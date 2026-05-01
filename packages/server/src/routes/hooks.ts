import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { appendEvent, getProject, getSession } from "../db.js";
import { statusManager } from "../status.js";
import { readMemory, type MemoryEntry } from "../memory-service.js";
import { subagentRuns } from "../subagent-runs.js";
import { serverLog } from "../log-bus.js";

/** Cap the injected memory header at ~10KB so it never drowns the system prompt. */
const MEMORY_HEADER_MAX_BYTES = 10_000;
/** Cap auto.md lessons to the most recent N. */
const AUTO_TAIL_COUNT = 30;

function buildMemoryHeader(auto: MemoryEntry[], manual: MemoryEntry[]): string {
  const autoLessons = auto.filter((e) => e.kind === "lesson").slice(-AUTO_TAIL_COUNT);
  const manualLines = manual.filter((e) => e.text.trim().length > 0);

  if (autoLessons.length === 0 && manualLines.length === 0) return "";

  const parts: string[] = ["# 项目记忆（自动沉淀 + 手动追记）"];
  if (autoLessons.length > 0) {
    parts.push("", `## 最近自动沉淀的经验（auto.md, 最多 ${AUTO_TAIL_COUNT} 条）`);
    for (const e of autoLessons) parts.push(e.text);
  }
  if (manualLines.length > 0) {
    parts.push("", "## 手动沉淀（manual.md）");
    for (const e of manualLines) parts.push(e.text);
  }

  let out = parts.join("\n");
  if (Buffer.byteLength(out, "utf8") > MEMORY_HEADER_MAX_BYTES) {
    // Byte-accurate truncate: slice char-by-char until under budget.
    let limit = out.length;
    while (limit > 0 && Buffer.byteLength(out.slice(0, limit), "utf8") > MEMORY_HEADER_MAX_BYTES) {
      limit -= 256;
    }
    out = out.slice(0, Math.max(0, limit)) + "\n... (truncated at 10KB)";
  }
  return out;
}

async function buildSessionStartAdditionalContext(sessionId: string): Promise<string> {
  const session = getSession(sessionId);
  if (!session) return "";
  const project = getProject(session.projectId);
  if (!project) return "";
  const payload = await readMemory(project.path);
  return buildMemoryHeader(payload.auto, payload.manual);
}

const ClaudeHookSchema = z.object({
  sessionId: z.string().min(1),
  event: z.string().min(1),
  payload: z.unknown().optional(),
});

// ---------- Task tool (subagent) extraction ----------

interface TaskInvocation {
  subagentType: string;
  description: string;
  prompt: string;
  /** Claude's own tool-use id; we use it to bridge Pre and Post events. */
  toolUseId: string | null;
}

/**
 * Pull subagent metadata out of a Task tool hook payload. Tolerant of
 * field name changes — claude SDK has shifted these before. Returns null
 * when this is not a Task event. When AIMON_HOOK_DEBUG=1, dumps the raw
 * payload once so we can verify field names match reality.
 */
function extractTaskInvocation(payload: unknown): TaskInvocation | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const tool = typeof p.tool_name === "string" ? p.tool_name : null;
  if (tool !== "Task") return null;

  if (process.env.AIMON_HOOK_DEBUG === "1") {
    try {
      console.log(
        "[hook:debug] Task payload =",
        JSON.stringify(payload, null, 2).slice(0, 4000),
      );
    } catch {
      /* ignore */
    }
  }

  const input = p.tool_input;
  const rec =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : ({} as Record<string, unknown>);

  const subagentType =
    typeof rec.subagent_type === "string"
      ? rec.subagent_type
      : typeof rec.subagentType === "string"
        ? rec.subagentType
        : typeof rec.agent_type === "string"
          ? rec.agent_type
          : "unknown";
  const description =
    typeof rec.description === "string"
      ? rec.description
      : typeof rec.task_description === "string"
        ? rec.task_description
        : "";
  const prompt =
    typeof rec.prompt === "string"
      ? rec.prompt
      : typeof rec.task === "string"
        ? rec.task
        : "";
  const toolUseId =
    typeof p.tool_use_id === "string"
      ? p.tool_use_id
      : typeof p.toolUseId === "string"
        ? p.toolUseId
        : null;

  return { subagentType, description, prompt, toolUseId };
}

export async function registerHookRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/hooks/claude", async (req) => {
    // Fail-open posture: any infra error → no decision field → claude proceeds.
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

      if (event === "SessionStart") {
        try {
          const additionalContext = await buildSessionStartAdditionalContext(sessionId);
          if (additionalContext) {
            return { ok: true, additionalContext };
          }
        } catch (err) {
          app.log.warn({ err, sessionId }, "SessionStart memory lookup failed — fail-open");
        }
      }

      if (event === "PreToolUse") {
        // Task tool: register a subagent run card on the parent session.
        try {
          const task = extractTaskInvocation(payload);
          if (task) {
            subagentRuns.registerStart({
              parentSessionId: sessionId,
              runId: task.toolUseId ?? undefined,
              subagentType: task.subagentType,
              description: task.description,
              prompt: task.prompt,
            });
          }
        } catch (err) {
          // Surface to LogsView so the failure path is observable per the
          // 「操作日志规则」 ERROR-coverage requirement.
          serverLog(
            "error",
            "subagent",
            `registerStart failed: ${(err as Error).message}`,
            { sessionId, meta: { error: { message: (err as Error).message } } },
          );
        }
      }

      if (event === "PostToolUse") {
        try {
          const task = extractTaskInvocation(payload);
          if (task && task.toolUseId) {
            subagentRuns.markDone(task.toolUseId);
          }
        } catch (err) {
          serverLog(
            "error",
            "subagent",
            `markDone failed: ${(err as Error).message}`,
            { sessionId, meta: { error: { message: (err as Error).message } } },
          );
        }
      }

      app.log.info({ sessionId, event }, "claude hook");
    } catch (err) {
      app.log.warn({ err }, "claude hook handler crashed");
    }
    return { ok: true };
  });
}
