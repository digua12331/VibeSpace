import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { aimonWS } from '../ws'
import { logAction } from '../logs'
import { dispatchClaude } from '../dispatchClaude'
import { alertDialog } from './dialog/DialogHost'
import { HTML_PREVIEW_PICKER_SCRIPT } from './htmlPreviewPicker'

interface Props {
  projectId: string
  path: string
  content: string
  truncated?: boolean
}

interface Picked {
  selector: string | null
  outerHTML: string
  tag: string | null
  id: string | null
  classList: string[]
}

type DispatchTarget = 'new' | string

const DIRECT_SEND_MAX = 8_000

function wrapHtmlWithPicker(html: string): string {
  return `${html}\n<script>${HTML_PREVIEW_PICKER_SCRIPT}</script>`
}

function buildPrompt(filePath: string, picked: Picked, userText: string): string {
  const lines = [
    '请修改以下 HTML 元素：',
    '',
    `文件：${filePath}`,
  ]
  if (picked.selector) lines.push(`CSS selector：${picked.selector}`)
  if (picked.tag) lines.push(`标签：${picked.tag}`)
  if (picked.id) lines.push(`id：${picked.id}`)
  if (picked.classList.length > 0) lines.push(`class：${picked.classList.join(' ')}`)
  lines.push('元素片段：')
  lines.push('```html')
  lines.push(picked.outerHTML)
  lines.push('```')
  lines.push('')
  lines.push('修改要求：')
  lines.push(userText.trim())
  return lines.join('\n')
}

