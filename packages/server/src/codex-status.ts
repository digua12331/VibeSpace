import type { StatusManager } from "./status.js";
import type { Agent } from "./db.js";

/**
 * CodexStatusDetector — heuristic state detection for the Codex CLI.
 *
 * Codex (unlike Claude) has no hook protocol, so we infer status from PTY
 * stdout cadence + tail-pattern matching. Runs alongside StatusManager and
 * only acts when the session's agent is 'codex'; for other agents it is a
 * no-op.
 *
 * Transitions emitted:
 *   onData (any chunk)              → 'working'
 *   3s of stdout silence + prompt  → 'idle'
 *   3s of stdout silence + no match → 'running' (LLM probably still thinking)
 *
 * The 'starting' → 'running' promotion on first byte is left to StatusManager.
 */

const IDLE_MS = 3000;
const TAIL_BYTES = 2048;
const TAIL_MATCH_WINDOW = 256; // only inspect this many trailing chars for prompt
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b[\(\)][A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

/**
 * Prompt heuristics — at least ONE of these in the trailing window means idle.
 * Kept loose because exact characters change between Codex versions:
 *   - DEC cursor-show (\x1b[?25h) trailing the last frame: Codex hides cursor
 *     during render then shows it when waiting for input. Strong signal.
 *   - DEC synchronized-update end (\x1b[?2026l): often the very last bytes.
 *   - Visible prompt glyphs in stripped tail: › ❯ > $ # » (loose).
 *   - "Press enter to continue" dialog blocker (e.g. upgrade prompt).
 */
const RAW_PROMPT_RE = /\x1b\[\?25h\s*$|\x1b\[\?2026l\s*$/;
const STRIPPED_PROMPT_RE = /(?:[\u203A\u276F>$#\u00BB])\s*$|Press\s+enter\s+to\s+continue/i;

interface SessionState {
  tail: string;
  lastDataAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export class CodexStatusDetector {
  private states = new Map<string, SessionState>();

  constructor(
    private readonly status: StatusManager,
    private readonly getAgent: (sessionId: string) => Agent | undefined,
  ) {}

  onData(sessionId: string, chunk: string): void {
    if (this.getAgent(sessionId) !== "codex") return;

    let st = this.states.get(sessionId);
    if (!st) {
      st = { tail: "", lastDataAt: 0, idleTimer: null };
      this.states.set(sessionId, st);
    }

    // Sliding window tail: keep last TAIL_BYTES chars (chars ≈ bytes for ANSI).
    st.tail = (st.tail + chunk).slice(-TAIL_BYTES);
    st.lastDataAt = Date.now();

    // Each chunk means agent is producing output → working.
    // StatusManager dedupes same-state emits, so this is cheap.
    this.status.handleCodexInternal(sessionId, "working");

    // Reset idle countdown.
    if (st.idleTimer) clearTimeout(st.idleTimer);
    st.idleTimer = setTimeout(() => this.evaluateIdle(sessionId), IDLE_MS);
    // Don't keep node alive on this timer alone.
    if (typeof st.idleTimer.unref === "function") st.idleTimer.unref();
  }

  onExit(sessionId: string): void {
    const st = this.states.get(sessionId);
    if (!st) return;
    if (st.idleTimer) clearTimeout(st.idleTimer);
    this.states.delete(sessionId);
  }

  private evaluateIdle(sessionId: string): void {
    const st = this.states.get(sessionId);
    if (!st) return;
    st.idleTimer = null;

    // Defensive: if agent is no longer codex (rare), skip.
    if (this.getAgent(sessionId) !== "codex") return;

    const rawTail = st.tail.slice(-TAIL_MATCH_WINDOW);
    const strippedTail = stripAnsi(rawTail).replace(/\s+$/g, "");

    const looksIdle =
      RAW_PROMPT_RE.test(rawTail) ||
      STRIPPED_PROMPT_RE.test(strippedTail) ||
      // Fallback: very-short stripped tail (only whitespace / cursor moves
      // remained) plus cursor-show anywhere in window → likely idle screen.
      (strippedTail.length < 4 && /\x1b\[\?25h/.test(rawTail));

    if (looksIdle) {
      this.status.handleCodexInternal(sessionId, "idle");
    } else {
      // Silent but no prompt visible → probably mid-LLM-call.
      this.status.handleCodexInternal(sessionId, "running");
    }
  }
}

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}
