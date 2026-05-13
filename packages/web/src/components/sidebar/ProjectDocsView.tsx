import { useEffect } from 'react'
import { useStore } from '../../store'
import { logAction } from '../../logs'
import type { ProjectDocFile } from '../../types'

const EMPTY: ProjectDocFile[] = []

export default function ProjectDocsView() {
  const projectId = useStore((s) => s.selectedProjectId)
  const projects = useStore((s) => s.projects)
  const docs = useStore((s) =>
    projectId ? s.projectDocs[projectId] ?? EMPTY : EMPTY,
  )
  const loading = useStore((s) =>
    projectId ? s.projectDocsLoading[projectId] === true : false,
  )
  const error = useStore((s) =>
    projectId ? s.projectDocsError[projectId] ?? null : null,
  )
  const refreshProjectDocs = useStore((s) => s.refreshProjectDocs)
  const openFile = useStore((s) => s.openFile)

  useEffect(() => {
    if (!projectId) return
    void logAction('project-docs', 'list', () => refreshProjectDocs(projectId), {
      projectId,
    }).catch(() => {
      /* error captured in store */
    })
  }, [projectId, refreshProjectDocs])

  if (!projectId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-sm text-muted text-center">
        <div>请先在左侧「项目」列表中选中一个项目</div>
      </div>
    )
  }

  const project = projects.find((p) => p.id === projectId)

  function openDoc(name: string) {
    if (!projectId) return
    openFile({ projectId, path: `docs/${name}` })
  }

  function manualRefresh() {
    if (!projectId) return
    void logAction('project-docs', 'list', () => refreshProjectDocs(projectId), {
      projectId,
    }).catch(() => {
      /* error captured in store */
    })
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {project && (
        <div
          className="px-3 py-1.5 text-[11px] text-muted border-b border-border/40 truncate flex items-center justify-between gap-2"
          title={project.path}
        >
          <span className="truncate">{project.name}</span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={manualRefresh}
              title="刷新"
              className="fluent-btn w-6 h-6 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.08]"
            >
              ⟳
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto p-2 space-y-0.5">
        {loading && docs.length === 0 && (
          <div className="px-3 py-6 text-xs text-muted text-center">加载中…</div>
        )}
        {error && (
          <div className="mx-1 mb-2 px-3 py-2 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md">
            {error}
          </div>
        )}
        {!loading && docs.length === 0 && !error && (
          <div className="px-3 py-6 text-xs text-muted">
            <div className="text-center mb-3">项目根下没有 <code className="font-mono">docs/</code> 文件夹，或其中没有 <code className="font-mono">.md</code> 文件。</div>
            <div className="text-left leading-relaxed">
              在项目根建立 <code className="font-mono">docs/</code> 目录并放入
              <code className="mx-0.5 font-mono">.md</code> 文件即可在此列出。
            </div>
          </div>
        )}
        {docs.map((d) => (
          <button
            key={d.name}
            onClick={() => openDoc(d.name)}
            className="fluent-btn w-full text-left pl-2 pr-3 py-1 text-[12.5px] rounded hover:bg-white/[0.06] flex items-center gap-2"
            title={`打开 ${d.name}`}
          >
            <span className="shrink-0">📄</span>
            <span className="flex-1 truncate">{d.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
