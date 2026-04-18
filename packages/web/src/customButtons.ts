// User-defined quick-action buttons rendered on each SessionTile header.
// Persisted in localStorage (global, not per-project); editable from the
// Settings drawer's "按钮" tab.

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
  /** When false, the button stays in the settings list but doesn't render on tiles. */
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

const LS_KEY = 'aimon_custom_buttons_v1'
// Separate marker so we can distinguish "never initialized" from "user
// deleted all their buttons" — the latter must stay empty.
const INIT_KEY = 'aimon_custom_buttons_init_v1'

function defaultButtons(): CustomButton[] {
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
  ]
}

type Listener = (list: CustomButton[]) => void
const listeners = new Set<Listener>()

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

function readList(): CustomButton[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(LS_KEY)
    const initialized = localStorage.getItem(INIT_KEY) === '1'
    // First-run: no list and never initialized → seed with sensible defaults
    // (the old hardcoded 清除 / 历史对话 buttons) so the top bar doesn't look
    // empty. Users can still delete them afterward.
    if (raw == null && !initialized) {
      const seeded = defaultButtons()
      writeList(seeded)
      localStorage.setItem(INIT_KEY, '1')
      return seeded
    }
    if (raw == null) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValid)
  } catch {
    return []
  }
}

function writeList(list: CustomButton[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list))
    localStorage.setItem(INIT_KEY, '1')
  } catch {
    // quota / private mode — non-fatal
  }
}

let cache: CustomButton[] = readList()

export function getCustomButtons(): CustomButton[] {
  return cache
}

export function setCustomButtons(list: CustomButton[]): void {
  cache = list.slice()
  writeList(cache)
  for (const l of listeners) {
    try { l(cache) } catch { /* ignore */ }
  }
}

export function onCustomButtonsChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Keep tabs of the same app in sync: the `storage` event fires in OTHER tabs
// when the one that mutated writes. Same-tab updates go through setCustomButtons.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== LS_KEY) return
    cache = readList()
    for (const l of listeners) {
      try { l(cache) } catch { /* ignore */ }
    }
  })
}

export function makeId(): string {
  // Enough entropy for localStorage scope; avoids pulling nanoid into web.
  return Math.random().toString(36).slice(2, 10)
}
