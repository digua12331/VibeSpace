import { useStore } from '../../store'
import ChangesList from '../ChangesList'

export default function ScmView() {
  const projectId = useStore((s) => s.selectedProjectId)
  const projects = useStore((s) => s.projects)
  const setActivity = useStore((s) => s.setActivity)

  if (!projectId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-sm text-muted text-center">
        <div>
          <div className="mb-2">请先在「资源管理器」中选中一个项目</div>
          <button
            onClick={() => setActivity('explorer')}
            className="fluent-btn px-3 py-1 rounded-md border border-border hover:text-fg hover:bg-white/[0.04] text-xs"
          >
            返回资源管理器
          </button>
        </div>
      </div>
    )
  }

  const project = projects.find((p) => p.id === projectId)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {project && (
        <div className="px-3 py-1.5 text-[11px] text-muted border-b border-border/40 truncate" title={project.path}>
          {project.name}
        </div>
      )}
      <ChangesList projectId={projectId} />
    </div>
  )
}
