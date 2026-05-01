import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { pushLog } from '../logs'
import type { CliEntry, CliStatusResponse, InstallJob, InstallJobState } from '../types'

interface RowState {
  jobId: string | null
  state: InstallJobState | 'idle'
  exitCode: number | null
  log: string
  expanded: boolean
}

const EMPTY_ROW: RowState = { jobId: null, state: 'idle', exitCode: null, log: '', expanded: false }

export default function CliInstallerDialog({
  open,
  onClose,
  onCatalogChanged,
}: {
  open: boolean
  onClose: () => void
  onCatalogChanged: () => void
}) {
  const [catalog, setCatalog] = useState<CliEntry[]>([])
  const [status, setStatus] = useState<CliStatusResponse | null>(null)
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'missing' | 'installed'>('all')
  const sourcesRef = useRef<Map<string, EventSource>>(new Map())
  const startedAtRef = useRef<Map<string, number>>(new Map())

  // Esc closes
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Initial fetch + cleanup of any open SSE on close
  useEffect(() => {
    if (!open) return
    void refresh()
    return () => {
      const sources = sourcesRef.current
      for (const es of sources.values()) es.close()
      sources.clear()
    }
  }, [open])

  async function refresh() {
    setLoadError(null)
    try {
      const [cat, st] = await Promise.all([api.getCliInstallerCatalog(), api.getCliInstallerStatus()])
      setCatalog(cat)
      setStatus(st)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }

  function setRow(cliId: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [cliId]: { ...(prev[cliId] ?? EMPTY_ROW), ...patch } }))
  }

  function attachStream(cliId: string, jobId: string) {
    // Close any prior stream for this CLI
    const prior = sourcesRef.current.get(cliId)
    if (prior) prior.close()

    const es = new EventSource(api.installJobStreamUrl(jobId))
    sourcesRef.current.set(cliId, es)
    es.addEventListener('snapshot', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as Pick<InstallJob, 'log' | 'state' | 'exitCode'>
        setRow(cliId, { log: data.log, state: data.state, exitCode: data.exitCode })
      } catch {
        /* ignore */
      }
    })
    es.addEventListener('log', (ev) => {
      try {
        const chunk = JSON.parse((ev as MessageEvent).data) as string
        setRows((prev) => {
          const cur = prev[cliId] ?? EMPTY_ROW
          return { ...prev, [cliId]: { ...cur, log: cur.log + chunk } }
        })
      } catch {
        /* ignore */
      }
    })
    es.addEventListener('exit', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { exitCode: number | null; state: InstallJobState }
        setRow(cliId, { state: data.state, exitCode: data.exitCode })
        const startedAt = startedAtRef.current.get(cliId)
        const ms = startedAt ? Math.round(performance.now() - startedAt) : null
        startedAtRef.current.delete(cliId)
        if (data.state === 'done') {
          pushLog({
            level: 'info',
            scope: 'installer',
            msg: `install 成功 (${ms ?? '?'}ms)`,
            meta: { cliId, ms, exitCode: data.exitCode },
          })
          // Re-detect installed status, then notify the menu so the new CLI appears.
          void api.getCliInstallerStatus().then(setStatus)
          onCatalogChanged()
        } else if (data.state === 'failed') {
          pushLog({
            level: 'error',
            scope: 'installer',
            msg: `install 失败: exit=${data.exitCode ?? 'null'}`,
            meta: { cliId, ms, exitCode: data.exitCode },
          })
        } else if (data.state === 'cancelled') {
          pushLog({
            level: 'warn',
            scope: 'installer',
            msg: `install 取消 (${ms ?? '?'}ms)`,
            meta: { cliId, ms, exitCode: data.exitCode },
          })
        }
      } catch {
        /* ignore */
      } finally {
        es.close()
        sourcesRef.current.delete(cliId)
      }
    })
    es.onerror = () => {
      // Connection dropped; the job may still be running but we lose live tail.
      es.close()
      sourcesRef.current.delete(cliId)
    }
  }

  async function install(entry: CliEntry) {
    if (!entry.installCmd) return
    const missingReq = (entry.requires ?? []).filter((r) => status && status.requires[r] === false)
    if (missingReq.length > 0) {
      setRow(entry.id, {
        state: 'failed',
        exitCode: -1,
        log: `本机缺少依赖工具: ${missingReq.join(', ')}\n请先安装后再试。\n`,
        expanded: true,
      })
      pushLog({
        level: 'error',
        scope: 'installer',
        msg: `install 失败: 缺少依赖 ${missingReq.join(', ')}`,
        meta: { cliId: entry.id, missing: missingReq },
      })
      return
    }
    const startedAt = performance.now()
    startedAtRef.current.set(entry.id, startedAt)
    setRow(entry.id, { state: 'running', log: '', exitCode: null, expanded: true })
    pushLog({
      level: 'info',
      scope: 'installer',
      msg: `install 开始`,
      meta: { cliId: entry.id, cmd: entry.installCmd },
    })
    try {
      const { jobId } = await api.startCliInstall(entry.id)
      setRow(entry.id, { jobId })
      attachStream(entry.id, jobId)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const ms = Math.round(performance.now() - startedAt)
      startedAtRef.current.delete(entry.id)
      setRow(entry.id, { state: 'failed', exitCode: -1, log: msg, expanded: true })
      pushLog({
        level: 'error',
        scope: 'installer',
        msg: `install 失败: ${msg}`,
        meta: { cliId: entry.id, ms, error: { message: msg } },
      })
    }
  }

  async function cancel(cliId: string) {
    const row = rows[cliId]
    if (!row?.jobId) return
    try {
      await api.cancelInstallJob(row.jobId)
    } catch {
      /* ignore — server returns 404 if already finished */
    }
  }

  if (!open) return null
  const platform = status?.platform ?? '?'
  const requires = status?.requires ?? {}
  const missingTools = Object.entries(requires)
    .filter(([, v]) => !v)
    .map(([k]) => k)

  const filtered = catalog.filter((e) => {
    if (filter === 'all') return true
    const installed = !!status?.cli[e.id]?.installed
    return filter === 'installed' ? installed : !installed
  })

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[760px] max-w-[95vw] max-h-[85vh] fluent-acrylic rounded-win shadow-dialog flex flex-col animate-fluent-in"
      >
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
          <div>
            <div className="text-base font-display font-semibold">📦 安装 AI CLI</div>
            <div className="text-xs text-muted mt-0.5">
              平台: {platform}
              {missingTools.length > 0 && (
                <span className="ml-3 text-amber-300">
                  缺少工具: {missingTools.join(', ')}（依赖该工具的 CLI 将无法自动安装）
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-white/[0.04] rounded-md border border-border text-xs overflow-hidden p-0.5 gap-0.5">
              {(['all', 'missing', 'installed'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`fluent-btn px-2 py-1 rounded ${
                    filter === k
                      ? 'bg-accent/20 text-accent'
                      : 'hover:bg-white/[0.06] text-muted'
                  }`}
                >
                  {k === 'all' ? '全部' : k === 'missing' ? '未装' : '已装'}
                </button>
              ))}
            </div>
            <button
              onClick={() => void refresh()}
              className="fluent-btn px-2 py-1 text-xs rounded-md border border-border bg-white/[0.03] hover:bg-white/[0.08]"
              title="重新检测"
            >
              ↻
            </button>
            <button
              onClick={onClose}
              className="fluent-btn px-2 py-1 text-xs rounded-md border border-border bg-white/[0.03] hover:bg-white/[0.08]"
            >
              关闭
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-3">
          {loadError && (
            <div className="mb-3 px-3 py-2 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md">
              加载失败: {loadError}
            </div>
          )}
          {filtered.length === 0 && !loadError && (
            <div className="text-center text-muted text-sm py-10">没有匹配的条目</div>
          )}
          <div className="space-y-2">
            {filtered.map((entry) => {
              const installed = !!status?.cli[entry.id]?.installed
              const row = rows[entry.id] ?? EMPTY_ROW
              const isRunning = row.state === 'running'
              const installPath = status?.cli[entry.id]?.path ?? null
              return (
                <div
                  key={entry.id}
                  className="border border-border rounded-md bg-white/[0.02] hover:bg-white/[0.04] transition-colors overflow-hidden"
                >
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{entry.label}</span>
                        {entry.builtin && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30">
                            内置
                          </span>
                        )}
                        {entry.kind === 'mcp-tool' && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 border border-violet-500/30"
                            title="MCP 工具：装好后由 mcp-bridge 自动接到 claude/codex 等 session"
                          >
                            MCP 工具
                          </span>
                        )}
                        <StatusBadge installed={installed} state={row.state} />
                      </div>
                      {entry.description && (
                        <div className="text-xs text-muted mt-0.5 truncate">
                          {entry.description}
                        </div>
                      )}
                      {installPath && (
                        <div className="text-[10px] text-subtle font-mono mt-0.5 truncate">
                          {installPath}
                        </div>
                      )}
                      {entry.installCmd && (
                        <div className="text-[10px] text-subtle font-mono mt-0.5 truncate">
                          $ {entry.installCmd}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => setRow(entry.id, { expanded: !row.expanded })}
                        className="text-xs text-muted hover:text-fg"
                        title={row.expanded ? '收起日志' : '展开日志'}
                      >
                        {row.expanded ? '▾' : '▸'}
                      </button>
                      {isRunning ? (
                        <button
                          onClick={() => void cancel(entry.id)}
                          className="fluent-btn px-2 py-1 text-xs rounded-md border border-rose-500/40 text-rose-200 bg-rose-500/10 hover:bg-rose-500/20"
                        >
                          ■ 取消
                        </button>
                      ) : (
                        <button
                          disabled={!entry.installCmd}
                          onClick={() => void install(entry)}
                          className={`fluent-btn px-2.5 py-1 text-xs rounded-md border ${
                            installed
                              ? 'border-border bg-white/[0.03] text-muted hover:bg-white/[0.08]'
                              : 'bg-accent text-on-accent font-medium hover:bg-accent-2 border-accent/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                          title={!entry.installCmd ? `当前平台 ${platform} 暂无安装命令` : ''}
                        >
                          {installed ? '↻ 重装' : '📥 安装'}
                        </button>
                      )}
                    </div>
                  </div>
                  {row.expanded && (
                    <LogPane log={row.log} state={row.state} exitCode={row.exitCode} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({
  installed,
  state,
}: {
  installed: boolean
  state: RowState['state']
}) {
  if (state === 'running') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-sky-950/50 text-sky-300 border border-sky-800/50">
        <span className="animate-pulse">●</span> 安装中
      </span>
    )
  }
  if (state === 'failed') {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/50 text-rose-300 border border-rose-900">
        ❌ 失败
      </span>
    )
  }
  if (state === 'cancelled') {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/40 text-amber-300 border border-amber-900">
        ⊘ 已取消
      </span>
    )
  }
  if (installed) {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950/40 text-emerald-300 border border-emerald-900">
        ✅ 已安装
      </span>
    )
  }
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg/60 text-muted border border-border">
      ⚪ 未安装
    </span>
  )
}

function LogPane({
  log,
  state,
  exitCode,
}: {
  log: string
  state: RowState['state']
  exitCode: number | null
}) {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (!ref.current) return
    ref.current.scrollTop = ref.current.scrollHeight
  }, [log])
  return (
    <div className="border-t border-border bg-black/40">
      <pre
        ref={ref}
        className="m-0 px-3 py-2 text-[11px] font-mono text-fg/90 whitespace-pre-wrap break-words overflow-auto"
        style={{ maxHeight: 220 }}
      >
        {log || (state === 'idle' ? '(尚未运行)' : '(等待输出…)')}
      </pre>
      {state !== 'running' && state !== 'idle' && (
        <div className="px-3 py-1 text-[10px] text-muted border-t border-border">
          state={state}
          {exitCode !== null && ` · exit=${exitCode}`}
        </div>
      )}
    </div>
  )
}
