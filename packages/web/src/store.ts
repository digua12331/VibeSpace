import { create } from 'zustand'
import * as api from './api'
import { aimonWS } from './ws'
import { isPageFocused, notifyWaitingInput, type NotificationPermissionState } from './notify'
import type {
  ChecklistDoc,
  DocTaskSummary,
  GitRef,
  IssuesPayload,
  MemoryPayload,
  MemoryRollbackSelection,
  LogEntry,
  OutputFeature,
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

export type Activity = 'scm' | 'files' | 'docs' | 'perf' | 'logs' | 'inbox' | 'output'

export type EditorTabKind = 'file' | 'checklist'

export interface EditorTab {
  /** Stable id = `${projectId}:${path}:${ref}:${from ?? ''}:${to ?? ''}:${kind}` */
  key: string
  projectId: string
  path: string
  ref?: GitRef
  from?: GitRef
  to?: GitRef
  commitSha?: string
  status?: string
  /** Discriminator for EditorArea; default 'file'. */
  kind?: EditorTabKind
}

function editorTabKey(
  projectId: string,
  path: string,
  opts: Pick<EditorTab, 'ref' | 'from' | 'to' | 'kind'>,
): string {
  return [
    projectId,
    path,
    opts.ref ?? 'WORKTREE',
    opts.from ?? '',
    opts.to ?? '',
    opts.kind ?? 'file',
  ].join('\u0000')
}

interface WorkbenchPersisted {
  activity?: Activity
  projectsColumnSize?: number
  sidebarCollapsed?: boolean
  sidebarSize?: number
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
  projectsColumnSize: number
  sidebarCollapsed: boolean
  sidebarSize: number
  activeSessionIdByProject: Record<string, string>
}): void {
  writeWorkbench({
    activity: s.activity,
    projectsColumnSize: s.projectsColumnSize,
    sidebarCollapsed: s.sidebarCollapsed,
    sidebarSize: s.sidebarSize,
    activeSessionIdByProject: s.activeSessionIdByProject,
  })
}
import { pushLog } from './logs'

const LOG_RING_CAPACITY = 500

const SELECTED_PROJECT_LS_KEY = 'aimon_selected_project_v1'
const WORKBENCH_LS_KEY = 'aimon_workbench_v3'

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
  projectsColumnSize: number
  sidebarCollapsed: boolean
  sidebarSize: number
  openFiles: EditorTab[]
  activeFileKey: string | null
  activeSessionIdByProject: Record<string, string>
  /** Which kind of tab is currently showing in the unified workspace. */
  activeTabKind: 'file' | 'session' | null

  setActivity: (a: Activity) => void
  setProjectsColumnSize: (n: number) => void
  toggleSidebar: () => void
  setSidebarSize: (n: number) => void

  openFile: (t: Omit<EditorTab, 'key'>) => void
  closeFile: (key: string) => void
  closeAllFiles: () => void
  setActiveFile: (key: string | null) => void

  setActiveSession: (projectId: string, sessionId: string) => void
  setActiveTabKind: (k: 'file' | 'session' | null) => void

  /** Incremented whenever the file listing (FilesView) should re-fetch. */
  filesRefreshTick: number
  bumpFilesRefresh: () => void

  /** ----- Dev Docs ----- */
  docsTasks: Record<string, DocTaskSummary[]>
  docsLoading: Record<string, boolean>
  docsError: Record<string, string | null>
  refreshDocs: (projectId: string) => Promise<void>
  createDocsTask: (projectId: string, name: string) => Promise<DocTaskSummary>
  archiveDocsTask: (projectId: string, name: string) => Promise<void>

  /** ----- Issues 档案 ----- */
  issuesData: Record<string, IssuesPayload | undefined>
  issuesLoading: Record<string, boolean>
  issuesError: Record<string, string | null>
  refreshIssues: (projectId: string) => Promise<void>

  /** ----- 记忆（auto / manual / rejected） ----- */
  memoryData: Record<string, MemoryPayload | undefined>
  memoryLoading: Record<string, boolean>
  memoryError: Record<string, string | null>
  refreshMemory: (projectId: string) => Promise<void>
  rollbackMemoryItems: (projectId: string, items: MemoryRollbackSelection[]) => Promise<void>

  /** ----- Output (策划方案清单) ----- */
  outputFeatures: Record<string, OutputFeature[] | undefined>
  outputLoading: Record<string, boolean>
  outputError: Record<string, string | null>
  refreshOutput: (projectId: string) => Promise<void>

  /** keyed by `<projectId>::<feature>` */
  checklists: Record<string, ChecklistDoc | undefined>
  checklistsLoading: Record<string, boolean>
  checklistsError: Record<string, string | null>
  refreshChecklist: (projectId: string, feature: string) => Promise<void>
  patchChecklistItem: (
    projectId: string,
    feature: string,
    sectionId: string,
    itemId: string,
    patch: Record<string, unknown>,
  ) => Promise<void>

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

