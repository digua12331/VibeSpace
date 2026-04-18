import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { appendEvent } from "../db.js";
import { statusManager } from "../status.js";

const ClaudeHookSchema = z.object({
  sessionId: z.string().min(1),
  event: z.string().min(1),
  payload: z.unknown().optional(),
});

export async function registerHookRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/hooks/claude", async (req) => {
    // Hooks must NEVER block claude — swallow everything and always return ok.
    try {
      const parsed = ClaudeHookSchema.safeParse(req.body);
      if (!parsed.success) {
        app.log.warn({ issues: parsed.error.issues }, "claude hook bad body");
        return { ok: true };
      }
      const { sessionId, event, payload } = parsed.data;
      try {
        appendEvent({ sessionId, kind: "hook", payload: { event, payload } });
      } catch (err) {
        app.log.warn({ err, sessionId, event }, "appendEvent failed");
      }
      try {
        statusManager.handleClaudeHook(sessionId, event, payload);
      } catch (err) {
        app.log.warn({ err, sessionId, event }, "handleClaudeHook failed");
      }
      app.log.info({ sessionId, event }, "claude hook");
    } catch (err) {
      app.log.warn({ err }, "claude hook handler crashed");
    }
    return { ok: true };
  });
}
