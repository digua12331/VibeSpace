import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";

export type InstallJobState = "running" | "done" | "failed" | "cancelled";

export interface InstallJob {
  id: string;
  cliId: string;
  cmdline: string;
  state: InstallJobState;
  exitCode: number | null;
  log: string;
  startedAt: number;
  endedAt: number | null;
}

interface InternalJob extends InstallJob {
  proc: ChildProcess;
}

const MAX_LOG_BYTES = 64 * 1024;

export class InstallJobManager extends EventEmitter {
  private jobs = new Map<string, InternalJob>();
  /** cliId -> jobId for the most recent / currently-running job. */
  private byCli = new Map<string, string>();

  /**
   * Events:
   *   'log'  (jobId, chunk)
   *   'exit' (jobId, exitCode | null, state)
   */

  /** Returns existing running job for the same CLI, otherwise spawns a new one. */
  start(cliId: string, cmdline: string): InstallJob {
    const existingId = this.byCli.get(cliId);
    if (existingId) {
      const existing = this.jobs.get(existingId);
      if (existing && existing.state === "running") return toPublic(existing);
    }

    const isWin = process.platform === "win32";
    const proc = isWin
      ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", cmdline], {
          windowsHide: true,
          env: process.env,
        })
      : spawn("/bin/sh", ["-lc", cmdline], { env: process.env });

    const job: InternalJob = {
      id: nanoid(12),
      cliId,
      cmdline,
      state: "running",
      exitCode: null,
      log: "",
      startedAt: Date.now(),
      endedAt: null,
      proc,
    };
    this.jobs.set(job.id, job);
    this.byCli.set(cliId, job.id);

    const append = (chunk: Buffer | string): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      job.log += text;
      if (job.log.length > MAX_LOG_BYTES) {
        const keep = Math.floor(MAX_LOG_BYTES / 2);
        job.log = "…(log truncated)…\n" + job.log.slice(-keep);
      }
      this.emit("log", job.id, text);
    };

    proc.stdout?.on("data", append);
    proc.stderr?.on("data", append);
    proc.on("error", (err) => {
      append(`\n[spawn error] ${err.message}\n`);
    });
    proc.on("exit", (code, signal) => {
      job.exitCode = code;
      job.endedAt = Date.now();
      if (job.state === "cancelled") {
        // already labelled
      } else if (code === 0) {
        job.state = "done";
      } else {
        job.state = "failed";
      }
      append(
        `\n[process exited code=${code ?? "null"}${signal ? ` signal=${signal}` : ""}]\n`,
      );
      this.emit("exit", job.id, code, job.state);
    });

    return toPublic(job);
  }

  get(jobId: string): InstallJob | undefined {
    const j = this.jobs.get(jobId);
    return j ? toPublic(j) : undefined;
  }

  list(): InstallJob[] {
    return [...this.jobs.values()].map(toPublic);
  }

  cancel(jobId: string): boolean {
    const j = this.jobs.get(jobId);
    if (!j || j.state !== "running") return false;
    j.state = "cancelled";
    try {
      j.proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      if (j.proc.exitCode === null && !j.proc.killed) {
        try {
          j.proc.kill("SIGKILL");
        } catch {
          /* ignore */
        }
      }
    }, 3000).unref();
    return true;
  }

  killAll(): void {
    for (const j of this.jobs.values()) {
      if (j.state === "running") {
        try {
          j.proc.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }
    }
  }
}

function toPublic(j: InternalJob): InstallJob {
  return {
    id: j.id,
    cliId: j.cliId,
    cmdline: j.cmdline,
    state: j.state,
    exitCode: j.exitCode,
    log: j.log,
    startedAt: j.startedAt,
    endedAt: j.endedAt,
  };
}

export const installJobs = new InstallJobManager();
