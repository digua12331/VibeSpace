import { useStore } from './store'
import { aimonWS } from './ws'
import type { LogEntry } from './types'

export type { LogEntry, LogLevel } from './types'

let _nextId = 1

type PushLogInput = Omit<LogEntry, 'id' | 'ts'> & { _fromServer?: boolean }

/**
 * Push a project-scoped log entry. Safe to call from anywhere (store actions,
 * components, async callbacks) — writes go through zustand so subscribers
 * re-render. Old entries are dropped when we exceed the 500-entry cap.
 *
 * Every call also mirrors the entry to the backend via WS `log-from-client`
 * for JSONL persistence — except when `_fromServer: true` is set (the entry
 * originated from the backend itself and is being replayed into the store,
 * so re-sending it would loop forever).
 */
export function pushLog(entry: PushLogInput): void {
  const { _fromServer, ...rest } = entry
  const full: LogEntry = { id: _nextId++, ts: Date.now(), ...rest }
  useStore.getState().appendLog(full)
  const line = `[VibeSpace:${rest.scope}] ${rest.msg}`
  if (rest.level === 'error') console.error(line, rest.meta ?? '')
  else if (rest.level === 'warn') console.warn(line, rest.meta ?? '')
  else console.log(line, rest.meta ?? '')
  if (!_fromServer) {
    aimonWS.sendClientLog({
      level: rest.level,
      scope: rest.scope,
      msg: rest.msg,
      projectId: rest.projectId,
      sessionId: rest.sessionId,
      meta: rest.meta,
    })
  }
}

export interface LogActionCtx {
  projectId?: string
  sessionId?: string
  meta?: Record<string, unknown>
}

/**
 * Wrap an async mutation so LogsView gets a start/end pair (with duration)
 * and failures are logged at error level before re-throwing. This is the
 * default way to instrument user-initiated operations — see CLAUDE.md
 * 「操作日志规则」. Callers should use a stable `scope` (e.g. 'project',
 * 'session', 'docs') and a verb `action` ('create', 'start', 'archive').
 */
export async function logAction<T>(
  scope: string,
  action: string,
  fn: () => Promise<T>,
  ctx?: LogActionCtx,
): Promise<T> {
  const started = performance.now()
  pushLog({
    level: 'info',
    scope,
    msg: `${action} 开始`,
    projectId: ctx?.projectId,
    sessionId: ctx?.sessionId,
    meta: ctx?.meta,
  })
  try {
    const result = await fn()
    const ms = Math.round(performance.now() - started)
    pushLog({
      level: 'info',
      scope,
      msg: `${action} 成功 (${ms}ms)`,
      projectId: ctx?.projectId,
      sessionId: ctx?.sessionId,
      meta: { ms, ...(ctx?.meta ?? {}) },
    })
    return result
  } catch (err) {
    const ms = Math.round(performance.now() - started)
    const e = err as Error
    pushLog({
      level: 'error',
      scope,
      msg: `${action} 失败: ${e?.message ?? String(err)}`,
      projectId: ctx?.projectId,
      sessionId: ctx?.sessionId,
      meta: {
        ms,
        error: { name: e?.name, message: e?.message, stack: e?.stack },
        ...(ctx?.meta ?? {}),
      },
    })
    throw err
  }
}

/**
 * Dev-only roundtrip probe: send a client log marked `roundtrip: true`; the
 * backend recognises the flag and broadcasts a matching `server-test` entry
 * back to every connected client, proving both directions work end-to-end.
 */
export function testBackendLog(): void {
  aimonWS.sendClientLog({
    level: 'info',
    scope: 'server-test',
    msg: 'roundtrip probe',
    meta: { roundtrip: true },
  })
}
