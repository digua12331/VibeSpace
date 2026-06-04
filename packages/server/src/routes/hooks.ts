import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { appendEvent, getProject, getSession } from "../db.js";
import { statusManager } from "../status.js";
import { readMemory, type MemoryEntry } from "../memory-service.js";
import { subagentRuns } from "../subagent-runs.js";
import { serverLog } from "../log-bus.js";
import {
  budgetManager,
  estimateTokens,
  loadProjectBudgetLimits,
} from "../task-budget.js";
import { readStatusSummary } from "../task-status.js";
import { readTaskFileHints } from "../docs-service.js";

/** Cap the injected memory header at ~10KB so it never drowns the system prompt. */
const MEMORY_HEADER_MAX_BYTES = 10_000;
/** Cap auto.md lessons to the most recent N. */
const AUTO_TAIL_COUNT = 30;

type MemoryMode = "relevance" | "recency";

interface SelectOpts {
  taskName?: string;
  fileHints?: string[];
}

/** Static prefix of a (possibly glob) hint, normalised for prefix matching. */
function staticPrefix(hint: string): string {
  const star = hint.indexOf("*");
  return (star >= 0 ? hint.slice(0, star) : hint).replace(/\\/g, "/").toLowerCase();
}

function basename(p: string): string {
  const norm = p.replace(/\\/g, "/").toLowerCase();
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

/** Is a concrete lesson file path plausibly covered by a task file hint? */
function fileMatchesHint(lessonFile: string, hint: string): boolean {
  const lf = lessonFile.replace(/\\/g, "/").toLowerCase();
  if (!lf) return false;
  if (hint.includes("*")) {
    const pre = staticPrefix(hint);
    return pre.length > 0 && lf.startsWith(pre);
  }
  const h = hint.replace(/\\/g, "/").toLowerCase();
  if (lf === h) return true;
  if (lf.startsWith(h.endsWith("/") ? h : h + "/")) return true;
  if (h.startsWith(lf.endsWith("/") ? lf : lf + "/")) return true;
  return basename(lf) === basename(h);
}

/** 2-char sliding windows over the CJK/alnum runs of a string, for cheap fuzzy
 *  name overlap without pulling in a tokenizer. */
function bigrams(s: string): Set<string> {
  const cleaned = (s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const out = new Set<string>();
  for (let i = 0; i + 2 <= cleaned.length; i += 1) out.add(cleaned.slice(i, i + 2));
  return out;
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n;
}

/**
 * Pick which auto.md lessons to inject. When the session is bound to a task we
 * score each lesson by file overlap (dominant, ×10) + task-name bigram overlap
 * (tiebreak) and keep the top `limit`, restored to chronological order for
 * readable output. With no task signal (no hints + no name, or all-zero scores)
 * we fall back to the most recent `limit` — never worse than the old behaviour.
 */
export function selectAutoLessons(
  autoLessons: MemoryEntry[],
  limit: number,
  opts: SelectOpts,
): { selected: MemoryEntry[]; mode: MemoryMode } {
  const recency = (): MemoryEntry[] => autoLessons.slice(-limit);
  const hints = (opts.fileHints ?? []).filter((h) => h.trim().length > 0);
  const nameGrams = bigrams(opts.taskName ?? "");
  if (hints.length === 0 && nameGrams.size === 0) {
    return { selected: recency(), mode: "recency" };
  }

  let maxScore = 0;
  const scored = autoLessons.map((e, idx) => {
    let fileScore = 0;
    for (const f of e.files ?? []) {
      if (hints.some((h) => fileMatchesHint(f, h))) fileScore += 1;
    }
    const nameScore =
      intersectionSize(nameGrams, bigrams(e.task ?? "")) * 2 +
      Math.min(3, intersectionSize(nameGrams, bigrams(e.body ?? "")));
    const score = fileScore * 10 + nameScore;
    if (score > maxScore) maxScore = score;
    return { e, idx, score };
  });

  if (maxScore === 0) return { selected: recency(), mode: "recency" };

  const top = scored
    .slice()
    .sort((a, b) => b.score - a.score || b.idx - a.idx)
    .slice(0, limit)
    .sort((a, b) => a.idx - b.idx)
    .map((x) => x.e);
  return { selected: top, mode: "relevance" };
}

function buildMemoryHeader(
  auto: MemoryEntry[],
  manual: MemoryEntry[],
  opts: SelectOpts = {},
): { header: string; mode: MemoryMode; autoCount: number } {
  const allAuto = auto.filter((e) => e.kind === "lesson");
  const { selected, mode } = selectAutoLessons(allAuto, AUTO_TAIL_COUNT, opts);
  const manualLines = manual.filter((e) => e.text.trim().length > 0);

  if (selected.length === 0 && manualLines.length === 0) {
    return { header: "", mode, autoCount: 0 };
  }

  const parts: string[] = ["# 项目记忆（自动沉淀 + 手动追记）"];
  if (selected.length > 0) {
    parts.push(
      "",
      mode === "relevance"
        ? `## 与当前任务相关的经验（auto.md, 按相关性挑选 ${selected.length} 条）`
        : `## 最近自动沉淀的经验（auto.md, 最多 ${AUTO_TAIL_COUNT} 条）`,
    );
    for (const e of selected) parts.push(e.text);
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
  return { header: out, mode, autoCount: selected.length };
}

/** Per-task STATUS.md tail injection budget. Independent from MEMORY_HEADER_MAX_BYTES
 *  so a long status log can't squeeze out project memory. */
const STATUS_TAIL_MAX_BYTES = 3 * 1024;

async function buildSessionStartAdditionalContext(sessionId: string): Promise<string> {
  const session = getSession(sessionId);
  if (!session) return "";
  const project = getProject(session.projectId);
  if (!project) return "";
  const payload = await readMemory(project.path);
  let fileHints: string[] = [];
  if (session.task) {
    try {
      fileHints = await readTaskFileHints(project.path, session.task);
    } catch {
      fileHints = [];
    }
  }
  const { header: memoryHeader, mode, autoCount } = buildMemoryHeader(
    payload.auto,
    payload.manual,
    { taskName: session.task ?? undefined, fileHints },
  );
  if (memoryHeader) {
    try {
      serverLog(
        "info",
        "memory",
        `记忆注入（${mode === "relevance" ? "按相关性" : "按最近"} ${autoCount} 条）`,
        {
          sessionId,
          projectId: session.projectId,
          meta: { mode, autoCount, task: session.task ?? null, fileHints: fileHints.length },
        },
      );
    } catch {
      /* logging is best-effort — never block SessionStart */
    }
  }

  // When the session is bound to a task with prior STATUS.md activity, append
  // the tail so the new session sees its predecessor's progress / cutoff
  // reason / next-step suggestion without the user having to type "继续 X".
  let statusBlock = "";
  if (session.task) {
    try {
      const tail = await readStatusSummary(
        project.path,
        session.task,
        STATUS_TAIL_MAX_BYTES,
      );
      if (tail) {
        statusBlock = `\n\n# 上次执行状态（任务 \`${session.task}\` 自动接力，由 SessionStart hook 注入）\n\n${tail}\n`;
      }
    } catch {
      /* status read is best-effort */
    }
  }

  return memoryHeader + statusBlock;
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

/**
 * Make sure BudgetManager has a state entry for the task this session is
 * bound to. The first call for a task lazy-loads its `.aimon/task-budget.json`
 * limits; subsequent calls are O(1) (registerTask is idempotent).
 */
async function ensureBudgetForSession(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session?.task) return;
  const existing = budgetManager.getState(session.task);
  if (existing && existing.projectId === session.projectId) {
    budgetManager.attachSession(session.task, sessionId);
    return;
  }
  const proj = getProject(session.projectId);
  if (!proj) return;
  const limits = await loadProjectBudgetLimits(proj.path);
  budgetManager.registerTask({
    taskName: session.task,
    projectId: session.projectId,
    projectPath: proj.path,
    limits,
  });
  budgetManager.attachSession(session.task, sessionId);
}

/**
 * Approximate token cost of a single hook event. Uses input + output text
 * length / 4 (see D4 in dev/active/执行不打扰最小闭环/context.md).
 */
function estimateHookTokens(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const p = payload as Record<string, unknown>;
  const inputText = p.tool_input ? safeStringify(p.tool_input) : "";
  const outputText = p.tool_response
    ? safeStringify(p.tool_response)
    : p.tool_output
      ? safeStringify(p.tool_output)
      : "";
  return estimateTokens(inputText, outputText);
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return "";
  }
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

      // Budget tracking: lazy-register the task on first hook event for a
      // task-bound session, then route the event into BudgetManager. Errors
      // here are non-fatal (the hook handler is fail-open).
      try {
        await ensureBudgetForSession(sessionId);
        const session = getSession(sessionId);
        if (session?.task) {
          if (event === "PreToolUse") {
            const tokens = estimateHookTokens(payload);
            budgetManager.recordRound(session.task, tokens);
          } else if (event === "PostToolUse") {
            const tokens = estimateHookTokens(payload);
            budgetManager.addTokens(session.task, tokens);
          }
        }
      } catch (err) {
        app.log.warn({ err, sessionId, event }, "budget tracking failed");
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
