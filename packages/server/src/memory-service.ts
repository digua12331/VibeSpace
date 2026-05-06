import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve as resolvePath, relative as relativePath, sep } from "node:path";

export type MemoryFileKind = "auto" | "manual" | "rejected";

export type LessonSeverity = "info" | "warn" | "error";

export interface MemoryEntry {
  /** `lesson` = single-line entry parsed by LINE_RE；`raw` = 其他行（标题 / 空行 / 自由文本） */
  kind: "lesson" | "raw";
  /** 1-based line number in the source file */
  line: number;
  /** Full original line text (newline stripped) */
  text: string;
  /** Parsed ISO date when kind === "lesson" */
  date?: string;
  /** Parsed task name when kind === "lesson" */
  task?: string;
  /** Lesson body with the trailing `[k=v;...]` tag segment stripped. Falls back to the
   *  raw match when no valid tag segment is present. */
  body?: string;
  /** Optional structured tag — present only when the line has a valid trailing
   *  `[category=...; severity=...; files=...]` segment with at least one known key. */
  category?: string;
  severity?: LessonSeverity;
  files?: string[];
}

export interface MemoryPayload {
  auto: MemoryEntry[];
  manual: MemoryEntry[];
  rejected: MemoryEntry[];
  updatedAt: number;
}

export class MemoryServiceError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const MEMORY_DIR_REL = "dev/memory";
const FILE_NAMES: Record<MemoryFileKind, string> = {
  auto: "auto.md",
  manual: "manual.md",
  rejected: "rejected.md",
};

const HEADERS: Record<MemoryFileKind, string> = {
  auto: "# 自动沉淀（归档评审产出）\n\n> 这份文件由\"归档评审\"自动追加。归档任一任务时后端会调 codex/gemini 评审归档目录，把\"换个任务还会再用到\"的经验按单行格式追加到下方。\n> 条目格式：`- [<YYYY-MM-DD> / <任务名>] <结论>（上下文：<为什么会重复踩>）`。不要手动改这里的条目——UI「记忆」tab 勾选+撤回即可，撤回的条目会移到 `rejected.md`。\n",
  manual: "# 手动沉淀（长期经验，主理人写）\n\n> 这份文件由主理人手动维护，不会被自动评审改动。想沉淀一条\"换个任务还会用到的\"长期经验/约定/偏好，直接往下追加一行即可。\n> 建议条目格式与 auto.md 一致：`- [<YYYY-MM-DD> / <来源>] <结论>（上下文：...）`；非单行自然段也可以直接写，前端会以 `raw` 原文展示。\n",
  rejected: "# 已撤回（从 auto.md 移过来的历史）\n\n> 在 UI「记忆」tab 勾选 auto.md 条目并\"撤回\"后，原条目会连同撤回时间戳注释移到这里，保留历史便于日后反悔。\n> 每条前会自带一行 `<!-- rolled-back from auto.md at <ISO时间> -->` 注释，不要手动删除。\n",
};

const LINE_RE = /^- \[(\d{4}-\d{2}-\d{2}) \/ ([^\]]+)\] (.+)$/;

/** Match the *last* `[...]` segment at end-of-string. Non-greedy body lets the
 *  trailing bracket capture win even when the body contains earlier brackets
 *  (e.g. "看到 [error] 时…(结论) [category=约定]"). */
const TRAILING_TAG_RE = /^(.*?)\s*\[([^\[\]]+)\]\s*$/;

interface ParsedTagSegment {
  category?: string;
  severity?: LessonSeverity;
  files?: string[];
}

function isLessonSeverity(value: string): value is LessonSeverity {
  return value === "info" || value === "warn" || value === "error";
}

/**
 * Parse the inside of a trailing `[...]` segment. Returns `null` when the
 * segment cannot be interpreted as a tag (no `=`, no recognised keys, etc.) —
 * in that case the caller keeps the original body text intact (the brackets
 * stay as plain content).
 *
 * Wide-in / strict-out:
 *   - unknown keys are silently dropped
 *   - invalid `severity` values are dropped (other valid keys still apply)
 *   - any segment with at least one *recognised* key is considered a valid tag
 *   - `files=` splits on `,` and trims; empty entries are dropped (paths
 *     containing `,` are not supported by the schema and will be split)
 */
function parseTagSegment(tagStr: string): ParsedTagSegment | null {
  const parts = tagStr.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
  if (parts.length === 0) return null;
  const out: ParsedTagSegment = {};
  let recognised = false;
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq < 0) return null;
    const key = p.slice(0, eq).trim();
    const val = p.slice(eq + 1).trim();
    if (!key || !val) continue;
    if (key === "category") {
      out.category = val;
      recognised = true;
    } else if (key === "severity") {
      if (isLessonSeverity(val)) {
        out.severity = val;
        recognised = true;
      }
    } else if (key === "files") {
      const arr = val.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      if (arr.length > 0) {
        out.files = arr;
        recognised = true;
      }
    }
  }
  return recognised ? out : null;
}

function splitLessonBody(rawBody: string): { body: string; tag?: ParsedTagSegment } {
  const m = TRAILING_TAG_RE.exec(rawBody);
  if (!m) return { body: rawBody };
  const tag = parseTagSegment(m[2]);
  if (!tag) return { body: rawBody };
  return { body: m[1].trim(), tag };
}

/**
 * Render a lesson line with optional structured tags. Used by callers that
 * want to write a typed entry without hand-rolling the wire format.
 */
