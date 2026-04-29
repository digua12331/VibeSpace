import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import { serverLog } from "./log-bus.js";

export type JobKind = "review";
export type JobState = "running" | "done" | "failed" | "cancelled";

export interface JobRecord {
  id: string;
  kind: JobKind;
  title: string;
  state: JobState;
  startedAt: number;
  endedAt: number | null;
  projectId?: string;
  /** Last error message when state==='failed'. */
  error?: string;
}

interface InternalJob extends JobRecord {
  /** Timer that removes a finished job after JOB_RETENTION_MS. */
  pruneTimer?: ReturnType<typeof setTimeout>;
}

const JOB_RETENTION_MS = 30 * 60 * 1000;

/**
 * Lightweight in-memory registry for fire-and-forget background tasks owned by
 * the server (currently: archive review). It does NOT manage process
 * lifetimes — the runner is opaque. Done/failed entries are pruned after
 * 30 minutes; restart wipes the registry (matches install-jobs behaviour).
 *
 * NOTE: install-jobs has its own manager (`install-jobs.ts`); this service
 * intentionally does not absorb it. The `/api/jobs` route aggregates both
 * sources for the UI.
 */
export class JobsService extends EventEmitter {
  private jobs = new Map<string, InternalJob>();

  /** Register a fire-and-forget runner; returns the job id immediately. */
  register(opts: {
    kind: JobKind;
    title: string;
    runner: () => Promise<unknown>;
    projectId?: string;
  }): string {
    const id = nanoid(12);
    const job: InternalJob = {
      id,
      kind: opts.kind,
      title: opts.title,
      state: "running",
      startedAt: Date.now(),
      endedAt: null,
      projectId: opts.projectId,
    };
    this.jobs.set(id, job);
    serverLog("info", "jobs", `${opts.kind}-job 开始: ${opts.title}`, {
      projectId: opts.projectId,
      meta: { jobId: id, kind: opts.kind },
    });
    this.emit("change", id);

    // Run on next tick so register() returns first.
    setImmediate(() => {
      opts.runner().then(
        () => this.finish(id, "done"),
        (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.finish(id, "failed", msg);
        },
      );
    });

    return id;
  }

  private finish(id: string, state: "done" | "failed", error?: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    if (job.state !== "running") return; // already finished/cancelled
    job.state = state;
    job.endedAt = Date.now();
    if (error) job.error = error;
    const ms = job.endedAt - job.startedAt;
    if (state === "done") {
      serverLog("info", "jobs", `${job.kind}-job 成功 (${ms}ms): ${job.title}`, {
        projectId: job.projectId,
        meta: { jobId: id, kind: job.kind, ms },
      });
    } else {
      serverLog("error", "jobs", `${job.kind}-job 失败: ${error ?? "unknown"}`, {
        projectId: job.projectId,
        meta: { jobId: id, kind: job.kind, ms, error },
      });
    }
    this.emit("change", id);
    this.scheduleRemoval(id);
  }

  private scheduleRemoval(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    const timer = setTimeout(() => {
      this.jobs.delete(id);
      this.emit("change", id);
    }, JOB_RETENTION_MS);
    timer.unref();
    job.pruneTimer = timer;
  }

  get(id: string): JobRecord | undefined {
    const j = this.jobs.get(id);
    return j ? toPublic(j) : undefined;
  }

  list(): JobRecord[] {
    return [...this.jobs.values()].map(toPublic);
  }

  /** Mark a running job cancelled. Does NOT abort the underlying runner. */
  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.state !== "running") return false;
    job.state = "cancelled";
    job.endedAt = Date.now();
    serverLog("info", "jobs", `${job.kind}-job 取消: ${job.title}`, {
      projectId: job.projectId,
      meta: { jobId: id, kind: job.kind },
    });
    this.emit("change", id);
    this.scheduleRemoval(id);
    return true;
  }

  /** Remove a finished job from the registry immediately. */
  remove(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.state === "running") return false;
    if (job.pruneTimer) clearTimeout(job.pruneTimer);
    this.jobs.delete(id);
    this.emit("change", id);
    return true;
  }
}

function toPublic(j: InternalJob): JobRecord {
  return {
    id: j.id,
    kind: j.kind,
    title: j.title,
    state: j.state,
    startedAt: j.startedAt,
    endedAt: j.endedAt,
    projectId: j.projectId,
    error: j.error,
  };
}

export const jobsService = new JobsService();
