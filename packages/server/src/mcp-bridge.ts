/**
 * Inject browser-use MCP server config into the right place per agent.
 *
 * Dispatch:
 *   - `claude`  → **no auto-inject** (default OFF / opt-in). browser-use is only
 *     written to `<projectPath>/.mcp.json` when the user flips it ON in the MCP
 *     panel (via `writeBrowserUseToMcpJson`, called from the toggle route).
 *     Claude Code reads `.mcp.json` itself, so presence there IS the per-project
 *     "enabled" source of truth.
 *   - `codex`   → `~/.codex/config.toml` `[mcp_servers.browser-use]` (unchanged —
 *     codex config is global, per-project opt-in has no clean home there).
 *   - hub       → `injectHubMcps` (browser-use + aimon-hub, always on).
 *   - other     → no-op
 *
 * Behaviour contract:
 *   - Idempotent: re-running with the same desired entry leaves the file byte
 *     identical (deep-equal check before writing).
 *   - Atomic: writes go through a `.aimon-tmp` sibling then `rename`.
 *   - Best-effort: callers MUST `.catch(...)` — failure logs at error level
 *     but never throws further. Session start is not blocked.
 *   - Path normalization: file paths in log meta use forward slashes so the
 *     LogsView reads cleanly on Windows.
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serverLog } from "./log-bus.js";
import { HUB_PROJECT_ID } from "./hub-project.js";
import { getHubToken } from "./hub-token.js";
import { getHubWorkspaceDir, ensureHubBypassPermissions } from "./hub-workspace.js";

const MCP_KEY = "browser-use";
const HUB_MCP_KEY = "aimon-hub";

interface ClaudeMcpEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

const DESIRED_ENTRY: ClaudeMcpEntry = {
  command: "uvx",
  args: ["--from", "browser-use[cli]", "browser-use", "--mcp"],
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(__dirname, "..");
const MCP_HUB_BIN_PATH = resolve(SERVER_ROOT, "dist", "mcp-hub", "index.js");

/** Build the desired aimon-hub MCP entry for the current process (port + token). */
function buildHubEntry(): ClaudeMcpEntry {
  return {
    command: process.execPath,
    args: [MCP_HUB_BIN_PATH],
    env: {
      HUB_TOKEN: getHubToken(),
      AIMON_BACKEND_PORT: String(process.env.AIMON_PORT || 8787),
    },
  };
}

/**
 * Best-effort inject. Never throws — caller pattern is `await ... .catch(noop)`.
 *
 * **D4 (总控台体验对齐 plan)**: when `projectId === '__hub__'` we write to
 * `hub-workspace/.mcp.json` (containing both browser-use + aimon-hub). For
 * any other project we write only browser-use to the project root — normal
 * sessions must NOT see aimon-hub tools.
 */
export async function injectMcpForAgent(
  agent: string,
  projectPath: string,
  sessionId: string,
  projectId?: string,
): Promise<void> {
  try {
    if (projectId === HUB_PROJECT_ID) {
      // Hub project: merge browser-use + aimon-hub into hub-workspace/.mcp.json.
      // Both claude & codex inside hub workspace pick the same file up (claude
      // via cwd auto-discovery, codex via --mcp-config CLI flag).
      // 总控台权限全开——微信/飞书通道里用户点不了权限确认，hub claude 必须
      // bypassPermissions 才能跑通指令。
      ensureHubBypassPermissions();
      await injectHubMcps(sessionId);
      return;
    }
    if (agent === "codex") {
      await injectCodex(sessionId, projectId);
    }
    // claude: browser-use 默认不再自动注入（按需开启）—— 由 MCP 面板 toggle ON
    // 经 writeBrowserUseToMcpJson 写入 <project>/.mcp.json，Claude Code 自行读盘。
    // other agents: no-op.
  } catch (err) {
    const e = err as Error;
    serverLog(
      "error",
      "installer",
      `inject-mcp-browseruse 失败: ${e.message}`,
      {
        projectId,
        sessionId,
        meta: {
          agent,
          error: { name: e.name, message: e.message, stack: e.stack },
        },
      },
    );
  }
}