export default function HtmlPreview({ projectId, path, content, truncated }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [userText, setUserText] = useState('')
  const [target, setTarget] = useState<DispatchTarget>('new')
  const [dispatching, setDispatching] = useState(false)

  const sessions = useStore((s) => s.sessions)
  const liveStatus = useStore((s) => s.liveStatus)

  const liveSessions = useMemo(() => {
    return sessions
      .filter((s) => s.projectId === projectId)
      .filter((s) => {
        const st = liveStatus[s.id] ?? s.status
        return st !== 'stopped' && st !== 'crashed'
      })
      .sort((a, b) => a.started_at - b.started_at)
  }, [sessions, liveStatus, projectId])

  const srcDoc = useMemo(() => wrapHtmlWithPicker(content), [content])

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const iframeWin = iframeRef.current?.contentWindow
      if (!iframeWin || e.source !== iframeWin) return
      const data = e.data as Partial<Picked> & { __aiPicker__?: boolean }
      if (!data || data.__aiPicker__ !== true) return
      const payload: Picked = {
        selector: data.selector ?? null,
        outerHTML: data.outerHTML ?? '',
        tag: data.tag ?? null,
        id: data.id ?? null,
        classList: Array.isArray(data.classList) ? data.classList : [],
      }
      void logAction(
        'html-preview',
        'pick-element',
        async () => {
          setPicked(payload)
          setUserText('')
        },
        { projectId, meta: { path, selector: payload.selector, tag: payload.tag } },
      )
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [projectId, path])

  function closeDialog() {
    setPicked(null)
    setUserText('')
  }

  async function onDispatch() {
    if (!picked || !userText.trim() || dispatching) return
    const prompt = buildPrompt(path, picked, userText)
    const wantDirect = target !== 'new'
    const needFallbackToNew = wantDirect && prompt.length > DIRECT_SEND_MAX
    setDispatching(true)
    try {
      await logAction(
        'html-preview',
        'dispatch-modification',
        async () => {
          if (wantDirect && !needFallbackToNew) {
            const sid = target
            const live = liveSessions.some((s) => s.id === sid)
            if (!live) throw new Error('目标终端已不存在或已停止')
            aimonWS.sendInput(sid, prompt + '\r')
            await alertDialog('已发送到终端（按回车提交）。', {
              title: '已派单',
            })
          } else {
            const successTitle =
              wantDirect && needFallbackToNew
                ? '已降级为新建终端（内容超过直发上限）'
                : '已派 Claude 处理此元素'
            await dispatchClaude({ projectId, prompt, successTitle })
          }
          closeDialog()
        },
        {
          projectId,
          meta: {
            path,
            selector: picked.selector,
            target: wantDirect ? 'direct' : 'new',
            promptLen: prompt.length,
            fallback: needFallbackToNew,
          },
        },
      )
    } catch {
      /* alertDialog already shown inside dispatchClaude or by throw above */
    } finally {
      setDispatching(false)
    }
  }

  return (
    <div className="relative w-full h-full flex flex-col">
      {truncated && (
        <div className="px-3 py-1.5 text-[11px] text-amber-300 bg-amber-500/10 border-b border-amber-600/40">
          ⚠ 文件已截断；预览可能不完整
        </div>
      )}
      <div className="px-3 py-1 text-[10px] text-subtle border-b border-border/40 bg-black/20">
        沙箱预览（相对资源未处理）。点击任意元素 → 填写修改要求 → 派单给 Claude。
      </div>
      <iframe
        ref={iframeRef}
        title="html-preview"
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        className="flex-1 w-full bg-white border-0"
      />

      {picked && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60">
          <div className="w-[560px] max-w-[90%] max-h-[85%] flex flex-col rounded-lg border border-border bg-bg shadow-xl">
            <div className="px-4 py-2.5 border-b border-border/60 flex items-center justify-between">
              <span className="text-sm font-medium">发送修改请求</span>
              <button
                onClick={closeDialog}
                className="w-6 h-6 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.08]"
                title="取消"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto px-4 py-3 space-y-3 text-[12.5px]">
              <div>
                <div className="text-[10px] text-subtle mb-1">文件</div>
                <div className="font-mono truncate">{path}</div>
              </div>
              {picked.selector && (
                <div>
                  <div className="text-[10px] text-subtle mb-1">CSS selector</div>
                  <div className="font-mono text-accent break-all">{picked.selector}</div>
                </div>
              )}
              <div>
                <div className="text-[10px] text-subtle mb-1">元素片段</div>
                <pre className="font-mono text-[11.5px] whitespace-pre-wrap break-all px-2 py-1.5 bg-white/[0.04] border border-border rounded max-h-32 overflow-auto">
                  {picked.outerHTML}
                </pre>
              </div>
              <div>
                <div className="text-[10px] text-subtle mb-1">修改要求</div>
                <textarea
                  value={userText}
                  onChange={(e) => setUserText(e.target.value)}
                  autoFocus
                  rows={4}
                  placeholder="比如：把这个按钮背景改成红色，字体加粗"
                  className="w-full px-2 py-1.5 text-[12.5px] bg-white/[0.04] border border-border rounded focus:border-accent focus:bg-white/[0.06] transition-colors resize-y"
                />
              </div>
              <div>
                <div className="text-[10px] text-subtle mb-1">发送到</div>
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value as DispatchTarget)}
                  className="w-full px-2 py-1.5 text-[12.5px] bg-white/[0.04] border border-border rounded focus:border-accent focus:bg-white/[0.06]"
                >
                  <option value="new">新建 Claude 终端（安全，需手动粘贴）</option>
                  {liveSessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      直发 · {s.agent}·{s.id.slice(-6)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="px-4 py-2.5 border-t border-border/60 flex items-center justify-end gap-2">
              <button
                onClick={closeDialog}
                disabled={dispatching}
                className="fluent-btn px-3 h-7 text-[12.5px] rounded border border-border hover:bg-white/[0.06] disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={() => void onDispatch()}
                disabled={dispatching || !userText.trim()}
                className="fluent-btn px-3 h-7 text-[12.5px] rounded bg-accent/20 border border-accent/40 text-accent hover:bg-accent/30 disabled:opacity-50"
              >
                {dispatching ? '派单中…' : '派单'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
