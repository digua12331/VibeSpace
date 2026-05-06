/**
 * Skill catalog service — 管理 Anthropic 标准 skill（文件夹 + SKILL.md）。
 *
 * 与 `skills-service.ts` 区分：
 * - skills-service.ts → `.aimon/skills/<name>.md`（VibeSpace 内部 hook 注入）
 * - 本文件               → `.claude|.codex|.opencode/skill[s]/<name>/SKILL.md`
 *                          （AI CLI 自身 skill 系统，由各 CLI 直接读取）
 *
 * 路径表与 cgx2012/skill-manager 对齐。
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type SkillAgentType = "claude-code" | "codex" | "opencode";

export const SKILL_AGENT_TYPES: readonly SkillAgentType[] = [
  "claude-code",
  "codex",
  "opencode",
] as const;

interface AgentDirSpec {
  /** Project-relative paths to scan, in priority order. add() writes the first. */
  project: readonly string[];
  /** Absolute global paths to scan. add() does not write here. */
  global: readonly string[];
}

const AGENT_SKILL_DIRS: Record<SkillAgentType, AgentDirSpec> = {
  "claude-code": {
    project: [".claude/skills"],
    global: [join(homedir(), ".claude", "skills")],
  },
  codex: {
    project: [".codex/skills"],
    global: [join(homedir(), ".codex", "skills")],
  },
  opencode: {
    project: [".opencode/skill", ".opencode/skills"],
    global: [
      join(homedir(), ".config", "opencode", "skill"),
      join(homedir(), ".config", "opencode", "skills"),
      join(homedir(), ".agents", "skill"),
      join(homedir(), ".agents", "skills"),
    ],
  },
};

export interface SkillEntry {
  /** Folder name (used as id and as filename when adding). */
  id: string;
  /** Display name from frontmatter `name`, fallback to folder name. */
  name: string;
  /** Description from frontmatter `description`, truncated 200 chars. */
  description: string;
  /** Absolute path to the skill folder. */
  path: string;
  /** "project" or "global", set by caller. */
  source: "project" | "global";
  /** True if this is a symlink (shows up differently in UI). */
  isSymlink: boolean;
}

export interface SkillCatalogResult {
  project: SkillEntry[];
  global: SkillEntry[];
}

export class SkillCatalogError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus: number,
  ) {
    super(message);
  }
}

const SKILL_NAME_RE = /^[A-Za-z0-9_.\-]+$/;

function assertValidSkillName(name: string): void {
  if (!name || !SKILL_NAME_RE.test(name)) {
    throw new SkillCatalogError(
      `Invalid skill name: ${name}`,
      "invalid_skill_name",
      400,
    );
  }
}

function assertValidAgent(agentType: string): asserts agentType is SkillAgentType {
  if (!SKILL_AGENT_TYPES.includes(agentType as SkillAgentType)) {
    throw new SkillCatalogError(
      `Unknown agent type: ${agentType}`,
      "invalid_agent_type",
      400,
    );
  }
}

/**
 * Parse a SKILL.md file and return display metadata.
 * Tolerant of: missing file, missing frontmatter, malformed frontmatter.
 * Mirrors the simplified parser used by upstream skill-manager — we deliberately
 * avoid pulling in `gray-matter` for ~30 lines of work.
 */
