/**
 * Read/write `~/.claude.json` — Claude Code's user-global state file. Used to
 * manage `projects.<absPath>.disabledMcpServers` arrays, which is the official
 * (and currently only) mechanism for **per-project** MCP server disable.
 *
 * Why this file and not `settings.json`:
 *  - Claude Code 官方文档：disabledMcpServers 只识别 ~/.claude.json projects 段，
 *    settings.json 不支持。`claude mcp disable/enable` CLI 还在 issue 阶段。
 *
 * Concurrency / safety:
 *  - File is 60+KB and Claude Code itself writes to it. Every patch re-reads
 *    from disk before merging; writes go through tmp+rename (atomic on Win/POSIX).
 *  - Never touches top-level keys outside `projects.<key>.disabledMcpServers`
 *    — preserves Claude Code's own state (numStartups / tipsHistory /
 *    hasClaudeMdExternalIncludesApproved / cachedGrowthBookFeatures …).
 *
 * Path-key matching (Windows quirks):
 *  - Claude Code stores project keys with the path that was current when it
 *    first touched the project — mixed `\` / `/`, mixed drive-letter case.
 *  - We match in this order: exact → case-insensitive + separator-normalized.
 *  - Found existing key → reuse it (don't fork a second key for the same project).
 *  - No match → create a new key with the caller-supplied absolute path.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

function claudeJsonPath(): string {
  return join(homedir(), ".claude.json");
}

export interface ClaudeJsonProjectShape {
  mcpServers?: Record<string, unknown>;
  disabledMcpServers?: string[];
  [key: string]: unknown;
}

export interface ClaudeJsonShape {
  mcpServers?: Record<string, unknown>;
  projects?: Record<string, ClaudeJsonProjectShape>;
  [key: string]: unknown;
}

export interface ClaudeJsonRead {
  data: ClaudeJsonShape;
  exists: boolean;
  parseError?: string;
}

export function getClaudeJsonPath(): string {
  return claudeJsonPath();
}

export function readClaudeJson(): ClaudeJsonRead {
  const path = claudeJsonPath();
  if (!existsSync(path)) {
    return { data: {}, exists: false };
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        data: {},
        exists: true,
        parseError: "~/.claude.json 顶层不是对象",
      };
    }
    return { data: parsed as ClaudeJsonShape, exists: true };
  } catch (err) {
    return {
      data: {},
      exists: true,
      parseError: (err as Error).message,
    };
  }
}

function normalize(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

/**
 * Find the key in `projects` that matches the given absolute path. Returns
 * the matched key string, or `null` if no match found. Caller may then use
 * the original path as a new key.
 */
export function findProjectKey(
  projects: Record<string, ClaudeJsonProjectShape>,
  absPath: string,
): string | null {
  if (Object.prototype.hasOwnProperty.call(projects, absPath)) return absPath;
  const target = normalize(absPath);
  for (const key of Object.keys(projects)) {
    if (normalize(key) === target) return key;
  }
  return null;
}

/** Snapshot of MCP servers visible to a given project, from the user-global
 *  `~/.claude.json.mcpServers`. Does **not** include `<proj>/.mcp.json` —
 *  callers compose that themselves. */
export function getGlobalMcpServers(): Record<string, { command?: string; args?: string[] }> {
  const r = readClaudeJson();
  if (r.parseError) return {};
  const ms = r.data.mcpServers;
  if (!ms || typeof ms !== "object" || Array.isArray(ms)) return {};
  const out: Record<string, { command?: string; args?: string[] }> = {};
  for (const [k, v] of Object.entries(ms)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const row = v as Record<string, unknown>;
      out[k] = {
        command: typeof row.command === "string" ? row.command : undefined,
        args: Array.isArray(row.args) ? row.args.filter((a): a is string => typeof a === "string") : undefined,
      };
    }
  }
  return out;
}

export function getDisabledMcpServersForProject(absPath: string): string[] {
  const r = readClaudeJson();
  if (r.parseError) return [];
  const projects = r.data.projects ?? {};
  const key = findProjectKey(projects, absPath);
  if (!key) return [];
  const arr = projects[key].disabledMcpServers;
  return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === "string") : [];
}

export function isMcpDisabledForProject(absPath: string, mcpName: string): boolean {
  return getDisabledMcpServersForProject(absPath).includes(mcpName);
}

/**
 * Atomic patch: re-read disk, set the project's `disabledMcpServers` array,
 * preserve every other top-level key and every other project key intact.
 *
 *  - `names = []` → remove `disabledMcpServers` from that project entry
 *  - Existing path-key reused if found via `findProjectKey`; otherwise the
 *    caller's `absPath` becomes a new key.
 *  - Throws on existing parse error (refuses to overwrite corrupted file).
 */
export function setDisabledMcpServersForProject(
  absPath: string,
  names: string[],
): void {
  const path = claudeJsonPath();
  mkdirSync(dirname(path), { recursive: true });

  const fresh = readClaudeJson();
  if (fresh.parseError) {
    throw new Error(
      `无法解析现有 ~/.claude.json：${fresh.parseError}（拒绝覆盖损坏的配置文件）`,
    );
  }
  const data: ClaudeJsonShape = { ...fresh.data };
  const projects = { ...(data.projects ?? {}) };
  const existingKey = findProjectKey(projects, absPath);
  const key = existingKey ?? absPath;
  const project: ClaudeJsonProjectShape = { ...(projects[key] ?? {}) };
  if (names.length === 0) {
    delete project.disabledMcpServers;
  } else {
    project.disabledMcpServers = [...new Set(names)];
  }
  projects[key] = project;
  data.projects = projects;

  const tmp = path + ".aimon-tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  renameSync(tmp, path);
}
