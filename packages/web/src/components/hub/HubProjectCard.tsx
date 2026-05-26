import { useEffect, useState } from 'react'
import * as api from '../../api'
import type { HubProject, HubProjectDetail, HubSession } from '../../types'

const DETAIL_POLL_MS = 30_000

function formatMem(bytes: number): string {
  if (bytes <= 0) return '—'
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${Math.round(mb)} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

function formatRelativeTime(ts: number | null): string {
  if (ts == null || ts <= 0) return '—'
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

const STATUS_COLOR: Record<string, string> = {
  starting: 'text-amber-300 bg-amber-500/10',
  idle: 'text-emerald-300 bg-emerald-500/10',
  running: 'text-sky-300 bg-sky-500/10',
  waiting_input: 'text-violet-300 bg-violet-500/10',
  stopped: 'text-muted bg-white/[0.03]',
  crashed: 'text-rose-300 bg-rose-500/10',
  hibernated: 'text-muted bg-white/[0.03]',
}

interface Props {
  project: HubProject
  onOpen: () => void
  onDispatch: () => void
  onStopAll: () => void
  onStopOne: (sid: string) => void
  onOpenSession: (sid: string) => void
}

export default function HubProjectCard({
  project,
  onOpen,
  onDispatch,
  onStopAll,
  onStopOne,
  onOpenSession,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState<HubProjectDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Heavy data (git dirty + dev tasks) — only fetched while the card is open;
  // 30s slow refresh; cleared on collapse.
  useEffect(() => {
    if (!expanded) {
      setDetail(null)
      return
    }
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async (): Promise<void> => {
      setDetailLoading(true)
      try {
        const r = await api.getHubProjectDetail(project.id)
        if (alive) setDetail(r)
      } catch {
        // Project deleted between expand and fetch, or transient error —
        // detail stays as last successful value; will retry on next tick.
      } finally {
        if (alive) setDetailLoading(false)
        if (alive) timer = setTimeout(() => void tick(), DETAIL_POLL_MS)
      }
    }
    void tick()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [expanded, project.id])

  return (
    <div className="border border-border/60 rounded-md bg-bg/40">
      <div className="px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-6 h-6 inline-flex items-center justify-center text-muted hover:text-fg shrink-0"
          title={expanded ? '折叠' : '展开'}
        >
          {expanded ? '▼' : '▶'}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-fg truncate">{project.name}</div>
          <div className="text-xs text-muted truncate font-mono">{project.path}</div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted shrink-0">
          <span
            className={`px-1.5 py-0.5 rounded ${
              project.aliveSessionCount > 0
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-white/[0.03]'
            }`}
          >
            🟢 {project.aliveSessionCount}
          </span>
          <span className="tabular-nums w-16 text-right">
            {formatMem(project.totalMemBytes)}
          </span>
          <span className="w-20 text-right">{formatRelativeTime(project.lastActivityAt)}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onOpen}
            className="fluent-btn px-2 py-1 text-xs rounded border border-border hover:border-accent/60 hover:bg-accent/10"
            title="切换到该项目主界面"
          >
            打开
          </button>
          <button
            onClick={onDispatch}
            className="fluent-btn px-2 py-1 text-xs rounded border border-accent/40 bg-accent/15 text-accent hover:bg-accent/25"
            title="在该项目下新建 session 并把任务文本作为首句发送"
          >
            + 派任务
          </button>
          {project.aliveSessionCount > 0 && (
            <button
              onClick={onStopAll}
              className="fluent-btn px-2 py-1 text-xs rounded border border-rose-700/60 text-rose-300 hover:bg-rose-900/30"
              title="停止该项目下所有 AI 终端"
            >
              停所有
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/40 px-4 py-2 space-y-2">
          {project.sessions.length === 0 ? (
            <div className="text-xs text-muted py-2">该项目暂无 alive AI 终端</div>
          ) : (
            <div className="space-y-1">
              {project.sessions.map((s) => (
                <SessionRow
                  key={s.id}
                  session={s}
                  onOpen={() => onOpenSession(s.id)}
                  onStop={() => onStopOne(s.id)}
                />
              ))}
            </div>
          )}
          <DetailBlock detail={detail} loading={detailLoading} />
        </div>
      )}
    </div>
  )
}

function SessionRow({
  session,
  onOpen,
  onStop,
}: {
  session: HubSession
  onOpen: () => void
  onStop: () => void
}) {
  const statusClass = STATUS_COLOR[session.status] ?? 'text-muted bg-white/[0.03]'
  const lastAct = Math.max(
    session.startedAt,
    session.lastInputAt ?? 0,
    session.lastOutputAt ?? 0,
  )
  return (
    <div className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-white/[0.03] text-xs">
      <span className="font-mono text-subtle w-16 truncate" title={session.id}>
        {session.id.slice(0, 8)}
      </span>
      <span className="text-fg w-20 truncate">{session.agent}</span>
      <span className={`px-1.5 py-0.5 rounded ${statusClass}`}>{session.status}</span>
      <span className="text-muted tabular-nums">{formatRelativeTime(lastAct)}</span>
      <div className="flex-1" />
      <button
        onClick={onOpen}
        className="fluent-btn px-2 py-0.5 text-[11px] rounded border border-border hover:border-accent/60 hover:bg-accent/10"
      >
        打开
      </button>
      <button
        onClick={onStop}
        className="fluent-btn px-2 py-0.5 text-[11px] rounded border border-rose-700/60 text-rose-300 hover:bg-rose-900/30"
      >
        停
      </button>
    </div>
  )
}

function DetailBlock({
  detail,
  loading,
}: {
  detail: HubProjectDetail | null
  loading: boolean
}) {
  if (!detail && loading) {
    return <div className="text-xs text-muted py-1">详情加载中…</div>
  }
  if (!detail) return null
  const totalDirty = detail.gitDirty
    ? detail.gitDirty.staged + detail.gitDirty.unstaged + detail.gitDirty.untracked
    : 0
  return (
    <div className="text-xs text-muted pt-2 border-t border-border/30 space-y-1">
      {detail.gitDirty ? (
        <div>
          git: 分支 <span className="text-fg">{detail.gitDirty.branch ?? '—'}</span>
          {detail.gitDirty.ahead > 0 && <span> · ↑{detail.gitDirty.ahead}</span>}
          {detail.gitDirty.behind > 0 && <span> · ↓{detail.gitDirty.behind}</span>}
          {totalDirty > 0 && <span> · 改动 {totalDirty} 文件</span>}
          {totalDirty === 0 && <span> · 干净</span>}
        </div>
      ) : (
        <div>git: (不是 git 仓库或读取失败)</div>
      )}
      {detail.devTasks.length > 0 ? (
        <div>
          dev/active: {detail.devTasks.length} 个任务；最新
          <span className="text-fg mx-1">{detail.devTasks[0].name}</span>
          ({detail.devTasks[0].checked}/{detail.devTasks[0].total} 步)
        </div>
      ) : (
        <div>dev/active: 无活动任务</div>
      )}
    </div>
  )
}
