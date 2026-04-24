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
