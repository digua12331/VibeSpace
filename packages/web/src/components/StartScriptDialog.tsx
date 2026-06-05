import { useEffect, useState } from 'react'
import * as api from '../api'
import { logAction } from '../logs'
import { runBatFile } from './runExecutable'
import type { Project } from '../types'

/** Windows 绝对路径判断：盘符开头（C:\ / C:/）、UNC（\\）或 POSIX 根（/）。 */
function isAbsPath(p: string): boolean {
  return /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(p)
}

/** 把候选文件名或相对脚本拼成绝对路径给 runBatFile（它会自己再 cd 到目录）。 */
function toAbs(projectPath: string, script: string): string {
  if (isAbsPath(script)) return script
  return `${projectPath.replace(/[\\/]+$/, '')}\\${script}`
}

/**
 * 设置/选择项目的「一键启动脚本」。项目根目录没有 start.bat 时点 ▶ 会弹它，
 * 也可从项目行右键菜单打开来重设/清空。选定后保存（记住）并立即运行。
 */
export default function StartScriptDialog({
  project,
  onClose,
  onChanged,
}: {
  project: Project
  onClose: () => void
  onChanged: () => void
}) {
  const [candidates, setCandidates] = useState<string[]>([])
  const [script, setScript] = useState(project.startScript ?? '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await api.getStartScript(project.id)
        if (cancelled) return
        setCandidates(r.candidates)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [project.id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function saveAndRun() {
    const value = script.trim()
    if (!value) {
      setError('请选择一个候选脚本，或在下方填写一个 bat 路径')
      return
    }
    if (!/\.(bat|cmd)$/i.test(value)) {
      setError('只能选择 .bat 或 .cmd 文件')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await logAction(
        'project',
        'set-start-script',
        async () => {
          await api.setStartScript(project.id, value)
          onChanged()
        },
        { projectId: project.id, meta: { script: value } },
      )
      await runBatFile(project.id, toAbs(project.path, value))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  async function clearScript() {
    setBusy(true)
    setError(null)
    try {
      await logAction(
        'project',
        'set-start-script',
        async () => {
          await api.setStartScript(project.id, null)
          onChanged()
        },
        { projectId: project.id, meta: { script: null } },
      )
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[440px] max-w-[90vw] fluent-acrylic rounded-win p-6 shadow-dialog animate-fluent-in flex flex-col"
      >
        <div className="text-lg font-display font-semibold mb-1">设置启动脚本</div>
        <div className="text-[11px] text-muted mb-4 truncate" title={project.path}>
          {project.name} · <span className="font-mono">{project.path}</span>
        </div>

        <div className="text-xs text-muted mb-1.5">项目目录里的 bat / cmd 文件</div>
        {/* 候选区固定高、内部滚动：脚本多时不撑爆弹窗 */}
        <div className="h-[160px] overflow-auto rounded-md border border-border bg-white/[0.02] p-1 mb-3">
          {loading ? (
            <div className="px-2 py-3 text-xs text-muted">扫描中…</div>
          ) : candidates.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted">
              没找到 bat / cmd 文件，可在下方直接粘贴一个 bat 的完整路径。
            </div>
          ) : (
            candidates.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setScript(c)
                  setError(null)
                }}
                className={`block w-full text-left px-2 py-1.5 rounded text-sm font-mono truncate ${
                  script.trim() === c
                    ? 'bg-accent/20 text-accent'
                    : 'text-fg hover:bg-white/[0.06]'
                }`}
              >
                {c}
              </button>
            ))
          )}
        </div>

        <label className="block mb-3">
          <span className="block text-xs text-muted mb-1.5">
            或填写 bat 路径（相对项目根或绝对）
          </span>
          <input
            value={script}
            onChange={(e) => setScript(e.target.value)}
            className="w-full px-3 py-2 bg-white/[0.04] border border-border rounded-md focus:border-accent focus:bg-white/[0.06] text-sm font-mono transition-colors"
            placeholder="start.bat 或 D:\tools\launch.bat"
          />
        </label>

        {error && (
          <div className="mb-3 px-3 py-2 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md break-all">
            {error}
          </div>
        )}

        <div className="flex justify-between items-center gap-2 mt-1">
          <button
            type="button"
            onClick={clearScript}
            disabled={busy || !project.startScript}
            title={project.startScript ? '清空后点 ▶ 回到自动找 start.bat' : '当前未设置'}
            className="fluent-btn px-3 py-1.5 text-xs rounded-md border border-border bg-white/[0.03] hover:bg-white/[0.08] disabled:opacity-40"
          >
            清空
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="fluent-btn px-4 py-1.5 text-sm rounded-md border border-border bg-white/[0.03] hover:bg-white/[0.08]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={saveAndRun}
              disabled={busy}
              className="fluent-btn px-4 py-1.5 text-sm rounded-md bg-accent text-on-accent font-medium hover:bg-accent-2 border border-accent/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] disabled:opacity-50"
            >
              {busy ? '运行中…' : '保存并运行'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