/**
 * Idempotent write: ensure `<projectPath>/.mcp.json` contains the browser-use
 * MCP entry, preserving every other entry. Returns `{changed:false}` when the
 * entry is already present and identical. Pure (no logging) — mirrors
 * `removeFromMcpJson`; the caller (MCP toggle ON) owns start/success logging.
 *
 * This is the ONLY writer of browser-use into a normal project's `.mcp.json`.
 * Sessions no longer auto-inject — Claude Code reads `.mcp.json` on its own, so
 * presence here is the per-project "enabled" source of truth.
 */
export async function writeBrowserUseToMcpJson(
  projectPath: string,
): Promise<{ changed: boolean }> {
  const target = join(projectPath, ".mcp.json");

  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(target, "utf8");
    if (raw.trim()) existing = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const servers = (existing.mcpServers ?? {}) as Record<string, ClaudeMcpEntry>;
  const cur = servers[MCP_KEY];
  if (cur && deepEqualEntry(cur, DESIRED_ENTRY)) {
    return { changed: false };
  }

  const next = {
    ...existing,
    mcpServers: { ...servers, [MCP_KEY]: DESIRED_ENTRY },
  };
  const tmp = target + ".aimon-tmp";
  await writeFile(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  await rename(tmp, target);
  return { changed: true };
}

/**
 * Reverse-cleanup: remove a single MCP entry from `<projectPath>/.mcp.json`
 * if present, preserve every other entry intact. Idempotent — returns
 * `{changed:false}` when there's nothing to do (file absent / entry not
 * present / parse error).
 *
 * Called by `PUT /api/mcp-servers/toggle` when the UI flips a project-scope
 * MCP off — the teardown that pairs with `writeBrowserUseToMcpJson`.
 */
export async function removeFromMcpJson(
  projectPath: string,
  mcpName: string,
): Promise<{ changed: boolean }> {
  const target = join(projectPath, ".mcp.json");

  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(target, "utf8");
    if (raw.trim()) existing = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { changed: false };
    }
    // Parse error / other read failure: don't touch the file; let caller decide.
    throw err;
  }

  const servers = (existing.mcpServers ?? {}) as Record<string, ClaudeMcpEntry>;
  if (!(mcpName in servers)) {
    return { changed: false };
  }

  const nextServers: Record<string, ClaudeMcpEntry> = { ...servers };
  delete nextServers[mcpName];
  const next =
    Object.keys(nextServers).length === 0
      ? (() => {
          const { mcpServers: _, ...rest } = existing;
          return rest;
        })()
      : { ...existing, mcpServers: nextServers };

  const tmp = target + ".aimon-tmp";
  await writeFile(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  await rename(tmp, target);
  return { changed: true };
}

function deepEqualEntry(a: ClaudeMcpEntry, b: ClaudeMcpEntry): boolean {
  if (a.command !== b.command) return false;
  if (a.args.length !== b.args.length) return false;
  for (let i = 0; i < a.args.length; i++) {
    if (a.args[i] !== b.args[i]) return false;
  }
  const ae = a.env ?? {};
  const be = b.env ?? {};
  const ak = Object.keys(ae);
  const bk = Object.keys(be);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (ae[k] !== be[k]) return false;
  return true;
}

