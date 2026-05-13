import { useEffect, useState } from 'react'
import { getAppSettings, updateAppSettings } from '../api'
import { logAction } from '../logs'
import type { AppSettings } from '../types'

/**
 * Imperative open API — keeps the dialog mounted once at the workbench root
 * and lets any button toggle it without prop-drilling. Mirrors the pattern in
 * DialogHost (listeners + module-level state) but the body is fully custom
 * because DialogHost only supports alert/confirm/prompt.
 */
const listeners = new Set<(open: boolean) => void>()
let _open = false

function setOpenState(next: boolean) {
  _open = next
  for (const l of listeners) l(next)
}

export function openSettings(): void {
  setOpenState(true)
}

const RETENTION_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: '1 天' },
  { value: 3, label: '3 天' },
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
  { value: 0, label: '不清理' },
]

export default function SettingsDialog() {
  const [open, setOpen] = useState(_open)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retention, setRetention] = useState<number>(1)

  useEffect(() => {
    const l = (next: boolean) => setOpen(next)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    getAppSettings()
      .then((s: AppSettings) => {
        setRetention(s.pasteImageRetentionDays)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpenState(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function onSave() {
    setSaving(true)
    setError(null)
    try {
      await logAction(
        'settings',
        'update-paste-image-retention',
        () => updateAppSettings({ pasteImageRetentionDays: retention }),
        { meta: { retentionDays: retention } },
      )
      setOpenState(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm flex items-center justify-center animate-fluent-in"
      onClick={() => !saving && setOpenState(false)}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-[460px] max-w-[90vw] fluent-acrylic rounded-win p-5 shadow-dialog"
      >
        <div className="text-[15px] font-display font-semibold mb-3">设置</div>

        <section className="mb-4">
          <div className="text-sm text-fg/90 mb-1">粘贴图片保留天数</div>
          <div className="text-xs text-muted mb-2">
            粘贴到对话里的图片存在每个项目的 .vibespace/pasted-images
            目录。后端每次启动时会清理超过保留天数的图。"不清理"表示不删任何旧图。
          </div>
          <select
            disabled={loading || saving}
            value={retention}
            onChange={(e) => setRetention(Number(e.target.value))}
            className="w-full px-3 py-2 bg-white/[0.04] border border-border rounded-md focus:border-accent focus:bg-white/[0.06] text-sm transition-colors disabled:opacity-60"
          >
            {RETENTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </section>

        {error && (
          <div className="mb-3 px-3 py-1.5 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            disabled={saving}
            onClick={() => setOpenState(false)}
            className="fluent-btn px-4 py-1.5 text-sm rounded-md border border-border bg-white/[0.03] hover:bg-white/[0.08] disabled:opacity-60"
          >
            取消
          </button>
          <button
            type="button"
            disabled={loading || saving}
            onClick={() => void onSave()}
            className="fluent-btn px-4 py-1.5 text-sm rounded-md border border-accent/60 bg-accent text-on-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] font-medium hover:bg-accent-2 disabled:opacity-60"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
