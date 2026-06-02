import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { getSession, type SessionStatus } from "./db.js";
import { serverLog } from "./log-bus.js";
import { ptyManager } from "./pty-manager.js";
import { statusManager } from "./status.js";
import { appendStatusEntry, ensureTaskDir } from "./task-status.js";
import { broadcast } from "./ws-hub.js";

export interface BudgetLimits {
  /** Hard max for tool-use rounds (PreToolUse count). */
  maxRounds: number;
  /** Hard max for wall-clock minutes since task start. */
  maxElapsedMinutes: number;
  /** Hard max for minutes without any session activity. */
  maxStallMinutes: number;
  /** Hard max for consecutive verify failures of the same step. */
  maxVerifyFails: number;
}

export const DEFAULT_BUDGET_LIMITS: BudgetLimits = {
  maxRounds: 80,
  maxElapsedMinutes: 120,
  maxStallMinutes: 15,
  maxVerifyFails: 3,
};

export type BudgetCutoffReason =
  | "rounds-exceeded"
  | "elapsed-exceeded"
  | "stall-exceeded"
  | "verify-failed-too-many";

export interface BudgetCutoff {
  reason: BudgetCutoffReason;
  at: number;
  message: string;
  /** Human-readable next-step suggestion written into STATUS.md. */
  nextStep: string;
}

export interface BudgetState {
  taskName: string;
  projectId: string;
  projectPath: string;
  startedAt: number;
  lastActivityAt: number;
  rounds: number;
  /** Approximate token consumption: (input.length + output.length) / 4. */
  tokensApprox: number;
  verifyFailCount: number;
  /** Last verify step id (resets verifyFailCount when step changes). */
  lastVerifyStepId: string | null;
  /** Live PTY session ids currently bound to this task. */
  sessionIds: Set<string>;
  /** Set when a cutoff fires; further hook events become no-ops. */
  cutoff: BudgetCutoff | null;
  limits: BudgetLimits;
}

/**
 * Snapshot of {@link BudgetState} safe to JSON-serialize and broadcast over WS.
 */
export interface BudgetStateSnapshot {
  taskName: string;
  projectId: string;
  startedAt: number;
  lastActivityAt: number;
  rounds: number;
  tokensApprox: number;
  verifyFailCount: number;
  sessionIds: string[];
  cutoff: BudgetCutoff | null;
  limits: BudgetLimits;
  elapsedMinutes: number;
  stallMinutes: number;
}

const STALL_SCAN_INTERVAL_MS = 30 * 1000;

/**
 * Per-task budget tracker. Pure in-memory; lost on server restart but the
 * downstream STATUS.md captures cutoffs so the next session can rehydrate.
 *
 * Events:
 *   'state-change'  (taskName, snapshot)
 *   'cutoff'        (taskName, cutoff, snapshot)
 *   'session-attach' / 'session-detach' (taskName, sessionId)
 */
