import { readFile, writeFile, access } from "node:fs/promises";
import { safeResolve as gitSafeResolve } from "./git-service.js";

export interface CommentAnchor {
  anchorId: string;
  blockType: string;
  index: number;
  contentHash: string;
  textPreview: string;
}

export interface CommentEntry {
  id: string;
  anchor: CommentAnchor;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface CommentsFile {
  version: 1;
  comments: CommentEntry[];
}

export class CommentsServiceError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const MD_SUFFIX = /\.(md|markdown|mdx)$/i;

/**
 * Wrap git-service's safeResolve so its GitServiceError (another module's
 * type) doesn't leak out of this service. Route handlers only know how to
 * serialize CommentsServiceError.
 */
function safeResolve(projectPath: string, input: string): string {
  try {
    return gitSafeResolve(projectPath, input);
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    throw new CommentsServiceError("path_escape", msg, 400);
  }
}

function assertMarkdownPath(rel: string): void {
  if (!MD_SUFFIX.test(rel)) {
    throw new CommentsServiceError(
      "not_markdown",
      "评论功能仅对 .md/.markdown/.mdx 文件启用",
      400,
    );
  }
}

function sidecarPathOf(relFilePath: string): string {
  return `${relFilePath}.comments.json`;
}

function assertValidAnchor(a: unknown): CommentAnchor {
  if (!a || typeof a !== "object") throw new CommentsServiceError("invalid_anchor", "anchor 必填");
  const o = a as Record<string, unknown>;
  if (typeof o.anchorId !== "string" || !o.anchorId)
    throw new CommentsServiceError("invalid_anchor", "anchor.anchorId 必填");
  if (typeof o.blockType !== "string" || !o.blockType)
    throw new CommentsServiceError("invalid_anchor", "anchor.blockType 必填");
  if (typeof o.index !== "number" || !Number.isFinite(o.index) || o.index < 0)
    throw new CommentsServiceError("invalid_anchor", "anchor.index 必须是非负整数");
  if (typeof o.contentHash !== "string")
    throw new CommentsServiceError("invalid_anchor", "anchor.contentHash 必填");
  if (typeof o.textPreview !== "string")
    throw new CommentsServiceError("invalid_anchor", "anchor.textPreview 必填");
  return {
    anchorId: o.anchorId,
    blockType: o.blockType,
    index: o.index,
    contentHash: o.contentHash,
    textPreview: (o.textPreview as string).slice(0, 200),
  };
}

function assertBody(body: unknown): string {
  if (typeof body !== "string")
    throw new CommentsServiceError("invalid_body", "body 必须是字符串");
  const trimmed = body.trim();
  if (!trimmed) throw new CommentsServiceError("invalid_body", "评论内容不能为空");
  if (body.length > 10_000)
    throw new CommentsServiceError("invalid_body", "评论过长（上限 10000 字符）");
  return body;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function emptyFile(): CommentsFile {
  return { version: 1, comments: [] };
}

/**
 * Read the sidecar json for a given project-relative md path. Returns an empty
 * CommentsFile when the sidecar does not yet exist. Throws on malformed JSON
 * or unknown version so the caller can surface a clear error to the user
 * rather than silently overwriting hand-edited data.
 */
export async function readComments(
  projectPath: string,
  relFilePath: string,
): Promise<CommentsFile> {
  assertMarkdownPath(relFilePath);
  safeResolve(projectPath, relFilePath); // path-escape guard on the md file itself
  const sidecarAbs = safeResolve(projectPath, sidecarPathOf(relFilePath));
  if (!(await fileExists(sidecarAbs))) return emptyFile();
  let raw: string;
  try {
    raw = await readFile(sidecarAbs, "utf8");
  } catch (err) {
    throw new CommentsServiceError(
      "read_failed",
      `读取 sidecar 失败: ${(err as Error).message}`,
      500,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CommentsServiceError(
      "malformed_sidecar",
      `sidecar JSON 解析失败: ${(err as Error).message}`,
      500,
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new CommentsServiceError("malformed_sidecar", "sidecar 不是对象");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new CommentsServiceError(
      "unknown_version",
      `sidecar version=${String(obj.version)} 不支持`,
      500,
    );
  }
  if (!Array.isArray(obj.comments)) {
    throw new CommentsServiceError("malformed_sidecar", "sidecar.comments 必须是数组");
  }
  const comments: CommentEntry[] = [];
  for (const c of obj.comments) {
    if (!c || typeof c !== "object") continue;
    const cc = c as Record<string, unknown>;
    if (typeof cc.id !== "string" || typeof cc.body !== "string") continue;
    try {
      comments.push({
        id: cc.id,
        anchor: assertValidAnchor(cc.anchor),
        body: cc.body,
        createdAt: typeof cc.createdAt === "number" ? cc.createdAt : Date.now(),
        updatedAt: typeof cc.updatedAt === "number" ? cc.updatedAt : Date.now(),
      });
    } catch {
      // skip the one bad row rather than refusing the whole sidecar
    }
  }
  return { version: 1, comments };
}

async function writeSidecar(
  projectPath: string,
  relFilePath: string,
  file: CommentsFile,
): Promise<void> {
  assertMarkdownPath(relFilePath);
  const sidecarAbs = safeResolve(projectPath, sidecarPathOf(relFilePath));
  const json = JSON.stringify(file, null, 2) + "\n";
  try {
    await writeFile(sidecarAbs, json, "utf8");
  } catch (err) {
    throw new CommentsServiceError(
      "write_failed",
      `写入 sidecar 失败: ${(err as Error).message}`,
      500,
    );
  }
}

function genId(): string {
  // crypto.randomUUID is available in all node 20+ runtimes and modern browsers.
  return `cmt_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

export async function createComment(
  projectPath: string,
  relFilePath: string,
  anchor: unknown,
  body: unknown,
): Promise<CommentEntry> {
  const validAnchor = assertValidAnchor(anchor);
  const validBody = assertBody(body);
  const file = await readComments(projectPath, relFilePath);
  const now = Date.now();
  const entry: CommentEntry = {
    id: genId(),
    anchor: validAnchor,
    body: validBody,
    createdAt: now,
    updatedAt: now,
  };
  file.comments.push(entry);
  await writeSidecar(projectPath, relFilePath, file);
  return entry;
}

export async function updateComment(
  projectPath: string,
  relFilePath: string,
  commentId: string,
  body: unknown,
): Promise<CommentEntry> {
  const validBody = assertBody(body);
  const file = await readComments(projectPath, relFilePath);
  const found = file.comments.find((c) => c.id === commentId);
  if (!found) {
    throw new CommentsServiceError("comment_not_found", `评论不存在: ${commentId}`, 404);
  }
  found.body = validBody;
  found.updatedAt = Date.now();
  await writeSidecar(projectPath, relFilePath, file);
  return found;
}

export async function deleteComment(
  projectPath: string,
  relFilePath: string,
  commentId: string,
): Promise<void> {
  const file = await readComments(projectPath, relFilePath);
  const i = file.comments.findIndex((c) => c.id === commentId);
  if (i < 0) {
    throw new CommentsServiceError("comment_not_found", `评论不存在: ${commentId}`, 404);
  }
  file.comments.splice(i, 1);
  await writeSidecar(projectPath, relFilePath, file);
}
