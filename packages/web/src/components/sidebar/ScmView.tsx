import { Group, Panel, Separator } from 'react-resizable-panels'
import { useStore } from '../../store'
import ChangesList from '../ChangesList'
import GitGraph from '../GitGraph'

export default function ScmView() {
  const projectId = useStore((s) => s.selectedProjectId)
  const projects = useStore((s) => s.projects)

  if (!projectId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-sm text-muted text-center">
        <div>请先在左侧「项目」列表中选中一个项目</div>
      </div>
    )
  }

  const project = projects.find((p) => p.id === projectId)

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {project && (
        <div
          className="px-3 py-1.5 text-[11px] text-muted border-b border-border/40 truncate"
          title={project.path}
        >
          {project.name}
        </div>
      )}
      <Group
        orientation="vertical"
        id="aimon-scm-vsplit"
        className="flex-1 min-h-0 flex flex-col"
      >
        <Panel minSize="20%" defaultSize="60%">
          <div className="h-full flex flex-col min-h-0">
            <ChangesList projectId={projectId} />
          </div>
        </Panel>
        <Separator className="h-[3px] bg-transparent hover:bg-accent/40 active:bg-accent/70 transition-colors" />
        <Panel minSize="15%" defaultSize="40%" collapsible collapsedSize="0%">
          <GitGraph projectId={projectId} />
        </Panel>
      </Group>
    </div>
  )
}
