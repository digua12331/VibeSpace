import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { serverLog } from "./log-bus.js";

export type SubtaskRunState =
  | "pending"
  | "running"
  | "verifying"
  | "review-ready"
  | "failed"
  | "cancelled"
  | "merge-conflict"
  | "merged"
  | "unknown";

export interface SubtaskRun {
  /** Stable key: `<taskName>::<subtaskId>`. */
  runId: string;
  projectId: string;
  taskName: string;
  subtaskId: number;
  title: string;
  worktreePath: string;
  branch: string;
  /** PTY session id, set when state becomes 'running'. */
  sessionId: string | null;
  state: SubtaskRunState;
  /** Tail-truncated verify pipeline log. */
  verifyLog: string;
  startedAt: number;
  endedAt: number | null;
  mergedAt: number | null;
  /** Reason for failed / cancelled / merge-conflict / unknown states. */
  errorReason: string | null;
}

interface InternalRun extends SubtaskRun {
  timeoutTimer?: ReturnType<typeof setTimeout>;
}

const TIMEOUT_MS = 90 * 60 * 1000;
const VERIFY_LOG_MAX = 32 * 1024;

const VALID_TRANSITIONS: Record<SubtaskRunState, SubtaskRunState[]> = {
  pending: ["running", "cancelled"],
  running: ["verifying", "failed", "cancelled"],
  verifying: ["review-ready", "failed", "cancelled"],
  "review-ready": ["merge-conflict", "merged", "cancelled"],
  failed: [],
  cancelled: [],
  "merge-conflict": ["review-ready", "merged", "cancelled"],
  merged: [],
  unknown: ["cancelled", "review-ready", "failed", "merged"],
};

function canTransition(from: SubtaskRunState, to: SubtaskRunState): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

interface RegisterInput {
  projectId: string;
  taskName: string;
  subtaskId: number;
  title: string;
  worktreePath: string;
  branch: string;
}

interface SubtaskMeta {
  runId: string;
  projectId: string;
  taskName: string;
  subtaskId: number;
  title: string;
  worktreePath: string;
  branch: string;
  sessionId: string | null;
  startedAt: number;
}

function runIdOf(taskName: string, subtaskId: number): string {
  return `${taskName}::${subtaskId}`;
}

/**
 * In-memory store for subtask runs. One entry per dispatched subtask of a
 * task. Cleared on server restart; orphaned worktrees are re-imported as
 * `unknown` via registerOrphan() by the route-layer scanner.
 *
 * Events:
 *   'state-change' (runId, newState, oldState)
 *   'verify-log'   (runId, chunk)
 *   'remove'       (runId)
 */
export class SubtaskRunManager extends EventEmitter {
  private runs = new Map<string, InternalRun>();

  register(input: RegisterInput): SubtaskRun {
    const runId = runIdOf(input.taskName, input.subtaskId);
    const existing = this.runs.get(runId);
    if (existing) {
      // Idempotent re-register from a retry; keep the existing entry.
      return toPublic(existing);
    }
    const run: InternalRun = {
      runId,
      projectId: input.projectId,
      taskName: input.taskName,
      subtaskId: input.subtaskId,
      title: input.title,
      worktreePath: input.worktreePath,
      branch: input.branch,
      sessionId: null,
      state: "pending",
      verifyLog: "",
      startedAt: Date.now(),
      endedAt: null,
      mergedAt: null,
      errorReason: null,
    };
    this.runs.set(runId, run);
    serverLog("info", "subtasks", `register: ${runId}`, {
      projectId: input.projectId,
      meta: { runId, subtaskId: input.subtaskId, taskName: input.taskName },
    });
    this.emit("state-change", runId, "pending", "pending");
    return toPublic(run);
  }

  registerOrphan(input: RegisterInput): SubtaskRun {
    const runId = runIdOf(input.taskName, input.subtaskId);
    if (this.runs.has(runId)) return toPublic(this.runs.get(runId)!);
    const run: InternalRun = {
      runId,
      projectId: input.projectId,
      taskName: input.taskName,
      subtaskId: input.subtaskId,
      title: input.title,
      worktreePath: input.worktreePath,
      branch: input.branch,
      sessionId: null,
      state: "unknown",
      verifyLog: "",
      startedAt: Date.now(),
      endedAt: Date.now(),
      mergedAt: null,
      errorReason: "server-restart",
    };
    this.runs.set(runId, run);
    this.emit("state-change", runId, "unknown", "unknown");
    return toPublic(run);
  }

  markRunning(runId: string, sessionId: string): boolean {
    return this.transition(runId, "running", {
      sessionId,
      withTimeout: true,
    });
  }

  markVerifying(runId: string): boolean {
    return this.transition(runId, "verifying");
  }

  markReviewReady(runId: string): boolean {
    return this.transition(runId, "review-ready", {
      clearTimer: true,
      endNow: true,
    });
  }

  markFailed(runId: string, errorReason: string): boolean {
    return this.transition(runId, "failed", {
      clearTimer: true,
      endNow: true,
      errorReason,
    });
  }

  markCancelled(runId: string, errorReason?: string): boolean {
    return this.transition(runId, "cancelled", {
      clearTimer: true,
      endNow: true,
      errorReason: errorReason ?? null,
    });
  }

  markMergeConflict(runId: string, errorReason: string): boolean {
    return this.transition(runId, "merge-conflict", { errorReason });
  }

  markMerged(runId: string): boolean {
    const ok = this.transition(runId, "merged", { mergedNow: true });
    return ok;
  }

