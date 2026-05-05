/**
 * Dynamic slash-command scanner — 给悬浮输入框 `/` 菜单提供动态候选。
 *
 * 与 `skill-catalog-service.ts` 的关系：
 * - 那边是 UI 管理 skill 增删的服务，agent type 命名 `claude-code|codex|opencode`
 *   并返回结构化 `SkillEntry`。
 * - 本文件只为输入框补全服务，agent 命名直接用 session.agent（`claude` /
 *   `codex` / `gemini` / 其它 shell），返回带 `/` 前缀的字符串数组。
 *
 * 故意不复用 skill-catalog 的扫描函数：返回结构、agent 命名空间、是否扫
 * commands 目录都不同，硬抽公共 helper 反而绕弯。
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface AgentSlashSpec {
  /** Folders whose direct children are skill folders containing SKILL.md. */
  skillDirs: string[];
  /** Folders whose direct children are command files matched by `fileExts`. */
  commandDirs: string[];
  /** Allowed file extensions (with leading dot) for command files. */
  fileExts: string[];
}

/** Names accepted as slash command tokens. `:` allows codex-plugin-style names. */
const NAME_RE = /^[A-Za-z0-9_.\-:]+$/;

function specsFor(agent: string, projectPath: string): AgentSlashSpec {
  const home = homedir();
  switch (agent) {
    case "claude":
      return {
        skillDirs: [
          join(home, ".claude", "skills"),
          join(projectPath, ".claude", "skills"),
        ],
        commandDirs: [
          join(home, ".claude", "commands"),
          join(projectPath, ".claude", "commands"),
        ],
        fileExts: [".md"],
      };
    case "codex":
      return {
        skillDirs: [
          join(home, ".codex", "skills"),
          join(projectPath, ".codex", "skills"),
        ],
        commandDirs: [
          join(home, ".codex", "commands"),
          join(projectPath, ".codex", "commands"),
        ],
        fileExts: [".md"],
      };
    case "gemini":
      return {
        skillDirs: [],
        commandDirs: [
          join(home, ".gemini", "commands"),
          join(projectPath, ".gemini", "commands"),
        ],
        fileExts: [".toml", ".md"],
      };
    default:
      // shell / cmd / pwsh / opencode / qoder / kilo / unknown → 不扫。
      return { skillDirs: [], commandDirs: [], fileExts: [] };
  }
}

function listSkillFolderNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const n of names) {
    if (!NAME_RE.test(n)) continue;
    const full = join(dir, n);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    if (!existsSync(join(full, "SKILL.md"))) continue;
    out.push(n);
  }
  return out;
}

function listCommandFileNames(dir: string, exts: string[]): string[] {
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const n of names) {
    const ext = exts.find((e) => n.endsWith(e));
    if (!ext) continue;
    const base = n.slice(0, -ext.length);
    if (!NAME_RE.test(base)) continue;
    out.push(base);
  }
  return out;
}

export function scanDynamicSlashCommands(args: {
  agent: string;
  projectPath: string;
}): string[] {
  const spec = specsFor(args.agent, args.projectPath);
  const seen = new Set<string>();
  const out: string[] = [];
  function add(name: string): void {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(`/${name}`);
  }
  for (const d of spec.skillDirs) {
    for (const n of listSkillFolderNames(d)) add(n);
  }
  for (const d of spec.commandDirs) {
    for (const n of listCommandFileNames(d, spec.fileExts)) add(n);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}
