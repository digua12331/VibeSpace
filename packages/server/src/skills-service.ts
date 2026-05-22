import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { serverLog } from "./log-bus.js";

export interface SkillEntry {
  /** Filename without extension. */
  name: string;
  /** Substrings (case-insensitive) that activate this skill. */
  triggers: string[];
  /** Skill body (everything after the closing `---` of the frontmatter). */
  body: string;
}

/** A skill matched for a task, tagged with where it came from. */
export interface MatchedSkill {
  skill: SkillEntry;
  source: "global" | "project";
}

const SKILLS_SUBDIR = ".aimon/skills";

/**
 * Home-directory global skill pool. Lets a skill be installed once and pick up
 * across every project a VibeSpace session is started in. Project-level skills
 * of the same name always override the global one (see pickSkillsForTask).
 *
 * `AIMON_GLOBAL_SKILLS_DIR` overrides the default — used by the smoke test to
 * point at a temp dir instead of the real ~/.aimon/skills.
 */
function resolveGlobalSkillsDir(): string {
  const override = process.env.AIMON_GLOBAL_SKILLS_DIR;
  if (override && override.trim()) return override;
  return join(homedir(), ".aimon", "skills");
}

/**
 * Strip a leading frontmatter block delimited by `---` lines and return
 * { fields, body }. Tolerant of:
 *   - missing frontmatter (returns body = whole text, fields = {})
 *   - inline arrays `triggers: [a, b, c]`
 *   - block arrays
 *       triggers:
 *         - a
 *         - b
 *
 * Intentionally simple — we don't depend on `gray-matter` for 30 lines of work.
 */
