import type { FastifyInstance } from "fastify";
import { listProjects } from "../db.js";
import { serverLog } from "../log-bus.js";
import { HUB_PROJECT_ID } from "../hub-project.js";
import { refreshAllOutdatedDevDocs } from "../workflow-service.js";

/**
 * 机器级工作流维护路由（跨所有项目，不属单个项目，故挂独立 `/api/workflow/*`）。
 */
export async function registerWorkflowRoutes(
  app: FastifyInstance,
): Promise<void> {
  // 一键把所有"已装 Dev Docs 且版本落后"的项目刷到最新母版。
  app.post("/api/workflow/refresh-all", async (_req, reply) => {
    const t0 = Date.now();
    serverLog("info", "workflow", "refresh-all 开始", {});
    try {
      const projects = listProjects()
        .filter((p) => p.id !== HUB_PROJECT_ID)
        .map((p) => ({ id: p.id, name: p.name, path: p.path }));
      const r = refreshAllOutdatedDevDocs(projects);
      serverLog(
        "info",
        "workflow",
        `refresh-all 成功 (${Date.now() - t0}ms)`,
        {
          meta: {
            updatedCount: r.updated.length,
            skippedCount: r.skipped.length,
            updated: r.updated.map((u) => u.name),
          },
        },
      );
      return reply.send(r);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      serverLog("error", "workflow", `refresh-all 失败: ${msg}`, {
        meta: { error: { name: (err as Error).name, message: msg } },
      });
      return reply.code(500).send({ error: "refresh_failed", detail: msg });
    }
  });
}
