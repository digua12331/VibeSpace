import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getClaudeSettingsPath,
  patchClaudeSettings,
  readClaudeSettings,
  type ClaudeSettingsPatch,
} from "../claude-settings.js";
import { serverLog } from "../log-bus.js";

const KEY = z
  .string()
  .min(1)
  .max(200, "key 长度超出 200，疑似异常输入");

const SkillOverrideValue = z.union([z.literal("off"), z.null()]);

const PatchBody = z
  .object({
    skillOverrides: z.record(KEY, SkillOverrideValue).optional(),
    enabledPlugins: z.record(KEY, z.boolean()).optional(),
  })
  .refine(
    (b) => b.skillOverrides != null || b.enabledPlugins != null,
    { message: "skillOverrides 与 enabledPlugins 至少传一个" },
  );

function summarize(s: Record<string, unknown>): {
  skillOverrides: Record<string, "off">;
  enabledPlugins: Record<string, boolean>;
} {
  const out = {
    skillOverrides: {} as Record<string, "off">,
    enabledPlugins: {} as Record<string, boolean>,
  };
  const so = s.skillOverrides;
  if (so && typeof so === "object" && !Array.isArray(so)) {
    for (const [k, v] of Object.entries(so as Record<string, unknown>)) {
      if (v === "off") out.skillOverrides[k] = "off";
    }
  }
  const ep = s.enabledPlugins;
  if (ep && typeof ep === "object" && !Array.isArray(ep)) {
    for (const [k, v] of Object.entries(ep as Record<string, unknown>)) {
      if (typeof v === "boolean") out.enabledPlugins[k] = v;
    }
  }
  return out;
}

export async function registerClaudeSettingsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/claude-settings", async (_req, reply) => {
    const r = readClaudeSettings();
    const projection = summarize(r.settings);
    return reply.send({
      ...projection,
      path: getClaudeSettingsPath(),
      exists: r.exists,
      ...(r.parseError ? { parseError: r.parseError } : {}),
    });
  });

  app.put<{ Body: unknown }>("/api/claude-settings", async (req, reply) => {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_body", detail: parsed.error.issues });
    }
    const patch: ClaudeSettingsPatch = parsed.data;
    const startedAt = Date.now();
    const counts = {
      skillOverrideKeys: patch.skillOverrides
        ? Object.keys(patch.skillOverrides).length
        : 0,
      pluginKeys: patch.enabledPlugins
        ? Object.keys(patch.enabledPlugins).length
        : 0,
    };
    serverLog("info", "claude-settings", "patch 开始", {
      meta: {
        counts,
        skillOverrideSample: patch.skillOverrides
          ? Object.keys(patch.skillOverrides).slice(0, 5)
          : [],
        pluginSample: patch.enabledPlugins
          ? Object.keys(patch.enabledPlugins).slice(0, 5)
          : [],
      },
    });
    try {
      const next = patchClaudeSettings(patch);
      const projection = summarize(next.settings);
      serverLog(
        "info",
        "claude-settings",
        `patch 成功 (${Date.now() - startedAt}ms)`,
        { meta: { counts, ms: Date.now() - startedAt } },
      );
      return reply.send({
        ...projection,
        path: getClaudeSettingsPath(),
        exists: true,
      });
    } catch (err) {
      const e = err as Error;
      serverLog("error", "claude-settings", `patch 失败: ${e.message}`, {
        meta: {
          ms: Date.now() - startedAt,
          counts,
          error: { name: e.name, message: e.message, stack: e.stack },
        },
      });
      return reply
        .code(500)
        .send({ error: "claude_settings_write_failed", message: e.message });
    }
  });
}
