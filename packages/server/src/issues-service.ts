import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve as resolvePath, relative as relativePath, sep } from "node:path";
import { createHash } from "node:crypto";

export interface IssueItem {
  /** 1-based line number in dev/issues.md. */
  line: number;
  /** Text after the checkbox marker, with the optional `[auto]` prefix stripped. */
  text: string;
  done: boolean;
  /** Whether the line is tagged `[auto]` and eligible for batch dispatch. */
  auto: boolean;
  /** Stable id for cross-edit lookup: first 16 hex chars of sha1(text after auto strip). */
  hash: string;
}

export interface IssuesPayload {
  /** Project-relative POSIX path, e.g. "dev/issues.md". */
  path: string;
  /** Raw file content — empty string when the file does not exist. */
  content: string;
  items: IssueItem[];
  updatedAt: number;
}

export class IssuesServiceError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const ISSUES_REL_PATH = "dev/issues.md";

function issuesAbsPath(projectPath: string): string {
  return join(projectPath, "dev", "issues.md");
}

/**
 * Guard against path traversal. Mirrors the pattern used in docs-service.ts —
 * the issues file must stay under <projectPath>/dev.
 */
function assertContained(projectPath: string, candidate: string): void {
  const projectAbs = resolvePath(projectPath);
  const devAbs = resolvePath(projectAbs, "dev");
  const abs = resolvePath(candidate);
  const rel = relativePath(devAbs, abs);
  if (rel.startsWith("..") || rel.startsWith(`..${sep}`) || rel === "..") {
    throw new IssuesServiceError("path_escape", "非法路径", 400);
  }
}

const LINE_RE = /^\s*[-*+]\s+\[( |x|X)\]\s+(.+?)\s*$/;
const AUTO_PREFIX_RE = /^\s*\[auto\]\s+/i;

function hashIssueText(text: string): string {
  return createHash("sha1").update(text, "utf8").digest("hex").slice(0, 16);
}

function parseItems(content: string): IssueItem[] {
  const out: IssueItem[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const m = LINE_RE.exec(lines[i]);
    if (!m) continue;
    const rawText = m[2];
    const auto = AUTO_PREFIX_RE.test(rawText);
    const text = auto ? rawText.replace(AUTO_PREFIX_RE, "") : rawText;
    out.push({
      line: i + 1,
      text,
      done: m[1] !== " ",
      auto,
      hash: hashIssueText(text),
    });
  }
  return out;
}

/**
 * Locate an issue by its stable hash. Returns null when absent (e.g. the line
 * was edited so the hash no longer matches anything).
 */
export function findIssueByHash(items: IssueItem[], hash: string): IssueItem | null {
  for (const it of items) {
    if (it.hash === hash) return it;
  }
  return null;
}

export async function readIssues(projectPath: string): Promise<IssuesPayload> {
  const abs = issuesAbsPath(projectPath);
  assertContained(projectPath, abs);
  if (!existsSync(abs)) {
    return { path: ISSUES_REL_PATH, content: "", items: [], updatedAt: 0 };
  }
  const content = await readFile(abs, "utf8");
  const st = await stat(abs);
  return {
    path: ISSUES_REL_PATH,
    content,
    items: parseItems(content),
    updatedAt: Math.round(st.mtimeMs),
  };
}
