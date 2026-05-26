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
/**
 * Result of {@link StatusManager.claimIdle}. Hub dispatch route maps the
 * `code` field to HTTP 400 / structured MCP error for hub claude.
 */
export interface ClaimIdleResult {
  ok: boolean;
  code?: "not_idle" | "idle_too_fresh" | "locked" | "not_found";
  currentStatus?: SessionStatus;
  /** Milliseconds the session has been in its current status. */
  idleAge?: number;
}

export class StatusManager extends EventEmitter {
  private statuses = new Map<string, SessionStatus>();
  private gotData = new Set<string>();
  // 跟踪 status 最后变更时间（毫秒）—— claimIdle 检查 idleAge 用，防 Claude
  // `Stop` hook 异步滞后导致刚转 idle 就被派工 (D2 = 800ms 持续窗口)。
  private statusChangedAt = new Map<string, number>();
  // 派工锁：被 hub claimIdle 抢占的 session id 集合。一旦 hook 把 status 回
  // 转到 'idle' (通过 set() 内部检测)，自动清除——下一次 claim 可重新评估。
  private dispatchLocks = new Set<string>();

  get(sessionId: string): SessionStatus | undefined {
    return this.statuses.get(sessionId);
  }

  private set(sessionId: string, status: SessionStatus, detail?: string): void {
    const prev = this.statuses.get(sessionId);
    if (prev === status) return;
    this.statuses.set(sessionId, status);
    this.statusChangedAt.set(sessionId, Date.now());
    // status 自然回 idle 时自动释放 hub claim lock；调用方不需要手动 release。
    if (status === "idle") {
      this.dispatchLocks.delete(sessionId);
    }
    this.emit("change", sessionId, status, detail);
  }

  /**
   * Hub dispatch 抢占：检查 status==='idle' && idleAge>=minIdleAgeMs && 未锁，
   * 全过则**同步原子**地加 lock + 把 status 改为 'working'，返回 ok=true。
   * 失败返结构化 code 让 hub claude 自我修复（如 not_idle → 改用新建路径）。
   *
   * JS 单线程同步保证：read → check → write 在同一 microtask 内不会被别的
   * 回调插入，等价于"原子操作"。
   */
  claimIdle(sessionId: string, opts: { minIdleAgeMs: number }): ClaimIdleResult {
    const cur = this.statuses.get(sessionId);
    if (cur == null) {
      return { ok: false, code: "not_found" };
    }
    if (cur !== "idle") {
      return { ok: false, code: "not_idle", currentStatus: cur };
    }
    if (this.dispatchLocks.has(sessionId)) {
      return { ok: false, code: "locked", currentStatus: cur };
    }
    const changedAt = this.statusChangedAt.get(sessionId) ?? 0;
    const sinceMs = Date.now() - changedAt;
    if (sinceMs < opts.minIdleAgeMs) {
      return {
        ok: false,
        code: "idle_too_fresh",
        currentStatus: cur,
        idleAge: sinceMs,
      };
    }
    // 抢占：先加 lock 再改 status。set() 内部的"status===idle 清 lock"在这里
    // 不会触发因为我们设的是 'working'。
    this.dispatchLocks.add(sessionId);
    this.set(sessionId, "working", "hub-dispatch");
    return { ok: true, currentStatus: "working", idleAge: sinceMs };
  }

  /**
   * 主动释放 claim 锁。**只**在 hub dispatch 流程后续步骤失败需要回滚时调；
   * 正常成功路径不必调——hook 把 status 转回 idle 时 set() 会自动清。
   */
  releaseIdleClaim(sessionId: string): void {
    this.dispatchLocks.delete(sessionId);
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