export function formatLessonLine(
  date: string,
  task: string,
  body: string,
  opts?: { category?: string; severity?: LessonSeverity; files?: string[] },
): string {
  const segs: string[] = [];
  if (opts?.category) segs.push(`category=${opts.category}`);
  if (opts?.severity && isLessonSeverity(opts.severity)) segs.push(`severity=${opts.severity}`);
  if (opts?.files && opts.files.length > 0) {
    const cleaned = opts.files
      .map((f) => f.trim())
      .filter((f) => f.length > 0 && !f.includes(","));
    if (cleaned.length > 0) segs.push(`files=${cleaned.join(",")}`);
  }
  const tail = segs.length > 0 ? ` [${segs.join("; ")}]` : "";
  return `- [${date} / ${task}] ${body.trim()}${tail}`;
}

function memoryDirAbs(projectPath: string): string {
  return join(projectPath, "dev", "memory");
}

function memoryFileAbs(projectPath: string, kind: MemoryFileKind): string {
  return join(memoryDirAbs(projectPath), FILE_NAMES[kind]);
}

function assertContained(projectPath: string, candidate: string): void {
  const projectAbs = resolvePath(projectPath);
  const memoryAbs = resolvePath(projectAbs, "dev", "memory");
  const abs = resolvePath(candidate);
  const rel = relativePath(memoryAbs, abs);
  if (rel.startsWith("..") || rel.startsWith(`..${sep}`) || rel === "..") {
    throw new MemoryServiceError("path_escape", "非法路径", 400);
  }
}

async function ensureMemoryFile(projectPath: string, kind: MemoryFileKind): Promise<string> {
  const abs = memoryFileAbs(projectPath, kind);
  assertContained(projectPath, abs);
  if (!existsSync(abs)) {
    await mkdir(memoryDirAbs(projectPath), { recursive: true });
    await writeFile(abs, HEADERS[kind], "utf8");
  }
  return abs;
}

function parseEntries(content: string): MemoryEntry[] {
  const out: MemoryEntry[] = [];
  const lines = content.split(/\r?\n/);
  // Drop trailing empty line produced by split when content ends with \n
  const last = lines.length > 0 ? lines.length - 1 : 0;
  const effectiveLength = lines[last] === "" ? last : lines.length;
  for (let i = 0; i < effectiveLength; i += 1) {
    const text = lines[i];
    const m = LINE_RE.exec(text);
    if (m) {
      const split = splitLessonBody(m[3]);
      out.push({
        kind: "lesson",
        line: i + 1,
        text,
        date: m[1],
        task: m[2],
        body: split.body,
        category: split.tag?.category,
        severity: split.tag?.severity,
        files: split.tag?.files,
      });
    } else {
      out.push({ kind: "raw", line: i + 1, text });
    }
  }
  return out;
}

async function readOne(projectPath: string, kind: MemoryFileKind): Promise<MemoryEntry[]> {
  const abs = await ensureMemoryFile(projectPath, kind);
  const content = await readFile(abs, "utf8");
  return parseEntries(content);
}

export async function readMemory(projectPath: string): Promise<MemoryPayload> {
  const [auto, manual, rejected] = await Promise.all([
    readOne(projectPath, "auto"),
    readOne(projectPath, "manual"),
    readOne(projectPath, "rejected"),
  ]);
  return { auto, manual, rejected, updatedAt: Date.now() };
}

/**
 * Append `entries` (one per line) to the given memory file. Each entry must
 * already be formatted — this function does not enforce the LINE_RE shape so
 * callers (review-runner) stay in control. Empty entries are skipped.
 */
export async function appendLessons(
  projectPath: string,
  kind: MemoryFileKind,
  entries: string[],
): Promise<void> {
  const filtered = entries.map((e) => e.trim()).filter((e) => e.length > 0);
  if (filtered.length === 0) return;
  const abs = await ensureMemoryFile(projectPath, kind);
  const existing = await readFile(abs, "utf8");
  const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n");
  const chunk = (needsLeadingNewline ? "\n" : "") + filtered.join("\n") + "\n";
  await appendFile(abs, chunk, "utf8");
}

export interface RollbackSelection {
  kind: "auto" | "manual";
  line: number;
}

/**
 * Move the selected lines from `auto.md` / `manual.md` to `rejected.md` with a
 * timestamp comment. Lines are identified by 1-based line numbers — the caller
 * must have obtained them via a fresh `readMemory` call (otherwise concurrent
 * edits would shift the indices).
 */
export async function rollbackLessons(
  projectPath: string,
  selections: RollbackSelection[],
): Promise<void> {
  if (selections.length === 0) return;
  const byKind: Record<"auto" | "manual", Set<number>> = {
    auto: new Set(),
    manual: new Set(),
  };
  for (const s of selections) {
    byKind[s.kind].add(s.line);
  }

  const rolledOut: string[] = [];
  const nowIso = new Date().toISOString();

  for (const kind of ["auto", "manual"] as const) {
    const lineSet = byKind[kind];
    if (lineSet.size === 0) continue;
    const abs = await ensureMemoryFile(projectPath, kind);
    const content = await readFile(abs, "utf8");
    const hadTrailingNewline = content.endsWith("\n");
    const lines = content.split(/\r?\n/);
    // split on trailing \n produces an empty tail — keep it so writes round-trip
    const endIdx = hadTrailingNewline && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;

    const kept: string[] = [];
    for (let i = 0; i < endIdx; i += 1) {
      const lineNum = i + 1;
      const text = lines[i];
      if (lineSet.has(lineNum) && LINE_RE.test(text)) {
        rolledOut.push(`<!-- rolled-back from ${FILE_NAMES[kind]} at ${nowIso} -->`);
        rolledOut.push(text);
      } else {
        kept.push(text);
      }
    }
    const next = kept.join("\n") + (hadTrailingNewline ? "\n" : "");
    await writeFile(abs, next, "utf8");
  }

  if (rolledOut.length > 0) {
    await appendLessons(projectPath, "rejected", rolledOut);
  }
}
