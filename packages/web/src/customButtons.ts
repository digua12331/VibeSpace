// Per-project quick-action buttons rendered above each SessionTile input.
// Each project gets its own localStorage key (`aimon_custom_buttons_v1:<projectId>`);
// the legacy global key is preserved as a migration source and snapshot.

import { pushLog } from './logs'

export type ButtonColor = 'slate' | 'emerald' | 'amber' | 'sky' | 'violet' | 'rose'

export interface CustomButton {
  id: string
  text: string
  color: ButtonColor
  /**
   * Fallback command when no per-agent override is set for the session's
   * agent. Sent to the PTY with a trailing \r appended.
   */
  command: string
  /**
   * Per-agent command overrides. Keyed by AgentKind (e.g. 'claude', 'codex',
   * 'shell', 'cmd', 'pwsh'). When the current session's agent has an entry
   * here, it wins over `command`. If the resolved command is empty the
   * button is hidden for that session.
   */
  commandByAgent?: Record<string, string>
  /**
   * 实际语义：是否在悬浮输入框**正上方**那一行常驻显示该按钮。
   * 字段名 `showInTopbar` 是历史遗留——按钮原先渲染在 SessionView 顶栏，
   * 现在已迁移到输入框上方。保留旧名以避免 localStorage 数据迁移。
   * When false, the button stays in the settings list but doesn't render on tiles.
   */
  showInTopbar: boolean
}

/**
 * Resolve the command for a specific session's agent: per-agent override
 * first, then the button's default. Returns '' if nothing is configured.
 */
export function resolveCommand(btn: CustomButton, agent: string): string {
  const override = btn.commandByAgent?.[agent]
  if (typeof override === 'string' && override.length > 0) return override
  return btn.command
}

// Win11 Fluent-styled chip buttons: soft tinted fill + accent border + hover lift.
export const BUTTON_COLOR_CLASSES: Record<ButtonColor, string> = {
  slate: 'border-border text-muted bg-white/[0.03] hover:text-fg hover:bg-white/[0.08]',
  emerald: 'border-emerald-500/40 text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20',
  amber: 'border-amber-500/40 text-amber-200 bg-amber-500/10 hover:bg-amber-500/20',
  sky: 'border-sky-500/40 text-sky-200 bg-sky-500/10 hover:bg-sky-500/20',
  violet: 'border-violet-500/40 text-violet-200 bg-violet-500/10 hover:bg-violet-500/20',
  rose: 'border-rose-500/40 text-rose-200 bg-rose-500/10 hover:bg-rose-500/20',
}

export const BUTTON_COLOR_SWATCH: Record<ButtonColor, string> = {
  slate: 'bg-slate-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  sky: 'bg-sky-500',
  violet: 'bg-violet-500',
  rose: 'bg-rose-500',
}

export const BUTTON_COLOR_LABELS: Record<ButtonColor, string> = {
  slate: '默认',
  emerald: '绿',
  amber: '琥珀',
  sky: '蓝',
  violet: '紫',
  rose: '红',
}

export const BUTTON_COLORS = Object.keys(BUTTON_COLOR_CLASSES) as ButtonColor[]

// Legacy global key (kept as a snapshot, used only as migration source).
const LEGACY_LS_KEY = 'aimon_custom_buttons_v1'
// New per-project key prefix: `${LS_KEY_PREFIX}<projectId>` holds one project's list.
const LS_KEY_PREFIX = 'aimon_custom_buttons_v1:'
// Set once migration has copied LEGACY_LS_KEY into per-project buckets.
const MIGRATED_KEY = 'aimon_custom_buttons_migrated_v2'

function projectKey(projectId: string): string {
  return `${LS_KEY_PREFIX}${projectId}`
}

