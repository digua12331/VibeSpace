import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { getProject } from "../db.js";
import {
  OutputServiceError,
  listOutput,
  readChecklist,
  patchChecklistItem,
} from "../output-service.js";

const PatchBody = z.object({
  sectionId: z.string().min(1),
  itemId: z.string().min(1),
  patch: z.record(z.string(), z.unknown()),
});

function sendOutputError(reply: FastifyReply, err: unknown) {
  if (err instanceof OutputServiceError) {
    return reply.code(err.httpStatus).send({ error: err.code, message: err.message });
  }
  const msg = (err as Error)?.message ?? String(err);
  return reply.code(500).send({ error: "output_failed", message: msg });
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

export async function registerOutputRoutes(app: FastifyInstance): Promise<void> {
  // ---------- GET /output — list feature dirs ----------
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/output",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      try {
        const r = await listOutput(proj.path);
        return reply.send(r);
      } catch (err) {
        return sendOutputError(reply, err);
      }
    },
  );

  // ---------- GET /output/:feature/checklist ----------
  app.get<{ Params: { id: string; feature: string } }>(
    "/api/projects/:id/output/:feature/checklist",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      try {
        const doc = await readChecklist(proj.path, decodeURIComponent(req.params.feature));
        return reply.send(doc);
      } catch (err) {
        return sendOutputError(reply, err);
      }
    },
  );

  // ---------- PATCH /output/:feature/checklist ----------
  app.patch<{ Params: { id: string; feature: string }; Body: unknown }>(
    "/api/projects/:id/output/:feature/checklist",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      const parsed = PatchBody.safeParse(req.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_body", detail: parsed.error.issues });
      }
      try {
        const doc = await patchChecklistItem(
          proj.path,
          decodeURIComponent(req.params.feature),
          parsed.data.sectionId,
          parsed.data.itemId,
          parsed.data.patch,
        );
        return reply.send(doc);
      } catch (err) {
        return sendOutputError(reply, err);
      }
    },
  );
}
