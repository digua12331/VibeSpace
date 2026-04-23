import { useEffect, useState } from 'react'
import { useStore } from '../../store'

const EMPTY_FEATURES: never[] = []

export default function OutputView() {
  const projectId = useStore((s) => s.selectedProjectId)
  const projects = useStore((s) => s.projects)
  const features = useStore((s) =>
    projectId ? s.outputFeatures[projectId] ?? EMPTY_FEATURES : EMPTY_FEATURES,
  )
  const loading = useStore((s) =>
    projectId ? s.outputLoading[projectId] === true : false,
  )
  const error = useStore((s) =>
    projectId ? s.outputError[projectId] ?? null : null,
  )
  const refreshOutput = useStore((s) => s.refreshOutput)
  const openFile = useStore((s) => s.openFile)

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!projectId) return
    refreshOutput(projectId).catch(() => {
      /* error already recorded in store */
    })
  }, [projectId, refreshOutput])

  if (!projectId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-sm text-muted text-center">
        <div>请先在左侧「项目」列表中选中一个项目</div>
      </div>
    )
  }

  const project = projects.find((p) => p.id === projectId)

  function toggle(name: string) {
    setExpanded((st) => ({ ...st, [name]: !st[name] }))
  }

  function openFeatureFile(feature: string, file: string) {
    if (!projectId) return
    const path = `output/${feature}/${file}`
    if (file === 'checklist.json') {
      openFile({ projectId, path, kind: 'checklist' })
    } else {
      openFile({ projectId, path })
    }
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
              onClick={() => void refreshOutput(projectId)}
              title="刷新"
              className="fluent-btn w-6 h-6 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.08]"
            >
              ⟳
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto p-2 space-y-0.5">
        {loading && features.length === 0 && (
          <div className="px-3 py-6 text-xs text-muted text-center">加载中…</div>
        )}
        {error && (
          <div className="mx-1 mb-2 px-3 py-2 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md">
            {error}
          </div>
        )}
        {!loading && features.length === 0 && !error && (
          <div className="px-3 py-6 text-xs text-muted">
            <div className="text-center mb-3">暂无策划方案。</div>
            <div className="text-left leading-relaxed">
              在项目根下建立
              <code className="mx-0.5 font-mono">output/&lt;功能名&gt;/</code>
              目录，放入
              <code className="mx-0.5 font-mono">checklist.json</code>
              即可在此列出。
            </div>
          </div>
        )}
        {features.map((f) => {
          const open = !!expanded[f.name]
          return (
            <div key={f.name} className="text-sm">
              <div
                className="group flex items-center gap-1.5 pl-1 pr-2 py-1 rounded hover:bg-white/[0.04] cursor-pointer"
                onClick={() => toggle(f.name)}
                title="点击展开"
              >
                <span className="inline-block w-4 text-center text-[11px] text-muted">
                  {open ? '▾' : '▸'}
                </span>
                <span className="flex-1 truncate font-medium">{f.name}</span>
                {f.hasChecklist && (
                  <span className="text-[10px] text-subtle tabular-nums shrink-0">
                    {f.files.length}
                  </span>
                )}
              </div>
              {open && (
                <div className="mt-0.5 mb-1 space-y-0.5">
                  {f.files.length === 0 && (
                    <div className="pl-8 pr-3 py-1 text-[12px] text-subtle">
                      （空文件夹）
                    </div>
                  )}
                  {f.files.map((file) => {
                    const isChecklist = file === 'checklist.json'
                    return (
                      <button
                        key={file}
                        onClick={() => openFeatureFile(f.name, file)}
                        className="fluent-btn w-full text-left pl-8 pr-3 py-1 text-[12.5px] rounded hover:bg-white/[0.06] flex items-center gap-2"
                        title={
                          isChecklist
                            ? '打开清单编辑器'
                            : `打开 ${file}`
                        }
                      >
                        <span className="shrink-0">{isChecklist ? '📋' : '📄'}</span>
                        <span className="flex-1 truncate">{file}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
