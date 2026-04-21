import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import * as api from '../../api'
import type { AgentKind, ProjectPerf, SessionPerfSample } from '../../types'

const POLL_MS = 2000

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

function fmtMb(bytes: number): string {
  if (!bytes) return '0.0'
  return (bytes / 1024 / 1024).toFixed(1)
}

function fmtCpu(cpu: number): string {
  return cpu.toFixed(1)
}

/**
 * CPU bar scales against a 100%-per-core ceiling; capped at 100 for display so
 * a multi-core spike doesn't overflow the row. RSS bar scales against a
 * per-project max — we track the running max to give the bar something stable
 * to compare against.
 */
function PerfRow({
  sample,
  rssMax,
}: {
  sample: SessionPerfSample
  rssMax: number
}) {
  const cpuPct = Math.min(100, Math.max(0, sample.cpu))
  const rssPct = rssMax > 0 ? Math.min(100, (sample.memRss / rssMax) * 100) : 0
  const dead = sample.error != null

  return (
    <div className="px-2 py-1.5 rounded hover:bg-white/[0.04] text-[12px]">
      <div className="flex items-center gap-2">
        <span>{agentIcon(sample.agent)}</span>
        <span className="font-mono text-muted truncate flex-1">
          {sample.agent}·{sample.sessionId.slice(-6)}
        </span>
        {sample.pid != null && (
          <span className="text-[10px] text-subtle tabular-nums">
            pid {sample.pid}
          </span>
        )}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <div>
          <div className="flex justify-between text-[10px] text-subtle">
            <span>CPU</span>
            <span className="tabular-nums text-fg/80">
              {dead ? '—' : `${fmtCpu(sample.cpu)}%`}
            </span>
          </div>
          <div className="h-1 rounded bg-white/[0.05] overflow-hidden">
            <div
              className="h-full bg-sky-400/70"
              style={{ width: `${cpuPct}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-[10px] text-subtle">
            <span>RSS</span>
            <span className="tabular-nums text-fg/80">
              {dead ? '—' : `${fmtMb(sample.memRss)} MB`}
            </span>
          </div>
          <div className="h-1 rounded bg-white/[0.05] overflow-hidden">
            <div
              className="h-full bg-emerald-400/70"
              style={{ width: `${rssPct}%` }}
            />
          </div>
        </div>
      </div>
      {sample.error && (
        <div className="mt-1 text-[10px] text-rose-300/80">
          采样失败: {sample.error}
        </div>
      )}
    </div>
  )
}

export default function PerfView() {
  const projectId = useStore((s) => s.selectedProjectId)
  const projects = useStore((s) => s.projects)
  const project = projects.find((p) => p.id === projectId)

  const [perf, setPerf] = useState<ProjectPerf | null>(null)
  const [error, setError] = useState<string | null>(null)
  const rssMaxRef = useRef(0)

  useEffect(() => {
    if (!projectId) {
      setPerf(null)
      setError(null)
      rssMaxRef.current = 0
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    async function tick() {
      if (!projectId) return
      try {
        const p = await api.getProjectPerf(projectId)
        if (cancelled) return
        // Track the running max of any single session's RSS so the per-row
        // bar has a stable reference across ticks (projects with one giant
        // process shouldn't make small ones look like zero).
        for (const s of p.sessions) {
          if (s.memRss > rssMaxRef.current) rssMaxRef.current = s.memRss
        }
        setPerf(p)
        setError(null)
      } catch (e: unknown) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS)
      }
    }
    void tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [projectId])

  if (!projectId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-sm text-muted text-center">
        <div>请先在左侧「项目」列表中选中一个项目</div>
      </div>
    )
  }

  const sessions = perf?.sessions ?? []
  const totalRssMb = perf ? perf.totalRssBytes / 1024 / 1024 : 0

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {project && (
        <div
          className="px-3 py-1.5 text-[11px] text-muted border-b border-border/40 truncate"
          title={project.path}
        >
          {project.name}
        </div>
      )}

      <div className="px-3 py-2 border-b border-border/40 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <div className="text-subtle">Sessions</div>
          <div className="text-fg font-medium tabular-nums">
            {sessions.length}
          </div>
        </div>
        <div>
          <div className="text-subtle">总 CPU</div>
          <div className="text-fg font-medium tabular-nums">
            {perf ? `${fmtCpu(perf.totalCpu)}%` : '—'}
          </div>
        </div>
        <div>
          <div className="text-subtle">总 RSS</div>
          <div className="text-fg font-medium tabular-nums">
            {perf ? `${totalRssMb.toFixed(1)} MB` : '—'}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-1 space-y-0.5">
        {error && (
          <div className="mx-1 mb-2 px-3 py-2 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md">
            {error}
          </div>
        )}
        {sessions.length === 0 && !error && (
          <div className="px-3 py-6 text-xs text-muted text-center">
            没有活跃的 session。
            <br />
            启动一个 AI 或 shell session 后才会采样。
          </div>
        )}
        {sessions.map((s) => (
          <PerfRow key={s.sessionId} sample={s} rssMax={rssMaxRef.current} />
        ))}
      </div>

      <div className="px-3 py-1.5 text-[10px] text-subtle border-t border-border/40">
        每 {POLL_MS / 1000}s 刷新一次 · 仅主进程，AI 派生子进程未计
      </div>
    </div>
  )
}
