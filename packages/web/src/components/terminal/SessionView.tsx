import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { aimonWS } from '../../ws'
import { useStore } from '../../store'
import * as api from '../../api'
import StatusBadge from '../StatusBadge'
import PermissionsDrawer from '../PermissionsDrawer'
import { alertDialog, confirmDialog } from '../dialog/DialogHost'
import { formatForSession } from '../fileContextMenu'
import { openContextMenu, type ContextMenuItem } from '../ContextMenu'
import PromptLibraryDialog from '../PromptLibraryDialog'
import {
  BUTTON_COLOR_CLASSES,
  getCustomButtons,
  onCustomButtonsChange,
  resolveCommand,
  type CustomButton,
} from '../../customButtons'
import type { AgentKind, Session } from '../../types'
import InputMenu from './InputMenu'
import { getSlashCommands } from './slashCommands'

type MenuState =
  | { kind: 'none' }
  | { kind: 'slash'; trigger: number; filter: string; selected: number }
  | { kind: 'mention'; trigger: number; filter: string; selected: number }

const PASTE_IMAGE_MIMES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])
const PASTE_IMAGE_MAX_BYTES = 5 * 1024 * 1024

async function findImageInClipboard(
  items: ClipboardItem[],
): Promise<{ blob: Blob; mime: string } | null> {
  for (const item of items) {
    for (const type of item.types) {
      if (PASTE_IMAGE_MIMES.has(type)) {
        try {
          const blob = await item.getType(type)
          return { blob, mime: type }
        } catch {
          // Move on to next item — getType can throw for stale ClipboardItems.
        }
      }
    }
  }
  return null
}

/**
 * Unified paste handler — image first, text fallback. Extracted out of the
 * useEffect body so the logic doesn't inflate the terminal setup block.
 */
async function handleClipboardPaste(
  session: Session,
  term: Terminal,
): Promise<void> {
  // Step 1: try to locate an image on the clipboard.
  let items: ClipboardItem[] | null = null
  try {
    items = await navigator.clipboard.read()
  } catch {
    // Permission denied / non-secure context — no way to even check for
    // images. Fall through to the legacy text path below.
  }

  if (items) {
    const hit = await findImageInClipboard(items)
    if (hit) {
      if (hit.blob.size > PASTE_IMAGE_MAX_BYTES) {
        await alertDialog(
          `图片超过 5 MB 上限（实际 ${(hit.blob.size / 1024 / 1024).toFixed(1)} MB）。Claude 视觉 API 单图 ≤ 5 MB。`,
          { title: '图片过大', variant: 'danger' },
        )
        return
      }
      try {
        const r = await api.uploadPastedImage(
          session.projectId,
          session.id,
          hit.blob,
          hit.mime,
        )
        aimonWS.sendInput(
          session.id,
          formatForSession(session.agent, r.relPath, 'file'),
        )
      } catch (e: unknown) {
        await alertDialog(
          `上传图片失败: ${e instanceof Error ? e.message : String(e)}`,
          { title: '粘贴失败', variant: 'danger' },
        )
      }
      return
    }
  }

  // Step 2: no image detected — legacy text paste.
  try {
    const text = await navigator.clipboard.readText()
    if (text) term.paste(text)
  } catch {
    // Clipboard blocked — silent; user can use the "type to send" input.
  }
}

async function copySelectionToClipboard(term: Terminal): Promise<void> {
  const sel = term.getSelection()
  if (!sel) return
  try {
    await navigator.clipboard.writeText(sel)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = sel
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
    } finally {
      document.body.removeChild(ta)
    }
  }
  term.clearSelection()
}