export function parseSkillManifest(skillDir: string): {
  name: string;
  description: string;
} {
  const fallbackName = skillDir.split(/[\\/]/).pop() ?? skillDir;
  const manifestPath = join(skillDir, "SKILL.md");
  if (!existsSync(manifestPath)) {
    return { name: fallbackName, description: "" };
  }
  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch {
    return { name: fallbackName, description: "" };
  }
  if (raw.startsWith("---")) {
    const end = raw.indexOf("---", 3);
    if (end > 3) {
      const fm = raw.slice(3, end);
      const nameMatch = /^name\s*:\s*(.+)$/m.exec(fm);
      const descMatch = /^description\s*:\s*(.+)$/m.exec(fm);
      if (nameMatch) {
        return {
          name: nameMatch[1].trim().replace(/^['"]|['"]$/g, ""),
          description: (descMatch?.[1].trim() ?? "")
            .replace(/^['"]|['"]$/g, "")
            .slice(0, 200),
        };
      }
    }
  }
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const name = lines[0]?.replace(/^#+\s*/, "").trim() || fallbackName;
  const description = lines.slice(1).join(" ").trim().slice(0, 200);
  return { name, description };
}

function scanOneDir(dir: string, source: "project" | "global"): SkillEntry[] {
  if (!existsSync(dir)) return [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: SkillEntry[] = [];
  for (const name of names) {
    const full = join(dir, name);
    let stat;
    try {
      stat = lstatSync(full);
    } catch {
      continue;
    }
    const isSymlink = stat.isSymbolicLink();
    // Symlink to a directory still scans; we want to display it.
    let isDir = stat.isDirectory();
    if (!isDir && isSymlink) {
      try {
        isDir = lstatSync(full).isDirectory() || existsSync(join(full, "SKILL.md"));
      } catch {
        // ignore
      }
    }
    if (!isDir && !isSymlink) continue;
    // Require SKILL.md to be considered a skill (matches upstream).
    if (!existsSync(join(full, "SKILL.md"))) continue;
    const { name: displayName, description } = parseSkillManifest(full);
    out.push({
      id: name,
      name: displayName,
      description,
      path: full,
      source,
      isSymlink,
    });
  }
  return out;
}

function dedupeById(entries: SkillEntry[]): SkillEntry[] {
  const seen = new Set<string>();
  const out: SkillEntry[] = [];
  for (const e of entries) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

export function scanSkills(
  projectPath: string,
  agentType: SkillAgentType,
): SkillCatalogResult {
  const spec = AGENT_SKILL_DIRS[agentType];
  const project: SkillEntry[] = [];
  for (const sub of spec.project) {
    project.push(...scanOneDir(join(projectPath, sub), "project"));
  }
  const global: SkillEntry[] = [];
  for (const abs of spec.global) {
    global.push(...scanOneDir(abs, "global"));
  }
  // Stable order by display name.
  project.sort((a, b) => a.name.localeCompare(b.name));
  global.sort((a, b) => a.name.localeCompare(b.name));
  return {
    project: dedupeById(project),
    global: dedupeById(global),
  };
}

/**
 * Add a skill folder into the project. Source can be a global skill dir or
 * any user-supplied path. Always validates source contains SKILL.md.
 *
 * `useSymlink`:
 *  - true → symlinkSync; falls back to copy on EPERM (Windows w/o developer
 *    mode is the typical case).
 *  - false (default) → cpSync recursive copy.
 */
export function addSkill(args: {
  projectPath: string;
  agentType: SkillAgentType;
  srcPath: string;
  useSymlink?: boolean;
}): { mode: "copy" | "symlink"; targetPath: string; fellBackToCopy: boolean } {
  const { projectPath, agentType, srcPath, useSymlink = false } = args;

  if (!existsSync(srcPath)) {
    throw new SkillCatalogError(
      `Source skill folder not found: ${srcPath}`,
      "src_not_found",
      400,
    );
  }
  let stat;
  try {
    stat = lstatSync(srcPath);
  } catch {
    throw new SkillCatalogError(
      `Cannot stat source: ${srcPath}`,
      "src_not_found",
      400,
    );
  }
  if (!stat.isDirectory() && !stat.isSymbolicLink()) {
    throw new SkillCatalogError(
      `Source is not a directory: ${srcPath}`,
      "src_not_directory",
      400,
    );
  }
  if (!existsSync(join(srcPath, "SKILL.md"))) {
    throw new SkillCatalogError(
      `Source does not contain SKILL.md: ${srcPath}`,
      "src_missing_manifest",
      400,
    );
  }

  const skillName = srcPath.split(/[\\/]/).pop() ?? "";
  assertValidSkillName(skillName);

  const spec = AGENT_SKILL_DIRS[agentType];
  const targetDir = join(projectPath, spec.project[0]);
  const targetPath = join(targetDir, skillName);

  if (existsSync(targetPath)) {
    throw new SkillCatalogError(
      `Skill already exists in project: ${skillName}`,
      "already_exists",
      409,
    );
  }

  mkdirSync(targetDir, { recursive: true });

  if (useSymlink) {
    try {
      symlinkSync(srcPath, targetPath, "dir");
      return { mode: "symlink", targetPath, fellBackToCopy: false };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (code !== "EPERM" && code !== "EACCES") throw err;
      // Fall back to copy on Windows-without-developer-mode case.
      cpSync(srcPath, targetPath, { recursive: true, dereference: true });
      return { mode: "copy", targetPath, fellBackToCopy: true };
    }
  }
  cpSync(srcPath, targetPath, { recursive: true, dereference: true });
  return { mode: "copy", targetPath, fellBackToCopy: false };
}

/**
 * Remove a skill from the project. Validates skillName cannot escape the
 * project's own skill directory (no `..`, no path separators, final resolved
 * path must startsWith resolved target dir).
 */
export function removeSkill(args: {
  projectPath: string;
  agentType: SkillAgentType;
  skillName: string;
}): { removedPath: string; wasSymlink: boolean } {
  const { projectPath, agentType, skillName } = args;
  assertValidSkillName(skillName);

  const spec = AGENT_SKILL_DIRS[agentType];
  // Find which of the (possibly multiple) project subdirs actually contains it.
  let targetPath = "";
  let targetDir = "";
  for (const sub of spec.project) {
    const candidateDir = join(projectPath, sub);
    const candidate = join(candidateDir, skillName);
    if (existsSync(candidate)) {
      targetDir = candidateDir;
      targetPath = candidate;
      break;
    }
  }
  if (!targetPath) {
    throw new SkillCatalogError(
      `Skill not found in project: ${skillName}`,
      "skill_not_found",
      404,
    );
  }

  // Belt-and-suspenders: even though SKILL_NAME_RE forbids it, double-check
  // that the resolved target actually lives under the project's skill dir.
  const resolvedTarget = resolve(targetPath);
  const resolvedDir = resolve(targetDir);
  if (!resolvedTarget.startsWith(resolvedDir)) {
    throw new SkillCatalogError(
      `Refusing to delete outside skill dir: ${resolvedTarget}`,
      "path_escape",
      400,
    );
  }

  const stat = lstatSync(resolvedTarget);
  const wasSymlink = stat.isSymbolicLink();
  if (wasSymlink) {
    unlinkSync(resolvedTarget);
  } else {
    rmSync(resolvedTarget, { recursive: true, force: true });
  }
  return { removedPath: resolvedTarget, wasSymlink };
}
