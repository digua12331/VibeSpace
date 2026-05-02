import { mkdirSync } from "node:fs";
import { appendFile, readdir, stat, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LogEntry, LogLevel, ClientLogPayload, ErrorPatternAlert } from "./types/log.js";
import { broadcast } from "./ws-hub.js";
import { errorPatternMonitor } from "./error-pattern-monitor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_ROOT = resolve(__dirname, "..");
const LOG_DIR = resolve(SERVER_ROOT, "data", "logs");
const LOG_RETENTION_DAYS = 30;
const LOG_RETENTION_MS = LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;

let _nextId = 1;
let _dirEnsured = false;
let _appendWarnedOnce = false;
let _monitorWarnedOnce = false;

/**
 * Hand each log entry to the error-loop monitor on next tick. Wrapped in
 * try/catch and gated behind setImmediate so a misbehaving monitor cannot
 * stall, throw into, or otherwise interfere with the original `serverLog` /
 * `persistClientLog` caller. First failure surfaces as a single warn log;
 * subsequent failures stay silent so a busted monitor cannot flood logs.
 */
function safeRecord(entry: LogEntry): void {
  setImmediate(() => {
    try {
      errorPatternMonitor.record(entry);
    } catch (err) {
      if (_monitorWarnedOnce) return;
      _monitorWarnedOnce = true;
      // serverLog('warn', ...) here is safe: monitor.record only acts on
      // level='error', so this warn entry will be ignored, no recursion.
      try {
        serverLog("warn", "error-monitor", "errorPatternMonitor.record threw", {
          meta: { error: (err as Error).message },
        });
      } catch {
        // last-ditch — avoid any chance of throwing back into this tick
        console.warn("log-bus: monitor record threw and warn-log also failed");
      }
    }
  });
}

function ensureDir(): void {
  if (_dirEnsured) return;
  mkdirSync(LOG_DIR, { recursive: true });
  _dirEnsured = true;
}

export function getLogFilePath(now: Date = new Date()): string {
  const iso = now.toISOString();
  const day = iso.slice(0, 10);
  return resolve(LOG_DIR, `${day}.log`);
}

function appendJsonl(entry: LogEntry): void {
  try {
    ensureDir();
    const line = JSON.stringify(entry) + "\n";
    void appendFile(getLogFilePath(new Date(entry.ts)), line, "utf8").catch(
      (err) => {
        if (!_appendWarnedOnce) {
          _appendWarnedOnce = true;
          console.warn(
            "log-bus: appendFile failed (further failures silenced):",
            (err as Error).message,
          );
        }
      },
    );
  } catch (err) {
    if (!_appendWarnedOnce) {
      _appendWarnedOnce = true;
      console.warn("log-bus: log serialize failed:", (err as Error).message);
    }
  }
}

export function serverLog(
  level: LogLevel,
  scope: string,
  msg: string,
  extra?: { projectId?: string; sessionId?: string; meta?: unknown },
): void {
  const entry: LogEntry = {
    id: _nextId++,
    ts: Date.now(),
    level,
    scope,
    msg,
    projectId: extra?.projectId,
    sessionId: extra?.sessionId,
    meta: extra?.meta,
  };
  const line = `[VibeSpace:${scope}] ${msg}`;
  if (level === "error") console.error(line, extra?.meta ?? "");
  else if (level === "warn") console.warn(line, extra?.meta ?? "");
  else console.log(line, extra?.meta ?? "");

  broadcast({
    type: "log",
    level,
    scope,
    msg,
    projectId: extra?.projectId,
    sessionId: extra?.sessionId,
    meta: extra?.meta,
  });

  appendJsonl(entry);
  safeRecord(entry);
}

export function persistClientLog(payload: ClientLogPayload): void {
  const entry: LogEntry = {
    id: _nextId++,
    ts: Date.now(),
    level: payload.level,
    scope: payload.scope,
    msg: payload.msg,
    projectId: payload.projectId,
    sessionId: payload.sessionId,
    meta: payload.meta,
  };
  appendJsonl(entry);
  safeRecord(entry);
}

export function handleClientLogRoundtrip(payload: ClientLogPayload): void {
  const isRoundtrip =
    payload.meta &&
    typeof payload.meta === "object" &&
    (payload.meta as Record<string, unknown>).roundtrip === true;
  if (!isRoundtrip) return;
  serverLog(
    "info",
    "server-test",
    `roundtrip echo: ${payload.msg}`,
    { meta: { source: "testBackendLog" } },
  );
}

/**
 * Broadcast an error-loop alert to all WS clients and persist a corresponding
 * `warn`-level log entry so it survives in the JSONL audit trail (the alert
 * itself is in-memory, but the JSONL record lets you replay "what fired and
 * when" from disk).
 */
export function broadcastAlert(alert: ErrorPatternAlert): void {
  broadcast({ type: "error-pattern-alert", alert });
  serverLog(
    "warn",
    "error-monitor",
    "检测到错误循环（同 key 在 1h 窗口内 ≥ 3 次）",
    {
      projectId: alert.key.projectId,
      meta: {
        alert: true,
        alertId: alert.id,
        key: alert.key,
        count: alert.count,
        firstAt: alert.firstAt,
        lastAt: alert.lastAt,
        sampleMsg: alert.sampleMsg,
      },
    },
  );
}

// Wire monitor → broadcast at module load. Only fires on level='error' entries
// fed via safeRecord above; cooldown / dedup live inside the monitor itself.
errorPatternMonitor.subscribe(broadcastAlert);

/**
 * Delete *.log files in data/logs whose mtime is older than 30 days. Fire and
 * forget — the server should not block startup waiting for filesystem I/O on a
 * janitorial task. Errors are swallowed (and logged once) so a hostile FS
 * permission state can't take the server down.
 */
export async function pruneOldLogs(): Promise<void> {
  try {
    ensureDir();
    const entries = await readdir(LOG_DIR);
    const now = Date.now();
    let deleted = 0;
    for (const name of entries) {
      if (!name.endsWith(".log")) continue;
      const full = resolve(LOG_DIR, name);
      try {
        const st = await stat(full);
        if (now - st.mtimeMs > LOG_RETENTION_MS) {
          await unlink(full);
          deleted += 1;
        }
      } catch {
        /* per-file failure is non-fatal */
      }
    }
    if (deleted > 0) {
      serverLog(
        "info",
        "log-bus",
        `pruneOldLogs 删除 ${deleted} 个 ≥${LOG_RETENTION_DAYS}d 旧日志`,
        { meta: { deleted, retentionDays: LOG_RETENTION_DAYS } },
      );
    }
  } catch (err) {
    console.warn("log-bus: pruneOldLogs failed:", (err as Error).message);
  }
}
