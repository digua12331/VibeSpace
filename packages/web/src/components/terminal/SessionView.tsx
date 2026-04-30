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
import { logAction, pushLog } from '../../logs'
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
import { BUILTIN_SHELL_AGENTS, type AgentKind, type Session } from '../../types'
import InputMenu from './InputMenu'
import { getSlashCommands } from './slashCommands'

// 多行裸文本送进 PTY 时，Claude Code / Codex / Gemini 等 ink-based TUI 会把
// 内嵌的 \n 当成"用户在 prompt 里手敲多行"，光标停在最后一行，后面的 \r
// 不算"干净的单行 Enter"所以不触发提交——表现就是文本进了 agent 的 prompt
// 框但没发送出去。bracketed paste 序列 (\x1b[200~ ... \x1b[201~) 是终端协议里
// "这段是一次粘贴"的标准信号，与 xterm Ctrl+V 在物理终端里的行为对齐。
// pwsh/cmd/shell 等纯 shell 不一定支持，会把 markers 当字面字符显示，所以
// 只对非 shell agent 启用。
const BRACKETED_PASTE_BEGIN = '\x1b[200~'
const BRACKETED_PASTE_END = '\x1b[201~'

function supportsBracketedPaste(agent: AgentKind): boolean {
  return !(BUILTIN_SHELL_AGENTS as readonly string[]).includes(agent)
}

function wrapBracketedPaste(agent: AgentKind, text: string): string {
  if (!text.includes('\n') || !supportsBracketedPaste(agent)) return text
  return BRACKETED_PASTE_BEGIN + text + BRACKETED_PASTE_END
}

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

