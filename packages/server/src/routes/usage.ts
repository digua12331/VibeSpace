import type { FastifyInstance } from "fastify";
import { computeClaudeUsage } from "../usage-service.js";
import { serverLog } from "../log-bus.js";

export async function registerUsageRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/usage/claude", async (_req, reply) => {
    const started = Date.now();
    serverLog("info", "usage", "read 开始");
    try {
      const usage = await computeClaudeUsage();
      const ms = Date.now() - started;
      serverLog("info", "usage", `read 成功 (${ms}ms)`, {
        meta: {
          ms,
          filesScanned: usage.filesScanned,
          entriesScanned: usage.entriesScanned,
          skipped: usage.skipped,
        },
      });
      return reply.send(usage);
    } catch (err) {
      const ms = Date.now() - started;
      const e = err as Error;
      serverLog("error", "usage", `read 失败: ${e?.message ?? String(err)}`, {
        meta: {
          ms,
          error: { name: e?.name, message: e?.message, stack: e?.stack },
        },
      });
      return reply
        .code(500)
        .send({ error: "usage_read_failed", message: e?.message ?? String(err) });
    }
  });
}