function parseFrontmatter(raw: string): { fields: Record<string, unknown>; body: string } {
  const lines = raw.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== "---") {
    return { fields: {}, body: raw };
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx < 0) {
    // unterminated frontmatter — treat as plain body to avoid swallowing user content
    return { fields: {}, body: raw };
  }

  const fields: Record<string, unknown> = {};
  let currentArrayKey: string | null = null;

  for (let i = 1; i < endIdx; i++) {
    const line = lines[i];
    if (!line.trim()) {
      currentArrayKey = null;
      continue;
    }
    // block array continuation: "  - value"
    const blockArrayMatch = /^\s*-\s+(.*)$/.exec(line);
    if (blockArrayMatch && currentArrayKey) {
      const arr = (fields[currentArrayKey] as unknown[] | undefined) ?? [];
      arr.push(blockArrayMatch[1].trim());
      fields[currentArrayKey] = arr;
      continue;
    }
    // key: value
    const kvMatch = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kvMatch) {
      currentArrayKey = null;
      continue;
    }
    const key = kvMatch[1];
    const value = kvMatch[2].trim();
    if (value === "") {
      // start of a block array (or scalar pending — we treat it as array start)
      fields[key] = [];
      currentArrayKey = key;
    } else if (value.startsWith("[") && value.endsWith("]")) {
      // inline array
      const inner = value.slice(1, -1).trim();
      if (inner === "") {
        fields[key] = [];
      } else {
        fields[key] = inner
          .split(",")
          .map((s) => s.trim())
          .map((s) => s.replace(/^['"]|['"]$/g, ""))
          .filter((s) => s.length > 0);
      }
      currentArrayKey = null;
    } else {
      fields[key] = value.replace(/^['"]|['"]$/g, "");
      currentArrayKey = null;
    }
  }

  const body = lines.slice(endIdx + 1).join("\n").replace(/^\n+/, "");
  return { fields, body };
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

// 模块级缓存：扫描目录绝对路径 → { dirMtimeMs, filesSig, skills }
// - dirMtimeMs：目录的 mtime（增删文件时变）
// - filesSig：所有 .md 文件名 + mtime 的拼接签名（文件内容编辑时变）
// 命中时跳过 readFile + parseFrontmatter，把每次 spawn 的 ~20ms 压到 ~1ms。
// key 是扫描目录本身（项目级 .aimon/skills 或家目录全局池），所以项目级与全局
// 池各有独立缓存项，互不失效。
// 已知缺陷：mtime 是秒级精度，1 秒内连改两次同文件可能读旧缓存——日志
// `cache=hit/miss` 是用户报"skill 改了不生效"时的排障入口。
interface SkillsCacheEntry {
  dirMtimeMs: number;
  filesSig: string;
  skills: SkillEntry[];
}
const skillsCache = new Map<string, SkillsCacheEntry>();

async function readSignature(
  dir: string,
): Promise<{ dirMtimeMs: number; filesSig: string; mdNames: string[] } | null> {
  let dirStat;
  try {
    dirStat = await stat(dir);
  } catch {
    return null;
  }
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const mdNames = names.filter((n) => n.endsWith(".md")).sort();
  // 拿每个 .md 文件 mtime 拼签名。N 个文件 N 次 stat，但 stat 是元数据
  // OS cache 友好，10 个 skill 文件 ~100us，比 readFile + parse 快 20x。
  const sigs: string[] = [];
  for (const fname of mdNames) {
    try {
      const s = await stat(join(dir, fname));
      sigs.push(`${fname}:${s.mtimeMs}`);
    } catch {
      // 文件刚被删 → 跳过；下一次签名会因 readdir 不再列出它而变化
    }
  }
  return {
    dirMtimeMs: dirStat.mtimeMs,
    filesSig: sigs.join("|"),
    mdNames,
  };
}

/**
 * Scan a single directory for `<name>.md` skill files. Returns [] when the
 * directory does not exist (feature simply stays hidden). A single malformed
 * file is skipped with a `warn` log — it never breaks the rest of the scan.
 *
 * Shared by both the project-level and the global pool — there is exactly one
 * scanning code path, parameterised only by directory.
 */
async function scanSkillsDir(dir: string): Promise<SkillEntry[]> {
  if (!existsSync(dir)) return [];

  const sig = await readSignature(dir);
  if (!sig) return [];

  const cached = skillsCache.get(dir);
  if (
    cached &&
    cached.dirMtimeMs === sig.dirMtimeMs &&
    cached.filesSig === sig.filesSig
  ) {
    serverLog("info", "skills", "scan-skills 命中缓存 (cache=hit)", {
      meta: { dir, count: cached.skills.length, cache: "hit" },
    });
    return cached.skills;
  }

  const out: SkillEntry[] = [];
  for (const fname of sig.mdNames) {
    const full = join(dir, fname);
    let raw: string;
    try {
      raw = await readFile(full, "utf8");
    } catch (err) {
      serverLog("warn", "skills", "skill 文件读取失败，已跳过", {
        meta: { dir, file: fname, error: String((err as Error).message ?? err) },
      });
      continue;
    }
    const parsed = parseFrontmatter(raw);
    const triggers = asStringArray(parsed.fields.triggers);
    if (triggers.length === 0) {
      // 无 triggers 字段（frontmatter 缺失/写坏/忘了写）→ 无法被任何任务命中。
      // 跳过，但记一条 warn 指明是哪个文件，方便用户排查 "skill 不生效"。
      serverLog("warn", "skills", "skill 缺少 triggers，已跳过（无法被任何任务命中）", {
        meta: { dir, file: fname },
      });
      continue;
    }
    out.push({
      name: fname.replace(/\.md$/, ""),
      triggers,
      body: parsed.body.trim(),
    });
  }
  // Stable order: filename ascending — keeps output reproducible.
  out.sort((a, b) => a.name.localeCompare(b.name));

  skillsCache.set(dir, {
    dirMtimeMs: sig.dirMtimeMs,
    filesSig: sig.filesSig,
    skills: out,
  });
  serverLog("info", "skills", "scan-skills 重扫缓存 (cache=miss)", {
    meta: { dir, count: out.length, cache: "miss" },
  });
  return out;
}

/** Project-level skills: `<projectPath>/.aimon/skills/*.md`. */
export async function listSkills(projectPath: string): Promise<SkillEntry[]> {
  return scanSkillsDir(join(projectPath, SKILLS_SUBDIR));
}

/** Global skill pool: `~/.aimon/skills/*.md` (or AIMON_GLOBAL_SKILLS_DIR). */
export async function listGlobalSkills(): Promise<SkillEntry[]> {
  return scanSkillsDir(resolveGlobalSkillsDir());
}

/**
 * Pick skills whose any trigger appears (case-insensitive) inside `taskName`,
 * drawn from BOTH the global pool and the project's own skills.
 *
 * Merge rule: a project-level skill OVERRIDES a global one with the same name
 * (filename stem). Order of the result is filename ascending — stable, so the
 * runtime prompt is reproducible.
 *
 * Empty / missing taskName → no matches.
 */
export async function pickSkillsForTask(
  projectPath: string,
  taskName: string | null | undefined,
): Promise<MatchedSkill[]> {
  if (!taskName) return [];

  const [globalSkills, projectSkills] = await Promise.all([
    listGlobalSkills(),
    listSkills(projectPath),
  ]);

  // Project overrides global: insert global first, then let project entries
  // replace same-name keys.
  const byName = new Map<string, MatchedSkill>();
  for (const s of globalSkills) byName.set(s.name, { skill: s, source: "global" });
  for (const s of projectSkills) byName.set(s.name, { skill: s, source: "project" });

  const haystack = taskName.toLowerCase();
  const matched = [...byName.values()].filter((m) =>
    m.skill.triggers.some((t) => haystack.includes(t.toLowerCase())),
  );
  matched.sort((a, b) => a.skill.name.localeCompare(b.skill.name));
  return matched;
}

export function buildRuntimePrompt(skills: SkillEntry[]): string {
  if (skills.length === 0) return "";
  const sections = skills.map((s) => `## skill: ${s.name}\n\n${s.body}`);
  return [
    "<!-- Generated by VibeSpace skills-service. Read this file via",
    "     env AIMON_SESSION_PROMPT_PATH if you want the activated skills",
    "     to influence your behaviour for this session. -->",
    "",
    sections.join("\n\n---\n\n"),
    "",
  ].join("\n");
}
