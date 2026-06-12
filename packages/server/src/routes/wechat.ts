import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getWechatConfig, maskWechatConfig, setWechatConfig } from "../wechat/config.js";
import { wechatClient } from "../wechat/client.js";
import { startBindingWindow, getBindingWindow, resetBinding } from "../wechat/inbound.js";
import { serverLog } from "../log-bus.js";

const UpdateBody = z.object({
  enabled: z.boolean().optional(),
});

/**
 * 微信（ilink）桥的机器级路由。凭证只进 data/wechat.json，从不出前端；
 * 取码返回登录链接由前端渲染二维码。状态读取高频轮询，不打操作日志。
 */
export async function registerWechatRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/wechat/config", async (_req, reply) => {
    return reply.send(maskWechatConfig(getWechatConfig()));
  });

  // High-frequency read (settings page polls while scanning); not logged.
  app.get("/api/wechat/status", async (_req, reply) => {
    return reply.send({ ...wechatClient.getStatus(), binding: getBindingWindow() });
  });

  // 取码：返回登录链接，前端渲染二维码；服务端后台轮询扫码结果。
  app.post("/api/wechat/login", async (_req, reply) => {
    const t0 = Date.now();
    serverLog("info", "wechat", "login 开始（取码）");
    try {
      const { loginUrl } = await wechatClient.beginLogin();
      serverLog("info", "wechat", `login 取码成功 (${Date.now() - t0}ms)`);
      return reply.send({ loginUrl });
    } catch (err) {
      const e = err as Error;
      serverLog("error", "wechat", `login 取码失败: ${e.message}`, {
        meta: { error: { name: e.name, message: e.message } },
      });
      return reply.code(502).send({ error: "wechat_login_failed", message: e.message });
    }
  });

  // 开启 owner 绑定窗口（须已登录），返回一次性口令给设置页展示。
  app.post("/api/wechat/bind-start", async (_req, reply) => {
    const cfg = getWechatConfig();
    if (!cfg.botToken) {
      return reply.code(400).send({ error: "not_logged_in", message: "先取码扫码连接，再开始绑定" });
    }
    return reply.send(startBindingWindow());
  });

  // 重置绑定：清空 owner（旧 owner 立即失效）。
  app.post("/api/wechat/reset-binding", async (_req, reply) => {
    serverLog("info", "wechat", "reset-binding 开始");
    resetBinding();
    serverLog("info", "wechat", "reset-binding 成功");
    return reply.send({ ok: true });
  });

  // 退出登录：清凭证与游标、停长轮询；保留 owner 绑定。
  app.post("/api/wechat/logout", async (_req, reply) => {
    serverLog("info", "wechat", "logout 开始");
    wechatClient.logout();
    serverLog("info", "wechat", "logout 成功");
    return reply.send(maskWechatConfig(getWechatConfig()));
  });

  // 开关：关 → 停轮询；开（且有凭证）→ 恢复轮询。
  app.put<{ Body: unknown }>("/api/wechat/config", async (req, reply) => {
    const parsed = UpdateBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
    }
    const t0 = Date.now();
    serverLog("info", "wechat", "config-save 开始");
    try {
      const next = setWechatConfig(parsed.data);
      if (next.enabled) {
        wechatClient.start();
      } else {
        wechatClient.stop();
      }
      serverLog("info", "wechat", `config-save 成功 (${Date.now() - t0}ms)`, {
        meta: { enabled: next.enabled, hasToken: next.botToken.length > 0 },
      });
      return reply.send(maskWechatConfig(next));
    } catch (err) {
      const e = err as Error;
      serverLog("error", "wechat", `config-save 失败: ${e.message}`, {
        meta: { error: { name: e.name, message: e.message, stack: e.stack } },
      });
      return reply.code(500).send({ error: "wechat_config_write_failed", message: e.message });
    }
  });
}
