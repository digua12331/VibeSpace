import { readFile, readdir, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve as resolvePath, relative as relativePath, sep } from "node:path";

export type ChecklistStatus = "pending" | "locked" | "modified";

export interface ChecklistItemBase {
  id: string;
  status?: ChecklistStatus;
  userChoice?: string;
  userAnswer?: string;
  [key: string]: unknown;
}

export interface ChecklistSection {
  id: string;
  title?: string;
  type?: string;
  items: ChecklistItemBase[];
  [key: string]: unknown;
}

export interface ChecklistDoc {
  feature: string;
  version?: number;
  createdAt?: string;
  status?: string;
  sections: ChecklistSection[];
  [key: string]: unknown;
}

export interface OutputFeature {
  name: string;
  files: string[];
  hasChecklist: boolean;
}

export class OutputServiceError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const FORBIDDEN_CHARS = /[\\\/:*?"<>|]/;

function safeFeatureName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new OutputServiceError("invalid_feature", "功能名不能为空");
  if (trimmed.length > 120)
    throw new OutputServiceError("invalid_feature", "功能名过长（上限 120 字符）");
  if (FORBIDDEN_CHARS.test(trimmed))
    throw new OutputServiceError(
      "invalid_feature",
      '功能名不能包含 / \\ : * ? " < > |',
    );
  if (trimmed === "." || trimmed === "..")
    throw new OutputServiceError("invalid_feature", "非法功能名");
  return trimmed;
}

function outputRoot(projectPath: string): string {
  return join(projectPath, "output");
}

function featureDir(projectPath: string, feature: string): string {
  return join(outputRoot(projectPath), feature);
}

function checklistPath(projectPath: string, feature: string): string {
  return join(featureDir(projectPath, feature), "checklist.json");
}

/**
 * Ensure `candidate` resolves underneath <projectPath>/output. Throws
 * `OutputServiceError('path_escape')` otherwise.
 */
function assertContained(projectPath: string, candidate: string): string {
  const root = resolvePath(outputRoot(projectPath));
  const abs = resolvePath(candidate);
  const rel = relativePath(root, abs);
  if (rel.startsWith("..") || rel.startsWith(`..${sep}`) || rel === "..") {
    throw new OutputServiceError("path_escape", "非法路径", 400);
  }
  return abs;
}

export async function listOutput(
  projectPath: string,
): Promise<{ features: OutputFeature[] }> {
  const root = outputRoot(projectPath);
  if (!existsSync(root)) return { features: [] };
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return { features: [] };
  }
  const features: OutputFeature[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = join(root, e.name);
    let files: string[];
    try {
      const inner = await readdir(dir, { withFileTypes: true });
      files = inner
        .filter((f) => f.isFile())
        .map((f) => f.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      files = [];
    }
    features.push({
      name: e.name,
      files,
      hasChecklist: files.includes("checklist.json"),
    });
  }
  features.sort((a, b) => a.name.localeCompare(b.name));
  return { features };
}

export async function readChecklist(
  projectPath: string,
  rawFeature: string,
): Promise<ChecklistDoc> {
  const feature = safeFeatureName(rawFeature);
  const p = checklistPath(projectPath, feature);
  assertContained(projectPath, p);
  if (!existsSync(p))
    throw new OutputServiceError("not_found", `checklist.json 不存在: ${feature}`, 404);
  const raw = await readFile(p, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new OutputServiceError(
      "invalid_json",
      `checklist.json 解析失败: ${(err as Error).message}`,
      422,
    );
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { sections?: unknown }).sections)) {
    throw new OutputServiceError("invalid_schema", "checklist.json 缺少 sections 数组", 422);
  }
  return parsed as ChecklistDoc;
}

/**
 * Shallow-merge `patch` into the item at `(sectionId, itemId)`. Returns the
 * full updated doc. Writes via tmp+rename so a crash mid-write can't corrupt.
 */
export async function patchChecklistItem(
  projectPath: string,
  rawFeature: string,
  sectionId: string,
  itemId: string,
  patch: Record<string, unknown>,
): Promise<ChecklistDoc> {
  const feature = safeFeatureName(rawFeature);
  const p = checklistPath(projectPath, feature);
  assertContained(projectPath, p);
  const doc = await readChecklist(projectPath, feature);

  const section = doc.sections.find((s) => s.id === sectionId);
  if (!section)
    throw new OutputServiceError("section_not_found", `section "${sectionId}" 不存在`, 404);
  const item = section.items?.find((it) => it.id === itemId);
  if (!item)
    throw new OutputServiceError("item_not_found", `item "${itemId}" 不存在`, 404);

  // Shallow merge; keep unknown fields. Drop explicit-undefined keys so callers
  // can clear a field by passing { key: null }.
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    (item as Record<string, unknown>)[k] = v;
  }

  const serialized = JSON.stringify(doc, null, 2) + "\n";
  const dir = featureDir(projectPath, feature);
  await mkdir(dir, { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, serialized, "utf8");
  await rename(tmp, p);

  // Return a fresh read (and fresh mtime from disk) rather than the mutated
  // in-memory doc, so callers see exactly what's on disk.
  return readChecklist(projectPath, feature);
}

export { safeFeatureName };
