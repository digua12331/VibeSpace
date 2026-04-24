import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { getProject } from "../db.js";
import {
  CommentsServiceError,
  createComment,
  deleteComment,
  readComments,
  updateComment,
} from "../comments-service.js";
import { serverLog } from "../log-bus.js";

const ListQuery = z.object({
  path: z.string().min(1),
});

const AnchorSchema = z.object({
  anchorId: z.string().min(1),
  blockType: z.string().min(1),
  index: z.number().int().nonnegative(),
  contentHash: z.string(),
  textPreview: z.string(),
});

const CreateBody = z.object({
  path: z.string().min(1),
  anchor: AnchorSchema,
  body: z.string().min(1),
});

const UpdateBody = z.object({
  path: z.string().min(1),
  body: z.string().min(1),
});

const DeleteQuery = z.object({
  path: z.string().min(1),
});

function sendCommentsError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof CommentsServiceError) {
    return reply.code(err.httpStatus).send({ error: err.code, message: err.message });
  }
  const msg = (err as Error)?.message ?? String(err);
  return reply.code(500).send({ error: "comments_failed", message: msg });
}

async function loadProjectOr404(
  reply: FastifyReply,
  id: string,
): Promise<{ id: string; path: string } | null> {
  const proj = getProject(id);
  if (!proj) {
    reply.code(404).send({ error: "project_not_found" });
    return null;
  }
  return { id: proj.id, path: proj.path };
}

export async function registerCommentsRoutes(app: FastifyInstance): Promise<void> {
  // ---------- GET /comments?path=... ----------
  app.get<{ Params: { id: string }; Querystring: unknown }>(
    "/api/projects/:id/comments",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = ListQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_query", detail: parsed.error.issues });
      }
      try {
        const file = await readComments(proj.path, parsed.data.path);
        return reply.send({ path: parsed.data.path, comments: file.comments });
      } catch (err) {
        return sendCommentsError(reply, err);
      }
    },
  );

  // ---------- POST /comments — create ----------
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/comments",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = CreateBody.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_body", detail: parsed.error.issues });
      }
      const { path: relPath, anchor, body } = parsed.data;
      const t0 = Date.now();
      serverLog("info", "comments", "create 开始", {
        projectId: proj.id,
        meta: { path: relPath, anchorId: anchor.anchorId },
      });
      try {
        const entry = await createComment(proj.path, relPath, anchor, body);
        serverLog(
          "info",
          "comments",
          `create 成功 (${Date.now() - t0}ms)`,
          { projectId: proj.id, meta: { path: relPath, id: entry.id } },
        );
        return reply.code(201).send(entry);
      } catch (err) {
        const e = err as Error;
        serverLog("error", "comments", `create 失败: ${e.message}`, {
          projectId: proj.id,
          meta: {
            path: relPath,
            error: { name: e.name, message: e.message },
          },
        });
        return sendCommentsError(reply, err);
      }
    },
  );

  // ---------- PATCH /comments/:cid — update body ----------
  app.patch<{ Params: { id: string; cid: string }; Body: unknown }>(
    "/api/projects/:id/comments/:cid",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = UpdateBody.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_body", detail: parsed.error.issues });
      }
      const cid = decodeURIComponent(req.params.cid);
      const { path: relPath, body } = parsed.data;
      const t0 = Date.now();
      serverLog("info", "comments", "update 开始", {
        projectId: proj.id,
        meta: { path: relPath, id: cid },
      });
      try {
        const entry = await updateComment(proj.path, relPath, cid, body);
        serverLog(
          "info",
          "comments",
          `update 成功 (${Date.now() - t0}ms)`,
          { projectId: proj.id, meta: { path: relPath, id: cid } },
        );
        return reply.send(entry);
      } catch (err) {
        const e = err as Error;
        serverLog("error", "comments", `update 失败: ${e.message}`, {
          projectId: proj.id,
          meta: {
            path: relPath,
            id: cid,
            error: { name: e.name, message: e.message },
          },
        });
        return sendCommentsError(reply, err);
      }
    },
  );

  // ---------- DELETE /comments/:cid?path=... ----------
  app.delete<{ Params: { id: string; cid: string }; Querystring: unknown }>(
    "/api/projects/:id/comments/:cid",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = DeleteQuery.safeParse(req.query);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_query", detail: parsed.error.issues });
      }
      const cid = decodeURIComponent(req.params.cid);
      const relPath = parsed.data.path;
      const t0 = Date.now();
      serverLog("info", "comments", "delete 开始", {
        projectId: proj.id,
        meta: { path: relPath, id: cid },
      });
      try {
        await deleteComment(proj.path, relPath, cid);
        serverLog(
          "info",
          "comments",
          `delete 成功 (${Date.now() - t0}ms)`,
          { projectId: proj.id, meta: { path: relPath, id: cid } },
        );
        return reply.code(204).send();
      } catch (err) {
        const e = err as Error;
        serverLog("error", "comments", `delete 失败: ${e.message}`, {
          projectId: proj.id,
          meta: {
            path: relPath,
            id: cid,
            error: { name: e.name, message: e.message },
          },
        });
        return sendCommentsError(reply, err);
      }
    },
  );
}
