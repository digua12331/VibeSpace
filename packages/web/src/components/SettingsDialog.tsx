import { useEffect, useState } from 'react'
import { getAppSettings, updateAppSettings } from '../api'
import { logAction } from '../logs'
import type { AppSettings, HibernationSettings } from '../types'

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

const DEFAULT_HIBERNATION: HibernationSettings = {
  enabled: true,
  idleMinutes: 15,
  includeShells: false,
}

export default function SettingsDialog() {
  const [open, setOpen] = useState(_open)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retention, setRetention] = useState<number>(1)
  const [hibernation, setHibernation] =
    useState<HibernationSettings>(DEFAULT_HIBERNATION)

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
        setHibernation(s.hibernation ?? DEFAULT_HIBERNATION)
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
        'update-app-settings',
        () =>
          updateAppSettings({
            pasteImageRetentionDays: retention,
            hibernation,
          }),
        {
          meta: {
            retentionDays: retention,
            hibernation,
          },
        },
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

        <section className="mb-4 border-t border-border/40 pt-4">
          <div className="text-sm text-fg/90 mb-1">会话冬眠</div>
          <div className="text-xs text-muted mb-2 leading-relaxed">
            空闲超过阈值的 AI 终端会被自动杀掉后端 CLI 进程释放内存，tab 在前端变成 💤 紫色；点 tab
            后会重新启动一个新的 CLI 进程接管。
            <span className="text-amber-300/80">
              {' '}
              冬眠会强制结束 CLI 进程，最近 1–2 条未保存的对话可能在 CLI 自带 /resume 列表里找不到。
            </span>
          </div>
          <label className="inline-flex items-center gap-2 text-sm mb-3 cursor-pointer">
            <input
              type="checkbox"
              disabled={loading || saving}
              checked={hibernation.enabled}
              onChange={(e) =>
                setHibernation((h) => ({ ...h, enabled: e.target.checked }))
              }
            />
            <span>启用自动冬眠</span>
          </label>
          <div className="flex items-center gap-2 mb-3">
            <label className="text-xs text-muted">空闲多久后冬眠（分钟，5–180）</label>
            <input
              type="number"
              min={5}
              max={180}
              step={1}
              disabled={loading || saving || !hibernation.enabled}
              value={hibernation.idleMinutes}
              onChange={(e) => {
                const n = Math.max(5, Math.min(180, Number(e.target.value) || 15))
                setHibernation((h) => ({ ...h, idleMinutes: n }))
              }}
              className="w-20 px-2 py-1 bg-white/[0.04] border border-border rounded text-sm focus:border-accent focus:bg-white/[0.06] disabled:opacity-60"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              disabled={loading || saving || !hibernation.enabled}
              checked={hibernation.includeShells}
              onChange={(e) =>
                setHibernation((h) => ({ ...h, includeShells: e.target.checked }))
              }
            />
            <span>同时冬眠纯 shell（cmd / pwsh / bash），不推荐 — 会丢 cd 历史</span>
          </label>
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
