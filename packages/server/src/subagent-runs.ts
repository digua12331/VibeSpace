import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import { serverLog } from "./log-bus.js";

export type SubagentRunState = "running" | "done";

export interface SubagentRunRecord {
  id: string;
  parentSessionId: string;
  /** Claude's `subagent_type` from Task tool input. */
  subagentType: string;
  /** Short description from Task tool input (claude provides it). */
  description: string;
  /** Full prompt the subagent was started with. Server keeps it; wire shape
   *  truncates to 1KB. */
  prompt: string;
  state: SubagentRunState;
  startedAt: number;
  endedAt: number | null;
}

interface InternalRun extends SubagentRunRecord {
  pruneTimer?: ReturnType<typeof setTimeout>;
}

const RUN_RETENTION_MS = 30 * 60 * 1000;

/**
 * Tracks claude `Task` tool invocations as they appear via the hook bridge.
 * The runs are NOT real PTY children — claude executes subagents inside its
 * own process. We only display them as cards on the parent session's view.
 *
 * Pure in-memory; cleared on server restart (matches jobs-service).
 */
export class SubagentRunsService extends EventEmitter {
  private runs = new Map<string, InternalRun>();

  /** Register a fresh subagent run. Caller should keep the returned id to call markDone later. */
  registerStart(input: {
    parentSessionId: string;
    /** Optional pre-existing id (e.g. claude's tool_use_id). When omitted we mint a new one. */
    runId?: string;
    subagentType: string;
    description: string;
    prompt: string;
  }): string {
    const id = input.runId ?? nanoid(12);
    const run: InternalRun = {
      id,
      parentSessionId: input.parentSessionId,
      subagentType: input.subagentType || "unknown",
      description: input.description || "",
      prompt: input.prompt || "",
      state: "running",
      startedAt: Date.now(),
      endedAt: null,
    };
    this.runs.set(id, run);
    serverLog(
      "info",
      "subagent",
      `start: ${run.subagentType} · ${run.description.slice(0, 80)}`,
      {
        sessionId: run.parentSessionId,
        meta: { runId: id, subagentType: run.subagentType },
      },
    );
    this.emit("change", id);
    return id;
  }

  markDone(id: string): boolean {
    const run = this.runs.get(id);
    if (!run) return false;
    if (run.state === "done") return true;
    run.state = "done";
    run.endedAt = Date.now();
    const ms = run.endedAt - run.startedAt;
    serverLog("info", "subagent", `done: ${run.subagentType} (${ms}ms)`, {
      sessionId: run.parentSessionId,
      meta: { runId: id, ms },
    });
    this.emit("change", id);
    this.scheduleRemoval(id);
    return true;
  }

  private scheduleRemoval(id: string): void {
    const run = this.runs.get(id);
    if (!run) return;
    if (run.pruneTimer) clearTimeout(run.pruneTimer);
    const timer = setTimeout(() => {
      this.runs.delete(id);
      this.emit("change", id);
    }, RUN_RETENTION_MS);
    timer.unref();
    run.pruneTimer = timer;
  }

  list(parentSessionId: string): SubagentRunRecord[] {
    const out: SubagentRunRecord[] = [];
    for (const r of this.runs.values()) {
      if (r.parentSessionId === parentSessionId) out.push(toPublic(r));
    }
    // Newest first.
    out.sort((a, b) => b.startedAt - a.startedAt);
    return out;
  }

  listAll(): SubagentRunRecord[] {
    return [...this.runs.values()].map(toPublic);
  }

  /** Test helper — clear everything. Not used in prod paths. */
  reset(): void {
    for (const r of this.runs.values()) {
      if (r.pruneTimer) clearTimeout(r.pruneTimer);
    }
    this.runs.clear();
  }
}

function toPublic(r: InternalRun): SubagentRunRecord {
  return {
    id: r.id,
    parentSessionId: r.parentSessionId,
    subagentType: r.subagentType,
    description: r.description,
    prompt: r.prompt,
    state: r.state,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
  };
}

export const subagentRuns = new SubagentRunsService();
