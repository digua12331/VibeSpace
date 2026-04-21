import { useStore } from './store'
import type { LogEntry } from './types'

export type { LogEntry, LogLevel } from './types'

let _nextId = 1

/**
 * Push a project-scoped log entry. Safe to call from anywhere (store actions,
 * components, async callbacks) — writes go through zustand so subscribers
 * re-render. Old entries are dropped when we exceed the 500-entry cap.
 */
export function pushLog(entry: Omit<LogEntry, 'id' | 'ts'>): void {
  const full: LogEntry = { id: _nextId++, ts: Date.now(), ...entry }
  useStore.getState().appendLog(full)
  const line = `[VibeSpace:${entry.scope}] ${entry.msg}`
  if (entry.level === 'error') console.error(line, entry.meta ?? '')
  else if (entry.level === 'warn') console.warn(line, entry.meta ?? '')
  else console.log(line, entry.meta ?? '')
}
