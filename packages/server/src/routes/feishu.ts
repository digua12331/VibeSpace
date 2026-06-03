import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getFeishuConfig,
  maskFeishuConfig,
  setFeishuConfig,
  type FeishuConfigPatch,
} from "../feishu/config.js";
import { feishuClient, testFeishuConnection } from "../feishu/client.js";
import { serverLog } from "../log-bus.js";

const UpdateBody = z.object({
  enabled: z.boolean().optional(),
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  domain: z.enum(["feishu", "lark"]).optional(),
  allowOpenIds: z.array(z.string()).optional(),
  allowChatIds: z.array(z.string()).optional(),
  ownerOpenId: z.string().optional(),
  hubAgent: z.string().optional(),
});

const TestBody = z.object({
  appId: z.string().optional(),
  appSecret: z.string().optional(),
  domain: z.enum(["feishu", "lark"]).optional(),
});

export async function registerFeishuRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/feishu/config", async (_req, reply) => {
    return reply.send(maskFeishuConfig(getFeishuConfig()));
  });

  app.get("/api/feishu/status", async (_req, reply) => {
    return reply.send(feishuClient.getStatus());
  });

  app.put<{ Body: unknown }>("/api/feishu/config", async (req, reply) => {
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
    }
    const startedAt = Date.now();
    serverLog("info", "feishu", "config-save 开始");
    try {
      const next = setFeishuConfig(parsed.data as FeishuConfigPatch);
      // Apply config change to the live connection. Fire-and-forget: a slow
      // reconnect must not block the settings save response.
      void feishuClient.start();
      serverLog("info", "feishu", `config-save 成功 (${Date.now() - startedAt}ms)`, {
        meta: { enabled: next.enabled, hasSecret: next.appSecret.length > 0, allowCounts: { openIds: next.allowOpenIds.length, chatIds: next.allowChatIds.length } },
      });
      return reply.send(maskFeishuConfig(next));
    } catch (err) {
      const e = err as Error;
      serverLog("error", "feishu", `config-save 失败: ${e.message}`, {
        meta: { error: { name: e.name, message: e.message, stack: e.stack } },
      });
      return reply.code(500).send({ error: "feishu_config_write_failed", message: e.message });
    }
  });

  app.post<{ Body: unknown }>("/api/feishu/test", async (req, reply) => {
    const parsed = TestBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
    }
    const stored = getFeishuConfig();
    const appId = parsed.data.appId?.trim() || stored.appId;
    // If the secret wasn't retyped (UI shows a mask), fall back to the stored one.
    const typed = parsed.data.appSecret ?? "";
    const appSecret = typed.length > 0 && !typed.startsWith("••••••") ? typed : stored.appSecret;
    const domain = parsed.data.domain || stored.domain;
    const startedAt = Date.now();
    serverLog("info", "feishu", "test 开始", { meta: { appId, domain } });
    const result = await testFeishuConnection(appId, appSecret, domain);
    if (result.ok) {
      serverLog("info", "feishu", `test 成功 (${Date.now() - startedAt}ms)`);
    } else {
      serverLog("error", "feishu", `test 失败: ${result.message}`);
    }
    return reply.send(result);
  });
}
