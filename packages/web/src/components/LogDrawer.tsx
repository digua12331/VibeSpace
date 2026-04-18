import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import type { LogEntry, LogLevel } from '../types'

const LEVEL_STYLE: Record<LogLevel, string> = {
  info: 'text-sky-300 border-sky-500/40 bg-sky-500/10',
  warn: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  error: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
}

const LEVEL_LABEL: Record<LogLevel, string> = {
  info: 'INFO',
  warn: 'WARN',
  error: 'ERR ',
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

export default function LogDrawer() {
  const logs = useStore((s) => s.logs)
  const logOpen = useStore((s) => s.logOpen)
  const toggleLog = useStore((s) => s.toggleLog)
  const clearLogs = useStore((s) => s.clearLogs)
  const selectedProjectId = useStore((s) => s.selectedProjectId)
  const [scope, setScope] = useState<'all' | 'project'>('all')
  const bodyRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  const shown = useMemo<LogEntry[]>(() => {
    if (scope === 'project' && selectedProjectId) {
      return logs.filter((l) => l.projectId === selectedProjectId)
    }
    return logs
  }, [logs, scope, selectedProjectId])

  useEffect(() => {
    if (!logOpen || !autoScroll) return
    const el = bodyRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [shown, logOpen, autoScroll])

  function onScroll() {
    const el = bodyRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20
    setAutoScroll(atBottom)
  }

  if (!logOpen) return null

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 flex flex-col fluent-mica border-t border-border/60 shadow-dialog h-[42%] animate-fluent-in">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 bg-white/[0.02] text-xs">
        <div className="flex items-center gap-3">
          <span className="font-medium">📋 项目日志</span>
          <span className="text-subtle tabular-nums">{shown.length} / {logs.length}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setScope('all')}
              className={`fluent-btn px-2 py-0.5 rounded border ${scope === 'all' ? 'border-accent/40 text-accent bg-accent/10' : 'border-border text-muted hover:text-fg hover:bg-white/[0.05]'}`}
            >
              全部
            </button>
            <button
              onClick={() => setScope('project')}
              disabled={!selectedProjectId}
              className={`fluent-btn px-2 py-0.5 rounded border disabled:opacity-40 ${scope === 'project' ? 'border-accent/40 text-accent bg-accent/10' : 'border-border text-muted hover:text-fg hover:bg-white/[0.05]'}`}
              title={selectedProjectId ? '仅显示当前项目' : '先选择一个项目'}
            >
              当前项目
            </button>
          </div>
          {!autoScroll && (
            <span className="text-amber-300">⏸ 暂停滚动</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearLogs}
            className="fluent-btn px-2 py-0.5 rounded border border-border text-muted hover:text-fg hover:bg-white/[0.05]"
          >
            清空
          </button>
          <button
            onClick={toggleLog}
            className="fluent-btn px-2 py-0.5 rounded border border-border text-muted hover:text-fg hover:bg-white/[0.05]"
            title="折叠日志面板"
          >
            ▼ 收起
          </button>
        </div>
      </div>
      <div
        ref={bodyRef}
        onScroll={onScroll}
        className="flex-1 overflow-auto font-mono text-xs leading-relaxed px-3 py-2 bg-[#1a1a1a]"
      >
        {shown.length === 0 ? (
          <div className="text-subtle py-4 text-center">暂无日志。点击 ▶ 启动 / 切换 session 状态后，日志会出现在这里。</div>
        ) : (
          shown.map((l) => (
            <div key={l.id} className="flex gap-2 py-0.5 border-b border-white/[0.04]">
              <span className="text-subtle shrink-0 w-[96px]">{fmtTime(l.ts)}</span>
              <span className={`shrink-0 px-1.5 border rounded ${LEVEL_STYLE[l.level]}`}>
                {LEVEL_LABEL[l.level]}
              </span>
              <span className="shrink-0 text-subtle w-[64px]">{l.scope}</span>
              <span className="shrink-0 text-subtle w-[120px] truncate" title={l.sessionId || l.projectId || ''}>
                {l.sessionId ? `sess ${l.sessionId.slice(0, 8)}` : l.projectId ? `proj ${l.projectId.slice(0, 8)}` : ''}
              </span>
              <span className="whitespace-pre-wrap break-words">{l.msg}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