  appendVerifyLog(runId: string, chunk: string): void {
    const r = this.runs.get(runId);
    if (!r) return;
    r.verifyLog += chunk;
    if (r.verifyLog.length > VERIFY_LOG_MAX) {
      const keep = Math.floor(VERIFY_LOG_MAX / 2);
      r.verifyLog = "…(verify log truncated)…\n" + r.verifyLog.slice(-keep);
    }
    this.emit("verify-log", runId, chunk);
  }

  remove(runId: string): boolean {
    const r = this.runs.get(runId);
    if (!r) return false;
    if (r.timeoutTimer) clearTimeout(r.timeoutTimer);
    this.runs.delete(runId);
    this.emit("remove", runId);
    return true;
  }

  get(runId: string): SubtaskRun | undefined {
    const r = this.runs.get(runId);
    return r ? toPublic(r) : undefined;
  }

  getBySubtask(taskName: string, subtaskId: number): SubtaskRun | undefined {
    return this.get(runIdOf(taskName, subtaskId));
  }

  listByTask(projectId: string, taskName: string): SubtaskRun[] {
    const out: SubtaskRun[] = [];
    for (const r of this.runs.values()) {
      if (r.projectId !== projectId || r.taskName !== taskName) continue;
      out.push(toPublic(r));
    }
    out.sort((a, b) => a.subtaskId - b.subtaskId);
    return out;
  }

  list(projectId?: string): SubtaskRun[] {
    const out: SubtaskRun[] = [];
    for (const r of this.runs.values()) {
      if (!projectId || r.projectId === projectId) out.push(toPublic(r));
    }
    out.sort((a, b) => b.startedAt - a.startedAt);
    return out;
  }

  countActive(projectId: string): number {
    let n = 0;
    for (const r of this.runs.values()) {
      if (r.projectId !== projectId) continue;
      if (
        r.state === "pending" ||
        r.state === "running" ||
        r.state === "verifying" ||
        r.state === "review-ready" ||
        r.state === "merge-conflict" ||
        r.state === "unknown"
      ) {
        n += 1;
      }
    }
    return n;
  }

  reset(): void {
    for (const r of this.runs.values()) {
      if (r.timeoutTimer) clearTimeout(r.timeoutTimer);
    }
    this.runs.clear();
  }

  private transition(
    runId: string,
    to: SubtaskRunState,
    opts: {
      sessionId?: string;
      withTimeout?: boolean;
      clearTimer?: boolean;
      endNow?: boolean;
      mergedNow?: boolean;
      errorReason?: string | null;
    } = {},
  ): boolean {
    const r = this.runs.get(runId);
    if (!r) return false;
    if (!canTransition(r.state, to)) {
      serverLog(
        "warn",
        "subtasks",
        `transition rejected: ${r.state} → ${to}`,
        { projectId: r.projectId, meta: { runId } },
      );
      return false;
    }
    const oldState = r.state;
    r.state = to;
    if (opts.sessionId !== undefined) r.sessionId = opts.sessionId;
    if (opts.errorReason !== undefined) r.errorReason = opts.errorReason;
    if (opts.endNow) r.endedAt = Date.now();
    if (opts.mergedNow) r.mergedAt = Date.now();
    if (opts.clearTimer && r.timeoutTimer) {
      clearTimeout(r.timeoutTimer);
      r.timeoutTimer = undefined;
    }
    if (opts.withTimeout) {
      if (r.timeoutTimer) clearTimeout(r.timeoutTimer);
      const timer = setTimeout(() => {
        this.markFailed(runId, "timeout 90m");
      }, TIMEOUT_MS);
      timer.unref();
      r.timeoutTimer = timer;
    }
    serverLog("info", "subtasks", `state: ${oldState} → ${to}`, {
      projectId: r.projectId,
      sessionId: r.sessionId ?? undefined,
      meta: { runId, errorReason: r.errorReason },
    });
    this.emit("state-change", runId, to, oldState);
    return true;
  }
}

function toPublic(r: InternalRun): SubtaskRun {
  return {
    runId: r.runId,
    projectId: r.projectId,
    taskName: r.taskName,
    subtaskId: r.subtaskId,
    title: r.title,
    worktreePath: r.worktreePath,
    branch: r.branch,
    sessionId: r.sessionId,
    state: r.state,
    verifyLog: r.verifyLog,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    mergedAt: r.mergedAt,
    errorReason: r.errorReason,
  };
}

// ---------- Disk metadata helpers ----------

function subtasksMetaDir(projectPath: string, taskName: string): string {
  return join(projectPath, ".aimon", "subtasks", taskName);
}

export async function writeSubtaskMeta(
  projectPath: string,
  meta: SubtaskMeta,
): Promise<void> {
  const dir = subtasksMetaDir(projectPath, meta.taskName);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, `${meta.subtaskId}.json`),
    JSON.stringify(meta, null, 2),
    "utf8",
  );
}

export async function deleteSubtaskMeta(
  projectPath: string,
  taskName: string,
  subtaskId: number,
): Promise<void> {
  try {
    await unlink(join(subtasksMetaDir(projectPath, taskName), `${subtaskId}.json`));
  } catch {
    /* already gone */
  }
}

export async function loadSubtaskOrphans(
  projectPath: string,
  taskName: string,
): Promise<SubtaskMeta[]> {
  const dir = subtasksMetaDir(projectPath, taskName);
  if (!existsSync(dir)) return [];
  try {
    const files = await readdir(dir);
    const out: SubtaskMeta[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await readFile(join(dir, f), "utf8");
        out.push(JSON.parse(raw) as SubtaskMeta);
      } catch {
        /* skip corrupt entry */
      }
    }
    return out;
  } catch {
    return [];
  }
}

export const subtaskRuns = new SubtaskRunManager();