export class BudgetManager extends EventEmitter {
  private states = new Map<string, BudgetState>();
  /** Periodic stall sweeper. unref()'d so it never blocks process exit. */
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    statusManager.on(
      "change",
      (sessionId: string, status: SessionStatus) => {
        this.touchBySession(sessionId);
        this.maybeAppendCheckpoint(sessionId, status);
      },
    );
    // Internal handler: when a cutoff fires, kill attached sessions, append
    // STATUS.md, and broadcast over WS. Sync emit -> async handler (errors
    // logged, never thrown back into the emitter chain).
    this.on(
      "cutoff",
      (taskName: string, cutoff: BudgetCutoff, snap: BudgetStateSnapshot) => {
        void this.handleCutoff(taskName, cutoff, snap);
      },
    );
    this.startSweeper();
  }

  private async handleCutoff(
    taskName: string,
    cutoff: BudgetCutoff,
    snap: BudgetStateSnapshot,
  ): Promise<void> {
    const st = this.states.get(taskName);
    if (!st) return;
    // 1. Kill all attached PTY sessions — the actual "stop hand" action.
    for (const sid of [...st.sessionIds]) {
      try {
        ptyManager.kill(sid, "budget-cutoff");
      } catch (err) {
        serverLog(
          "warn",
          "budget",
          `kill failed for session ${sid}: ${(err as Error).message}`,
          { sessionId: sid, meta: { taskName } },
        );
      }
    }
    // 2. Append CUTOFF entry to STATUS.md.
    try {
      await appendStatusEntry(st.projectPath, taskName, {
        kind: "CUTOFF",
        at: cutoff.at,
        reason: cutoff.reason,
        message: cutoff.message,
        nextStep: cutoff.nextStep,
        budget: {
          rounds: snap.rounds,
          elapsedMinutes: snap.elapsedMinutes,
          tokensApprox: snap.tokensApprox,
        },
      });
    } catch (err) {
      serverLog(
        "error",
        "budget",
        `STATUS append failed: ${(err as Error).message}`,
        { meta: { taskName, error: { message: (err as Error).message } } },
      );
    }
    // 3. Broadcast WS message so the UI can flip into the red "cutoff" state.
    try {
      broadcast({
        type: "budget-cutoff",
        taskName,
        projectId: st.projectId,
        cutoff,
        snapshot: snap,
      });
    } catch {
      /* broadcast is best-effort */
    }
  }

  private startSweeper(): void {
    if (this.sweeper) return;
    const t = setInterval(() => {
      this.scanStalls();
    }, STALL_SCAN_INTERVAL_MS);
    t.unref();
    this.sweeper = t;
  }

  private scanStalls(): void {
    const now = Date.now();
    for (const st of this.states.values()) {
      if (st.cutoff) continue;
      const stallMin = (now - st.lastActivityAt) / 60_000;
      if (stallMin >= st.limits.maxStallMinutes) {
        this.fireCutoff(st, {
          reason: "stall-exceeded",
          at: now,
          message: `任务 ${Math.round(stallMin)} 分钟没有任何活动（超过 ${st.limits.maxStallMinutes} 分钟上限）`,
          nextStep:
            "新会话开始后读 STATUS.md，确认上次最后一步是否真的完成；若是 PTY 卡死可重启 session 续跑，若是 AI 确实停手则用 `继续 <任务名>` 触发恢复。",
        });
      }
    }
  }

  /** Public for test injection. */
  registerTask(input: {
    taskName: string;
    projectId: string;
    projectPath: string;
    limits?: Partial<BudgetLimits>;
  }): BudgetState {
    const existing = this.states.get(input.taskName);
    if (existing && existing.projectId === input.projectId) return existing;
    const limits: BudgetLimits = { ...DEFAULT_BUDGET_LIMITS, ...input.limits };
    const now = Date.now();
    const state: BudgetState = {
      taskName: input.taskName,
      projectId: input.projectId,
      projectPath: input.projectPath,
      startedAt: now,
      lastActivityAt: now,
      rounds: 0,
      tokensApprox: 0,
      verifyFailCount: 0,
      lastVerifyStepId: null,
      sessionIds: new Set(),
      cutoff: null,
      limits,
    };
    this.states.set(input.taskName, state);
    serverLog("info", "budget", `task-register: ${input.taskName}`, {
      projectId: input.projectId,
      meta: { limits },
    });
    // Best-effort: make sure the task dir exists so the first STATUS.md
    // append doesn't get skipped. Don't block registration on it.
    void ensureTaskDir(input.projectPath, input.taskName);
    this.emit("state-change", input.taskName, snapshot(state));
    return state;
  }

  attachSession(taskName: string, sessionId: string): void {
    const st = this.states.get(taskName);
    if (!st) return;
    if (st.sessionIds.has(sessionId)) return;
    st.sessionIds.add(sessionId);
    st.lastActivityAt = Date.now();
    this.emit("session-attach", taskName, sessionId);
    this.emit("state-change", taskName, snapshot(st));
    // Append a RESUME entry so the next session can see when this attach
    // happened (vs the initial register). Don't await — fire and forget.
    void appendStatusEntry(st.projectPath, taskName, {
      kind: "RESUME",
      at: Date.now(),
      sessionId,
      note: st.sessionIds.size === 1 ? "session attach" : "additional session attach",
    });
  }

  detachSession(taskName: string, sessionId: string): void {
    const st = this.states.get(taskName);
    if (!st) return;
    if (!st.sessionIds.delete(sessionId)) return;
    this.emit("session-detach", taskName, sessionId);
    this.emit("state-change", taskName, snapshot(st));
  }

  /**
   * Record one Claude tool-use round. Called from routes/hooks.ts on PreToolUse.
   * Each `tokensDelta` is the rough token cost of *that* hook event; the caller
   * computes it from input/output char length (see D4 in context.md).
   */
  recordRound(taskName: string, tokensDelta: number): BudgetState | null {
    const st = this.states.get(taskName);
    if (!st) return null;
    if (st.cutoff) return st;
    st.rounds += 1;
    if (tokensDelta > 0) st.tokensApprox += tokensDelta;
    st.lastActivityAt = Date.now();
    this.checkLimits(st);
    if (!st.cutoff) {
      this.emit("state-change", taskName, snapshot(st));
    }
    return st;
  }

  /** PostToolUse only carries tokens (no round increment). */
  addTokens(taskName: string, tokensDelta: number): void {
    const st = this.states.get(taskName);
    if (!st || st.cutoff || tokensDelta <= 0) return;
    st.tokensApprox += tokensDelta;
    st.lastActivityAt = Date.now();
    this.emit("state-change", taskName, snapshot(st));
  }

  /**
   * Record a verify result. When the same `stepId` fails N times consecutively
   * (>= maxVerifyFails), fire a cutoff. A successful result or a different
   * stepId resets the counter.
   */
  recordVerifyResult(
    taskName: string,
    stepId: string,
    ok: boolean,
  ): BudgetState | null {
    const st = this.states.get(taskName);
    if (!st) return null;
    if (st.cutoff) return st;
    if (ok) {
      st.verifyFailCount = 0;
      st.lastVerifyStepId = stepId;
    } else {
      if (st.lastVerifyStepId !== stepId) {
        st.lastVerifyStepId = stepId;
        st.verifyFailCount = 1;
      } else {
        st.verifyFailCount += 1;
      }
    }
    st.lastActivityAt = Date.now();
    this.checkLimits(st);
    if (!st.cutoff) {
      this.emit("state-change", taskName, snapshot(st));
    }
    return st;
  }

  /** Bump activity timestamp without changing any counter (called on PTY output / status change). */
  private touchBySession(sessionId: string): void {
    const now = Date.now();
    for (const st of this.states.values()) {
      if (st.sessionIds.has(sessionId) && !st.cutoff) {
        st.lastActivityAt = now;
        // Don't emit state-change here — would be too chatty during normal output.
      }
    }
  }

  /**
   * Auto-checkpoint: when a session bound to a budget-tracked task transitions
   * to stopped/crashed, append a STEP_DONE / STEP_FAIL entry to STATUS.md and
   * detach the session. `idle` / `running` / `starting` don't emit checkpoints
   * — those are intermediate and would spam the log.
   */
  private maybeAppendCheckpoint(
    sessionId: string,
    status: SessionStatus,
  ): void {
    if (status !== "stopped" && status !== "crashed") return;
    const session = getSession(sessionId);
    if (!session?.task) return;
    const st = this.states.get(session.task);
    if (!st || !st.sessionIds.has(sessionId)) return;
    const kind = status === "stopped" ? "STEP_DONE" : "STEP_FAIL";
    void appendStatusEntry(st.projectPath, session.task, {
      kind,
      at: Date.now(),
      sessionId,
      note: status === "stopped" ? "session ended cleanly" : "session crashed",
      budget: {
        rounds: st.rounds,
        elapsedMinutes: (Date.now() - st.startedAt) / 60_000,
        tokensApprox: st.tokensApprox,
      },
    });
    // Detach since the session is no longer alive.
    this.detachSession(session.task, sessionId);
  }

  getState(taskName: string): BudgetStateSnapshot | null {
    const st = this.states.get(taskName);
    return st ? snapshot(st) : null;
  }

  listActive(projectId?: string): BudgetStateSnapshot[] {
    const out: BudgetStateSnapshot[] = [];
    for (const st of this.states.values()) {
      if (!projectId || st.projectId === projectId) out.push(snapshot(st));
    }
    return out;
  }

  /** Remove a task's state. Caller should clean up sessions first. */
  remove(taskName: string): boolean {
    const ok = this.states.delete(taskName);
    if (ok) this.emit("state-change", taskName, null);
    return ok;
  }

  /** Test helper. */
  reset(): void {
    this.states.clear();
  }

  private checkLimits(st: BudgetState): void {
    if (st.cutoff) return;
    const now = Date.now();
    const elapsedMin = (now - st.startedAt) / 60_000;
    if (st.rounds >= st.limits.maxRounds) {
      this.fireCutoff(st, {
        reason: "rounds-exceeded",
        at: now,
        message: `已经跑了 ${st.rounds} 轮 Claude 工具调用（超过 ${st.limits.maxRounds} 轮上限）`,
        nextStep:
          "新会话开始后先读 STATUS.md 确认进度；若主要工作已完成可直接归档任务，否则按 STATUS 末尾 NEXT 建议续跑。",
      });
      return;
    }
    if (elapsedMin >= st.limits.maxElapsedMinutes) {
      this.fireCutoff(st, {
        reason: "elapsed-exceeded",
        at: now,
        message: `任务已跑 ${Math.round(elapsedMin)} 分钟（超过 ${st.limits.maxElapsedMinutes} 分钟上限）`,
        nextStep:
          "防 compaction 把 CLAUDE.md 规则摘没——新会话开始后读 STATUS.md 接力，不要在同 session 继续。",
      });
      return;
    }
    if (st.verifyFailCount >= st.limits.maxVerifyFails) {
      this.fireCutoff(st, {
        reason: "verify-failed-too-many",
        at: now,
        message: `同一步骤 (${st.lastVerifyStepId}) 连续失败 ${st.verifyFailCount} 次（超过 ${st.limits.maxVerifyFails} 次上限）`,
        nextStep:
          "回到 plan/context 阶段核对方向是否走偏；不要继续在同 step 上死撞——可能是 plan 假设错了。",
      });
    }
  }

  private fireCutoff(st: BudgetState, cutoff: BudgetCutoff): void {
    if (st.cutoff) return;
    st.cutoff = cutoff;
    serverLog("error", "budget", `cutoff: ${cutoff.reason}`, {
      projectId: st.projectId,
      meta: {
        taskName: st.taskName,
        reason: cutoff.reason,
        message: cutoff.message,
        rounds: st.rounds,
        elapsedMinutes: (cutoff.at - st.startedAt) / 60_000,
        sessionIds: [...st.sessionIds],
      },
    });
    this.emit("cutoff", st.taskName, cutoff, snapshot(st));
    this.emit("state-change", st.taskName, snapshot(st));
  }
}

