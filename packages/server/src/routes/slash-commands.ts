import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getProject } from "../db.js";
import { serverLog } from "../log-bus.js";
import { scanDynamicSlashCommands } from "../dynamic-slash-service.js";

const Params = z.object({
  id: z.string().min(1),
  agent: z.string().min(1).max(40),
});

export async function registerSlashCommandRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get<{ Params: { id: string; agent: string } }>(
    "/api/projects/:id/slash-commands/:agent",
    async (req, reply) => {
      const parsed = Params.safeParse(req.params);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: "invalid_params", detail: parsed.error.issues });
      }
      const proj = getProject(parsed.data.id);
      if (!proj) {
        return reply.code(404).send({ error: "project_not_found" });
      }
      try {
        const commands = scanDynamicSlashCommands({
          agent: parsed.data.agent,
          projectPath: proj.path,
        });
        return reply.send({ commands });
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        serverLog("error", "slash", `slash-commands 失败: ${msg}`, {
          projectId: proj.id,
          meta: {
            agent: parsed.data.agent,
            error: { name: (err as Error)?.name ?? "Error", message: msg },
          },
        });
        return reply
          .code(500)
          .send({ error: "slash_scan_failed", message: msg });
      }
    },
  );
}
