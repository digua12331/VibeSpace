import type { FastifyInstance, FastifyReply } from "fastify";
import { getProject } from "../db.js";
import { sampleProject } from "../perf-service.js";

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

export async function registerPerfRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/metrics",
    async (req, reply) => {
      const proj = await loadProjectOr404(reply, req.params.id);
      if (!proj) return;
      try {
        const perf = await sampleProject(proj.id);
        return reply.send(perf);
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        return reply.code(500).send({ error: "perf_failed", message: msg });
      }
    },
  );
}
