import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Viewport-anchored position — caller computes from click target. */
  x: number
  y: number
  initialText?: string
  title?: string
  submitLabel?: string
  onSubmit: (text: string) => void | Promise<void>
  onCancel: () => void
}

/**
 * Lightweight modal input for new/edited comments. Positioned near the
 * triggering block's 💬 badge. Dismissed on Escape, outside-click, or submit.
 */
export default function CommentPopover({
  x,
  y,
  initialText = '',
  title = '写评论',
  submitLabel = '保存',
  onSubmit,
  onCancel,
}: Props) {
  const [text, setText] = useState(initialText)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const t = requestAnimationFrame(() => taRef.current?.focus())
    return () => cancelAnimationFrame(t)
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    function onClickOutside(e: MouseEvent) {
      const el = rootRef.current
      if (el && !el.contains(e.target as Node)) onCancel()
    }
    window.addEventListener('keydown', onKey)
    // Defer the outside-click listener by a tick so the click that opened
    // the popover doesn't immediately close it.
    const tid = setTimeout(() => {
      window.addEventListener('mousedown', onClickOutside)
    }, 0)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onClickOutside)
      clearTimeout(tid)
    }
  }, [onCancel])

  async function handleSubmit() {
    const trimmed = text.trim()
    if (!trimmed) {
      setError('评论内容不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit(text)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // Clamp to viewport so the popover isn't off-screen.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const WIDTH = 320
  const HEIGHT_ESTIMATE = 180
  const left = Math.max(8, Math.min(vw - WIDTH - 8, x))
  const top = Math.max(8, Math.min(vh - HEIGHT_ESTIMATE - 8, y))

  return (
    <div
      ref={rootRef}
      className="fixed z-[60] w-[320px] rounded-md bg-bg border border-border shadow-lg p-2"
      style={{ left, top }}
    >
      <div className="text-[11px] text-muted mb-1.5 px-1">{title}</div>
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void handleSubmit()
          }
        }}
        rows={4}
        placeholder="Enter 保存 · Shift+Enter 换行"
        className="w-full px-2 py-1.5 text-[13px] bg-white/[0.04] border border-border rounded focus:border-accent focus:bg-white/[0.06] resize-none outline-none"
      />
      {error && (
        <div className="text-[11px] text-rose-300 mt-1 px-1">{error}</div>
      )}
      <div className="flex justify-end gap-1.5 mt-2">
        <button
          type="button"
          onClick={onCancel}
          className="fluent-btn px-2 py-1 text-[12px] rounded border border-border text-muted hover:text-fg hover:bg-white/[0.04]"
        >
          取消
        </button>
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={busy || !text.trim()}
          className="fluent-btn px-2.5 py-1 text-[12px] rounded bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? '…' : submitLabel}
        </button>
      </div>
    </div>
  )
}
