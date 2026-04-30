import { useEffect, useMemo } from 'react'
import { useStore } from '../../store'
import * as api from '../../api'
import FilePreview from '../FilePreview'
import ChecklistEditor from './ChecklistEditor'
import StartSessionMenu from '../StartSessionMenu'
import SessionView from '../terminal/SessionView'
import { alertDialog, confirmDialog } from '../dialog/DialogHost'
import { logAction } from '../../logs'
import type { AgentKind, Session } from '../../types'

/**
 * When selectedProjectId is null (user picked "全部 sessions") we key the
 * active-session map under this placeholder so tabs still remember a focus.
 */
const ALL_KEY = '__all__'

function agentIcon(a: AgentKind): string {
  switch (a) {
    case 'pwsh': return '⚡'
    case 'cmd': return '🪟'
    case 'shell': return '💻'
    case 'gemini': return '✨'
    case 'opencode': return '🧠'
    case 'qoder': return '🧩'
    case 'kilo': return '🐤'
    case 'claude':
    case 'codex':
    default: return '🤖'
  }
}

export default function EditorArea() {
  const openFiles = useStore((s) => s.openFiles)
  const activeFileKey = useStore((s) => s.activeFileKey)
  const setActiveFile = useStore((s) => s.setActiveFile)
  const closeFile = useStore((s) => s.closeFile)

  const sessions = useStore((s) => s.sessions)
  const liveStatus = useStore((s) => s.liveStatus)
  const docsTasks = useStore((s) => s.docsTasks)
  const subagentRunsBySession = useStore((s) => s.subagentRunsBySession)
  const notifyingSessions = useStore((s) => s.notifyingSessions)
  const selectedProjectId = useStore((s) => s.selectedProjectId)
  const activeMap = useStore((s) => s.activeSessionIdByProject)
  const setActiveSession = useStore((s) => s.setActiveSession)
  const removeSession = useStore((s) => s.removeSession)
  const addSession = useStore((s) => s.addSession)

  const activeTabKind = useStore((s) => s.activeTabKind)
  const setActiveTabKind = useStore((s) => s.setActiveTabKind)

  const sessionKey = selectedProjectId ?? ALL_KEY

  const visibleSessions = useMemo(() => {
    const filtered = selectedProjectId
      ? sessions.filter((s) => s.projectId === selectedProjectId)
      : sessions
    return [...filtered].sort((a, b) => a.started_at - b.started_at)
  }, [sessions, selectedProjectId])

  const storedActiveSession = activeMap[sessionKey] ?? null
  const activeSessionId =
    (storedActiveSession &&
      visibleSessions.some((s) => s.id === storedActiveSession) &&
      storedActiveSession) ||
    (visibleSessions[visibleSessions.length - 1]?.id ?? null)

  // Keep the stored active-session in sync when it drifts (session removed etc).
  useEffect(() => {
    if (activeSessionId && activeSessionId !== storedActiveSession) {
      setActiveSession(sessionKey, activeSessionId)
    }
  }, [activeSessionId, storedActiveSession, sessionKey, setActiveSession])

  // Fall back to a sensible kind when the current one has no content.
  useEffect(() => {
    if (activeTabKind === 'file' && !activeFileKey) {
      if (activeSessionId) setActiveTabKind('session')
      else setActiveTabKind(null)
    } else if (activeTabKind === 'session' && !activeSessionId) {
      if (activeFileKey) setActiveTabKind('file')
      else setActiveTabKind(null)
    } else if (activeTabKind === null) {
      if (activeFileKey) setActiveTabKind('file')
      else if (activeSessionId) setActiveTabKind('session')
    }
  }, [activeTabKind, activeFileKey, activeSessionId, setActiveTabKind])

  const activeFile =
    activeTabKind === 'file'
      ? openFiles.find((f) => f.key === activeFileKey) ?? null
      : null

  function selectFileTab(key: string) {
    setActiveFile(key)
  }

  function selectSessionTab(id: string) {
    setActiveSession(sessionKey, id)
    setActiveTabKind('session')
  }

  async function closeSessionTab(id: string) {
    const s = sessions.find((x) => x.id === id)
    const status = liveStatus[id] ?? s?.status
    const isDead = status === 'stopped' || status === 'crashed'
    const isIsolated = s?.isolation === 'worktree' && !!s.worktreePath
    if (!isDead) {
      // If the session is bound to an unfinished task, surface the progress in
      // the confirm message so closing isn't a silent abandon.
      let confirmMsg = '结束当前终端会话?'
      if (s?.task && s.projectId) {
        const list = docsTasks[s.projectId] ?? []
        const t = list.find((x) => x.name === s.task)
        if (t && t.total > 0 && t.checked < t.total) {
          confirmMsg = `结束当前终端会话?\n\n该 session 绑定的任务 "${s.task}" (${t.checked}/${t.total}) 还没做完。`
        }
      }
      const ok = await confirmDialog(confirmMsg, {
        title: '关闭会话',
        variant: 'danger',
        confirmLabel: '结束',
      })
      if (!ok) return
      let gc = false
      if (isIsolated) {
        gc = await confirmDialog(
          `也删除 worktree 工作目录?\n\n  ${s?.worktreeBranch ?? ''}\n\n点「删除」会清理 worktree 及其未合并改动；点「保留」则保留目录供回看（之后可手动 git worktree remove）。`,
          {
            title: '清理 worktree',
            confirmLabel: '删除',
            cancelLabel: '保留',
            variant: 'danger',
          },
        )
      }
      try {
        await logAction(
          'session',
          'stop',
          () => api.deleteSession(id, { gc }),
          {
            projectId: s?.projectId,
            sessionId: id,
            meta: { agent: s?.agent, gc, isolation: s?.isolation },
          },
        )
      } catch (e: unknown) {
        await alertDialog(
          `关闭失败: ${e instanceof Error ? e.message : String(e)}`,
          { title: '关闭失败', variant: 'danger' },
        )
        return
      }
    }
    removeSession(id)
  }

  function handleRestart(oldId: string, next: Session) {
    removeSession(oldId)
    addSession(next)
    setActiveSession(next.projectId, next.id)
    setActiveTabKind('session')
  }

  const hasAnyTab = openFiles.length > 0 || visibleSessions.length > 0

  return (
    <section className="h-full flex flex-col min-h-0 min-w-0 bg-bg">
      <div className="flex items-stretch h-9 border-b border-border/60 bg-black/30">
        <div className="flex items-stretch flex-1 min-w-0 overflow-x-auto">
        {openFiles.map((f) => {
          const active = activeTabKind === 'file' && f.key === activeFileKey
          const basename = f.path.split('/').pop() ?? f.path
          const title = f.commitSha
            ? `${f.path} @ ${f.commitSha.slice(0, 7)}`
            : f.path
          return (
            <div
              key={`f:${f.key}`}
              title={title}
              onClick={() => selectFileTab(f.key)}
              onAuxClick={(e) => {
                if (e.button === 1) closeFile(f.key)
              }}
              className={`group relative flex items-center gap-2 px-3 pr-2 text-[12.5px] cursor-pointer select-none border-r border-border/40 ${
                active
                  ? 'bg-bg text-fg'
                  : 'bg-transparent text-muted hover:text-fg hover:bg-white/[0.04]'
              }`}
            >
              <span className="text-[12px] opacity-70">📄</span>
              <span className="font-mono truncate max-w-[220px]">{basename}</span>
              {f.commitSha && (
                <span className="text-[10px] font-mono text-subtle">
                  @{f.commitSha.slice(0, 7)}
                </span>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closeFile(f.key)
                }}
                className="w-4 h-4 inline-flex items-center justify-center rounded opacity-60 hover:opacity-100 hover:bg-white/[0.08]"
                title="关闭 (中键)"
              >
                ✕
              </button>
              {active && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
              )}
            </div>
          )
        })}

        {visibleSessions.map((s) => {
          const active = activeTabKind === 'session' && s.id === activeSessionId
          const nagging = notifyingSessions.has(s.id)
          return (
            <div
              key={`s:${s.id}`}
              title={s.id}
              onClick={() => selectSessionTab(s.id)}
              onAuxClick={(e) => {
                if (e.button === 1) void closeSessionTab(s.id)
              }}
              className={`group relative flex items-center gap-2 px-3 pr-2 text-[12.5px] cursor-pointer select-none border-r border-border/40 ${
                active
                  ? 'bg-bg text-fg'
                  : 'text-muted hover:text-fg hover:bg-white/[0.04]'
              } ${nagging ? 'animate-pulse-soft' : ''}`}
            >
              <span className="text-[12px]">{agentIcon(s.agent)}</span>
              {s.task && (
                <span
                  title={`绑定任务: ${s.task}`}
                  className="text-[10px] text-cyan-300/90 bg-cyan-400/10 border border-cyan-400/30 rounded px-1 py-0 leading-4 whitespace-pre"
                >
                  📝 {s.task.length > 10 ? s.task.slice(0, 10) + '…' : s.task}
                </span>
              )}
              {s.isolation === 'worktree' && s.worktreeBranch && (
                <span
                  title={`隔离 worktree 分支: ${s.worktreeBranch}`}
                  className="text-[10px] text-emerald-300/90 bg-emerald-400/10 border border-emerald-400/30 rounded px-1 py-0 leading-4 whitespace-pre"
                >
                  🌿 {s.worktreeBranch.replace(/^agent\//, '')}
                </span>
              )}
              {(() => {
                const runs = subagentRunsBySession[s.id] ?? []
                const running = runs.filter((r) => r.state === 'running').length
                if (running === 0) return null
                return (
                  <span
                    title={`${running} 个 subagent 正在跑`}
                    className="text-[10px] text-violet-300/90 bg-violet-400/10 border border-violet-400/30 rounded px-1 py-0 leading-4 whitespace-pre"
                  >
                    🤖×{running}
                  </span>
                )
              })()}
              <span className="font-mono truncate max-w-[180px]">
                {s.agent}·{s.id.slice(-6)}
              </span>
              {nagging && (
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void closeSessionTab(s.id)
                }}
                className="w-4 h-4 inline-flex items-center justify-center rounded opacity-60 hover:opacity-100 hover:bg-white/[0.08]"
                title="关闭 (中键)"
              >
                ✕
              </button>
              {active && (
                <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-accent" />
              )}
            </div>
          )
        })}

        </div>
        <div className="shrink-0 flex items-center px-1 border-l border-border/40">
          <StartSessionMenu
            projectId={selectedProjectId}
            compact
            triggerLabel="+ 启动 AI / 终端"
            onStarted={(s) => {
              setActiveSession(s.projectId, s.id)
              setActiveTabKind('session')
            }}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {visibleSessions.map((s) => (
          <SessionView
            key={s.id}
            session={s}
            active={activeTabKind === 'session' && s.id === activeSessionId}
            onClose={removeSession}
            onRestart={handleRestart}
          />
        ))}

        {activeFile ? (
          <div className="absolute inset-0 flex flex-col bg-bg">
            {activeFile.kind === 'checklist' ? (
              <ChecklistEditor
                key={activeFile.key}
                projectId={activeFile.projectId}
                feature={extractFeature(activeFile.path)}
              />
            ) : (
              <FilePreview
                key={activeFile.key}
                projectId={activeFile.projectId}
                path={activeFile.path}
                ref={activeFile.ref}
                from={activeFile.from}
                to={activeFile.to}
              />
            )}
          </div>
        ) : null}

        {!hasAnyTab && <EmptyState projectId={selectedProjectId} />}
      </div>
    </section>
  )
}

/**
 * Pull the feature name out of "output/<feature>/checklist.json". Falls back
 * to the middle path segment so the tab still renders something coherent if
 * the path shape ever drifts.
 */
function extractFeature(path: string): string {
  const m = /^output\/([^/]+)\/checklist\.json$/.exec(path)
  if (m) return m[1]
  const parts = path.split('/')
  return parts[parts.length - 2] ?? ''
}

function EmptyState({ projectId }: { projectId: string | null }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">
      <div className="text-center space-y-2">
        <div className="text-[36px] opacity-40">📄</div>
        <div>从左侧「源代码更改」中选择一个文件</div>
        <div className="text-xs text-subtle">
          {projectId
            ? '或点击右上角「+ 启动 AI / 终端」打开菜单，选一个 AI agent 或 shell'
            : '请先在「项目」中选择一个项目再启动 session'}
        </div>
      </div>
    </div>
  )
}
