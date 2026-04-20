import { useStore } from '../../store'
import ExplorerView from '../sidebar/ExplorerView'
import ScmView from '../sidebar/ScmView'
import LogsView from '../sidebar/LogsView'
import InboxView from '../sidebar/InboxView'

const TITLES: Record<string, string> = {
  explorer: '资源管理器',
  scm: '源代码更改',
  logs: '日志',
  inbox: '通知',
}

export default function PrimarySidebar({
  onNewProject,
}: {
  onNewProject: () => void
}) {
  const activity = useStore((s) => s.activity)

  let body: React.ReactNode
  switch (activity) {
    case 'explorer':
      body = <ExplorerView onNewProject={onNewProject} />
      break
    case 'scm':
      body = <ScmView />
      break
    case 'logs':
      body = <LogsView />
      break
    case 'inbox':
      body = <InboxView />
      break
    default:
      body = null
  }

  return (
    <aside className="h-full flex flex-col fluent-mica border-r border-border/60 min-h-0">
      <div className="h-9 px-3 flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-subtle font-medium border-b border-border/40">
        <span>{TITLES[activity] ?? activity}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{body}</div>
    </aside>
  )
}
