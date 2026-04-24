import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { getProject } from "../db.js";
import {
  DocsServiceError,
  archiveDocsTask,
  createDocsTask,
  docsFileProjectPath,
  listDocs,
  readDocFile,
  type DocFileKind,
} from "../docs-service.js";
import { kickoffArchiveReview } from "../review-runner.js";
import { serverLog } from "../log-bus.js";

const FileQuery = z.object({
  kind: z.enum(["plan", "context", "tasks"]),
});

const CreateBody = z.object({
  name: z.string().min(1).max(120),
});

function sendDocsError(reply: FastifyReply, err: unknown) {
  if (err instanceof DocsServiceError) {
    return reply.code(err.httpStatus).send({ error: err.code, message: err.message });
  }
  const msg = (err as Error)?.message ?? String(err);
  return reply.code(500).send({ error: "docs_failed", message: msg });
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

export async function registerDocsRoutes(app: FastifyInstance): Promise<void> {
  // ---------- GET /docs — list active tasks ----------
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/docs",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      try {
        const tasks = await listDocs(proj.path);
        return reply.send(tasks);
      } catch (err) {
        return sendDocsError(reply, err);
      }
    },
  );

  // ---------- GET /docs/:task/file?kind=... ----------
  app.get<{
    Params: { id: string; task: string };
    Querystring: unknown;
  }>("/api/projects/:id/docs/:task/file", async (req, reply) => {
    const proj = await loadProjectOr404(reply, req.params.id);
    if (!proj) return;
    const parsed = FileQuery.safeParse(req.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_query", detail: parsed.error.issues });
    }
    try {
      const result = await readDocFile(
        proj.path,
        decodeURIComponent(req.params.task),
        parsed.data.kind as DocFileKind,
      );
      if (!result) return reply.code(404).send({ error: "file_not_found" });
      return reply.send({
        path: docsFileProjectPath(
          decodeURIComponent(req.params.task),
          parsed.data.kind as DocFileKind,
        ),
        ...result,
      });
    } catch (err) {
      return sendDocsError(reply, err);
    }
  });

  // ---------- POST /docs — create new task ----------
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id/docs",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = CreateBody.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_body", detail: parsed.error.issues });
      }
      try {
        const summary = await createDocsTask(proj.path, parsed.data.name);
        return reply.code(201).send(summary);
      } catch (err) {
        return sendDocsError(reply, err);
      }
    },
  );

  // ---------- POST /docs/:task/archive ----------
  app.post<{ Params: { id: string; task: string } }>(
    "/api/projects/:id/docs/:task/archive",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      try {
        const taskName = decodeURIComponent(req.params.task);
        const out = await archiveDocsTask(proj.path, taskName);
        serverLog(
          "info",
          "docs",
          `归档评审 enqueue: ${taskName}`,
          { projectId: proj.id, meta: { archivedAs: out.archivedAs } },
        );
        // Fire-and-forget: evaluate lessons from the just-archived task in the
        // background. Never blocks the archive response.
        kickoffArchiveReview(proj.path, taskName, out.archivedAs);
        return reply.send(out);
      } catch (err) {
        const taskName = decodeURIComponent(req.params.task);
        serverLog(
          "error",
          "docs",
          `归档失败 ${taskName}: ${(err as Error)?.message ?? String(err)}`,
          { projectId: proj.id, meta: { task: taskName } },
        );
        return sendDocsError(reply, err);
      }
    },
  );
}
