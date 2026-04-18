import { EventEmitter } from "node:events";
import type { SessionStatus } from "./db.js";

/**
 * StatusManager — tracks per-session status derived from PTY lifecycle and
 * (Phase 3+) Claude/Codex hook events. Emits 'change' (sessionId, status, detail?).
 *
 * Phase 1 transitions:
 *   - onSpawn        → 'starting'
 *   - first onData   → 'running'  (only if currently 'starting')
 *   - onExit code=0  → 'stopped'
 *   - onExit code≠0  → 'crashed'
 *
 * Phase 3/4 will add 'working' / 'waiting_input' via onClaudeHook / onCodexHook.
 */
export class StatusManager extends EventEmitter {
  private statuses = new Map<string, SessionStatus>();
  private gotData = new Set<string>();

  get(sessionId: string): SessionStatus | undefined {
    return this.statuses.get(sessionId);
  }

  private set(sessionId: string, status: SessionStatus, detail?: string): void {
    const prev = this.statuses.get(sessionId);
    if (prev === status) return;
    this.statuses.set(sessionId, status);
    this.emit("change", sessionId, status, detail);
  }

  onSpawn(sessionId: string): void {
    this.gotData.delete(sessionId);
    this.set(sessionId, "starting");
  }

  onData(sessionId: string, _chunk: string): void {
    if (this.gotData.has(sessionId)) return;
    this.gotData.add(sessionId);
    const cur = this.statuses.get(sessionId);
    if (cur === "starting") {
      this.set(sessionId, "running");
    }
  }

  onExit(sessionId: string, code: number | null, _signal: number | null, wasKilled = false): void {
    const status: SessionStatus = wasKilled ? "stopped" : (code === 0 ? "stopped" : "crashed");
    const detail = code === null ? "killed" : `exit=${code}`;
    this.set(sessionId, status, detail);
    this.gotData.delete(sessionId);
    // Keep the final status in the map so late subscribers can still read it,
    // but remove after a delay to avoid unbounded growth.
    setTimeout(() => {
      this.statuses.delete(sessionId);
    }, 60_000).unref();
  }

  /** Phase 3 hook entry point — drives working / waiting_input / idle. */
  handleClaudeHook(sessionId: string, event: string, payload: unknown): void {
    switch (event) {
      case "SessionStart":
        // PTY data already promotes us to 'running'; don't override.
        return;
      case "UserPromptSubmit":
      case "PreToolUse":
      case "PostToolUse":
        this.set(sessionId, "working", event);
        return;
      case "Notification": {
        let detail: string | undefined;
        if (payload && typeof payload === "object") {
          const p = payload as Record<string, unknown>;
          if (typeof p.message === "string") detail = p.message;
          else if (typeof p.title === "string") detail = p.title;
        }
        this.set(sessionId, "waiting_input", detail);
        return;
      }
      case "Stop":
        this.set(sessionId, "idle", "Stop");
        return;
      default:
        return;
    }
  }

  /** Back-compat alias used by older call sites. */
  onClaudeHook(sessionId: string, event: string, payload: unknown): void {
    this.handleClaudeHook(sessionId, event, payload);
  }

  /** Phase 4 hook entry point — currently a no-op stub. */
  onCodexHook(_sessionId: string, _event: string, _payload: unknown): void {
    // intentionally empty for Phase 1
  }

  /**
   * Phase 4 internal channel used by CodexStatusDetector. Accepts the
   * detector-derived state and forwards it through the dedup'd `set` path.
   * Will not promote 'working'/'idle'/'running' over a terminal state
   * (stopped/crashed) since those entries get cleared from `statuses` on exit.
   */
  handleCodexInternal(sessionId: string, status: SessionStatus, detail?: string): void {
    // Only meaningful states this detector emits.
    if (status !== "working" && status !== "idle" && status !== "running") return;
    const cur = this.statuses.get(sessionId);
    // Don't downgrade out of a terminal state if one is still cached.
    if (cur === "stopped" || cur === "crashed") return;
    this.set(sessionId, status, detail ?? "codex-heuristic");
  }
}

export const statusManager = new StatusManager();
