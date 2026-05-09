import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
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

const SKILLS_SUBDIR = ".aimon/skills";

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

// 模块级缓存：projectPath → { dirMtimeMs, filesSig, skills }
// - dirMtimeMs：.aimon/skills 目录的 mtime（增删文件时变）
// - filesSig：所有 .md 文件名 + mtime 的拼接签名（文件内容编辑时变）
// 命中时跳过 readFile + parseFrontmatter，把每次 spawn 的 ~20ms 压到 ~1ms。
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

export async function listSkills(projectPath: string): Promise<SkillEntry[]> {
  const dir = join(projectPath, SKILLS_SUBDIR);
  if (!existsSync(dir)) return [];

  const sig = await readSignature(dir);
  if (!sig) return [];

  const cached = skillsCache.get(projectPath);
  if (
    cached &&
    cached.dirMtimeMs === sig.dirMtimeMs &&
    cached.filesSig === sig.filesSig
  ) {
    serverLog("info", "skills", "list-skills 命中缓存 (cache=hit)", {
      meta: { projectPath, count: cached.skills.length, cache: "hit" },
    });
    return cached.skills;
  }

  const out: SkillEntry[] = [];
  for (const fname of sig.mdNames) {
    const full = join(dir, fname);
    let raw: string;
    try {
      raw = await readFile(full, "utf8");
    } catch {
      continue;
    }
    let parsed: { fields: Record<string, unknown>; body: string };
    try {
      parsed = parseFrontmatter(raw);
    } catch {
      continue;
    }
    const triggers = asStringArray(parsed.fields.triggers);
    if (triggers.length === 0) continue; // skill without triggers can't match anything
    out.push({
      name: fname.replace(/\.md$/, ""),
      triggers,
      body: parsed.body.trim(),
    });
  }
  // Stable order: filename ascending — keeps output reproducible.
  out.sort((a, b) => a.name.localeCompare(b.name));

  skillsCache.set(projectPath, {
    dirMtimeMs: sig.dirMtimeMs,
    filesSig: sig.filesSig,
    skills: out,
  });
  serverLog("info", "skills", "list-skills 重扫缓存 (cache=miss)", {
    meta: { projectPath, count: out.length, cache: "miss" },
  });
  return out;
}

/**
 * Pick skills whose any trigger appears (case-insensitive) inside `taskName`.
 * Empty / missing taskName → no matches. Order follows listSkills (filename asc).
 */
export async function pickSkillsForTask(
  projectPath: string,
  taskName: string | null | undefined,
): Promise<SkillEntry[]> {
  if (!taskName) return [];
  const all = await listSkills(projectPath);
  if (all.length === 0) return [];
  const haystack = taskName.toLowerCase();
  return all.filter((s) =>
    s.triggers.some((t) => haystack.includes(t.toLowerCase())),
  );
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
