import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import { serverLog } from "./log-bus.js";

export type IssueJobState =
  | "pending"
  | "running"
  | "verifying"
  | "review-ready"
  | "failed"
  | "cancelled"
  | "merge-conflict"
  | "unknown";

export interface IssueJob {
  jobId: string;
  projectId: string;
  /** sha1 hash of the issue text (matches IssueItem.hash). */
  issueHash: string;
  /** Issue text snapshot at dispatch time (without [auto] prefix). */
  issueText: string;
  worktreePath: string;
  branch: string;
  /** PTY session id, set when state becomes 'running'. Null while pending / after end. */
  sessionId: string | null;
  state: IssueJobState;
  /** Tail-truncated verify pipeline log. */
  verifyLog: string;
  startedAt: number;
  endedAt: number | null;
  /** Reason for failed / cancelled / merge-conflict / unknown states. */
  errorReason: string | null;
}

interface InternalJob extends IssueJob {
  timeoutTimer?: ReturnType<typeof setTimeout>;
}

const TIMEOUT_MS = 90 * 60 * 1000;
const VERIFY_LOG_MAX = 32 * 1024;

// State machine: allowed transitions per state. Self-transitions always allowed.
const VALID_TRANSITIONS: Record<IssueJobState, IssueJobState[]> = {
  pending: ["running", "cancelled"],
  running: ["verifying", "failed", "cancelled"],
  verifying: ["review-ready", "failed", "cancelled"],
  "review-ready": ["merge-conflict", "cancelled"],
  failed: [],
  cancelled: [],
  "merge-conflict": ["review-ready", "cancelled"],
  unknown: ["cancelled", "review-ready", "failed"],
};

