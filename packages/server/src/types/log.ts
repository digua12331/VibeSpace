export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  id: number;
  ts: number;
  level: LogLevel;
  scope: string;
  projectId?: string;
  sessionId?: string;
  msg: string;
  meta?: unknown;
}

export interface ClientLogPayload {
  level: LogLevel;
  scope: string;
  msg: string;
  projectId?: string;
  sessionId?: string;
  meta?: unknown;
}

/**
 * Surfaced when ErrorPatternMonitor detects the same (scope, action, projectId?)
 * key tripping the configured threshold inside its sliding window. Carries
 * enough context for the UI to render a "see this same error N times — want
 * to capture it as a manual.md lesson?" card without needing a follow-up API.
 */
export interface ErrorPatternAlert {
  /** Unique alert id; useful as React key + dismiss / mark-read target. */
  id: string;
  /** Trigger timestamp (epoch ms). */
  ts: number;
  /** Aggregation key the monitor used. `action` may be a SHA-1 fallback when
   *  the underlying log entry had no `meta.action`. */
  key: {
    scope: string;
    action: string;
    /** Whether `action` was derived from `msg.slice(0,32)` rather than the
     *  log entry's real `meta.action` field. */
    actionIsFallback: boolean;
    projectId?: string;
  };
  /** Number of error entries inside the sliding window at trigger time. */
  count: number;
  /** First / last timestamp inside the sliding window. */
  firstAt: number;
  lastAt: number;
  /** Sample message from the most recent error entry, trimmed to 200 chars. */
  sampleMsg: string;
}
