import { readFile, readdir, mkdir, writeFile, rename, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve as resolvePath, relative as relativePath, sep } from "node:path";

export type DocFileKind = "plan" | "context" | "tasks";

export interface DocTaskSummary {
  name: string;
  status: "todo" | "doing" | "done";
  checked: number;
  total: number;
  updatedAt: number;
}

export class DocsServiceError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const FORBIDDEN_CHARS = /[\\\/:*?"<>|]/;

function sanitizeTaskName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new DocsServiceError("invalid_name", "任务名不能为空");
  if (trimmed.length > 120)
    throw new DocsServiceError("invalid_name", "任务名过长（上限 120 字符）");
  if (FORBIDDEN_CHARS.test(trimmed))
    throw new DocsServiceError(
      "invalid_name",
      '任务名不能包含 / \\ : * ? " < > |',
    );
  if (trimmed === "." || trimmed === "..")
    throw new DocsServiceError("invalid_name", "非法任务名");
  return trimmed;
}

function docsRoot(projectPath: string): string {
  return join(projectPath, "dev");
}

function activeDir(projectPath: string): string {
  return join(docsRoot(projectPath), "active");
}

function archiveDir(projectPath: string): string {
  return join(docsRoot(projectPath), "archive");
}

function taskDir(projectPath: string, name: string): string {
  return join(activeDir(projectPath), name);
}

function fileName(task: string, kind: DocFileKind): string {
  return `${task}-${kind}.md`;
}

function filePath(projectPath: string, task: string, kind: DocFileKind): string {
  return join(taskDir(projectPath, task), fileName(task, kind));
}

/**
 * Guard against path traversal. Returns the resolved absolute path iff it is
 * contained under <projectPath>/dev. Throws otherwise.
 */
function assertContained(projectPath: string, candidate: string): string {
  const projectAbs = resolvePath(projectPath);
  const devAbs = resolvePath(projectAbs, "dev");
  const abs = resolvePath(candidate);
  const rel = relativePath(devAbs, abs);
  if (rel.startsWith("..") || rel.startsWith(`..${sep}`) || rel === "..") {
    throw new DocsServiceError("path_escape", "非法路径", 400);
  }
  return abs;
}

function planTemplate(task: string): string {
  return `# ${task} · 计划

## 目标

<这个任务要解决什么问题，完成后的验收标准>

## 实施步骤

1.
2.
3.

## 风险与注意

-
`;
}

function contextTemplate(task: string): string {
  return `# ${task} · 上下文

## 关键文件

-

## 决策记录

-
`;
}

function tasksTemplate(task: string): string {
  return `# ${task} · 任务清单

> 仅由 AI 在推进过程中维护；人类读，不改。

- [ ]
`;
}

function countCheckboxes(md: string): { checked: number; total: number } {
  let checked = 0;
  let total = 0;
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    const m = /^\s*[-*+]\s+\[( |x|X)\]\s+/.exec(line);
    if (!m) continue;
    total += 1;
    if (m[1] === "x" || m[1] === "X") checked += 1;
  }
  return { checked, total };
}

function deriveStatus(checked: number, total: number): DocTaskSummary["status"] {
  if (total === 0) return "todo";
  if (checked === total) return "done";
  return "doing";
}

async function summarizeTask(
  projectPath: string,
  name: string,
): Promise<DocTaskSummary | null> {
  const dir = taskDir(projectPath, name);
  try {
    const st = await stat(dir);
    if (!st.isDirectory()) return null;
  } catch {
    return null;
  }
  const tasksFile = filePath(projectPath, name, "tasks");
  let md = "";
  let updatedAt = 0;
  try {
    md = await readFile(tasksFile, "utf8");
    updatedAt = (await stat(tasksFile)).mtimeMs;
  } catch {
    // No tasks.md yet — count as todo, use dir mtime
    try {
      updatedAt = (await stat(dir)).mtimeMs;
    } catch {
      updatedAt = Date.now();
    }
  }
  const { checked, total } = countCheckboxes(md);
  return {
    name,
    status: deriveStatus(checked, total),
    checked,
    total,
    updatedAt: Math.round(updatedAt),
  };
}

export async function listDocs(projectPath: string): Promise<DocTaskSummary[]> {
  const dir = activeDir(projectPath);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const summaries: DocTaskSummary[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const s = await summarizeTask(projectPath, e.name);
    if (s) summaries.push(s);
  }
  summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  return summaries;
}

export async function readDocFile(
  projectPath: string,
  task: string,
  kind: DocFileKind,
): Promise<{ content: string; updatedAt: number } | null> {
  const name = sanitizeTaskName(task);
  const p = filePath(projectPath, name, kind);
  assertContained(projectPath, p);
  if (!existsSync(p)) return null;
  const content = await readFile(p, "utf8");
  const st = await stat(p);
  return { content, updatedAt: Math.round(st.mtimeMs) };
}

export async function createDocsTask(
  projectPath: string,
  rawName: string,
): Promise<DocTaskSummary> {
  const name = sanitizeTaskName(rawName);
  const dir = taskDir(projectPath, name);
  assertContained(projectPath, dir);
  if (existsSync(dir))
    throw new DocsServiceError("name_taken", `任务 "${name}" 已存在`, 409);
  await mkdir(dir, { recursive: true });
  await writeFile(filePath(projectPath, name, "plan"), planTemplate(name), "utf8");
  await writeFile(
    filePath(projectPath, name, "context"),
    contextTemplate(name),
    "utf8",
  );
  await writeFile(
    filePath(projectPath, name, "tasks"),
    tasksTemplate(name),
    "utf8",
  );
  const s = await summarizeTask(projectPath, name);
  if (!s) throw new DocsServiceError("create_failed", "任务创建后读取失败", 500);
  return s;
}

export async function archiveDocsTask(
  projectPath: string,
  rawName: string,
): Promise<{ archivedAs: string }> {
  const name = sanitizeTaskName(rawName);
  const src = taskDir(projectPath, name);
  assertContained(projectPath, src);
  if (!existsSync(src))
    throw new DocsServiceError("not_found", `任务 "${name}" 不存在`, 404);
  await mkdir(archiveDir(projectPath), { recursive: true });
  // Avoid clobbering an existing archive entry by appending a timestamp suffix.
  const base = join(archiveDir(projectPath), name);
  let target = base;
  if (existsSync(target)) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    target = `${base}__${ts}`;
  }
  assertContained(projectPath, target);
  await rename(src, target);
  const archivedAs = target.slice(archiveDir(projectPath).length + 1);
  return { archivedAs };
}

/**
 * Relative POSIX path of a docs file inside the project tree — useful for the
 * web client to reuse existing file-preview infrastructure.
 */
export function docsFileProjectPath(task: string, kind: DocFileKind): string {
  return `dev/active/${task}/${fileName(task, kind)}`;
}