function defaultButtons(): CustomButton[] {
  // Buttons whose command is a plain Chinese reply (ok / 按你推荐 / 继续) or a
  // slash command (/commit) are AI-agent-only; we hide them on raw shells by
  // mapping the command to '' (resolveCommand + the visible-buttons filter
  // together drop empty commands from rendering).
  const hideOnShells = { cmd: '', pwsh: '', shell: '' }
  return [
    {
      id: 'default-clear',
      text: '🧹 清除',
      color: 'amber',
      command: '/clear',
      // Shells don't understand /clear — map them to the native clear command.
      commandByAgent: { cmd: 'cls', pwsh: 'clear', shell: 'clear' },
      showInTopbar: true,
    },
    {
      id: 'default-resume',
      text: '🕘 历史对话',
      color: 'violet',
      command: '/resume',
      showInTopbar: true,
    },
    {
      id: 'default-ok',
      text: 'ok',
      color: 'emerald',
      command: 'ok',
      commandByAgent: hideOnShells,
      showInTopbar: true,
    },
    {
      id: 'default-recommend',
      text: '按你推荐',
      color: 'sky',
      command: '按你推荐',
      commandByAgent: hideOnShells,
      showInTopbar: true,
    },
    {
      id: 'default-continue',
      text: '继续',
      color: 'slate',
      command: '继续',
      commandByAgent: hideOnShells,
      showInTopbar: true,
    },
    {
      id: 'default-commit',
      text: '🚀 提交 github',
      color: 'rose',
      command: '/commit',
      commandByAgent: hideOnShells,
      showInTopbar: true,
    },
  ]
}

// Listener now receives (projectId, list) — callers filter by projectId.
type Listener = (projectId: string, list: CustomButton[]) => void
const listeners = new Set<Listener>()

// Per-project read cache. localStorage is the source of truth; this is a
// hot-path optimisation so React state initialisers don't hit storage every
// render.
const cache = new Map<string, CustomButton[]>()

function isButtonColor(v: unknown): v is ButtonColor {
  return typeof v === 'string' && (BUTTON_COLORS as string[]).includes(v)
}

function isValid(x: unknown): x is CustomButton {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  const baseOk = (
    typeof o.id === 'string'
    && typeof o.text === 'string'
    && typeof o.command === 'string'
    && typeof o.showInTopbar === 'boolean'
    && isButtonColor(o.color)
  )
  if (!baseOk) return false
  if (o.commandByAgent != null) {
    if (typeof o.commandByAgent !== 'object') return false
    for (const v of Object.values(o.commandByAgent as Record<string, unknown>)) {
      if (typeof v !== 'string') return false
    }
  }
  return true
}

// projectId guard: empty / 'null' / 'undefined' would all become legal-looking
// LS keys, so reject them at the API boundary.
function isValidProjectId(projectId: unknown): projectId is string {
  return (
    typeof projectId === 'string'
    && projectId.length > 0
    && projectId !== 'null'
    && projectId !== 'undefined'
  )
}

// Returns null when the project's key is absent OR corrupt — caller decides
// whether to seed defaults (key absent) or just return [] (corrupt + already-
// initialised semantics is lost; we treat both as "fresh project" which means
// corruption results in a one-time defaults reset, acceptable trade-off).
function readBucket(projectId: string): CustomButton[] | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(projectKey(projectId))
    if (raw == null) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.filter(isValid)
  } catch {
    return null
  }
}

function writeBucket(
  projectId: string,
  list: CustomButton[],
): { ok: true } | { ok: false; reason: string } {
  if (typeof localStorage === 'undefined') return { ok: false, reason: 'no-localStorage' }
  try {
    localStorage.setItem(projectKey(projectId), JSON.stringify(list))
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message || String(e) }
  }
}

function notify(projectId: string, list: CustomButton[]): void {
  for (const l of listeners) {
    try { l(projectId, list) } catch { /* ignore */ }
  }
}

/**
 * Returns the project's buttons. If the project has no stored list yet
 * (key absent), seeds with `defaultButtons()` and writes it back — this is
 * how new projects pick up the standard 清除/历史对话 starters. If the key
 * exists but is `[]`, returns `[]` (user-initiated empty state is preserved).
 */
export function getCustomButtons(projectId: string): CustomButton[] {
  if (!isValidProjectId(projectId)) return []
  const cached = cache.get(projectId)
  if (cached != null) return cached
  const stored = readBucket(projectId)
  if (stored != null) {
    cache.set(projectId, stored)
    return stored
  }
  // First access for this project (or corrupt JSON) → seed defaults.
  const seeded = defaultButtons()
  const result = writeBucket(projectId, seeded)
  if (!result.ok) {
    pushLog({
      level: 'error',
      scope: 'session',
      msg: `custom-buttons-save-failed`,
      projectId,
      meta: { reason: result.reason, op: 'seed' },
    })
  }
  cache.set(projectId, seeded)
  return seeded
}

