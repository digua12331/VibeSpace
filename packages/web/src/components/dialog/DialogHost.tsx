import { useEffect, useState } from 'react'

type Variant = 'info' | 'danger'

interface BasePending {
  id: number
  title?: string
  message: string
  variant: Variant
  confirmLabel: string
}

interface AlertPending extends BasePending {
  kind: 'alert'
  resolve: () => void
}

interface ConfirmPending extends BasePending {
  kind: 'confirm'
  cancelLabel: string
  resolve: (value: boolean) => void
}

interface PromptPending extends BasePending {
  kind: 'prompt'
  cancelLabel: string
  placeholder: string
  defaultValue: string
  validate?: (value: string) => string | null
  resolve: (value: string | null) => void
}

type Pending = AlertPending | ConfirmPending | PromptPending

let sequence = 0
const listeners = new Set<(pending: Pending[]) => void>()
let queue: Pending[] = []

function notify() {
  for (const l of listeners) l([...queue])
}

function enqueue(item: Pending) {
  queue = [...queue, item]
  notify()
}

function dismiss(id: number): Pending | null {
  const idx = queue.findIndex((p) => p.id === id)
  if (idx < 0) return null
  const [item] = queue.splice(idx, 1)
  queue = [...queue]
  notify()
  return item
}

export function confirmDialog(
  message: string,
  opts: {
    title?: string
    confirmLabel?: string
    cancelLabel?: string
    variant?: Variant
  } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    sequence += 1
    enqueue({
      id: sequence,
      kind: 'confirm',
      title: opts.title,
      message,
      variant: opts.variant ?? 'info',
      confirmLabel: opts.confirmLabel ?? '确定',
      cancelLabel: opts.cancelLabel ?? '取消',
      resolve,
    })
  })
}

export function alertDialog(
  message: string,
  opts: { title?: string; confirmLabel?: string; variant?: Variant } = {},
): Promise<void> {
  return new Promise((resolve) => {
    sequence += 1
    enqueue({
      id: sequence,
      kind: 'alert',
      title: opts.title,
      message,
      variant: opts.variant ?? 'info',
      confirmLabel: opts.confirmLabel ?? '确定',
      resolve,
    })
  })
}

export function promptDialog(
  message: string,
  opts: {
    title?: string
    placeholder?: string
    defaultValue?: string
    confirmLabel?: string
    cancelLabel?: string
    validate?: (value: string) => string | null
  } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    sequence += 1
    enqueue({
      id: sequence,
      kind: 'prompt',
      title: opts.title,
      message,
      variant: 'info',
      confirmLabel: opts.confirmLabel ?? '确定',
      cancelLabel: opts.cancelLabel ?? '取消',
      placeholder: opts.placeholder ?? '',
      defaultValue: opts.defaultValue ?? '',
      validate: opts.validate,
      resolve,
    })
  })
}

function finish(top: Pending, kind: 'confirm' | 'cancel', value?: string) {
  const item = dismiss(top.id)
  if (!item) return
  if (item.kind === 'alert') item.resolve()
  else if (item.kind === 'confirm') item.resolve(kind === 'confirm')
  else item.resolve(kind === 'confirm' ? (value ?? '') : null)
}

export default function DialogHost() {
  const [pending, setPending] = useState<Pending[]>([])
  const [inputValue, setInputValue] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)

  useEffect(() => {
    const l = (next: Pending[]) => setPending(next)
    listeners.add(l)
    l([...queue])
    return () => {
      listeners.delete(l)
    }
  }, [])

  const top = pending.length > 0 ? pending[pending.length - 1] : null

  // Reset input buffer whenever the top dialog changes (id-driven).
  useEffect(() => {
    if (top && top.kind === 'prompt') {
      setInputValue(top.defaultValue)
      setInputError(null)
    }
  }, [top?.id, top?.kind])

  useEffect(() => {
    if (!top) return
    function onKey(e: KeyboardEvent) {
      if (!top) return
      if (e.key === 'Escape') {
        e.preventDefault()
        finish(top, 'cancel')
      } else if (e.key === 'Enter' && top.kind !== 'prompt') {
        e.preventDefault()
        finish(top, 'confirm')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [top])

  if (!top) return null
  const danger = top.variant === 'danger'

  function submitPrompt() {
    if (!top || top.kind !== 'prompt') return
    const v = inputValue
    const err = top.validate ? top.validate(v) : null
    if (err) {
      setInputError(err)
      return
    }
    finish(top, 'confirm', v)
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm flex items-center justify-center animate-fluent-in"
      onClick={() => finish(top, top.kind === 'alert' ? 'confirm' : 'cancel')}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] max-w-[90vw] fluent-acrylic rounded-win p-5 shadow-dialog"
      >
        {top.title && (
          <div className="text-[15px] font-display font-semibold mb-2">
            {top.title}
          </div>
        )}
        <div className="text-sm text-fg/90 whitespace-pre-wrap break-words">
          {top.message}
        </div>

        {top.kind === 'prompt' && (
          <div className="mt-3">
            <input
              autoFocus
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value)
                if (inputError) setInputError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitPrompt()
                }
              }}
              placeholder={top.placeholder}
              className="w-full px-3 py-2 bg-white/[0.04] border border-border rounded-md focus:border-accent focus:bg-white/[0.06] text-sm transition-colors"
            />
            {inputError && (
              <div className="mt-2 px-3 py-1.5 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md">
                {inputError}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          {top.kind !== 'alert' && (
            <button
              type="button"
              onClick={() => finish(top, 'cancel')}
              className="fluent-btn px-4 py-1.5 text-sm rounded-md border border-border bg-white/[0.03] hover:bg-white/[0.08]"
            >
              {top.cancelLabel}
            </button>
          )}
          <button
            type="button"
            autoFocus={top.kind === 'alert'}
            onClick={() => {
              if (top.kind === 'prompt') submitPrompt()
              else finish(top, 'confirm')
            }}
            className={`fluent-btn px-4 py-1.5 text-sm rounded-md border shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] font-medium ${
              danger
                ? 'bg-rose-500 text-white border-rose-400 hover:bg-rose-400'
                : 'bg-accent text-on-accent border-accent/60 hover:bg-accent-2'
            }`}
          >
            {top.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
