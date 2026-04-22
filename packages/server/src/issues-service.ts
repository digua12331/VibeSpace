import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve as resolvePath, relative as relativePath, sep } from "node:path";

export interface IssueItem {
  /** 1-based line number in dev/issues.md. */
  line: number;
  /** Original text after the checkbox marker. */
  text: string;
  done: boolean;
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

function parseItems(content: string): IssueItem[] {
  const out: IssueItem[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const m = LINE_RE.exec(lines[i]);
    if (!m) continue;
    out.push({
      line: i + 1,
      text: m[2],
      done: m[1] !== " ",
    });
  }
  return out;
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
