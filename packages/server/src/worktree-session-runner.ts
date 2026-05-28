import type { FastifyInstance } from "fastify";

import { serverLog } from "./log-bus.js";
import { ptyManager } from "./pty-manager.js";

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
  markerDone: string;
  markerStuck: string;
  /** Delay before injecting prompt; TUIs eat keystrokes during boot. */
  promptDelayMs?: number;
  /** Identifier used in log scope (e.g. "issue-job:abc12" / "subtask:1::myTask"). */
  jobLabel: string;
  onMarkerDone: (info: WorktreeJobSpawnInfo) => void;
  onMarkerStuck: (info: WorktreeJobSpawnInfo, reason: string) => void;
  /** Called when PTY exits *before* either marker fires. */
  onSessionExitBeforeMarker?: (info: WorktreeJobSpawnInfo) => void;
}

const DEFAULT_PROMPT_DELAY_MS = 1500;
const OUTPUT_BUFFER_MAX = 4096;

/**
 * Spawn a worktree-isolated session, wire marker detection, then inject a
 * prompt. The shared core for issue-jobs and task-subtasks dispatchers.
 *
 * Returns once the session exists and the marker watcher is wired. Callers
 * are responsible for the downstream verify / merge / cleanup pipeline via
 * the onMarkerDone / onMarkerStuck / onSessionExitBeforeMarker callbacks.
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

  wireMarkerDetection(input, info);

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

function wireMarkerDetection(
  input: WorktreeJobSpawnInput,
  info: WorktreeJobSpawnInfo,
): void {
  let buffer = "";
  let triggered = false;

  const cleanup = (): void => {
    ptyManager.off("output", onOutput);
    ptyManager.off("exit", onExit);
  };

  const onOutput = (sid: string, data: string): void => {
    if (sid !== info.sessionId || triggered) return;
    buffer += data;
    if (buffer.length > OUTPUT_BUFFER_MAX) buffer = buffer.slice(-OUTPUT_BUFFER_MAX);

    if (buffer.includes(input.markerStuck)) {
      triggered = true;
      const idx = buffer.indexOf(input.markerStuck) + input.markerStuck.length;
      const reason = buffer.slice(idx).split("\n")[0].trim() || "stuck";
      cleanup();
      input.onMarkerStuck(info, reason);
      return;
    }

    if (buffer.includes(input.markerDone)) {
      triggered = true;
      cleanup();
      input.onMarkerDone(info);
    }
  };

  const onExit = (sid: string): void => {
    if (sid !== info.sessionId || triggered) return;
    triggered = true;
    cleanup();
    input.onSessionExitBeforeMarker?.(info);
  };

  ptyManager.on("output", onOutput);
  ptyManager.on("exit", onExit);
}
