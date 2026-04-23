import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { relative, isAbsolute, resolve } from "node:path";
import picomatch from "picomatch";
import { appendEvent, getProject, getSession, getSessionScope } from "../db.js";
import { statusManager } from "../status.js";
import { readMemory, type MemoryEntry } from "../memory-service.js";

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

const WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);

interface ScopeDecision {
  decision: "block";
  reason: string;
}

function toRelPosix(filePath: string, projectRoot: string): string | null {
  const absFile = resolve(filePath);
  const absRoot = resolve(projectRoot);
  const rel = relative(absRoot, absFile);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(/[\\/]/).join("/");
}

function evaluateScope(
  filePath: string,
  projectRoot: string,
  readwrite: string[],
  readonly: string[],
): ScopeDecision | null {
  const rel = toRelPosix(filePath, projectRoot);
  if (rel === null) return null;
  const opts = { dot: true };

  for (const pat of readonly) {
    if (picomatch.isMatch(rel, pat, opts)) {
      return {
        decision: "block",
        reason: `out of session scope: ${rel} matches readonly glob \`${pat}\``,
      };
    }
  }
  for (const pat of readwrite) {
    if (picomatch.isMatch(rel, pat, opts)) return null;
  }
  return {
    decision: "block",
    reason: `out of session scope: ${rel} is not in any readwrite glob (${
      readwrite.length > 0 ? readwrite.join(", ") : "empty"
    })`,
  };
}

interface PreToolUsePayload {
  tool_name?: unknown;
  tool_input?: unknown;
}

function extractToolFilePath(payload: unknown): { tool: string; filePath: string } | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as PreToolUsePayload;
  const tool = typeof p.tool_name === "string" ? p.tool_name : null;
  if (!tool) return null;
  const input = p.tool_input;
  if (!input || typeof input !== "object") return null;
  const rec = input as Record<string, unknown>;
  const raw =
    typeof rec.file_path === "string"
      ? rec.file_path
      : typeof rec.notebook_path === "string"
        ? rec.notebook_path
        : null;
  if (!raw) return null;
  return { tool, filePath: raw };
}

function checkScopeForPreToolUse(
  sessionId: string,
  payload: unknown,
): ScopeDecision | null {
  const scope = getSessionScope(sessionId);
  if (!scope || !scope.enabled) return null;
  const extracted = extractToolFilePath(payload);
  if (!extracted) return null;
  if (!WRITE_TOOLS.has(extracted.tool)) return null;

  const session = getSession(sessionId);
  if (!session) return null;
  const project = getProject(session.projectId);
  if (!project) return null;

  return evaluateScope(
    extracted.filePath,
    project.path,
    scope.readwrite,
    scope.readonly,
  );
}

export async function registerHookRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/hooks/claude", async (req) => {
    // Fail-open posture: any infra error → no decision field → claude proceeds.
    // Only return `decision: "block"` when the scope logic explicitly says so.
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
        try {
          const decision = checkScopeForPreToolUse(sessionId, payload);
          if (decision) {
            app.log.info({ sessionId, reason: decision.reason }, "scope block");
            try {
              appendEvent({
                sessionId,
                kind: "scope_block",
                payload: { reason: decision.reason },
              });
            } catch {
              /* non-fatal */
            }
            return {
              ok: true,
              decision: decision.decision,
              reason: decision.reason,
            };
          }
        } catch (err) {
          app.log.warn({ err, sessionId }, "scope check failed — fail-open");
        }
      }

      app.log.info({ sessionId, event }, "claude hook");
    } catch (err) {
      app.log.warn({ err }, "claude hook handler crashed");
    }
    return { ok: true };
  });
}
