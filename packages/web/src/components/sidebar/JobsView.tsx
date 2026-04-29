import { useEffect, useState } from 'react'
import * as api from '../../api'
import { alertDialog, confirmDialog } from '../dialog/DialogHost'
import { logAction, pushLog } from '../../logs'
import type { JobItem, JobState } from '../../types'

const POLL_INTERVAL_MS = 3000

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 1000) return '刚刚'
  if (diff < 60_000) return `${Math.floor(diff / 1000)}秒前`
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}时前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function StatePill({ state }: { state: JobState }) {
  const cls =
    state === 'running'
      ? 'border-amber-600/40 bg-amber-500/10 text-amber-200'
      : state === 'done'
        ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300'
        : state === 'failed'
          ? 'border-rose-600/40 bg-rose-500/15 text-rose-200'
          : 'border-border bg-white/[0.04] text-muted'
  const label =
    state === 'running'
      ? '运行中'
      : state === 'done'
        ? '完成'
        : state === 'failed'
          ? '失败'
          : '已取消'
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${cls}`}>
      {label}
    </span>
  )
}

function kindIcon(kind: JobItem['kind']): string {
  switch (kind) {
    case 'review':
      return '🧪'
    case 'install':
      return '📦'
    default:
      return '🛠'
  }
}

export default function JobsView() {
  const [jobs, setJobs] = useState<JobItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const tick = async () => {
      try {
        const list = await api.listJobs()
        if (cancelled) return
        setJobs(list)
        setError(null)
      } catch (e: unknown) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_INTERVAL_MS)
      }
    }
    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  async function onCancel(j: JobItem) {
    if (j.state !== 'running' || busyId === j.id) return
    setBusyId(j.id)
    try {
      await logAction('jobs', 'cancel', () => api.cancelJob(j.id), {
        projectId: j.projectId,
        meta: { kind: j.kind, title: j.title },
      })
      const list = await api.listJobs()
      setJobs(list)
    } catch (e: unknown) {
      await alertDialog(
        e instanceof Error ? e.message : String(e),
        { title: '取消失败', variant: 'danger' },
      )
    } finally {
      setBusyId(null)
    }
  }

  async function onClear(j: JobItem) {
    // v1: only review jobs are clearable through this aggregator (install-jobs
    // has no remove API).
    if (j.kind !== 'review' || j.state === 'running' || busyId === j.id) return
    const ok = await confirmDialog(`从列表清掉这条记录?\n\n${j.title}`, {
      title: '清理任务',
      confirmLabel: '清理',
    })
    if (!ok) return
    setBusyId(j.id)
    try {
      await api.deleteJob(j.id)
      pushLog({ level: 'info', scope: 'jobs', msg: `cleared job ${j.id}` })
      const list = await api.listJobs()
      setJobs(list)
    } catch (e: unknown) {
      await alertDialog(
        e instanceof Error ? e.message : String(e),
        { title: '清理失败', variant: 'danger' },
      )
    } finally {
      setBusyId(null)
    }
  }

  async function onRowClick(j: JobItem) {
    const lines: string[] = []
    lines.push(`类型: ${j.kind}`)
    lines.push(`标题: ${j.title}`)
    lines.push(`状态: ${j.state}`)
    lines.push(`开始: ${new Date(j.startedAt).toLocaleString()}`)
    if (j.endedAt) {
      const ms = j.endedAt - j.startedAt
      lines.push(`结束: ${new Date(j.endedAt).toLocaleString()} (${ms}ms)`)
    }
    if (j.projectId) lines.push(`项目: ${j.projectId}`)
    if (j.error) lines.push(`错误: ${j.error}`)
    await alertDialog(lines.join('\n'), { title: '任务详情' })
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 min-h-0 overflow-auto p-2 space-y-0.5">
        {error && (
          <div className="mx-1 mb-2 px-3 py-2 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md">
            {error}
          </div>
        )}
        {jobs.length === 0 && !error && (
          <div className="px-3 py-6 text-xs text-muted text-center">
            还没有后台任务。
            <div className="mt-2 text-left text-[11px] leading-relaxed">
              归档 Dev Docs 任务会触发 codex/gemini 写记忆评审；安装 AI CLI
              也会在这里显示。
            </div>
          </div>
        )}
        {jobs.map((j) => (
          <div
            key={j.id}
            className="group flex items-center gap-1.5 pl-1 pr-2 py-1 rounded hover:bg-white/[0.04] cursor-pointer text-sm"
            onClick={() => void onRowClick(j)}
            title={`${j.kind} · ${j.title}`}
          >
            <span className="text-[12px] shrink-0 w-4 text-center">
              {kindIcon(j.kind)}
            </span>
            <span className="flex-1 truncate font-mono text-[12px]">
              {j.title}
            </span>
            <StatePill state={j.state} />
            <span className="text-[10px] text-subtle tabular-nums shrink-0">
              {formatTimeAgo(j.startedAt)}
            </span>
            {j.state === 'running' && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void onCancel(j)
                }}
                disabled={busyId === j.id}
                title="取消"
                className="opacity-0 group-hover:opacity-100 w-5 h-5 inline-flex items-center justify-center rounded text-muted hover:text-rose-300 hover:bg-white/[0.08] disabled:opacity-50"
              >
                ✕
              </button>
            )}
            {j.state !== 'running' && j.kind === 'review' && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  void onClear(j)
                }}
                disabled={busyId === j.id}
                title="从列表清掉"
                className="opacity-0 group-hover:opacity-100 w-5 h-5 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.08] disabled:opacity-50"
              >
                🧹
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
