import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FastifyInstance } from "fastify";

import { serverLog } from "./log-bus.js";
import { ptyManager } from "./pty-manager.js";

/**
 * Worktree-relative path the dispatched agent writes its completion signal to.
 * Lives under `.aimon/runtime/` (gitignored) so `git add -A` never carries it
 * into the branch and pollutes the downstream merge. The runner polls this
 * file instead of scraping the PTY for a sentinel — terminal echo / ANSI /
 * redraws made buffer scanning self-trigger on the injected prompt itself.
 */
export const JOB_SIGNAL_REL_PATH = ".aimon/runtime/job-signal";

const SIGNAL_POLL_MS = 1000;
const STUCK_REASON_MAX = 300;

export type WorktreeJobAgent = "claude" | "codex" | "shell";

export interface WorktreeJobSpawnInfo {
  sessionId: string;
  worktreePath: string;
  branch: string;
}

export interface WorktreeJobSpawnInput {
  app: FastifyInstance;
  projectId: string;
  /** Optional task binding so SessionStart hook can inject STATUS.md. */
  task?: string;
  agent?: WorktreeJobAgent;
  prompt: string;
  /** Delay before injecting prompt; TUIs eat keystrokes during boot. */
  promptDelayMs?: number;
  /** Identifier used in log scope (e.g. "issue-job:abc12" / "subtask:1::myTask"). */
  jobLabel: string;
  onSignalDone: (info: WorktreeJobSpawnInfo) => void;
  onSignalStuck: (info: WorktreeJobSpawnInfo, reason: string) => void;
  /** Called when PTY exits *before* either signal is written. */
  onSessionExitBeforeMarker?: (info: WorktreeJobSpawnInfo) => void;
}

const DEFAULT_PROMPT_DELAY_MS = 1500;

/**
 * Spawn a worktree-isolated session, wire the signal-file watcher, then inject
 * a prompt. The shared core for issue-jobs and task-subtasks dispatchers.
 *
 * Returns once the session exists and the watcher is wired. Callers are
 * responsible for the downstream verify / merge / cleanup pipeline via the
 * onSignalDone / onSignalStuck / onSessionExitBeforeMarker callbacks.
 */
export async function spawnWorktreeJob(
  input: WorktreeJobSpawnInput,
): Promise<
  | { ok: true; info: WorktreeJobSpawnInfo }
  | { ok: false; reason: string }
> {
  const agent: WorktreeJobAgent = input.agent ?? "claude";
  const sessionRes = await input.app.inject({
    method: "POST",
    url: "/api/sessions",
    payload: {
      projectId: input.projectId,
      agent,
      isolation: "worktree",
      ...(input.task ? { task: input.task } : {}),
    },
  });
  if (sessionRes.statusCode >= 300) {
    return {
      ok: false,
      reason: `session-create-failed: ${sessionRes.statusCode}`,
    };
  }

  const session = sessionRes.json() as {
    id: string;
    worktreePath?: string;
    worktreeBranch?: string;
  };
  if (!session.worktreePath || !session.worktreeBranch) {
    return { ok: false, reason: "session-missing-worktree" };
  }

  const info: WorktreeJobSpawnInfo = {
    sessionId: session.id,
    worktreePath: session.worktreePath,
    branch: session.worktreeBranch,
  };

  // Make sure the signal dir exists and no stale signal lingers from a reused
  // worktree path before the agent starts writing.
  const signalPath = join(info.worktreePath, JOB_SIGNAL_REL_PATH);
  try {
    mkdirSync(dirname(signalPath), { recursive: true });
    if (existsSync(signalPath)) rmSync(signalPath, { force: true });
  } catch {
    /* best-effort; the agent's Write tool also creates parent dirs */
  }

  wireSignalDetection(input, info, signalPath);

  const delay = input.promptDelayMs ?? DEFAULT_PROMPT_DELAY_MS;
  setTimeout(() => {
    ptyManager.write(info.sessionId, input.prompt + "\r");
  }, delay);

  serverLog("info", "worktree-runner", `spawn 成功 (${input.jobLabel})`, {
    projectId: input.projectId,
    sessionId: info.sessionId,
    meta: {
      jobLabel: input.jobLabel,
      branch: info.branch,
      agent,
      promptDelayMs: delay,
    },
  });

  return { ok: true, info };
}

/**
 * Watch the agent's out-of-band signal file (polled, not fs.watch — the latter
 * drops/duplicates events on Windows worktrees). Only a strict `DONE` or
 * `STUCK:`-prefixed first line counts; empty / half-written / garbage content
 * is ignored until the next tick, sidestepping read-mid-write races.
 */
function wireSignalDetection(
  input: WorktreeJobSpawnInput,
  info: WorktreeJobSpawnInfo,
  signalPath: string,
): void {
  let triggered = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const cleanup = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    ptyManager.off("exit", onExit);
    try {
      if (existsSync(signalPath)) rmSync(signalPath, { force: true });
    } catch {
      /* best-effort */
    }
  };

  /** Returns true if a recognized signal fired (and dispatches the callback). */
  const consumeSignal = (): boolean => {
    let raw: string;
    try {
      if (!existsSync(signalPath)) return false;
      raw = readFileSync(signalPath, "utf8");
    } catch {
      return false;
    }
    const line = raw.split("\n")[0].trim();
    if (line === "DONE") {
      triggered = true;
      cleanup();
      serverLog("info", "worktree-runner", `signal DONE (${input.jobLabel})`, {
        projectId: input.projectId,
        sessionId: info.sessionId,
        meta: { jobLabel: input.jobLabel },
      });
      input.onSignalDone(info);
      return true;
    }
    if (line.startsWith("STUCK:")) {
      triggered = true;
      const reason =
        line.slice("STUCK:".length).trim().slice(0, STUCK_REASON_MAX) || "stuck";
      cleanup();
      serverLog("warn", "worktree-runner", `signal STUCK (${input.jobLabel})`, {
        projectId: input.projectId,
        sessionId: info.sessionId,
        meta: { jobLabel: input.jobLabel, reason },
      });
      input.onSignalStuck(info, reason);
      return true;
    }
    return false;
  };

  const onExit = (sid: string): void => {
    if (sid !== info.sessionId || triggered) return;
    // The agent may have written the signal microseconds before exiting; read
    // once more before treating this as an exit-without-signal failure.
    if (consumeSignal()) return;
    triggered = true;
    cleanup();
    input.onSessionExitBeforeMarker?.(info);
  };

  timer = setInterval(() => {
    if (triggered) return;
    consumeSignal();
  }, SIGNAL_POLL_MS);

  ptyManager.on("exit", onExit);
}
