import { create } from 'zustand'
import * as api from './api'
import { aimonWS } from './ws'
import { isPageFocused, notifyWaitingInput, type NotificationPermissionState } from './notify'
import type {
  LogEntry,
  Project,
  ProjectLayout,
  Session,
  SessionStatus,
  WSConnState,
} from './types'
import { pushLog } from './logs'

const LOG_RING_CAPACITY = 500

const LAYOUTS_LS_KEY = 'aimon_layouts_v1'

function readLayoutsFromStorage(): Record<string, ProjectLayout> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(LAYOUTS_LS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, ProjectLayout>
  } catch {
    return {}
  }
}

function writeLayoutsToStorage(layouts: Record<string, ProjectLayout>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LAYOUTS_LS_KEY, JSON.stringify(layouts))
  } catch {
    // quota exceeded or private mode — non-fatal
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

  /** Per-project grid layout, keyed by projectId. */
  layoutByProject: Record<string, ProjectLayout>
  /** projectId → true when local layout differs from last-persisted. */
  layoutDirty: Record<string, boolean>
  /** projectIds for which layout has been fetched (null result counts). */
  layoutLoaded: Record<string, boolean>

  /** Ring-buffered project log entries, newest last. */
  logs: LogEntry[]
  /** Whether the bottom log drawer is expanded. */
  logOpen: boolean
  appendLog: (entry: LogEntry) => void
  toggleLog: () => void
  clearLogs: () => void

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

  loadProjectLayout: (projectId: string) => Promise<void>
  setProjectLayout: (projectId: string, layout: ProjectLayout) => void
  saveProjectLayout: (projectId: string) => Promise<void>
  /**
   * Preserve a tile's x/y/w/h across session restart: rename the layout entry
   * from the stopped session's id to the freshly-spawned one so RGL keeps the
   * same cell instead of placing the new session at defaults.
   */
  renameTileInLayout: (projectId: string, oldId: string, newId: string) => void
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
  selectedProjectId: null,
  wsState: 'connecting',
  serverVersion: null,
  notifyPerm: initialPerm(),
  notifyingSessions: new Set<string>(),
  layoutByProject: readLayoutsFromStorage(),
  layoutDirty: {},
  layoutLoaded: {},
  logs: [],
  logOpen: false,

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
  selectProject: (id) => set({ selectedProjectId: id }),

  refreshProjects: async () => {
    const projects = await api.listProjects()
    set({ projects })
    const sel = get().selectedProjectId
    if (sel && !projects.some((p) => p.id === sel)) set({ selectedProjectId: null })
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

  loadProjectLayout: async (projectId) => {
    if (get().layoutLoaded[projectId]) return
    try {
      const remote = await api.getProjectLayout(projectId)
      set((st) => {
        const loaded = { ...st.layoutLoaded, [projectId]: true }
        if (!remote) return { layoutLoaded: loaded }
        const local = st.layoutByProject[projectId]
        // Keep local layout only if it's newer (user changed it while offline
        // and hasn't saved yet). Otherwise trust the server copy.
        const keepLocal =
          st.layoutDirty[projectId] &&
          local &&
          local.updatedAt > remote.updatedAt
        return {
          layoutLoaded: loaded,
          layoutByProject: {
            ...st.layoutByProject,
            [projectId]: keepLocal ? local : remote,
          },
        }
      })
    } catch {
      // Server unavailable — rely on whatever localStorage gave us.
      set((st) => ({ layoutLoaded: { ...st.layoutLoaded, [projectId]: true } }))
    }
  },

  setProjectLayout: (projectId, layout) => {
    set((st) => {
      const nextMap = { ...st.layoutByProject, [projectId]: layout }
      writeLayoutsToStorage(nextMap)
      return {
        layoutByProject: nextMap,
        layoutDirty: { ...st.layoutDirty, [projectId]: true },
      }
    })
  },

  renameTileInLayout: (projectId, oldId, newId) => {
    if (oldId === newId) return
    set((st) => {
      const cur = st.layoutByProject[projectId]
      if (!cur) return st
      if (!cur.tiles.some((t) => t.i === oldId)) return st
      const nextTiles = cur.tiles
        // Drop any pre-existing tile with newId — duplicate i values confuse RGL.
        .filter((t) => t.i !== newId)
        .map((t) => (t.i === oldId ? { ...t, i: newId } : t))
      const nextLayout: ProjectLayout = {
        ...cur,
        tiles: nextTiles,
        updatedAt: Date.now(),
      }
      const nextMap = { ...st.layoutByProject, [projectId]: nextLayout }
      writeLayoutsToStorage(nextMap)
      return {
        layoutByProject: nextMap,
        layoutDirty: { ...st.layoutDirty, [projectId]: true },
      }
    })
  },

  saveProjectLayout: async (projectId) => {
    const layout = get().layoutByProject[projectId]
    if (!layout) return
    const { updatedAt: _ignored, ...payload } = layout
    void _ignored
    try {
      await api.saveProjectLayout(projectId, payload)
      set((st) => ({
        layoutDirty: { ...st.layoutDirty, [projectId]: false },
      }))
      pushLog({
        level: 'info',
        scope: 'layout',
        projectId,
        msg: `已保存布局 (${payload.tiles.length} 个 tile)`,
      })
    } catch (err) {
      pushLog({
        level: 'error',
        scope: 'layout',
        projectId,
        msg: `保存布局失败: ${err instanceof Error ? err.message : String(err)}`,
      })
      throw err
    }
  },

  appendLog: (entry) => {
    set((st) => {
      const next = st.logs.length >= LOG_RING_CAPACITY
        ? [...st.logs.slice(st.logs.length - LOG_RING_CAPACITY + 1), entry]
        : [...st.logs, entry]
      return { logs: next }
    })
  },

  toggleLog: () => set((st) => ({ logOpen: !st.logOpen })),

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
