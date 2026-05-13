import {
  BUILTIN_SHELL_AGENTS,
  flushActivityTimestamps,
  getSession,
  hibernateSession,
  listSessions,
} from "./db.js";
import { lastInputAt, lastOutputAt, ptyManager } from "./pty-manager.js";
import { getAppSettings } from "./app-settings.js";
import { serverLog } from "./log-bus.js";

const SHELL_SET = new Set<string>(BUILTIN_SHELL_AGENTS);

const TICK_MS = 30_000;

let timer: NodeJS.Timeout | null = null;

/**
 * Start the once-per-30s sweeper. Each tick:
 *   1. Flush in-memory lastInput/lastOutput maps to SQLite (one txn).
 *   2. If hibernation.enabled is false, stop here.
 *   3. For every alive PTY session, compute idleMs and hibernate if eligible.
 *
 * "Eligible" = status ∈ {running, idle}, not a shell when includeShells=false,
 * and idleMs > idleMinutes * 60_000. Sessions in 'working' / 'waiting_input' /
 * 'starting' are spared so an in-flight task never dies under the user.
 */
export function startHibernateSweeper(): void {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  timer.unref();
}

export function stopHibernateSweeper(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

function tick(): void {
  // Step 1: persist activity timestamps so the next process boot has them.
  flushFromMemoryMaps();

  // Step 2: bail if disabled.
  const settings = getAppSettings();
  if (!settings.hibernation.enabled) return;
  const thresholdMs = settings.hibernation.idleMinutes * 60_000;
  const includeShells = settings.hibernation.includeShells;

  // Step 3: candidate scan.
  const now = Date.now();
  for (const id of ptyManager.listAlive()) {
    const row = getSession(id);
    if (!row) continue;
    if (row.status !== "running" && row.status !== "idle") continue;
    if (!includeShells && SHELL_SET.has(row.agent)) continue;
    const lastIn = lastInputAt.get(id) ?? row.lastInputAt ?? row.startedAt;
    const lastOut = lastOutputAt.get(id) ?? row.lastOutputAt ?? row.startedAt;
    const idleMs = now - Math.max(lastIn, lastOut);
    if (idleMs < thresholdMs) continue;
    hibernateOne(id, row.projectId, idleMs);
  }
}

function flushFromMemoryMaps(): void {
  // Build a row-keyed batch so a single session contributes one UPDATE.
  const all = listSessions();
  const liveIds = new Set(ptyManager.listAlive());
  const rows: Array<{ id: string; lastInputAt?: number; lastOutputAt?: number }> = [];
  for (const s of all) {
    if (!liveIds.has(s.id)) continue;
    const inAt = lastInputAt.get(s.id);
    const outAt = lastOutputAt.get(s.id);
    if (inAt == null && outAt == null) continue;
    rows.push({ id: s.id, lastInputAt: inAt, lastOutputAt: outAt });
  }
  if (rows.length > 0) flushActivityTimestamps(rows);
}

function hibernateOne(id: string, projectId: string, idleMs: number): void {
  const t0 = Date.now();
  serverLog("info", "session", "hibernate-auto 开始", {
    projectId,
    sessionId: id,
    meta: { idleMs },
  });
  try {
    // Mark DB first so the pty-manager 'exit' handler can detect this is a
    // hibernation (not a user-initiated stop) by reading hibernated_at.
    hibernateSession(id);
    // Drop activity maps — the new process post-wake gets a clean slate.
    lastInputAt.delete(id);
    lastOutputAt.delete(id);
    ptyManager.kill(id);
    serverLog(
      "info",
      "session",
      `hibernate-auto 成功 (${Date.now() - t0}ms)`,
      { projectId, sessionId: id, meta: { idleMs } },
    );
  } catch (err) {
    const e = err as Error;
    serverLog("error", "session", `hibernate-auto 失败: ${e.message}`, {
      projectId,
      sessionId: id,
      meta: {
        idleMs,
        error: { name: e.name, message: e.message, stack: e.stack },
      },
    });
  }
}
