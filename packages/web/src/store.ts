import { create } from 'zustand'
import * as api from './api'
import { aimonWS } from './ws'
import { isPageFocused, notifyWaitingInput, type NotificationPermissionState } from './notify'
import type {
  GitRef,
  LogEntry,
  Project,
  Session,
  SessionStatus,
  WSConnState,
} from './types'

export interface SelectedChange {
  path: string
  /** Which ref's raw content to show in Source/Preview tab. Defaults to WORKTREE. */
  ref?: GitRef
  /** Diff boundary — default is from=HEAD to=WORKTREE. */
  from?: GitRef
  to?: GitRef
  /** Commit sha this selection belongs to (if user is browsing a commit). */
  commitSha?: string
  /** Optional status code for display (M/A/D/...). */
  status?: string
}

export type Activity = 'explorer' | 'scm' | 'logs' | 'inbox'

export interface EditorTab {
  /** Stable id = `${projectId}:${path}:${ref}:${from ?? ''}:${to ?? ''}` */
  key: string
  projectId: string
  path: string
  ref?: GitRef
  from?: GitRef
  to?: GitRef
  commitSha?: string
  status?: string
}

function editorTabKey(
  projectId: string,
  path: string,
  opts: Pick<EditorTab, 'ref' | 'from' | 'to'>,
): string {
  return [
    projectId,
    path,
    opts.ref ?? 'WORKTREE',
    opts.from ?? '',
    opts.to ?? '',
  ].join('\u0000')
}

interface WorkbenchPersisted {
  activity?: Activity
  sidebarCollapsed?: boolean
  sidebarSize?: number
  terminalSize?: number
  terminalCollapsed?: boolean
  activeSessionIdByProject?: Record<string, string>
}

function readWorkbench(): WorkbenchPersisted {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(WORKBENCH_LS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as WorkbenchPersisted
  } catch {
    return {}
  }
}

function writeWorkbench(v: WorkbenchPersisted): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(WORKBENCH_LS_KEY, JSON.stringify(v)) } catch { /* noop */ }
}

function persistWorkbench(s: {
  activity: Activity
  sidebarCollapsed: boolean
  sidebarSize: number
  terminalCollapsed: boolean
  terminalSize: number
  activeSessionIdByProject: Record<string, string>
}): void {
  writeWorkbench({
    activity: s.activity,
    sidebarCollapsed: s.sidebarCollapsed,
    sidebarSize: s.sidebarSize,
    terminalCollapsed: s.terminalCollapsed,
    terminalSize: s.terminalSize,
    activeSessionIdByProject: s.activeSessionIdByProject,
  })
}
import { pushLog } from './logs'

const LOG_RING_CAPACITY = 500

const SELECTED_PROJECT_LS_KEY = 'aimon_selected_project_v1'
const WORKBENCH_LS_KEY = 'aimon_workbench_v2'

function readSelectedProject(): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const v = localStorage.getItem(SELECTED_PROJECT_LS_KEY)
    return v && v.length > 0 ? v : null
  } catch {
    return null
  }
}

function writeSelectedProject(id: string | null): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (id == null) localStorage.removeItem(SELECTED_PROJECT_LS_KEY)
    else localStorage.setItem(SELECTED_PROJECT_LS_KEY, id)
  } catch {
    // non-fatal
  }
}

interface State {
  projects: Project[]
  sessions: Session[]
  liveStatus: Record<string, SessionStatus>
  selectedProjectId: string | null
  wsState: WSConnState
  serverVersion: string | null
  notifyPerm: NotificationPermissionState
  /** Sessions currently nagging the user (waiting_input + page not focused). */
  notifyingSessions: Set<string>

  /** Ring-buffered project log entries, newest last. */
  logs: LogEntry[]
  appendLog: (entry: LogEntry) => void
  clearLogs: () => void

  /** Which row is highlighted inside ChangesList (selection only, no overlay). */
  selectedChange: SelectedChange | null
  selectChange: (c: SelectedChange | null) => void

  /** ----- VS Code-style workbench ----- */
  activity: Activity
  sidebarCollapsed: boolean
  sidebarSize: number
  terminalCollapsed: boolean
  terminalSize: number
  openFiles: EditorTab[]
  activeFileKey: string | null
  activeSessionIdByProject: Record<string, string>

  setActivity: (a: Activity) => void
  toggleSidebar: () => void
  setSidebarSize: (n: number) => void
  toggleTerminal: () => void
  setTerminalSize: (n: number) => void

  openFile: (t: Omit<EditorTab, 'key'>) => void
  closeFile: (key: string) => void
  closeAllFiles: () => void
  setActiveFile: (key: string | null) => void

  setActiveSession: (projectId: string, sessionId: string) => void

  setWsState: (s: WSConnState) => void
  setServerVersion: (v: string) => void
  setNotifyPerm: (p: NotificationPermissionState) => void
  selectProject: (id: string | null) => void

  refreshProjects: () => Promise<void>
  refreshSessions: (projectId?: string) => Promise<void>
  addSession: (s: Session) => void
  removeSession: (id: string) => void
  updateSessionStatus: (id: string, status: SessionStatus, detail?: string) => void
  markSessionExit: (id: string, code: number) => void

