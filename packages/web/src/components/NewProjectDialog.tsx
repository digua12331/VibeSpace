import { useEffect, useState } from 'react'
import * as api from '../api'
import { useStore } from '../store'

export default function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const refreshProjects = useStore((s) => s.refreshProjects)
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim() || !path.trim()) {
      setError('名称和路径都不能为空')
      return
    }
    setSubmitting(true)
    try {
      await api.createProject({ name: name.trim(), path: path.trim() })
      await refreshProjects()
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-[440px] max-w-[90vw] fluent-acrylic rounded-win p-6 shadow-dialog animate-fluent-in"
      >
        <div className="text-lg font-display font-semibold mb-4">新建项目</div>
        <label className="block mb-3">
          <span className="block text-xs text-muted mb-1.5">名称</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 bg-white/[0.04] border border-border rounded-md focus:border-accent focus:bg-white/[0.06] text-sm transition-colors"
            placeholder="my-app"
          />
        </label>
        <label className="block mb-3">
          <span className="block text-xs text-muted mb-1.5">路径</span>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className="w-full px-3 py-2 bg-white/[0.04] border border-border rounded-md focus:border-accent focus:bg-white/[0.06] text-sm font-mono transition-colors"
            placeholder="D:\\projects\\my-app"
          />
        </label>
        {error && (
          <div className="mb-3 px-3 py-2 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="fluent-btn px-4 py-1.5 text-sm rounded-md border border-border bg-white/[0.03] hover:bg-white/[0.08]"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="fluent-btn px-4 py-1.5 text-sm rounded-md bg-accent text-[#003250] font-medium hover:bg-accent-2 border border-accent/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] disabled:opacity-50"
          >
            {submitting ? '创建中...' : '创建'}
          </button>
        </div>
      </form>
    </div>
  )
}
