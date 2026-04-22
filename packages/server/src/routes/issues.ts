import type { FastifyInstance, FastifyReply } from "fastify";
import { getProject } from "../db.js";
import { IssuesServiceError, readIssues } from "../issues-service.js";

function sendIssuesError(reply: FastifyReply, err: unknown) {
  if (err instanceof IssuesServiceError) {
    return reply.code(err.httpStatus).send({ error: err.code, message: err.message });
  }
  const msg = (err as Error)?.message ?? String(err);
  return reply.code(500).send({ error: "issues_failed", message: msg });
}

export async function registerIssuesRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/issues",
    async (req, reply) => {
      const proj = getProject(req.params.id);
      if (!proj) return reply.code(404).send({ error: "project_not_found" });
      try {
        const payload = await readIssues(proj.path);
        return reply.send(payload);
      } catch (err) {
        return sendIssuesError(reply, err);
      }
    },
  );
}
