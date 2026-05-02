// In-memory error-loop detector. Aggregates `level:error` log entries by
// (scope, action, projectId?) inside a sliding window; trips an alert when the
// same key passes the threshold; suppresses repeats during a cooldown.
//
// MVP scope (per plan):
//   - Single-process only. No persistence — repeat windows reset on restart.
//   - Lazy cleanup: each record() call drops expired timestamps for its key
//     before counting; no setInterval / no background worker.
//   - Wide-in: any error entry is recorded, even without a meta.action (a
//     SHA-1-of-msg-prefix fallback action is synthesised so all errors form
//     stable keys).
//   - Strict-out: alert payload only carries shape declared in
//     types/log.ts::ErrorPatternAlert.
//
// Constants live here on purpose. The plan explicitly defers UI configuration
// to a future iteration once we observe real usage frequency.

import { createHash, randomUUID } from "node:crypto";
import type { ErrorPatternAlert, LogEntry } from "./types/log.js";

/** Sliding window length in ms. 1 hour. */
const WINDOW_MS = 60 * 60 * 1000;
/** How many errors inside the window before an alert fires. */
const THRESHOLD = 3;
/** After alerting, suppress further alerts for the same key for this long. 24h. */
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** Per-key timestamp ring cap. Protects against a hot key wasting memory. */
const MAX_TS_PER_KEY = 200;
/** Truncation length for the sample message included in alerts. */
const SAMPLE_MSG_MAX = 200;

interface KeyState {
  /** Sorted ascending. Pruned to >= now-WINDOW_MS on every record. */
  timestamps: number[];
  /** Last alert time for this key, or 0 if never. */
  lastAlertAt: number;
  /** Last sample message we saw (most recent error). */
  lastMsg: string;
}

export type AlertListener = (alert: ErrorPatternAlert) => void;

/**
 * Build the aggregation key. `action` comes from `meta.action` when present
 * (logAction sets this on every wrapped front-end mutation). Otherwise we hash
 * the first 32 chars of the message — gives a stable, msg-shape-independent
 * fallback action, so a bare `serverLog('error', 'fs', 'EBUSY: …')` still
 * forms a useful key instead of collapsing into one bucket.
 */
function buildKey(entry: LogEntry): {
  scope: string;
  action: string;
  actionIsFallback: boolean;
  projectId?: string;
  composite: string;
} {
  const scope = entry.scope || "unknown";
  let action: string | undefined;
  if (entry.meta && typeof entry.meta === "object" && entry.meta !== null) {
    const a = (entry.meta as Record<string, unknown>).action;
    if (typeof a === "string" && a.length > 0) action = a;
  }
  let actionIsFallback = false;
  if (!action) {
    const seed = (entry.msg || "").slice(0, 32);
    action = createHash("sha1").update(seed).digest("hex").slice(0, 8);
    actionIsFallback = true;
  }
  const projectId = entry.projectId;
  const composite = `${scope}${action}${projectId ?? ""}`;
  return { scope, action, actionIsFallback, projectId, composite };
}

export class ErrorPatternMonitor {
  private states = new Map<string, KeyState>();
  private listeners = new Set<AlertListener>();
  /** Test seam — overridable clock so smoke can simulate cooldown / windows. */
  now: () => number = () => Date.now();

  /**
   * Feed one log entry. Non-error entries are ignored. Safe to call from any
   * hot path: never throws, never blocks the caller meaningfully (the only
   * work done synchronously is a small map lookup + array push + array
   * filter — well under 1ms even at thousands of keys).
   *
   * If the entry trips the threshold and is past cooldown, registered alert
   * listeners are notified synchronously after the bookkeeping update.
   * Listeners themselves are wrapped in try/catch so a misbehaving subscriber
   * cannot stop other subscribers or poison the monitor.
   */
  record(entry: LogEntry): void {
    if (entry.level !== "error") return;
    const key = buildKey(entry);
    const ts = entry.ts || this.now();
    const cutoff = ts - WINDOW_MS;

    let state = this.states.get(key.composite);
    if (!state) {
      state = { timestamps: [], lastAlertAt: 0, lastMsg: "" };
      this.states.set(key.composite, state);
    }
    // Lazy cleanup — drop timestamps that fell out of the window.
    if (state.timestamps.length > 0) {
      let drop = 0;
      while (drop < state.timestamps.length && state.timestamps[drop] < cutoff) drop += 1;
      if (drop > 0) state.timestamps.splice(0, drop);
    }
    state.timestamps.push(ts);
    if (state.timestamps.length > MAX_TS_PER_KEY) {
      state.timestamps.splice(0, state.timestamps.length - MAX_TS_PER_KEY);
    }
    state.lastMsg = (entry.msg || "").slice(0, SAMPLE_MSG_MAX);

    if (state.timestamps.length < THRESHOLD) return;
    if (state.lastAlertAt > 0 && ts - state.lastAlertAt < COOLDOWN_MS) return;

    state.lastAlertAt = ts;
    const alert: ErrorPatternAlert = {
      id: randomUUID(),
      ts,
      key: {
        scope: key.scope,
        action: key.action,
        actionIsFallback: key.actionIsFallback,
        projectId: key.projectId,
      },
      count: state.timestamps.length,
      firstAt: state.timestamps[0],
      lastAt: state.timestamps[state.timestamps.length - 1],
      sampleMsg: state.lastMsg,
    };
    for (const fn of this.listeners) {
      try {
        fn(alert);
      } catch {
        // Listener faults must not break other listeners or the monitor.
        // Caller is responsible for any logging it deems worthwhile.
      }
    }
  }

  subscribe(listener: AlertListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Test-only — wipes all state. Production callers should never need this. */
  reset(): void {
    this.states.clear();
  }
}

export const errorPatternMonitor = new ErrorPatternMonitor();

/** Internal constants exported for tests; not part of the public contract. */
export const __test__ = { WINDOW_MS, THRESHOLD, COOLDOWN_MS };
