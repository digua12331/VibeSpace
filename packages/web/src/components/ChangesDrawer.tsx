import { useEffect } from 'react'
import { useStore } from '../store'
import ChangesList from './ChangesList'
import FilePreview from './FilePreview'

export default function ChangesDrawer() {
  const projectId = useStore((s) => s.changesProjectId)
  const selected = useStore((s) => s.selectedChange)
  const closeChanges = useStore((s) => s.closeChanges)
  const projects = useStore((s) => s.projects)

  useEffect(() => {
    if (!projectId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeChanges()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [projectId, closeChanges])

  if (!projectId) return null
  const project = projects.find((p) => p.id === projectId)

  return (
    <div className="fixed inset-0 z-30 flex">
      {/* Backdrop */}
      <div
        className="flex-1 bg-black/50 backdrop-blur-sm"
        onClick={closeChanges}
        aria-label="关闭更改面板"
      />
      {/* Drawer */}
      <aside className="w-[min(1200px,90vw)] bg-bg border-l border-border/60 flex flex-col shadow-2xl">
        <header className="h-11 flex items-center justify-between px-3 border-b border-border/60 fluent-mica">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-display font-semibold text-[14px]">📂 源代码更改</span>
            {project && (
              <span className="text-xs text-muted truncate" title={project.path}>
                · {project.name}
              </span>
            )}
          </div>
          <button
            onClick={closeChanges}
            className="fluent-btn px-2 py-0.5 rounded-md border border-border text-muted hover:text-fg text-xs"
            title="关闭 (Esc)"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 flex min-h-0">
          <div className="w-[320px] min-w-[260px] max-w-[420px] border-r border-border/60 flex flex-col min-h-0">
            <ChangesList projectId={projectId} />
          </div>
          <div className="flex-1 flex min-h-0">
            {selected ? (
              <FilePreview
                projectId={projectId}
                path={selected.path}
                ref={selected.ref}
                from={selected.from}
                to={selected.to}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-muted">
                点击左侧文件以查看差异或内容
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  )
}