  /** Called when user interacts with a tile to clear nag state for that session. */
  clearNotify: (id: string) => void
  /** Called by App when tab regains focus to clear all nags. */
  clearAllNotify: () => void

}

function initialPerm(): NotificationPermissionState {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission as NotificationPermissionState
}

const ORIGINAL_TITLE = typeof document === 'undefined' ? 'aimon' : document.title || 'aimon'
let titleFlashTimer: ReturnType<typeof setInterval> | null = null
let titleFlipped = false

function startTitleFlash() {
  if (titleFlashTimer || typeof document === 'undefined') return
  titleFlipped = false
  titleFlashTimer = setInterval(() => {
    titleFlipped = !titleFlipped
    document.title = titleFlipped ? `● ${ORIGINAL_TITLE}` : ORIGINAL_TITLE
  }, 1000)
}

function stopTitleFlash() {
  if (titleFlashTimer) {
    clearInterval(titleFlashTimer)
    titleFlashTimer = null
  }
  if (typeof document !== 'undefined') document.title = ORIGINAL_TITLE
  titleFlipped = false
}

type BadgeNav = Navigator & {
  setAppBadge?: (n?: number) => Promise<void>
  clearAppBadge?: () => Promise<void>
}

function updateAppBadge(count: number) {
  if (typeof navigator === 'undefined') return
  const nav = navigator as BadgeNav
  try {
    if (count > 0) nav.setAppBadge?.(count)
    else nav.clearAppBadge?.()
  } catch {
    // Badging API is not supported everywhere; safe to ignore.
  }
}

