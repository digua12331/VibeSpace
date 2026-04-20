import { useEffect, useMemo } from 'react'
import { useStore } from '../../store'
import * as api from '../../api'
import StartSessionMenu from '../StartSessionMenu'
import SessionView from './SessionView'
import type { Session } from '../../types'

/**
 * When selectedProjectId is null (user picked "全部 sessions"), we key the
 * active session map under this placeholder so tabs still remember a focus.
 */
const ALL_KEY = '__all__'

export default function TerminalPanel() {
  const sessions = useStore((s) => s.sessions)
  const liveStatus = useStore((s) => s.liveStatus)
  const selectedProjectId = useStore((s) => s.selectedProjectId)
  const activeMap = useStore((s) => s.activeSessionIdByProject)
  const setActiveSession = useStore((s) => s.setActiveSession)
  const removeSession = useStore((s) => s.removeSession)
  const addSession = useStore((s) => s.addSession)

  const key = selectedProjectId ?? ALL_KEY

  const visible = useMemo(() => {
    const filtered = selectedProjectId
      ? sessions.filter((s) => s.projectId === selectedProjectId)
      : sessions
    return [...filtered].sort((a, b) => a.started_at - b.started_at)
  }, [sessions, selectedProjectId])

  const storedActive = activeMap[key] ?? null
  const activeId =
    (storedActive && visible.some((s) => s.id === storedActive) && storedActive) ||
    (visible[visible.length - 1]?.id ?? null)

  // Keep the store in sync when the effective active id drifts (e.g. the
  // previously-active session got removed).
  useEffect(() => {
    if (activeId && activeId !== storedActive) {
      setActiveSession(key, activeId)
    }
  }, [activeId, storedActive, key, setActiveSession])

  function select(id: string) {
    setActiveSession(key, id)
  }

  async function closeTab(id: string) {
    const s = sessions.find((x) => x.id === id)
    const status = liveStatus[id] ?? s?.status
    const isDead = status === 'stopped' || status === 'crashed'
    if (!isDead) {
      if (!confirm('结束当前终端会话?')) return
      try {
        await api.deleteSession(id)
      } catch (e: unknown) {
        alert(`关闭失败: ${e instanceof Error ? e.message : String(e)}`)
        return
      }
    }
    removeSession(id)
  }

  function handleRestart(oldId: string, next: Session) {
    removeSession(oldId)
    addSession(next)
    setActiveSession(next.projectId, next.id)
  }

  return (
    <section className="h-full flex flex-col min-h-0 min-w-0 bg-bg">
      <div className="flex items-stretch h-8 border-b border-border/60 bg-black/30 overflow-x-auto">
        <TerminalTabBarInner
          sessions={visible}
          activeId={activeId}
          onSelect={select}
          onClose={(id) => void closeTab(id)}
        />
        <div className="flex-1" />
        <div className="shrink-0 flex items-center px-1 border-l border-border/40">
          <StartSessionMenu
            projectId={selectedProjectId}
            compact
            triggerLabel="+ 新终端"
            onStarted={(s) => setActiveSession(s.projectId, s.id)}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {visible.length === 0 ? (
          <EmptyPanel projectId={selectedProjectId} />
        ) : (
          visible.map((s) => (
            <SessionView
              key={s.id}
              session={s}
              active={s.id === activeId}
              onClose={removeSession}
              onRestart={handleRestart}
            />
          ))
        )}
      </div>
    </section>
  )
}

function TerminalTabBarInner({
  sessions,
  activeId,
  onSelect,
  onClose,
}: {
  sessions: Session[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
}) {
  return (
    <div className="flex items-stretch">
      {sessions.map((s) => {
        const active = s.id === activeId
        return (
          <div
            key={s.id}
            title={s.id}
            onClick={() => onSelect(s.id)}
            onAuxClick={(e) => { if (e.button === 1) onClose(s.id) }}
            className={`group flex items-center gap-2 px-3 pr-2 text-[12px] cursor-pointer select-none border-r border-border/40 ${
              active ? 'bg-bg text-fg' : 'text-muted hover:text-fg hover:bg-white/[0.04]'
            }`}
          >
            <span className="font-mono truncate max-w-[180px]">
              {s.agent}·{s.id.slice(-6)}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(s.id) }}
              className="w-4 h-4 inline-flex items-center justify-center rounded opacity-60 hover:opacity-100 hover:bg-white/[0.08]"
              title="关闭 (中键)"
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}

function EmptyPanel({ projectId }: { projectId: string | null }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">
      <div className="text-center">
        <div className="text-[32px] opacity-40 mb-2">💻</div>
        <div>
          {projectId
            ? '还没有会话。点击右上角「+」启动一个 session。'
            : '请先在「资源管理器」中选择一个项目再启动 session。'}
        </div>
      </div>
    </div>
  )
}
