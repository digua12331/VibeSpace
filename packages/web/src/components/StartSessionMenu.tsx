import { useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { aimonWS } from '../ws'
import { useStore } from '../store'
import { logAction, pushLog } from '../logs'
import type { AgentKind, CliEntry, CliStatusResponse, Session, SessionScope } from '../types'
import CliInstallerDialog from './CliInstallerDialog'

function parseGlobs(raw: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim()
    if (!s) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

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
  const [scopeEnabled, setScopeEnabled] = useState(false)
  const [rwText, setRwText] = useState('')
  const [roText, setRoText] = useState('')
  const [isolationOn, setIsolationOn] = useState(false)
  /** null = haven't probed yet; true/false once getProjectChanges replied */
  const [isGitRepo, setIsGitRepo] = useState<boolean | null>(null)
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

  // Probe whether the project root is a git repo. Cheap (1 cached call), but
  // we only do it when the menu is open (and projectId is set) to avoid
  // unnecessary work on idle UI.
  useEffect(() => {
    if (!open || !projectId) return
    let cancelled = false
    void api.getProjectChanges(projectId).then((res) => {
      if (cancelled) return
      setIsGitRepo(res.enabled === true)
    }).catch(() => {
      if (!cancelled) setIsGitRepo(null)
    })
    return () => {
      cancelled = true
    }
  }, [open, projectId])

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
    try {
      await logAction(
        'session',
        'start',
        async () => {
          const scope: SessionScope | undefined = scopeEnabled
            ? {
                enabled: true,
                readwrite: parseGlobs(rwText),
                readonly: parseGlobs(roText),
              }
            : undefined
          const isolation = isolationOn && isGitRepo ? 'worktree' : 'shared'
          const s = await api.createSession({
            projectId,
            agent,
            scope,
            isolation,
          })
          // Backend doesn't echo scope in the wire response; attach it client-side
          // so the tab badge (T9) shows immediately without waiting for a refresh.
          const enriched = scope ? { ...s, scope } : s
          addSession(enriched)
          aimonWS.subscribe([s.id])
          onStarted?.(enriched)
          return s
        },
        {
          projectId,
          meta: {
            agent,
            scoped: scopeEnabled,
            isolation: isolationOn && isGitRepo ? 'worktree' : 'shared',
          },
        },
      )
      setOpen(false)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
    } finally {
      setBusy(null)
    }
  }

  const cliRows: AgentRow[] = catalog
    // mcp-tool entries (e.g. browser-use) are not chat REPLs; they are wired
    // into running sessions via mcp-bridge. Hide them from the launch menu so
    // users do not try to spawn one as a session.
    .filter((e) => (e.kind ?? 'agent') === 'agent')
    .map((e) => ({
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
          <div className="absolute right-0 top-full mt-2 w-72 fluent-acrylic rounded-win shadow-flyout z-20 py-1 animate-fluent-in">
            <div className="px-3 pt-2 pb-1.5 border-b border-white/[0.06]">
              <label
                className={`flex items-center gap-2 text-xs cursor-pointer select-none ${
                  isGitRepo === false ? 'text-subtle cursor-not-allowed' : 'text-muted'
                }`}
                title={
                  isGitRepo === false
                    ? '非 git 项目不支持隔离'
                    : '勾选后 session 跑在独立 git worktree + 独立分支，不污染主仓 working tree'
                }
              >
                <input
                  type="checkbox"
                  checked={isolationOn && isGitRepo === true}
                  disabled={isGitRepo !== true}
                  onChange={(e) => setIsolationOn(e.target.checked)}
                  className="accent-accent"
                />
                <span>🌿 工作区隔离（独立 worktree + 分支）</span>
              </label>
              <label className="mt-1.5 flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={scopeEnabled}
                  onChange={(e) => setScopeEnabled(e.target.checked)}
                  className="accent-accent"
                />
                <span>🛡 启用施工边界</span>
              </label>
              {scopeEnabled && (
                <div className="mt-2 space-y-2">
                  <div>
                    <div className="text-[10px] text-subtle mb-0.5">
                      可写 glob（一行一个）
                    </div>
                    <textarea
                      value={rwText}
                      onChange={(e) => setRwText(e.target.value)}
                      placeholder="dev/**&#10;docs/**"
                      rows={3}
                      className="w-full text-xs font-mono bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1 focus:outline-none focus:border-accent/60"
                    />
                  </div>
                  <div>
                    <div className="text-[10px] text-subtle mb-0.5">
                      只读 glob（一行一个）
                    </div>
                    <textarea
                      value={roText}
                      onChange={(e) => setRoText(e.target.value)}
                      placeholder="core/**&#10;packages/server/**"
                      rows={3}
                      className="w-full text-xs font-mono bg-white/[0.04] border border-white/[0.08] rounded px-2 py-1 focus:outline-none focus:border-accent/60"
                    />
                  </div>
                  <p className="text-[10px] text-subtle">
                    Edit / Write / NotebookEdit 命中只读或两个列表都没命中 → 拦截。
                  </p>
                </div>
              )}
            </div>
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
