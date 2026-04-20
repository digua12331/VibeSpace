import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { aimonWS } from '../ws'
import { useStore } from '../store'
import { pushLog } from '../logs'
import type { AgentKind, CliEntry, CliStatusResponse, Session } from '../types'
import CliInstallerDialog from './CliInstallerDialog'

interface AgentRow {
  id: string
  label: string
  emoji: string
  installed: boolean
  builtin?: boolean
  homepage?: string
}

const SHELL_ROWS: AgentRow[] = [
  { id: 'shell', label: '终端 (默认)', emoji: '💻', installed: true },
  { id: 'cmd', label: 'cmd', emoji: '🪟', installed: true },
  { id: 'pwsh', label: 'PowerShell', emoji: '⚡', installed: true },
]

const EMOJI_BY_ID: Record<string, string> = {
  claude: '🤖',
  codex: '🤖',
  gemini: '✨',
  opencode: '🧠',
  qoder: '🧩',
  kilo: '🐤',
}

export default function StartSessionMenu({
  projectId,
  onStarted,
  triggerLabel = '▶ 启动',
  compact = false,
}: {
  projectId: string | null
  onStarted?: (s: Session) => void
  triggerLabel?: string
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [installerOpen, setInstallerOpen] = useState(false)
  const [busy, setBusy] = useState<AgentKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<CliEntry[]>([])
  const [status, setStatus] = useState<CliStatusResponse | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const addSession = useStore((s) => s.addSession)
  const disabled = projectId === null

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  // Pull catalog + status whenever the menu opens or after an install completes.
  useEffect(() => {
    let cancelled = false
    void Promise.all([api.getCliInstallerCatalog(), api.getCliInstallerStatus()])
      .then(([cat, st]) => {
        if (cancelled) return
        setCatalog(cat)
        setStatus(st)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          pushLog({
            level: 'warn',
            scope: 'installer',
            msg: `读取 CLI 目录失败: ${err instanceof Error ? err.message : String(err)}`,
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [refreshTick])

  async function start(agent: AgentKind) {
    if (!projectId) return
    setBusy(agent)
    setError(null)
    pushLog({
      level: 'info',
      scope: 'session',
      projectId,
      msg: `请求启动 ${agent} session`,
    })
    try {
      const s = await api.createSession({ projectId, agent })
      addSession(s)
      aimonWS.subscribe([s.id])
      onStarted?.(s)
      pushLog({
        level: 'info',
        scope: 'session',
        projectId,
        sessionId: s.id,
        msg: `${agent} session 已创建 (pid=${s.pid ?? '?'})`,
      })
      setOpen(false)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      pushLog({
        level: 'error',
        scope: 'session',
        projectId,
        msg: `启动 ${agent} 失败: ${msg}`,
      })
    } finally {
      setBusy(null)
    }
  }

  const cliRows: AgentRow[] = catalog.map((e) => ({
    id: e.id,
    label: e.label,
    emoji: EMOJI_BY_ID[e.id] ?? '🤖',
    installed: !!status?.cli[e.id]?.installed,
    builtin: e.builtin,
    homepage: e.homepage,
  }))
  const installedCli = cliRows.filter((r) => r.installed)
  const missingCount = cliRows.length - installedCli.length

  return (
    <>
      <div className="relative inline-flex items-center gap-1" ref={ref}>
        <button
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className={`fluent-btn ${compact ? 'px-2 py-0.5' : 'px-3 py-1.5'} text-sm rounded-md border ${
            disabled
              ? 'border-border text-muted cursor-not-allowed opacity-50'
              : compact
                ? 'border-border text-muted hover:text-fg hover:bg-white/[0.04]'
                : 'bg-accent text-[#003250] font-medium hover:bg-accent-2 border-accent/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
          }`}
          title={disabled ? '先在左侧选择一个项目' : '启动新 session'}
        >
          {triggerLabel}
        </button>
        <button
          onClick={() => setInstallerOpen(true)}
          className="fluent-btn px-2 py-1.5 text-sm rounded-md border border-border bg-white/[0.03] hover:bg-white/[0.08]"
          title="安装 / 管理 AI CLI"
        >
          📦
          {missingCount > 0 && (
            <span className="ml-1 text-[10px] text-amber-300">+{missingCount}</span>
          )}
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-2 w-60 fluent-acrylic rounded-win shadow-flyout z-20 py-1 animate-fluent-in">
            <div className="px-3 pt-1.5 pb-1 text-[10px] uppercase tracking-[0.1em] text-subtle">
              AI Agent
            </div>
            {installedCli.length === 0 ? (
              <div className="px-3 py-3 text-xs text-muted">
                还没有可用的 CLI。
                <button
                  onClick={() => {
                    setOpen(false)
                    setInstallerOpen(true)
                  }}
                  className="block mt-2 text-accent hover:underline"
                >
                  📦 去安装一个
                </button>
              </div>
            ) : (
              installedCli.map((r) => (
                <button
                  key={r.id}
                  onClick={() => void start(r.id)}
                  disabled={busy !== null}
                  className="fluent-btn w-full text-left px-3 py-2 mx-1 rounded text-sm hover:bg-white/[0.06] disabled:opacity-50 flex items-center justify-between"
                  style={{ width: 'calc(100% - 0.5rem)' }}
                >
                  <span>
                    {r.emoji} {r.label}
                  </span>
                  {busy === r.id && <span className="text-xs text-subtle">...</span>}
                </button>
              ))
            )}
            <div className="mx-2 my-1 h-px bg-white/[0.08]" />
            <div className="px-3 py-1 text-[10px] uppercase tracking-[0.1em] text-subtle">
              终端 Shell
            </div>
            {SHELL_ROWS.map((r) => (
              <button
                key={r.id}
                onClick={() => void start(r.id)}
                disabled={busy !== null}
                className="fluent-btn w-full text-left px-3 py-2 mx-1 rounded text-sm hover:bg-white/[0.06] disabled:opacity-50"
                style={{ width: 'calc(100% - 0.5rem)' }}
                title={
                  r.id === 'shell'
                    ? '平台默认 shell (Windows: cmd, *nix: $SHELL)'
                    : r.id === 'pwsh'
                      ? '优先 pwsh.exe，其次 powershell.exe'
                      : undefined
                }
              >
                {r.emoji} {r.label} {busy === r.id && '...'}
              </button>
            ))}
            <div className="mx-2 my-1 h-px bg-white/[0.08]" />
            <button
              onClick={() => {
                setOpen(false)
                setInstallerOpen(true)
              }}
              className="fluent-btn w-full text-left px-3 py-2 mx-1 rounded text-xs text-muted hover:bg-white/[0.06]"
              style={{ width: 'calc(100% - 0.5rem)' }}
            >
              📦 安装更多 CLI…
              {missingCount > 0 && (
                <span className="ml-1 text-amber-300">({missingCount} 项可装)</span>
              )}
            </button>
            {error && (
              <div className="px-3 py-2 text-xs text-rose-300 border-t border-white/[0.08]">{error}</div>
            )}
          </div>
        )}
      </div>
      <CliInstallerDialog
        open={installerOpen}
        onClose={() => setInstallerOpen(false)}
        onCatalogChanged={() => setRefreshTick((t) => t + 1)}
      />
    </>
  )
}
