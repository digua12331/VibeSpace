import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { aimonWS } from '../../ws'
import { useStore } from '../../store'
import * as api from '../../api'
import StatusBadge from '../StatusBadge'
import PermissionsDrawer from '../PermissionsDrawer'
import { alertDialog, confirmDialog } from '../dialog/DialogHost'
import {
  BUTTON_COLOR_CLASSES,
  getCustomButtons,
  onCustomButtonsChange,
  resolveCommand,
  type CustomButton,
} from '../../customButtons'
import type { AgentKind, Session } from '../../types'

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

interface Props {
  session: Session
  /** True when this view is the active tab. Others stay mounted but hidden. */
  active: boolean
  /** Called when user dismisses a stopped/crashed session or closes a live one. */
  onClose: (id: string) => void
  /** Called when user restarts; parent should swap activeSessionId to the new id. */
  onRestart: (oldId: string, newSession: Session) => void
}

export default function SessionView({ session, active, onClose, onRestart }: Props) {
  const projects = useStore((s) => s.projects)
  const [showPerm, setShowPerm] = useState(false)
  const liveStatus = useStore((s) => s.liveStatus[session.id])
  const isNotifying = useStore((s) => s.notifyingSessions.has(session.id))
  const clearNotify = useStore((s) => s.clearNotify)
  const project = projects.find((p) => p.id === session.projectId)
  const status = liveStatus ?? session.status

  const termHostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [showExitInfo, setShowExitInfo] = useState(true)
  const [confirmClose, setConfirmClose] = useState(false)
  const [customButtons, setCustomButtonsState] = useState<CustomButton[]>(() => getCustomButtons())

  useEffect(() => onCustomButtonsChange(setCustomButtonsState), [])

  useEffect(() => {
    const host = termHostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, Menlo, monospace',
      fontSize: 13,
      theme: { background: '#1c1c1c', foreground: '#ffffff', cursor: '#60cdff' },
      cursorBlink: true,
      convertEol: false,
      scrollback: 5000,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(host)
    try { fit.fit() } catch { /* ignore */ }
    termRef.current = term
    fitRef.current = fit

    // Explicit paste handling. Xterm's default paste relies on the browser
    // firing a `paste` event on the hidden helper textarea, which is flaky
    // across focus states and browsers. We intercept Ctrl+V / Cmd+V and
    // read the clipboard ourselves, then feed through `term.paste()` so
    // bracketed-paste mode is honoured.
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true
      const isPasteCombo =
        (ev.ctrlKey || ev.metaKey) && !ev.altKey &&
        (ev.key === 'v' || ev.key === 'V')
      if (isPasteCombo) {
        ev.preventDefault()
        navigator.clipboard
          .readText()
          .then((text) => {
            if (text) term.paste(text)
          })
          .catch(() => {
            // Clipboard blocked (no secure context / permission denied).
            // Silent — user can fall back to the "type to send" input below.
          })
        return false
      }
      return true
    })

    const dataDisposable = term.onData((d) => {
      aimonWS.sendInput(session.id, d)
    })

    const ro = new ResizeObserver(() => {
      if (!fitRef.current || !termRef.current) return
      try {
        fitRef.current.fit()
        aimonWS.sendResize(session.id, termRef.current.cols, termRef.current.rows)
      } catch { /* ignore */ }
    })
    ro.observe(host)

    aimonWS.subscribe([session.id])
    aimonWS.requestReplay(session.id)
    if (term.cols > 0 && term.rows > 0) {
      aimonWS.sendResize(session.id, term.cols, term.rows)
    }

    const off = aimonWS.onMessage((msg) => {
      if (msg.type === 'output' && msg.sessionId === session.id) {
        term.write(msg.data)
      } else if (msg.type === 'replay' && msg.sessionId === session.id) {
        term.reset()
        term.write(msg.data)
      }
    })

    let prevState = aimonWS.getState()
    const offConn = aimonWS.onConnectionChange((s) => {
      if (s === 'open' && prevState !== 'open') {
        aimonWS.requestReplay(session.id)
        if (term.cols > 0 && term.rows > 0) {
          aimonWS.sendResize(session.id, term.cols, term.rows)
        }
      }
      prevState = s
    })

    return () => {
      off()
      offConn()
      dataDisposable.dispose()
      ro.disconnect()
      aimonWS.unsubscribe([session.id])
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [session.id])

  // When this tab becomes active after being hidden, xterm's measured
  // dimensions are stale (display toggled). Re-fit on activation.
  useEffect(() => {
    if (!active) return
    const raf = requestAnimationFrame(() => {
      try {
        fitRef.current?.fit()
        if (termRef.current) {
          aimonWS.sendResize(session.id, termRef.current.cols, termRef.current.rows)
        }
      } catch { /* ignore */ }
    })
    return () => cancelAnimationFrame(raf)
  }, [active, session.id])

  async function confirmCloseSession() {
    setBusy(true)
    try {
      await api.deleteSession(session.id)
    } catch (e: unknown) {
      setBusy(false)
      await alertDialog(
        `关闭失败: ${e instanceof Error ? e.message : String(e)}`,
        { title: '关闭失败', variant: 'danger' },
      )
      return
    }
    onClose(session.id)
  }

  async function restart(e: React.MouseEvent) {
    if (!e.shiftKey) {
      const ok = await confirmDialog(`重启 ${session.agent} session?`, {
        title: '重启 session',
        confirmLabel: '重启',
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const next = await api.restartSession(session.id)
      onRestart(session.id, next)
    } catch (err: unknown) {
      await alertDialog(
        `重启失败: ${err instanceof Error ? err.message : String(err)}`,
        { title: '重启失败', variant: 'danger' },
      )
    } finally {
      setBusy(false)
    }
  }

  function dismiss() {
    onClose(session.id)
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      aimonWS.sendInput(session.id, inputValue + '\r')
      setInputValue('')
    }
  }

  const isDead = status === 'stopped' || status === 'crashed'
  const exitCode = session.exit_code

  const ringClass = isNotifying
    ? 'ring-1 ring-rose-500/40 animate-pulse-soft'
    : ''

  return (
    <div
      id={`session-view-${session.id}`}
      onMouseDown={() => clearNotify(session.id)}
      className={`absolute inset-0 flex flex-col bg-bg ${ringClass}`}
      style={{
        visibility: active ? 'visible' : 'hidden',
        pointerEvents: active ? 'auto' : 'none',
      }}
      aria-hidden={!active}
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 bg-white/[0.02] text-sm select-none">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-muted">{agentIcon(session.agent)} {session.agent}</span>
          <StatusBadge status={status} />
          {isDead && exitCode != null && (
            <span className="text-xs text-subtle">exit {exitCode}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowPerm(true)}
            disabled={!project}
            title="打开设置（权限 / 按钮）"
            className="fluent-btn px-2 py-0.5 text-xs rounded border border-border text-muted hover:text-fg hover:bg-white/[0.05] disabled:opacity-50"
          >
            ⚙ 设置
          </button>
          {isDead ? (
            showExitInfo && (
              <>
                <button
                  onClick={(e) => void restart(e)}
                  disabled={busy}
                  title="重启 session (Shift+Click 跳过确认)"
                  className="fluent-btn px-2 py-0.5 text-xs rounded border border-sky-500/40 text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 disabled:opacity-50"
                >
                  ⟳ 重启
                </button>
                <button
                  onClick={dismiss}
                  className="fluent-btn px-2 py-0.5 text-xs rounded border border-border text-muted hover:text-fg hover:bg-white/[0.05]"
                >
                  关闭
                </button>
              </>
            )
          ) : (
            <>
              <button
                onClick={(e) => void restart(e)}
                disabled={busy}
                title="重启 session (Shift+Click 跳过确认)"
                className="fluent-btn px-2 py-0.5 text-xs rounded border border-sky-500/40 text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 disabled:opacity-50"
              >
                ⟳ 重启
              </button>
              {customButtons
                .filter((b) => b.showInTopbar)
                .map((b) => {
                  const cmd = resolveCommand(b, session.agent)
                  if (!cmd) return null
                  return (
                    <button
                      key={b.id}
                      onClick={() => aimonWS.sendInput(session.id, cmd + '\r')}
                      disabled={busy}
                      title={`发送: ${cmd}`}
                      className={`fluent-btn px-2 py-0.5 text-xs rounded border disabled:opacity-50 ${BUTTON_COLOR_CLASSES[b.color]}`}
                    >
                      {b.text}
                    </button>
                  )
                })}
              <button
                onClick={() => setConfirmClose(true)}
                disabled={busy}
                className="fluent-btn px-2 py-0.5 text-xs rounded border border-rose-500/40 text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50"
              >
                ✕ 关闭
              </button>
            </>
          )}
        </div>
      </div>

      <div
        ref={termHostRef}
        onContextMenu={(e) => {
          // Right-click = paste from clipboard, Windows Terminal / VS Code style.
          e.preventDefault()
          navigator.clipboard
            .readText()
            .then((text) => {
              if (text && termRef.current) termRef.current.paste(text)
            })
            .catch(() => { /* clipboard blocked — silent */ })
        }}
        className={`flex-1 min-h-0 bg-[#1c1c1c] p-1 ${isDead ? 'opacity-60' : ''}`}
      />

      <div className="flex items-center gap-2 px-3 py-2 border-t border-border/60 bg-white/[0.02]">
        <span className="text-subtle text-xs">{'>'}</span>
        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={onInputKey}
          disabled={isDead}
          placeholder={isDead ? '会话已结束' : 'type to send (Enter)'}
          className="flex-1 bg-transparent text-sm font-mono placeholder:text-subtle disabled:opacity-50"
          onMouseDown={() => setShowExitInfo(true)}
        />
      </div>

      {showPerm && project && (
        <PermissionsDrawer project={project} onClose={() => setShowPerm(false)} />
      )}

      {confirmClose && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="w-[80%] max-w-xs fluent-acrylic rounded-win shadow-dialog p-4 text-sm animate-fluent-in">
            <div className="text-fg font-semibold mb-1">关闭该终端?</div>
            <div className="text-muted text-xs mb-4">
              将结束 {session.agent} session，未保存的上下文会丢失。
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmClose(false)}
                disabled={busy}
                className="fluent-btn px-3 py-1 text-xs rounded-md border border-border text-muted hover:text-fg hover:bg-white/[0.06] disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={() => void confirmCloseSession()}
                disabled={busy}
                className="fluent-btn px-3 py-1 text-xs rounded-md border border-rose-500/50 text-rose-200 bg-rose-500/15 hover:bg-rose-500/25 disabled:opacity-50"
              >
                确认关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