const INSTANCE_LABEL = (import.meta.env.VITE_AIMON_INSTANCE_LABEL as string | undefined)?.trim()
const BASE_TITLE = INSTANCE_LABEL ? `VibeSpace-${INSTANCE_LABEL}` : 'VibeSpace'
const ORIGINAL_TITLE = BASE_TITLE
if (typeof document !== 'undefined') document.title = ORIGINAL_TITLE
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

  // ----- workbench state (v3 layout: 5-column horizontal) -----
  activity: readWorkbench().activity ?? 'scm',
  projectsColumnSize: readWorkbench().projectsColumnSize ?? 16,
  sidebarCollapsed: readWorkbench().sidebarCollapsed ?? false,
  sidebarSize: readWorkbench().sidebarSize ?? 16,
  openFiles: [],
  activeFileKey: null,
  activeSessionIdByProject: readWorkbench().activeSessionIdByProject ?? {},
  activeTabKind: null,
  docsTasks: {},
  docsLoading: {},
  docsError: {},

  issuesData: {},
  issuesLoading: {},
  issuesError: {},

  memoryData: {},
  memoryLoading: {},
  memoryError: {},

  outputFeatures: {},
  outputLoading: {},
  outputError: {},

  checklists: {},
  checklistsLoading: {},
  checklistsError: {},

  setActivity: (a) => {
    set((st) => (st.activity === a ? st : { activity: a }))
    persistWorkbench(useStore.getState())
  },
  setProjectsColumnSize: (n) => {
    set({ projectsColumnSize: Math.max(8, Math.min(40, n)) })
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

  openFile: (t) => {
    const key = editorTabKey(t.projectId, t.path, t)
    set((st) => {
      const existing = st.openFiles.find((x) => x.key === key)
      // Only one file tab is kept at a time: clicking a different file
      // replaces the current preview tab in place (like VS Code's single
      // preview slot without the pinning UI).
      const tab: EditorTab = existing ?? { ...t, key, kind: t.kind ?? 'file' }
      return {
        openFiles: [tab],
        activeFileKey: key,
        activeTabKind: 'file',
      }
    })
  },
  closeFile: (key) => {
    set((st) => {
      const idx = st.openFiles.findIndex((x) => x.key === key)
      if (idx < 0) return st
      const next = st.openFiles.filter((x) => x.key !== key)
      let nextActive = st.activeFileKey
      let nextKind = st.activeTabKind
      if (st.activeFileKey === key) {
        const fallback = next[Math.min(idx, next.length - 1)]
        nextActive = fallback?.key ?? null
        if (!fallback) nextKind = st.activeTabKind === 'file' ? null : st.activeTabKind
      }
      return { openFiles: next, activeFileKey: nextActive, activeTabKind: nextKind }
    })
  },
  closeAllFiles: () =>
    set((st) => ({
      openFiles: [],
      activeFileKey: null,
      activeTabKind: st.activeTabKind === 'file' ? null : st.activeTabKind,
    })),
  setActiveFile: (key) =>
    set({ activeFileKey: key, activeTabKind: key ? 'file' : null }),
  setActiveTabKind: (k) => set({ activeTabKind: k }),

  filesRefreshTick: 0,
  bumpFilesRefresh: () =>
    set((st) => ({ filesRefreshTick: st.filesRefreshTick + 1 })),

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
    set((st) => {
      // File tabs are single-instance and tied to a specific project; once the
      // user switches to a different project, any open file tab belonging to
      // the previous project is stale and should be closed. When id is null
      // ("全部 sessions"), leave the current file tab alone — the user has
      // not committed to a specific project context.
      const nextOpenFiles =
        id != null ? st.openFiles.filter((f) => f.projectId === id) : st.openFiles
      const fileDropped = nextOpenFiles.length !== st.openFiles.length
      const nextActiveFileKey = fileDropped
        ? (nextOpenFiles[0]?.key ?? null)
        : st.activeFileKey
      // If the active tab kind was 'file' and we just dropped the file, fall
      // back so the EditorArea doesn't render stale state.
      const nextActiveTabKind =
        fileDropped && nextActiveFileKey == null && st.activeTabKind === 'file'
          ? null
          : st.activeTabKind
      // Also drop any selectedChange referring to the old project — it would
      // otherwise keep highlighting a row in the new ChangesList by accident.
      const nextSelectedChange =
        id != null && st.selectedChange ? null : st.selectedChange
      return {
        selectedProjectId: id,
        openFiles: nextOpenFiles,
        activeFileKey: nextActiveFileKey,
        activeTabKind: nextActiveTabKind,
        selectedChange: nextSelectedChange,
      }
    })
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

  refreshDocs: async (projectId) => {
    set((st) => ({
      docsLoading: { ...st.docsLoading, [projectId]: true },
      docsError: { ...st.docsError, [projectId]: null },
    }))
    try {
      const tasks = await api.listDocsTasks(projectId)
      set((st) => ({
        docsTasks: { ...st.docsTasks, [projectId]: tasks },
        docsLoading: { ...st.docsLoading, [projectId]: false },
      }))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      set((st) => ({
        docsLoading: { ...st.docsLoading, [projectId]: false },
        docsError: { ...st.docsError, [projectId]: msg },
      }))
      throw e
    }
  },

  createDocsTask: async (projectId, name) => {
    const created = await api.createDocsTask(projectId, name)
    set((st) => {
      const prev = st.docsTasks[projectId] ?? []
      return {
        docsTasks: { ...st.docsTasks, [projectId]: [created, ...prev] },
      }
    })
    return created
  },

  archiveDocsTask: async (projectId, name) => {
    await api.archiveDocsTask(projectId, name)
    set((st) => {
      const prev = st.docsTasks[projectId] ?? []
      return {
        docsTasks: {
          ...st.docsTasks,
          [projectId]: prev.filter((t) => t.name !== name),
        },
      }
    })
  },

  refreshIssues: async (projectId) => {
    set((st) => ({
      issuesLoading: { ...st.issuesLoading, [projectId]: true },
      issuesError: { ...st.issuesError, [projectId]: null },
    }))
    try {
      const payload = await api.listIssues(projectId)
      set((st) => ({
        issuesData: { ...st.issuesData, [projectId]: payload },
        issuesLoading: { ...st.issuesLoading, [projectId]: false },
      }))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      set((st) => ({
        issuesLoading: { ...st.issuesLoading, [projectId]: false },
        issuesError: { ...st.issuesError, [projectId]: msg },
      }))
      throw e
    }
  },

  refreshMemory: async (projectId) => {
    set((st) => ({
      memoryLoading: { ...st.memoryLoading, [projectId]: true },
      memoryError: { ...st.memoryError, [projectId]: null },
    }))
    try {
      const payload = await api.getMemory(projectId)
      set((st) => ({
        memoryData: { ...st.memoryData, [projectId]: payload },
        memoryLoading: { ...st.memoryLoading, [projectId]: false },
      }))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      set((st) => ({
        memoryLoading: { ...st.memoryLoading, [projectId]: false },
        memoryError: { ...st.memoryError, [projectId]: msg },
      }))
      throw e
    }
  },

  rollbackMemoryItems: async (projectId, items) => {
    if (items.length === 0) return
    set((st) => ({
      memoryLoading: { ...st.memoryLoading, [projectId]: true },
      memoryError: { ...st.memoryError, [projectId]: null },
    }))
    try {
      const payload = await api.rollbackMemory(projectId, items)
      set((st) => ({
        memoryData: { ...st.memoryData, [projectId]: payload },
        memoryLoading: { ...st.memoryLoading, [projectId]: false },
      }))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      set((st) => ({
        memoryLoading: { ...st.memoryLoading, [projectId]: false },
        memoryError: { ...st.memoryError, [projectId]: msg },
      }))
      throw e
    }
  },

  refreshOutput: async (projectId) => {
    set((st) => ({
      outputLoading: { ...st.outputLoading, [projectId]: true },
      outputError: { ...st.outputError, [projectId]: null },
    }))
    try {
      const r = await api.listOutput(projectId)
      set((st) => ({
        outputFeatures: { ...st.outputFeatures, [projectId]: r.features },
        outputLoading: { ...st.outputLoading, [projectId]: false },
      }))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      set((st) => ({
        outputLoading: { ...st.outputLoading, [projectId]: false },
        outputError: { ...st.outputError, [projectId]: msg },
      }))
      throw e
    }
  },

  refreshChecklist: async (projectId, feature) => {
    const key = `${projectId}::${feature}`
    set((st) => ({
      checklistsLoading: { ...st.checklistsLoading, [key]: true },
      checklistsError: { ...st.checklistsError, [key]: null },
    }))
    try {
      const doc = await api.getChecklist(projectId, feature)
      set((st) => ({
        checklists: { ...st.checklists, [key]: doc },
        checklistsLoading: { ...st.checklistsLoading, [key]: false },
      }))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      set((st) => ({
        checklistsLoading: { ...st.checklistsLoading, [key]: false },
        checklistsError: { ...st.checklistsError, [key]: msg },
      }))
      throw e
    }
  },

  patchChecklistItem: async (projectId, feature, sectionId, itemId, patch) => {
    const key = `${projectId}::${feature}`
    set((st) => ({
      checklistsError: { ...st.checklistsError, [key]: null },
    }))
    try {
      const doc = await api.patchChecklistItem(
        projectId,
        feature,
        sectionId,
        itemId,
        patch,
      )
      set((st) => ({
        checklists: { ...st.checklists, [key]: doc },
      }))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      set((st) => ({
        checklistsError: { ...st.checklistsError, [key]: msg },
      }))
      throw e
    }
  },
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