function snapshot(st: BudgetState): BudgetStateSnapshot {
  const now = Date.now();
  return {
    taskName: st.taskName,
    projectId: st.projectId,
    startedAt: st.startedAt,
    lastActivityAt: st.lastActivityAt,
    rounds: st.rounds,
    tokensApprox: st.tokensApprox,
    verifyFailCount: st.verifyFailCount,
    sessionIds: [...st.sessionIds],
    cutoff: st.cutoff,
    limits: st.limits,
    elapsedMinutes: (now - st.startedAt) / 60_000,
    stallMinutes: (now - st.lastActivityAt) / 60_000,
  };
}

/**
 * Estimate token consumption from input + output text. Approximates the
 * tokenizer at ~4 chars per token; close enough for budget-cap purposes
 * (Codex evaluation: real cost is unavailable, hard signals suffice).
 */
export function estimateTokens(...texts: string[]): number {
  let totalChars = 0;
  for (const t of texts) {
    if (typeof t === "string") totalChars += t.length;
  }
  return Math.ceil(totalChars / 4);
}

/**
 * Load `.aimon/task-budget.json` from project root. Bad JSON / missing file =
 * default limits (logged). Mirrors the "single bad config doesn't break the
 * main UI" pattern from auto.md.
 */
export async function loadProjectBudgetLimits(
  projectPath: string,
): Promise<BudgetLimits> {
  const cfgPath = join(projectPath, ".aimon", "task-budget.json");
  if (!existsSync(cfgPath)) return DEFAULT_BUDGET_LIMITS;
  try {
    const raw = await readFile(cfgPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<BudgetLimits>;
    return {
      maxRounds: clampInt(parsed.maxRounds, DEFAULT_BUDGET_LIMITS.maxRounds, 1, 10000),
      maxElapsedMinutes: clampInt(
        parsed.maxElapsedMinutes,
        DEFAULT_BUDGET_LIMITS.maxElapsedMinutes,
        1,
        1440,
      ),
      maxStallMinutes: clampInt(
        parsed.maxStallMinutes,
        DEFAULT_BUDGET_LIMITS.maxStallMinutes,
        1,
        1440,
      ),
      maxVerifyFails: clampInt(
        parsed.maxVerifyFails,
        DEFAULT_BUDGET_LIMITS.maxVerifyFails,
        1,
        100,
      ),
    };
  } catch (err) {
    serverLog("warn", "budget", `bad task-budget.json: ${(err as Error).message}`, {
      meta: { cfgPath },
    });
    return DEFAULT_BUDGET_LIMITS;
  }
}

function clampInt(
  v: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  const i = Math.floor(v);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

export const budgetManager = new BudgetManager();