async function injectCodex(
  sessionId: string,
  projectId?: string,
): Promise<void> {
  const target = join(homedir(), ".codex", "config.toml");
  const targetForLog = target.replace(/\\/g, "/");
  const t0 = Date.now();
  serverLog("info", "installer", "inject-mcp-browseruse 开始", {
    projectId,
    sessionId,
    meta: { agent: "codex", configPath: targetForLog },
  });

  await mkdir(dirname(target), { recursive: true });

  let existing = "";
  try {
    existing = await readFile(target, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      const e = err as Error;
      serverLog(
        "error",
        "installer",
        `inject-mcp-browseruse 失败: ${e.message}`,
        {
          projectId,
          sessionId,
          meta: {
            agent: "codex",
            configPath: targetForLog,
            error: { name: e.name, message: e.message, stack: e.stack },
          },
        },
      );
      return;
    }
  }

  const desiredBlock = [
    "[mcp_servers.browser-use]",
    'command = "uvx"',
    'args = ["--from", "browser-use[cli]", "browser-use", "--mcp"]',
  ].join("\n");

  // Match the section header up to (but not including) the next [section]
  // header or end-of-file. The leading delimiter — start-of-file or `\n` — is
  // captured separately so we can keep it on replace.
  const sectionRe = /(^|\n)\[mcp_servers\.browser-use\][\s\S]*?(?=\n\[|$)/;
  const m = sectionRe.exec(existing);

  let next: string;
  let changed = true;

  if (m) {
    const leadingNl = m[1];
    const sectionText = m[0].slice(leadingNl.length).trimEnd();
    if (sectionText === desiredBlock) {
      changed = false;
      next = existing;
    } else {
      next = existing.replace(sectionRe, leadingNl + desiredBlock);
    }
  } else {
    const sep =
      existing.length === 0
        ? ""
        : existing.endsWith("\n\n")
          ? ""
          : existing.endsWith("\n")
            ? "\n"
            : "\n\n";
    next = existing + sep + desiredBlock + "\n";
  }

  if (!changed) {
    serverLog(
      "info",
      "installer",
      `inject-mcp-browseruse 成功 (${Date.now() - t0}ms, 无变化)`,
      {
        projectId,
        sessionId,
        meta: { agent: "codex", configPath: targetForLog, changed: false },
      },
    );
    return;
  }

  const tmp = target + ".aimon-tmp";
  await writeFile(tmp, next, "utf8");
  await rename(tmp, target);

  serverLog(
    "info",
    "installer",
    `inject-mcp-browseruse 成功 (${Date.now() - t0}ms)`,
    {
      projectId,
      sessionId,
      meta: { agent: "codex", configPath: targetForLog, changed: true },
    },
  );
}

/**
 * Write `hub-workspace/.mcp.json` with both browser-use + aimon-hub. Hub
 * claude/codex sessions pick it up from their cwd (which is hub-workspace).
 *
 * Merges with any existing servers (preserves user-added entries; updates
 * aimon-hub when token / port rotated). Idempotent for steady-state runs.
 */
async function injectHubMcps(sessionId: string): Promise<void> {
  const target = join(getHubWorkspaceDir(), ".mcp.json");
  const targetForLog = target.replace(/\\/g, "/");
  const t0 = Date.now();
  serverLog("info", "installer", "inject-mcp-hub 开始", {
    projectId: HUB_PROJECT_ID,
    sessionId,
    meta: { configPath: targetForLog },
  });

  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(target, "utf8");
    if (raw.trim()) existing = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      const e = err as Error;
      serverLog("error", "installer", `inject-mcp-hub 失败: ${e.message}`, {
        projectId: HUB_PROJECT_ID,
        sessionId,
        meta: { configPath: targetForLog, error: { name: e.name, message: e.message } },
      });
      return;
    }
  }

  const servers = (existing.mcpServers ?? {}) as Record<string, ClaudeMcpEntry>;
  const hubEntry = buildHubEntry();

  // Idempotent check: both browser-use and aimon-hub already at desired shape.
  const browserOk = servers[MCP_KEY] && deepEqualEntry(servers[MCP_KEY], DESIRED_ENTRY);
  const hubOk = servers[HUB_MCP_KEY] && deepEqualEntry(servers[HUB_MCP_KEY], hubEntry);
  if (browserOk && hubOk) {
    serverLog(
      "info",
      "installer",
      `inject-mcp-hub 成功 (${Date.now() - t0}ms, 无变化)`,
      {
        projectId: HUB_PROJECT_ID,
        sessionId,
        meta: { configPath: targetForLog, changed: false },
      },
    );
    return;
  }

  const next = {
    ...existing,
    mcpServers: {
      ...servers,
      [MCP_KEY]: DESIRED_ENTRY,
      [HUB_MCP_KEY]: hubEntry,
    },
  };

  const tmp = target + ".aimon-tmp";
  await writeFile(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  await rename(tmp, target);

  serverLog(
    "info",
    "installer",
    `inject-mcp-hub 成功 (${Date.now() - t0}ms)`,
    {
      projectId: HUB_PROJECT_ID,
      sessionId,
      // 故意不记 HUB_TOKEN 进 meta — 防泄漏。
      meta: { configPath: targetForLog, changed: true, mergedKeys: Object.keys(next.mcpServers ?? {}) },
    },
  );
}
