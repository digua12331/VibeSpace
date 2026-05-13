import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAppSettings, setAppSettings } from "../app-settings.js";
import { serverLog } from "../log-bus.js";

const HibernationSchema = z
  .object({
    enabled: z.boolean().optional(),
    idleMinutes: z.number().int().min(5).max(180).optional(),
    includeShells: z.boolean().optional(),
  })
  .optional();

const UpdateBody = z.object({
  pasteImageRetentionDays: z
    .number()
    .int()
    .min(0)
    .max(365)
    .optional(),
  hibernation: HibernationSchema,
});

export async function registerAppSettingsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/app-settings", async (_req, reply) => {
    return reply.send(getAppSettings());
  });

  app.put<{ Body: unknown }>("/api/app-settings", async (req, reply) => {
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", detail: parsed.error.issues });
    }
    const startedAt = Date.now();
    serverLog("info", "settings", "app-settings 更新 开始", {
      meta: { patch: parsed.data },
    });
    try {
      const next = setAppSettings(parsed.data);
      serverLog(
        "info",
        "settings",
        `app-settings 更新 成功 (${Date.now() - startedAt}ms)`,
        { meta: { settings: next } },
      );
      return reply.send(next);
    } catch (err) {
      const e = err as Error;
      serverLog("error", "settings", `app-settings 更新 失败: ${e.message}`, {
        meta: {
          ms: Date.now() - startedAt,
          error: { name: e.name, message: e.message, stack: e.stack },
        },
      });
      return reply
        .code(500)
        .send({ error: "settings_write_failed", message: e.message });
    }
  });
}