export const useStore = create<State>((set, get) => ({
  projects: [],
  sessions: [],
  liveStatus: {},
  selectedProjectId: readSelectedProject(),
  wsState: 'connecting',
  serverVersion: null,
  notifyPerm: initialPerm(),
  notifyingSessions: new Set<string>(),
  logs: [],
  selectedChange: null,

  selectChange: (c) => set({ selectedChange: c }),

  // ----- workbench state (v2 layout: 4-column horizontal) -----
  activity: readWorkbench().activity ?? 'explorer',
  sidebarCollapsed: readWorkbench().sidebarCollapsed ?? false,
  sidebarSize: readWorkbench().sidebarSize ?? 18,
  terminalCollapsed: readWorkbench().terminalCollapsed ?? false,
  terminalSize: readWorkbench().terminalSize ?? 35,
  openFiles: [],
  activeFileKey: null,
  activeSessionIdByProject: readWorkbench().activeSessionIdByProject ?? {},

  setActivity: (a) => {
    set((st) => (st.activity === a ? st : { activity: a }))
    persistWorkbench(useStore.getState())
  },
  toggleSidebar: () => {
    set((st) => ({ sidebarCollapsed: !st.sidebarCollapsed }))
    persistWorkbench(useStore.getState())
  },
  setSidebarSize: (n) => {
    set({ sidebarSize: Math.max(10, Math.min(50, n)) })
    persistWorkbench(useStore.getState())
  },
  toggleTerminal: () => {
    set((st) => ({ terminalCollapsed: !st.terminalCollapsed }))
    persistWorkbench(useStore.getState())
  },
  setTerminalSize: (n) => {
    set({ terminalSize: Math.max(10, Math.min(80, n)) })
    persistWorkbench(useStore.getState())
  },

  openFile: (t) => {
    const key = editorTabKey(t.projectId, t.path, t)
    set((st) => {
      const exists = st.openFiles.some((x) => x.key === key)
      const tab: EditorTab = { ...t, key }
      return {
        openFiles: exists ? st.openFiles : [...st.openFiles, tab],
        activeFileKey: key,
      }
    })
  },
  closeFile: (key) => {
    set((st) => {
      const idx = st.openFiles.findIndex((x) => x.key === key)
      if (idx < 0) return st
      const next = st.openFiles.filter((x) => x.key !== key)
      let nextActive = st.activeFileKey
      if (st.activeFileKey === key) {
        const fallback = next[Math.min(idx, next.length - 1)]
        nextActive = fallback?.key ?? null
      }
      return { openFiles: next, activeFileKey: nextActive }
    })
  },
  closeAllFiles: () => set({ openFiles: [], activeFileKey: null }),
  setActiveFile: (key) => set({ activeFileKey: key }),

  setActiveSession: (projectId, sessionId) => {
    set((st) => ({
      activeSessionIdByProject: {
        ...st.activeSessionIdByProject,
        [projectId]: sessionId,
      },
    }))
    persistWorkbench(useStore.getState())
  },

  setWsState: (s) => {
    const prev = get().wsState
    set({ wsState: s })
    if (prev !== s) {
      pushLog({
        level: s === 'closed' ? 'warn' : 'info',
        scope: 'ws',
        msg: `WebSocket ${prev} → ${s}`,
      })
    }
  },
  setServerVersion: (v) => set({ serverVersion: v }),
  setNotifyPerm: (p) => set({ notifyPerm: p }),
  selectProject: (id) => {
    writeSelectedProject(id)
    set({ selectedProjectId: id })
  },

  refreshProjects: async () => {
    const projects = await api.listProjects()
    set({ projects })
    const sel = get().selectedProjectId
    if (sel && !projects.some((p) => p.id === sel)) {
      writeSelectedProject(null)
      set({ selectedProjectId: null })
    }
  },

  refreshSessions: async (projectId) => {
    const fetched = await api.listSessions(projectId)
    // After a refresh, only restore sessions still running on the server side
    // (ended_at is null). Previously dismissed dead sessions stay dismissed.
    const alive = fetched.filter((s) => s.ended_at == null)
    set((st) => {
      if (projectId) {
        const others = st.sessions.filter((s) => s.projectId !== projectId)
        return { sessions: [...others, ...alive] }
      }
      return { sessions: alive }
    })
    // Re-attach to every alive session so xterm tiles immediately get
    // status/output frames after a page refresh, even before they mount.
    const aliveIds = alive.map((s) => s.id)
    if (aliveIds.length > 0) aimonWS.subscribe(aliveIds)
  },

  addSession: (s) =>
    set((st) => {
      if (st.sessions.some((x) => x.id === s.id)) return st
      return { sessions: [...st.sessions, s] }
    }),

  removeSession: (id) => {
    set((st) => ({
      sessions: st.sessions.filter((s) => s.id !== id),
      liveStatus: omit(st.liveStatus, id),
    }))
    get().clearNotify(id)
  },

  updateSessionStatus: (id, status, detail) => {
    const prev = get().liveStatus[id] ?? get().sessions.find((s) => s.id === id)?.status
    set((st) => ({
      liveStatus: { ...st.liveStatus, [id]: status },
      sessions: st.sessions.map((s) => (s.id === id ? { ...s, status } : s)),
    }))
    if (prev !== status) {
      const sess = get().sessions.find((s) => s.id === id)
      pushLog({
        level: status === 'crashed' ? 'error' : 'info',
        scope: 'session',
        projectId: sess?.projectId,
        sessionId: id,
        msg: `状态: ${prev ?? '?'} → ${status}${detail ? ` (${detail})` : ''}`,
      })
    }
    if (status === 'waiting_input' && prev !== 'waiting_input') {
      const sess = get().sessions.find((s) => s.id === id)
      const proj = sess ? get().projects.find((p) => p.id === sess.projectId) : undefined
      const projName = proj?.name ?? `…${id.slice(-6)}`
      const result = notifyWaitingInput(
        id,
        projName,
        sess?.agent ?? 'agent',
        detail,
        sess?.projectId,
        () => {
          get().selectProject(sess?.projectId ?? null)
          get().clearNotify(id)
        },
      )
      // Whether or not the OS notification fired, mark this session as nagging
      // so the tile and tab title visibly indicate attention is needed. If the
      // page is currently focused we suppress everything (user is already here).
      if (!result.suppressedByFocus) {
        const next = new Set(get().notifyingSessions)
        next.add(id)
        set({ notifyingSessions: next })
        startTitleFlash()
        updateAppBadge(next.size)
      }
    } else if (status !== 'waiting_input') {
      // Auto-clear nag state once the session moves out of waiting_input.
      if (get().notifyingSessions.has(id)) get().clearNotify(id)
    }
  },

  markSessionExit: (id, code) => {
    const sess = get().sessions.find((s) => s.id === id)
    set((st) => ({
      sessions: st.sessions.map((s) =>
        s.id === id
          ? { ...s, status: 'stopped', exit_code: code, ended_at: Date.now() }
          : s,
      ),
      liveStatus: { ...st.liveStatus, [id]: 'stopped' },
    }))
    pushLog({
      level: code === 0 ? 'info' : 'warn',
      scope: 'session',
      projectId: sess?.projectId,
      sessionId: id,
      msg: `session 退出 (code=${code})`,
    })
    get().clearNotify(id)
  },

  clearNotify: (id) => {
    const cur = get().notifyingSessions
    if (!cur.has(id)) return
    const next = new Set(cur)
    next.delete(id)
    set({ notifyingSessions: next })
    if (next.size === 0) stopTitleFlash()
    updateAppBadge(next.size)
  },

  clearAllNotify: () => {
    if (get().notifyingSessions.size === 0) return
    set({ notifyingSessions: new Set() })
    stopTitleFlash()
    updateAppBadge(0)
  },

  appendLog: (entry) => {
    set((st) => {
      const next = st.logs.length >= LOG_RING_CAPACITY
        ? [...st.logs.slice(st.logs.length - LOG_RING_CAPACITY + 1), entry]
        : [...st.logs, entry]
      return { logs: next }
    })
  },

  clearLogs: () => set({ logs: [] }),
}))

// When the user comes back to the tab, all nags are implicitly acknowledged.
if (typeof document !== 'undefined') {
  const onVisibility = () => {
    if (isPageFocused()) useStore.getState().clearAllNotify()
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', onVisibility)
}

function omit<T extends object>(obj: T, key: string): T {
  if (!(key in obj)) return obj
  const next = { ...obj } as Record<string, unknown>
  delete next[key]
  return next as T
}
