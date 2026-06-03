import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getAppSettings,
  keyComboError,
  keyCombosEqual,
  setAppSettings,
} from "../app-settings.js";
import { serverLog } from "../log-bus.js";

const HibernationSchema = z
  .object({
    enabled: z.boolean().optional(),
    idleMinutes: z.number().int().min(5).max(180).optional(),
    includeShells: z.boolean().optional(),
  })
  .optional();

const KeyComboSchema = z.object({
  key: z.string().min(1),
  ctrl: z.boolean().optional(),
  alt: z.boolean().optional(),
  shift: z.boolean().optional(),
  meta: z.boolean().optional(),
});

const TerminalKeybindingsSchema = z
  .object({
    abortAltKey: KeyComboSchema.nullable().optional(),
    interruptAltKey: KeyComboSchema.nullable().optional(),
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
  terminalKeybindings: TerminalKeybindingsSchema,
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

    // Semantic check on the alt keybindings: reject reserved / unsafe combos
    // and the case where both alt keys collapse to the same combo (a single
    // press would fire both \x1b and \x03). Emit an ERROR log so the failure
    // shows up in LogsView, same as a write failure.
    const kb = parsed.data.terminalKeybindings;
    if (kb) {
      const reasons: string[] = [];
      if (kb.abortAltKey) {
        const e = keyComboError(kb.abortAltKey);
        if (e) reasons.push(`打断 AI 备用键：${e}`);
      }
      if (kb.interruptAltKey) {
        const e = keyComboError(kb.interruptAltKey);
        if (e) reasons.push(`强制中断备用键：${e}`);
      }
      const cur = getAppSettings();
      const effAbort =
        kb.abortAltKey !== undefined ? kb.abortAltKey : cur.terminalKeybindings.abortAltKey;
      const effInterrupt =
        kb.interruptAltKey !== undefined
          ? kb.interruptAltKey
          : cur.terminalKeybindings.interruptAltKey;
      if (keyCombosEqual(effAbort, effInterrupt)) {
        reasons.push("两个备用键不能设成同一个组合");
      }
      if (reasons.length > 0) {
        const detail = reasons.join("；");
        serverLog("error", "settings", `app-settings 更新 失败: ${detail}`, {
          meta: { reason: "invalid_keybinding", reasons },
        });
        return reply.code(400).send({ error: "invalid_keybinding", message: detail });
      }
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