// xterm `disableStdin: true` 把所有按键吞掉，但 TUI 菜单（AskUserQuestion / inquirer
// / npm prompt 等）需要这些导航键直达 PTY。条件命中下手动发对应 ANSI 序列。
// 仅 Normal Cursor Mode；Application Mode 序列（如 \x1bOA）不支持。
const TUI_PASSTHROUGH_KEYMAP: Readonly<Record<string, string>> = {
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
  ArrowRight: '\x1b[C',
  ArrowLeft: '\x1b[D',
  Enter: '\r',
  Tab: '\t',
  Escape: '\x1b',
  Backspace: '\x7f',
  Home: '\x1b[H',
  End: '\x1b[F',
  PageUp: '\x1b[5~',
  PageDown: '\x1b[6~',
}

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
async function handleClipboardPaste(session: Session): Promise<void> {
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
        const r = await logAction(
          'paste-image',
          'upload',
          () =>
            api.uploadPastedImage(
              session.projectId,
              session.id,
              hit.blob,
              hit.mime,
            ),
          {
            projectId: session.projectId,
            sessionId: session.id,
            meta: { mime: hit.mime, bytes: hit.blob.size, source: 'terminal' },
          },
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

  // Step 2: no image detected — 直接把文本丢给后端。注意：不能走 term.paste(text)，
  // 因为我们开了 disableStdin，xterm 的 triggerDataEvent 在那种状态下会静默 no-op。
  try {
    const text = await navigator.clipboard.readText()
    if (text) aimonWS.sendInput(session.id, wrapBracketedPaste(session.agent, text))
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
  const pendingInput = useStore((s) => s.pendingInputBySession[session.id])
  const consumePendingInput = useStore((s) => s.consumePendingInput)
  const setInputDraft = useStore((s) => s.setInputDraft)
  const subagentRuns = useStore((s) => s.subagentRunsBySession[session.id]) ?? []
  const refreshSubagentRuns = useStore((s) => s.refreshSubagentRuns)
  const project = projects.find((p) => p.id === session.projectId)
  const status = liveStatus ?? session.status

  const termHostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  // IME 真实状态：onCompositionStart/End 维护，比 keydown 的 isComposing 可靠
  // —— 后者在 Chromium 上 compositionend 边界偶尔漏报，导致 Enter 被误判。
  const composingRef = useRef(false)
  const inputBarRef = useRef<HTMLDivElement | null>(null)
  const filesRef = useRef<string[] | null>(null)
  // 粘贴/填入超长文本时，原文放到这里，textarea 里只留一个占位 token，避免
  // 大文本在 DOM 里导致每次 keystroke 都 reflow + menu 扫描整个字符串。
  // 发送（Enter）时把 token 展开回原文。
  const pasteStashRef = useRef<Map<string, string>>(new Map())
  const pasteSeqRef = useRef(0)
  const resizeRafRef = useRef<number | null>(null)
  // 单实例幂等：第一次走 TUI 透传分支时打一条 INFO 进 LogsView，之后翻 true 不再打。
  // 见 attachCustomKeyEventHandler 的 TUI passthrough 分支。
  const passthroughLoggedRef = useRef(false)
  const [menu, setMenu] = useState<MenuState>({ kind: 'none' })
  const [busy, setBusy] = useState(false)
  const [showExitInfo, setShowExitInfo] = useState(true)
  const [confirmClose, setConfirmClose] = useState(false)
  const [customButtons, setCustomButtonsState] = useState<CustomButton[]>(() => getCustomButtons())

  useEffect(() => onCustomButtonsChange(setCustomButtonsState), [])

  // Poll subagent runs while this session view is active. 5s cadence matches
  // MemoryView/JobsView; subagent Task calls last 30s+ so faster polling is
  // wasted. Stops polling when the tab is not the active one.
  useEffect(() => {
    if (!active) return
    let cancelled = false
    const tick = () => {
      if (cancelled) return
      void refreshSubagentRuns(session.id)
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [active, session.id, refreshSubagentRuns])

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
      // 屏蔽终端内部的键盘输入：用户打字不会再直接流进 PTY。所有输入统一走
      // 下方的悬浮输入框（见 attachCustomKeyEventHandler 的字符转发逻辑）。
      // 副作用：xterm 的 Ctrl+C、Enter、方向键等都失效，我们在 handler 里按
      // 需要手动补回（目前只保留 Ctrl+C 终止）。
      disableStdin: true,
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
        void handleClipboardPaste(session)
        return false
      }
      // Ctrl/Cmd+C: 有选区 → 复制；无选区 → 手动发 \x03（disableStdin 会吞掉默认行为，
      // 所以必须我们自己 sendInput，否则跑飞的 AI 无法 Ctrl+C 中断）。
      const isCopyCombo =
        (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey &&
        (ev.key === 'c' || ev.key === 'C')
      if (isCopyCombo) {
        ev.preventDefault()
        if (term.hasSelection()) {
          void copySelectionToClipboard(term)
        } else {
          aimonWS.sendInput(session.id, '\x03')
        }
        return false
      }
      // TUI passthrough：xterm 区跑的 TUI 菜单（Claude Code AskUserQuestion、
      // codex/inquirer 系 prompt、npm init 之类）需要 ↑/↓/Enter/Tab/Esc 直达 PTY。
      // 守卫顺序：IME → 焦点 → textarea 为空 → 命中白名单。任一不满足 fallthrough
      // 到下方"全屏蔽"分支，绝不混进 forwardCharToInput（那条只接可打印字符）。
      // 仅 Normal Cursor Mode；Application Mode（vim/less 等）暂不支持。
      const inIme = ev.isComposing || ev.keyCode === 229
      const inputEl = inputRef.current
      const inputEmpty = inputEl?.value === ''
      const inputUnfocused = document.activeElement !== inputEl
      if (!inIme && inputEmpty && inputUnfocused) {
        const seq = TUI_PASSTHROUGH_KEYMAP[ev.key]
        if (seq !== undefined) {
          ev.preventDefault()
          aimonWS.sendInput(session.id, seq)
          if (!passthroughLoggedRef.current) {
            passthroughLoggedRef.current = true
            pushLog({
              level: 'info',
              scope: 'session',
              msg: 'tui-passthrough-enabled 开始',
              projectId: session.projectId,
              sessionId: session.id,
              meta: { firstKey: ev.key },
            })
          }
          return false
        }
      }
      // 可打印单字符（无 Ctrl/Meta/Alt 修饰；Shift 允许）→ 自动转发到悬浮输入框，
      // 并把 focus 切过去。防止用户对着终端区敲字没反馈。
      const isPrintable =
        ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey
      if (isPrintable) {
        ev.preventDefault()
        forwardCharToInput(ev.key)
        return false
      }
      // 其他键（Enter / Backspace / 方向键 / 功能键 / IME Process 等）：全部屏蔽，
      // disableStdin 会确保它们不会意外落到 PTY。
      return false
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

  // 把输入框 wrapper 的实际高度推到 termHost 的 bottom 上，这样输入框撑开到 3 行
  // 时终端区域会相应收缩。termHost 自己的 ResizeObserver（见挂载 effect）会接着
  // 触发 fit() + sendResize，cols/rows 与后端 PTY 同步更新。
  useEffect(() => {
    const bar = inputBarRef.current
    const host = termHostRef.current
    if (!bar || !host) return
    const update = () => {
      // 输入框 wrapper 的 bottom-[32px] 留了 32px 间距；termHost 的 bottom 应该留够
      // wrapper 高度 + 这 32px，才能把终端底部完全让给输入框。
      host.style.bottom = `${bar.offsetHeight + 32}px`
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(bar)
    return () => ro.disconnect()
  }, [])

  async function confirmCloseSession() {
    setBusy(true)
    try {
      await logAction(
        'session',
        'stop',
        () => api.deleteSession(session.id),
        {
          projectId: session.projectId,
          sessionId: session.id,
          meta: { agent: session.agent },
        },
      )
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

  function autoResizeInput(el: HTMLTextAreaElement) {
    // rAF 合并多次 keystroke：每次输入都直接同步读 scrollHeight 会触发
    // reflow，大批量输入时会卡。合并到下一帧统一做一次。
    if (resizeRafRef.current != null) cancelAnimationFrame(resizeRafRef.current)
    resizeRafRef.current = requestAnimationFrame(() => {
      resizeRafRef.current = null
      // max height ≈ 3× single-line wrapper (40px * 3 = 120px); textarea
      // content caps at 100px to leave the 20px wrapper padding, then the
      // wrapper grows to exactly 120px before scrollbar kicks in.
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 100)}px`
    })
  }

  // 超过此阈值的粘贴/填入按 stash 处理（显示为占位 token）。500 字符约 = 5 行
  // textarea 撑满，再多就要滚动/缩略。
  const PASTE_STASH_THRESHOLD = 500

  function stashText(text: string): string {
    const n = ++pasteSeqRef.current
    const token = `⟦粘贴·${n}·${text.length}字⟧`
    pasteStashRef.current.set(token, text)
    return token
  }

  function expandStashed(input: string): string {
    const stash = pasteStashRef.current
    if (stash.size === 0) return input
    let out = input
    stash.forEach((original, token) => {
      if (out.includes(token)) out = out.split(token).join(original)
    })
    return out
  }

  function clearStash() {
    pasteStashRef.current.clear()
    pasteSeqRef.current = 0
  }

  function fillInput(text: string) {
    const el = inputRef.current
    if (!el) return
    el.value = text.length > PASTE_STASH_THRESHOLD ? stashText(text) : text
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    autoResizeInput(el)
    setMenu({ kind: 'none' })
  }

  // 用户对着终端区按可打印键时，把字符插入到悬浮输入框当前 cursor 位置，并把
  // focus 切到悬浮框。见 xterm `attachCustomKeyEventHandler` 里的 isPrintable 分支。
  function forwardCharToInput(ch: string) {
    const el = inputRef.current
    if (!el) return
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    el.value = el.value.slice(0, start) + ch + el.value.slice(end)
    const pos = start + ch.length
    el.focus()
    el.setSelectionRange(pos, pos)
    autoResizeInput(el)
    setMenu(detectTrigger(el))
  }

  // Drains `pendingInputBySession[session.id]` from the store into the floating
  // input (appended to whatever the user has already typed). The file
  // right-click "发送到 XXX" flow uses this instead of writing straight to the
  // pty, so the user gets a chance to edit before hitting Enter.
  useEffect(() => {
    if (!pendingInput) return
    const el = inputRef.current
    if (!el) return
    fillInput(el.value + pendingInput)
    consumePendingInput(session.id)
  }, [pendingInput, session.id, consumePendingInput])

  // 切换项目会让本 SessionView 卸载（visibleSessions 按 projectId 过滤），
  // textarea 是非受控的，DOM 销毁后输入就丢了。挂载时把 store 里上次保存
  // 的草稿回填，卸载时把当前 textarea 内容存回 store。stash 占位 token 跨
  // 卸载无法还原原文，含 token 的草稿存空，避免下次出现死 token。
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const draft = useStore.getState().inputDraftBySession[session.id]
    if (draft) {
      el.value = draft
      autoResizeInput(el)
      setInputDraft(session.id, '')
    }
    return () => {
      const cur = inputRef.current
      const text = cur?.value ?? ''
      const safe = text.includes('⟦粘贴·') ? '' : text
      setInputDraft(session.id, safe)
    }
  }, [session.id, setInputDraft])

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

  function detectTrigger(el: HTMLTextAreaElement): MenuState {
    const v = el.value
    const cursor = el.selectionStart ?? v.length
    // Scan left from cursor to find the most recent trigger char or whitespace.
    // 限制最多向左扫 256 字符 —— / 或 @ 触发的 token 不会很长，超了等于没有触发，
    // 避免无空格长文本场景下每次 keystroke O(N) 扫描。
    const stop = Math.max(0, cursor - 256)
    let i = cursor - 1
    while (i >= stop) {
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
    autoResizeInput(el)
    setMenu({ kind: 'none' })
  }

  function onInputKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // IME 三重守卫：composingRef（compositionend 同步翻转，最可靠）
    // + nativeEvent.isComposing + keyCode === 229（Process 键，IME 占用）。
    // Chromium 在 IME 上屏后立即按 Enter 时，单看 isComposing 偶尔漏报；
    // 命中守卫时若是 Enter 必须 preventDefault，否则 textarea 默认行为会
    // 把 \n 插进来——这是"按一次 Enter 没发送、文本多了换行、再按一次才发"
    // 的根因。preventDefault 不会影响 IME 真正在选字时的候选确认。
    if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) {
      if (e.key === 'Enter') e.preventDefault()
      return
    }
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
      const payload = expandStashed(el.value)
      const hasNewline = payload.includes('\n')
      // 所有非 shell agent（claude / codex / gemini / opencode 等 ink-based TUI）
      // 都走"bracketed paste 包整段 + 隔一帧发 \r"，单行也走，理由见下面注释。
      const useBracketedPaste = supportsBracketedPaste(session.agent)
      // 诊断埋点：用来定位"Enter 偶尔只送达 prompt 不触发提交"。
      // composingRef / isComposing / keyCode 三个字段一起看能区分是 IME 边界
      // 漏报（值为 true 但守卫没拦住）还是 PTY/ink 侧 \r 没被识别为 submit。
      // tailHex 是 payload 末尾两个 char code，用来确认没有尾随 \n / \r 误入。
      const tailHex = Array.from(payload.slice(-2))
        .map((ch) => ch.charCodeAt(0).toString(16))
        .join(',')
      pushLog({
        level: 'info',
        scope: 'session',
        msg: 'input-submit',
        projectId: session.projectId,
        sessionId: session.id,
        meta: {
          agent: session.agent,
          len: payload.length,
          hasNewline,
          bracketedPaste: useBracketedPaste,
          tailHex,
          composingRef: composingRef.current,
          isComposing: e.nativeEvent.isComposing,
          keyCode: e.keyCode,
        },
      })
      if (useBracketedPaste) {
        // ink-based TUI（claude / codex / gemini）：单行也走 bracketed paste。
        // 原本以为只有多行才出问题，但用户实测单行 `payload\r` 一个 chunk 里
        // \r 偶尔会被 ink 当成 CR 回车字符而不是 submit 信号——表现为光标回
        // 到行首换行、文本没提交。bracketed paste 把整段标记为"一次粘贴"，
        // ink 对这种事件有专门处理，更鲁棒。隔 16ms 再发独立的 \r，给 ink
        // 一帧时间退出 paste 状态机后再当 Enter 处理。
        aimonWS.sendInput(
          session.id,
          BRACKETED_PASTE_BEGIN + payload + BRACKETED_PASTE_END,
        )
        setTimeout(() => {
          aimonWS.sendInput(session.id, '\r')
        }, 16)
      } else {
        // shell（pwsh / cmd / shell）不识别 bracketed paste 序列，会把
        // \x1b[200~ 当字面字符显示。维持原行为：text + \r 一次性发出去。
        aimonWS.sendInput(session.id, payload + '\r')
      }
      el.value = ''
      clearStash()
      autoResizeInput(el)
      setMenu({ kind: 'none' })
      // 用户在终端往上滑看历史后回到输入框发送，xterm 默认会停在原滚动位置；
      // 主动跳回底部，让回车后立刻看到自己刚发的内容和 agent 的反馈。
      termRef.current?.scrollToBottom()
    }
  }

  function onInputChange(e: React.FormEvent<HTMLTextAreaElement>) {
    // React's onInput fires after composition end, so `isComposing` is false
    // here in normal use. Guard anyway for safety.
    const ne = e.nativeEvent as InputEvent
    if (ne.isComposing) return
    autoResizeInput(e.currentTarget)
    const next = detectTrigger(e.currentTarget)
    setMenu(next)
  }

  function onInputPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items
    if (!items) return
    let imageItem: DataTransferItem | null = null
    for (const it of items) {
      if (PASTE_IMAGE_MIMES.has(it.type)) {
        imageItem = it
        break
      }
    }
    // 没有图片：判断是否为超长文本，若是则换成 token 占位，避免 textarea 撑爆。
    if (!imageItem) {
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (text.length <= PASTE_STASH_THRESHOLD) return
      e.preventDefault()
      const el = e.currentTarget
      const token = stashText(text)
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? el.value.length
      const before = el.value.slice(0, start)
      const after = el.value.slice(end)
      el.value = before + token + after
      const cursor = (before + token).length
      el.setSelectionRange(cursor, cursor)
      el.focus()
      autoResizeInput(el)
      setMenu(detectTrigger(el))
      return
    }
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
        const r = await logAction(
          'paste-image',
          'upload',
          () => api.uploadPastedImage(session.projectId, session.id, blob, mime),
          {
            projectId: session.projectId,
            sessionId: session.id,
            meta: { mime, bytes: blob.size, source: 'input-box' },
          },
        )
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
        autoResizeInput(el)
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
                      onClick={() => {
                        aimonWS.sendInput(
                          session.id,
                          wrapBracketedPaste(session.agent, cmd) + '\r',
                        )
                        pushLog({
                          level: 'info',
                          scope: 'session',
                          msg: `quick-button 发送 ${b.text}`,
                          projectId: session.projectId,
                          sessionId: session.id,
                          meta: { buttonId: b.id, agent: session.agent, cmd },
                        })
                      }}
                      disabled={busy}
                      title={`发送到 ${session.agent}: ${cmd}`}
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

      {subagentRuns.length > 0 && (
        <div className="flex items-center gap-1.5 px-3 py-1 border-b border-border/40 bg-violet-500/[0.04] overflow-x-auto whitespace-nowrap">
          <span className="text-[10px] text-violet-300/80 shrink-0 mr-1">
            🤖 子工:
          </span>
          {subagentRuns.slice(0, 10).map((r) => {
            const isRunning = r.state === 'running'
            const ms = r.endedAt ? r.endedAt - r.startedAt : Date.now() - r.startedAt
            const desc = r.description.length > 12
              ? r.description.slice(0, 12) + '…'
              : r.description || r.subagentType
            return (
              <button
                key={r.id}
                onClick={() => {
                  const lines: string[] = []
                  lines.push(`类型: ${r.subagentType}`)
                  lines.push(`状态: ${r.state}${isRunning ? '' : ` (${ms}ms)`}`)
                  if (r.description) lines.push(`描述: ${r.description}`)
                  if (r.prompt) {
                    lines.push('')
                    lines.push('Prompt:')
                    lines.push(r.prompt)
                    if (r.promptTruncated) lines.push('… (服务端截断到 1KB)')
                  }
                  void alertDialog(lines.join('\n'), { title: '子 agent 详情' })
                }}
                title={r.description || r.subagentType}
                className={`text-[11px] px-1.5 py-0.5 rounded border whitespace-nowrap shrink-0 ${
                  isRunning
                    ? 'border-violet-400/50 bg-violet-500/15 text-violet-200 animate-pulse-soft'
                    : 'border-border bg-white/[0.03] text-muted hover:text-fg'
                }`}
              >
                📌 {desc}
                {!isRunning && (
                  <span className="ml-1 text-[10px] text-subtle">{ms}ms</span>
                )}
              </button>
            )
          })}
          {subagentRuns.length > 10 && (
            <span className="text-[10px] text-subtle shrink-0">
              +{subagentRuns.length - 10}
            </span>
          )}
        </div>
      )}

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
            // disableStdin 下 term.paste() 无效，直接 sendInput 把文本送给后端。
            navigator.clipboard
              .readText()
              .then((text) => {
                if (text) aimonWS.sendInput(session.id, wrapBracketedPaste(session.agent, text))
              })
              .catch(() => { /* clipboard blocked — silent */ })
          }}
          style={{ bottom: 72 }}
          className={`absolute top-0 left-0 right-0 bg-[#1c1c1c] p-1 ${isDead ? 'opacity-60' : ''}`}
        />

        <div
          ref={inputBarRef}
          className="absolute bottom-[32px] left-3 right-3 min-h-10 z-10 flex items-start gap-2 px-3 py-2.5 rounded-win border border-border bg-card shadow-flyout"
        >
          <span className="text-subtle text-xs leading-5">{'>'}</span>
          <textarea
            ref={inputRef}
            rows={1}
            onKeyDown={onInputKey}
            onCompositionStart={() => { composingRef.current = true }}
            onCompositionEnd={() => { composingRef.current = false }}
            onPaste={onInputPaste}
            onInput={onInputChange}
            disabled={isDead}
            placeholder={isDead ? '会话已结束' : 'type to send (Enter, Shift+Enter 换行)'}
            className="flex-1 bg-transparent text-sm font-mono leading-5 resize-none max-h-[100px] overflow-y-auto placeholder:text-subtle disabled:opacity-50 outline-none"
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