function canTransition(from: IssueJobState, to: IssueJobState): boolean {
  if (from === to) return true;
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

interface RegisterInput {
  projectId: string;
  issueHash: string;
  issueText: string;
  worktreePath: string;
  branch: string;
}

/**
 * In-memory store for issue-jobs (one per dispatched dev/issues.md entry).
 * Cleared on server restart; orphaned worktrees are re-imported as `unknown`
 * via registerOrphan() by the route-layer scanner.
 *
 * Events emitted (for ws-hub to forward to clients):
 *   'state-change' (jobId, newState, oldState)
 *   'verify-log'   (jobId, chunk)
 *   'remove'       (jobId)
 */
export class IssueJobManager extends EventEmitter {
  private jobs = new Map<string, InternalJob>();

  register(input: RegisterInput): IssueJob {
    const job: InternalJob = {
      jobId: nanoid(12),
      projectId: input.projectId,
      issueHash: input.issueHash,
      issueText: input.issueText,
      worktreePath: input.worktreePath,
      branch: input.branch,
      sessionId: null,
      state: "pending",
      verifyLog: "",
      startedAt: Date.now(),
      endedAt: null,
      errorReason: null,
    };
    this.jobs.set(job.jobId, job);
    serverLog(
      "info",
      "issues",
      `job-register: ${input.issueHash.slice(0, 8)}`,
      {
        projectId: input.projectId,
        meta: { jobId: job.jobId, issueHash: input.issueHash },
      },
    );
    this.emit("state-change", job.jobId, "pending", "pending");
    return toPublic(job);
  }

  /** Re-import an orphaned worktree found on disk after server restart. */
  registerOrphan(input: RegisterInput): IssueJob {
    const job: InternalJob = {
      jobId: nanoid(12),
      projectId: input.projectId,
      issueHash: input.issueHash,
      issueText: input.issueText,
      worktreePath: input.worktreePath,
      branch: input.branch,
      sessionId: null,
      state: "unknown",
      verifyLog: "",
      startedAt: Date.now(),
      endedAt: Date.now(),
      errorReason: "server-restart",
    };
    this.jobs.set(job.jobId, job);
    this.emit("state-change", job.jobId, "unknown", "unknown");
    return toPublic(job);
  }

  markRunning(jobId: string, sessionId: string): boolean {
    return this.transition(jobId, "running", { sessionId, withTimeout: true });
  }

  markVerifying(jobId: string): boolean {
    return this.transition(jobId, "verifying");
  }

  markReviewReady(jobId: string): boolean {
    return this.transition(jobId, "review-ready", {
      clearTimer: true,
      endNow: true,
    });
  }

  markFailed(jobId: string, errorReason: string): boolean {
    return this.transition(jobId, "failed", {
      clearTimer: true,
      endNow: true,
      errorReason,
    });
  }

  markCancelled(jobId: string, errorReason?: string): boolean {
    return this.transition(jobId, "cancelled", {
      clearTimer: true,
      endNow: true,
      errorReason: errorReason ?? null,
    });
  }

  markMergeConflict(jobId: string, errorReason: string): boolean {
    return this.transition(jobId, "merge-conflict", { errorReason });
  }

  appendVerifyLog(jobId: string, chunk: string): void {
    const j = this.jobs.get(jobId);
    if (!j) return;
    j.verifyLog += chunk;
    if (j.verifyLog.length > VERIFY_LOG_MAX) {
      const keep = Math.floor(VERIFY_LOG_MAX / 2);
      j.verifyLog = "…(verify log truncated)…\n" + j.verifyLog.slice(-keep);
    }
    this.emit("verify-log", jobId, chunk);
  }

  /** Remove the entry. Caller is expected to have cleaned up the worktree. */
  remove(jobId: string): boolean {
    const j = this.jobs.get(jobId);
    if (!j) return false;
    if (j.timeoutTimer) clearTimeout(j.timeoutTimer);
    this.jobs.delete(jobId);
    this.emit("remove", jobId);
    return true;
  }

  get(jobId: string): IssueJob | undefined {
    const j = this.jobs.get(jobId);
    return j ? toPublic(j) : undefined;
  }

  list(projectId?: string): IssueJob[] {
    const out: IssueJob[] = [];
    for (const j of this.jobs.values()) {
      if (!projectId || j.projectId === projectId) out.push(toPublic(j));
    }
    out.sort((a, b) => b.startedAt - a.startedAt);
    return out;
  }

  /**
   * Count jobs that consume a worktree slot. Used by the route layer for
   * concurrency-cap enforcement.
   */
  countActive(projectId: string): number {
    let n = 0;
    for (const j of this.jobs.values()) {
      if (j.projectId !== projectId) continue;
      if (
        j.state === "pending" ||
        j.state === "running" ||
        j.state === "verifying" ||
        j.state === "review-ready" ||
        j.state === "merge-conflict" ||
        j.state === "unknown"
      ) {
        n += 1;
      }
    }
    return n;
  }

  /** True when a job already exists for (projectId, issueHash) in a live state. */
  hasLiveJobForIssue(projectId: string, issueHash: string): boolean {
    for (const j of this.jobs.values()) {
      if (j.projectId !== projectId) continue;
      if (j.issueHash !== issueHash) continue;
      if (
        j.state !== "failed" &&
        j.state !== "cancelled"
      ) {
        return true;
      }
    }
    return false;
  }

  /** Test helper — clear everything. Not used in prod paths. */
  reset(): void {
    for (const j of this.jobs.values()) {
      if (j.timeoutTimer) clearTimeout(j.timeoutTimer);
    }
    this.jobs.clear();
  }

  private transition(
    jobId: string,
    to: IssueJobState,
    opts: {
      sessionId?: string;
      withTimeout?: boolean;
      clearTimer?: boolean;
      endNow?: boolean;
      errorReason?: string | null;
    } = {},
  ): boolean {
    const j = this.jobs.get(jobId);
    if (!j) return false;
    if (!canTransition(j.state, to)) {
      serverLog(
        "warn",
        "issues",
        `job-transition rejected: ${j.state} → ${to}`,
        {
          projectId: j.projectId,
          sessionId: j.sessionId ?? undefined,
          meta: { jobId },
        },
      );
      return false;
    }
    const oldState = j.state;
    j.state = to;
    if (opts.sessionId !== undefined) j.sessionId = opts.sessionId;
    if (opts.errorReason !== undefined) j.errorReason = opts.errorReason;
    if (opts.endNow) j.endedAt = Date.now();
    if (opts.clearTimer && j.timeoutTimer) {
      clearTimeout(j.timeoutTimer);
      j.timeoutTimer = undefined;
    }
    if (opts.withTimeout) {
      if (j.timeoutTimer) clearTimeout(j.timeoutTimer);
      const timer = setTimeout(() => {
        this.markFailed(jobId, "timeout 90m");
      }, TIMEOUT_MS);
      timer.unref();
      j.timeoutTimer = timer;
    }
    serverLog("info", "issues", `job-state: ${oldState} → ${to}`, {
      projectId: j.projectId,
      sessionId: j.sessionId ?? undefined,
      meta: { jobId, errorReason: j.errorReason },
    });
    this.emit("state-change", jobId, to, oldState);
    return true;
  }
}

function toPublic(j: InternalJob): IssueJob {
  return {
    jobId: j.jobId,
    projectId: j.projectId,
    issueHash: j.issueHash,
    issueText: j.issueText,
    worktreePath: j.worktreePath,
    branch: j.branch,
    sessionId: j.sessionId,
    state: j.state,
    verifyLog: j.verifyLog,
    startedAt: j.startedAt,
    endedAt: j.endedAt,
    errorReason: j.errorReason,
  };
}

export const issueJobs = new IssueJobManager();
