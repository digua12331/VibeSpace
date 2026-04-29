import type { FastifyInstance } from "fastify";
import { jobsService } from "../jobs-service.js";
import { installJobs } from "../install-jobs.js";

/** Unified wire shape for the Jobs sidebar tab. */
interface WireJob {
  id: string;
  kind: "review" | "install";
  title: string;
  state: "running" | "done" | "failed" | "cancelled";
  startedAt: number;
  endedAt: number | null;
  projectId?: string;
  /** Last error message when state==='failed'. Optional. */
  error?: string;
}

export async function registerJobsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/jobs", async () => {
    const out: WireJob[] = [];
    for (const j of jobsService.list()) {
      out.push({
        id: j.id,
        kind: "review",
        title: j.title,
        state: j.state,
        startedAt: j.startedAt,
        endedAt: j.endedAt,
        projectId: j.projectId,
        error: j.error,
      });
    }
    for (const j of installJobs.list()) {
      out.push({
        id: j.id,
        kind: "install",
        title: j.cliId,
        state: j.state,
        startedAt: j.startedAt,
        endedAt: j.endedAt,
      });
    }
    // Newest first.
    out.sort((a, b) => b.startedAt - a.startedAt);
    return out;
  });

  app.post<{ Params: { id: string } }>(
    "/api/jobs/:id/cancel",
    async (req, reply) => {
      const { id } = req.params;
      // Try the JobsService (review) first; fall back to install-jobs.
      if (jobsService.get(id)) {
        const ok = jobsService.cancel(id);
        if (!ok) return reply.code(409).send({ error: "not_running" });
        return reply.code(204).send();
      }
      if (installJobs.get(id)) {
        const ok = installJobs.cancel(id);
        if (!ok) return reply.code(409).send({ error: "not_running" });
        return reply.code(204).send();
      }
      return reply.code(404).send({ error: "not_found" });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/jobs/:id",
    async (req, reply) => {
      const { id } = req.params;
      if (jobsService.get(id)) {
        const ok = jobsService.remove(id);
        if (!ok) return reply.code(409).send({ error: "still_running" });
        return reply.code(204).send();
      }
      // install-jobs has no remove() — its entries linger until server restart.
      // For v1 we don't expose deletion of install jobs through this aggregator.
      return reply.code(404).send({ error: "not_found" });
    },
  );
}