function buildTerminalSelectionMenu(
  selection: string,
  onCopy: () => void,
  onAppendToInput: (text: string) => void,
): ContextMenuItem[] {
  return [
    { label: '复制', icon: '📋', onSelect: onCopy },
    { label: '添加到终端聊天', icon: '➕', onSelect: () => onAppendToInput(selection) },
  ]
}

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
  const [promptLibOpen, setPromptLibOpen] = useState(false)
  const liveStatus = useStore((s) => s.liveStatus[session.id])
  const isNotifying = useStore((s) => s.notifyingSessions.has(session.id))
  const clearNotify = useStore((s) => s.clearNotify)
  const project = projects.find((p) => p.id === session.projectId)
  const status = liveStatus ?? session.status

  const termHostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const filesRef = useRef<string[] | null>(null)
  const [menu, setMenu] = useState<MenuState>({ kind: 'none' })
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

    // Unicode 11 widths — must load before first render so CJK + emoji
    // occupy the correct cell count (default `6` truncates wide chars).
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'

    term.open(host)

    // WebGL renderer loads after `open()` because it needs the host element
    // in the DOM to grab a canvas. If the browser loses GPU context
    // (e.g. tab backgrounded for long, driver reset), fall back by disposing
    // the addon — xterm reverts to the DOM renderer automatically.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      // Some headless / old browsers can't create a WebGL context; silently
      // stay on DOM renderer.
    }

    try { fit.fit() } catch { /* ignore */ }
    termRef.current = term
    fitRef.current = fit

    // Explicit paste handling. Xterm's default paste relies on the browser
    // firing a `paste` event on the hidden helper textarea, which is flaky
    // across focus states and browsers. We intercept Ctrl+V / Cmd+V and
    // read the clipboard ourselves. If an image is present we upload it to
    // the server and feed the AI agent a file reference; otherwise we fall
    // back to the existing text-paste behaviour.
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true
      const isPasteCombo =
        (ev.ctrlKey || ev.metaKey) && !ev.altKey &&
        (ev.key === 'v' || ev.key === 'V')
      if (isPasteCombo) {
        ev.preventDefault()
        void handleClipboardPaste(session, term)
        return false
      }
      // Ctrl/Cmd+C: if there's a selection, copy it instead of sending SIGINT.
      // No selection → let xterm emit 0x03 as usual.
      const isCopyCombo =
        (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey &&
        (ev.key === 'c' || ev.key === 'C')
      if (isCopyCombo && term.hasSelection()) {
        ev.preventDefault()
        void copySelectionToClipboard(term)
        return false
      }
      return true
    })

    const dataDisposable = term.onData((d) => {
      aimonWS.sendInput(session.id, d)
    })

    // Δh < 4px (under one xterm row) is IME / sub-pixel noise, not a real splitter drag — ignore.
    let prevW = host.clientWidth
    let prevH = host.clientHeight
    const ro = new ResizeObserver(() => {
      if (!fitRef.current || !termRef.current) return
      const w = host.clientWidth
      const h = host.clientHeight
      if (Math.abs(w - prevW) < 1 && Math.abs(h - prevH) < 4) return
      prevW = w
      prevH = h
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
    if (!active) {
      setMenu({ kind: 'none' })
      return
    }
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

  function fillInput(text: string) {
    const el = inputRef.current
    if (!el) return
    el.value = text
    el.focus()
    el.setSelectionRange(text.length, text.length)
    setMenu({ kind: 'none' })
  }

  function ensureFilesLoaded() {
    if (filesRef.current !== null) return
    filesRef.current = []
    void (async () => {
      try {
        const r = await api.listProjectFiles(session.projectId)
        filesRef.current = r.files.map((f) => f.path)
        // Re-trigger detection if mention menu is still open with stale empty list.
        const el = inputRef.current
        if (el && document.activeElement === el) {
          const next = detectTrigger(el)
          setMenu(next)
        }
      } catch {
        // On failure keep filesRef as [] so mention menu shows "无匹配".
      }
    })()
  }

  function detectTrigger(el: HTMLInputElement): MenuState {
    const v = el.value
    const cursor = el.selectionStart ?? v.length
    // Scan left from cursor to find the most recent trigger char or whitespace.
    let i = cursor - 1
    while (i >= 0) {
      const ch = v[i]
      if (ch === ' ' || ch === '\t' || ch === '\n') return { kind: 'none' }
      if (ch === '/') {
        // Valid slash only when `/` is at start of input or preceded by whitespace.
        const prev = i > 0 ? v[i - 1] : ''
        const atBoundary = i === 0 || prev === ' ' || prev === '\t' || prev === '\n'
        if (!atBoundary) return { kind: 'none' }
        if (getSlashCommands(session.agent).length === 0) return { kind: 'none' }
        return {
          kind: 'slash',
          trigger: i,
          filter: v.slice(i, cursor),
          selected: 0,
        }
      }
      if (ch === '@') {
        const prev = i > 0 ? v[i - 1] : ''
        const atBoundary = i === 0 || prev === ' ' || prev === '\t' || prev === '\n'
        if (!atBoundary) return { kind: 'none' }
        ensureFilesLoaded()
        return {
          kind: 'mention',
          trigger: i,
          filter: v.slice(i + 1, cursor),
          selected: 0,
        }
      }
      i--
    }
    return { kind: 'none' }
  }

  function getMenuItems(state: MenuState): string[] {
    if (state.kind === 'slash') {
      const all = getSlashCommands(session.agent)
      const q = state.filter.toLowerCase()
      return all.filter((c) => c.toLowerCase().startsWith(q))
    }
    if (state.kind === 'mention') {
      const files = filesRef.current ?? []
      if (!state.filter) return files.slice(0, 200)
      const q = state.filter.toLowerCase()
      return files.filter((p) => p.toLowerCase().includes(q)).slice(0, 200)
    }
    return []
  }

  function pickItem(index: number) {
    if (index < 0) {
      setMenu({ kind: 'none' })
      return
    }
    const state = menu
    if (state.kind === 'none') return
    const items = getMenuItems(state)
    if (index >= items.length) return
    const picked = items[index]
    const el = inputRef.current
    if (!el) return
    const v = el.value
    const cursorEnd =
      state.kind === 'slash'
        ? state.trigger + state.filter.length
        : state.trigger + 1 + state.filter.length
    const replacement =
      state.kind === 'slash'
        ? picked + ' '
        : formatForSession(session.agent, picked, 'file')
    const before = v.slice(0, state.trigger)
    const after = v.slice(cursorEnd)
    const next = before + replacement + after
    el.value = next
    const pos = (before + replacement).length
    el.setSelectionRange(pos, pos)
    el.focus()
    setMenu({ kind: 'none' })
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return
    if (menu.kind !== 'none') {
      const items = getMenuItems(menu)
      if (e.key === 'Escape') {
        e.preventDefault()
        setMenu({ kind: 'none' })
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (items.length === 0) return
        setMenu({ ...menu, selected: (menu.selected + 1) % items.length })
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (items.length === 0) return
        setMenu({
          ...menu,
          selected: (menu.selected - 1 + items.length) % items.length,
        })
        return
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey) {
        e.preventDefault()
        if (items.length > 0) pickItem(menu.selected)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const el = e.currentTarget
      aimonWS.sendInput(session.id, el.value + '\r')
      el.value = ''
      setMenu({ kind: 'none' })
    }
  }

  function onInputChange(e: React.FormEvent<HTMLInputElement>) {
    // React's onInput fires after composition end, so `isComposing` is false
    // here in normal use. Guard anyway for safety.
    const ne = e.nativeEvent as InputEvent
    if (ne.isComposing) return
    const next = detectTrigger(e.currentTarget)
    setMenu(next)
  }

  function onInputPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const items = e.clipboardData?.items
    if (!items) return
    let imageItem: DataTransferItem | null = null
    for (const it of items) {
      if (PASTE_IMAGE_MIMES.has(it.type)) {
        imageItem = it
        break
      }
    }
    if (!imageItem) return
    e.preventDefault()
    const blob = imageItem.getAsFile()
    if (!blob) return
    const el = e.currentTarget
    const mime = imageItem.type
    void (async () => {
      if (blob.size > PASTE_IMAGE_MAX_BYTES) {
        await alertDialog(
          `图片超过 5 MB 上限（实际 ${(blob.size / 1024 / 1024).toFixed(1)} MB）。Claude 视觉 API 单图 ≤ 5 MB。`,
          { title: '图片过大', variant: 'danger' },
        )
        return
      }
      try {
        const r = await api.uploadPastedImage(session.projectId, session.id, blob, mime)
        const ref = formatForSession(session.agent, r.relPath, 'file')
        const start = el.selectionStart ?? el.value.length
        const end = el.selectionEnd ?? el.value.length
        const before = el.value.slice(0, start)
        const after = el.value.slice(end)
        const sep = before && !before.endsWith(' ') ? ' ' : ''
        el.value = before + sep + ref + after
        const cursor = (before + sep + ref).length
        el.setSelectionRange(cursor, cursor)
        el.focus()
      } catch (err) {
        await alertDialog(
          `上传图片失败: ${err instanceof Error ? err.message : String(err)}`,
          { title: '粘贴失败', variant: 'danger' },
        )
      }
    })()
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
      className={`absolute inset-0 flex flex-col bg-bg overflow-hidden ${ringClass}`}
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
          <button
            onClick={() => setPromptLibOpen(true)}
            title="提示词库"
            className="fluent-btn px-2 py-0.5 text-xs rounded border border-border text-muted hover:text-fg hover:bg-white/[0.05]"
          >
            📝 提示词
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
                      onClick={() => fillInput(cmd)}
                      disabled={busy}
                      title={`填入输入框: ${cmd}`}
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

      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div
          ref={termHostRef}
          onContextMenu={(e) => {
            e.preventDefault()
            const term = termRef.current
            if (term && term.hasSelection()) {
              const sel = term.getSelection()
              openContextMenu({
                x: e.clientX,
                y: e.clientY,
                items: buildTerminalSelectionMenu(
                  sel,
                  () => void copySelectionToClipboard(term),
                  (text) => {
                    queueMicrotask(() => {
                      const el = inputRef.current
                      if (!el) return
                      el.value = (el.value ? el.value + ' ' : '') + text
                      el.focus()
                      el.setSelectionRange(el.value.length, el.value.length)
                    })
                  },
                ),
              })
              return
            }
            // No selection → legacy right-click = paste from clipboard.
            navigator.clipboard
              .readText()
              .then((text) => {
                if (text && termRef.current) termRef.current.paste(text)
              })
              .catch(() => { /* clipboard blocked — silent */ })
          }}
          className={`absolute top-0 left-0 right-0 bottom-[52px] bg-[#1c1c1c] p-1 ${isDead ? 'opacity-60' : ''}`}
        />

        <div className="absolute bottom-3 left-3 right-3 h-10 z-10 flex items-center gap-2 px-3 rounded-win border border-border bg-card shadow-flyout">
          <span className="text-subtle text-xs">{'>'}</span>
          <input
            ref={inputRef}
            onKeyDown={onInputKey}
            onPaste={onInputPaste}
            onInput={onInputChange}
            disabled={isDead}
            placeholder={isDead ? '会话已结束' : 'type to send (Enter)'}
            className="flex-1 h-full leading-none bg-transparent text-sm font-mono placeholder:text-subtle disabled:opacity-50 outline-none"
            onMouseDown={() => setShowExitInfo(true)}
          />
        </div>
      </div>

      {showPerm && project && (
        <PermissionsDrawer project={project} onClose={() => setShowPerm(false)} />
      )}

      <PromptLibraryDialog
        open={promptLibOpen}
        onClose={() => setPromptLibOpen(false)}
        onSend={(text) => {
          fillInput(text)
          setPromptLibOpen(false)
        }}
      />

      <InputMenu
        open={menu.kind !== 'none'}
        anchorRef={inputRef}
        items={menu.kind === 'none' ? [] : getMenuItems(menu)}
        selectedIndex={menu.kind === 'none' ? 0 : menu.selected}
        onPick={pickItem}
        onHover={(idx) => {
          if (menu.kind === 'none') return
          setMenu({ ...menu, selected: idx })
        }}
      />

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