export function setCustomButtons(projectId: string, list: CustomButton[]): void {
  if (!isValidProjectId(projectId)) return
  const next = list.slice()
  const result = writeBucket(projectId, next)
  if (!result.ok) {
    pushLog({
      level: 'error',
      scope: 'session',
      msg: `custom-buttons-save-failed`,
      projectId,
      meta: { reason: result.reason, op: 'set', size: next.length },
    })
    return
  }
  cache.set(projectId, next)
  notify(projectId, next)
}

/**
 * Subscribe to button changes across all projects. The listener receives
 * `(projectId, list)` whenever a project's buttons are saved or arrive via
 * a cross-tab `storage` event. Callers (SessionView, ButtonsTab) filter
 * by the project they care about.
 */
export function onCustomButtonsChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * One-shot migration from the legacy global key into per-project buckets.
 * Idempotent: a marker is written only after all writes succeed, so a
 * mid-migration failure (e.g. quota) gets retried on the next session.
 *
 * Behaviour:
 *  - If the migration marker is already set → no-op, returns null.
 *  - If there is no legacy key → mark migrated, return null (nothing to do).
 *  - If the legacy list is `[]` → still copies `[]` to every project (user
 *    had explicitly emptied the global list; we must not let defaults
 *    silently reappear per-project).
 *  - Skips any project that already has a bucket (defensive against repeat
 *    runs where partial writes happened previously).
 *  - On full success returns `{ projectCount, buttonCount }` for the
 *    caller to log; on partial failure returns the stats but does NOT
 *    write the marker.
 */
export function migrateGlobalToPerProject(
  projectIds: readonly string[],
): { projectCount: number; buttonCount: number } | null {
  if (typeof localStorage === 'undefined') return null
  if (localStorage.getItem(MIGRATED_KEY) === '1') return null

  let oldList: CustomButton[]
  try {
    const raw = localStorage.getItem(LEGACY_LS_KEY)
    if (raw == null) {
      // No legacy data to migrate. Mark so we don't keep checking on every
      // session boot.
      try { localStorage.setItem(MIGRATED_KEY, '1') } catch { /* ignore */ }
      return null
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      try { localStorage.setItem(MIGRATED_KEY, '1') } catch { /* ignore */ }
      return null
    }
    oldList = parsed.filter(isValid)
  } catch {
    return null
  }

  const cleanIds = Array.from(new Set(projectIds.filter(isValidProjectId)))
  if (cleanIds.length === 0) {
    // No projects yet → defer; do NOT write marker so we retry once the
    // user has at least one project.
    return null
  }

  let allOk = true
  let touched = 0
  for (const pid of cleanIds) {
    if (localStorage.getItem(projectKey(pid)) != null) continue
    const result = writeBucket(pid, oldList)
    if (!result.ok) {
      allOk = false
      pushLog({
        level: 'error',
        scope: 'session',
        msg: `custom-buttons-save-failed`,
        projectId: pid,
        meta: { reason: result.reason, op: 'migrate' },
      })
      continue
    }
    cache.set(pid, oldList.slice())
    notify(pid, oldList.slice())
    touched++
  }

  if (allOk) {
    try { localStorage.setItem(MIGRATED_KEY, '1') } catch { /* ignore */ }
  }

  return { projectCount: touched, buttonCount: oldList.length }
}

// Cross-tab sync via the `storage` event. Listens only to per-project keys;
// legacy key changes (other tabs still on the old build) are ignored to
// avoid clobbering the new format.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key == null) return
    if (!e.key.startsWith(LS_KEY_PREFIX)) return
    const pid = e.key.slice(LS_KEY_PREFIX.length)
    if (!isValidProjectId(pid)) return
    const fresh = readBucket(pid)
    if (fresh == null) {
      cache.delete(pid)
      notify(pid, [])
    } else {
      cache.set(pid, fresh)
      notify(pid, fresh)
    }
  })
}

export function makeId(): string {
  // Enough entropy for localStorage scope; avoids pulling nanoid into web.
  return Math.random().toString(36).slice(2, 10)
}
