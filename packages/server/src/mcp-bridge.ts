/**
 * Inject browser-use MCP server config into the right place per agent so that
 * a freshly-spawned claude / codex session sees `mcp__browser-use__*` tools
 * out of the box.
 *
 * Dispatch (Phase 1, hard-coded):
 *   - `claude`  → `<projectPath>/.mcp.json` (project-scoped MCP entrypoint)
 *   - `codex`   → `~/.codex/config.toml`     `[mcp_servers.browser-use]`
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
import { getHubWorkspaceDir } from "./hub-workspace.js";

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
      await injectHubMcps(sessionId);
      return;
    }
    if (agent === "claude") {
      await injectClaude(projectPath, sessionId, projectId);
    } else if (agent === "codex") {
      await injectCodex(sessionId, projectId);
    }
    // other agents: no-op (Phase 1 supports only claude / codex)
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

async function injectClaude(
  projectPath: string,
  sessionId: string,
  projectId?: string,
): Promise<void> {
  const target = join(projectPath, ".mcp.json");
  const targetForLog = target.replace(/\\/g, "/");
  const t0 = Date.now();
  serverLog("info", "installer", "inject-mcp-browseruse 开始", {
    projectId,
    sessionId,
    meta: { agent: "claude", configPath: targetForLog },
  });

  let existing: Record<string, unknown> = {};
  try {
    const raw = await readFile(target, "utf8");
    if (raw.trim()) existing = JSON.parse(raw) as Record<string, unknown>;
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
            agent: "claude",
            configPath: targetForLog,
            error: { name: e.name, message: e.message, stack: e.stack },
          },
        },
      );
      return;
    }
  }

  const servers = (existing.mcpServers ?? {}) as Record<string, ClaudeMcpEntry>;
  const cur = servers[MCP_KEY];
  if (cur && deepEqualEntry(cur, DESIRED_ENTRY)) {
    serverLog(
      "info",
      "installer",
      `inject-mcp-browseruse 成功 (${Date.now() - t0}ms, 无变化)`,
      {
        projectId,
        sessionId,
        meta: { agent: "claude", configPath: targetForLog, changed: false },
      },
    );
    return;
  }

  const next = {
    ...existing,
    mcpServers: { ...servers, [MCP_KEY]: DESIRED_ENTRY },
  };

  const tmp = target + ".aimon-tmp";
  await writeFile(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  await rename(tmp, target);

  serverLog(
    "info",
    "installer",
    `inject-mcp-browseruse 成功 (${Date.now() - t0}ms)`,
    {
      projectId,
      sessionId,
      meta: { agent: "claude", configPath: targetForLog, changed: true },
    },
  );
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
