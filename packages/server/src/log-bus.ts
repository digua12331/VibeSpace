import { mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LogEntry, LogLevel, ClientLogPayload } from "./types/log.js";
import { broadcast } from "./ws-hub.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_ROOT = resolve(__dirname, "..");
const LOG_DIR = resolve(SERVER_ROOT, "data", "logs");

let _nextId = 1;
let _dirEnsured = false;
let _appendWarnedOnce = false;

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
