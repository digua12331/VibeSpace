import { useStore } from '../../store'
import ScmView from '../sidebar/ScmView'
import LogsView from '../sidebar/LogsView'
import InboxView from '../sidebar/InboxView'
import DocsView from '../sidebar/DocsView'
import FilesView from '../sidebar/FilesView'
import OutputView from '../sidebar/OutputView'
import PerfView from '../sidebar/PerfView'
import JobsView from '../sidebar/JobsView'
import UsageView from '../sidebar/UsageView'

const TITLES: Record<string, string> = {
  scm: '源代码更改',
  files: '文件',
  docs: 'Dev Docs',
  output: '策划方案',
  perf: '性能',
  logs: '日志',
  inbox: '通知',
  jobs: '后台任务',
  usage: '使用量',
}

export default function PrimarySidebar() {
  const activity = useStore((s) => s.activity)

  let body: React.ReactNode
  switch (activity) {
    case 'scm':
      body = <ScmView />
      break
    case 'files':
      body = <FilesView />
      break
    case 'docs':
      body = <DocsView />
      break
    case 'output':
      body = <OutputView />
      break
    case 'perf':
      body = <PerfView />
      break
    case 'logs':
      body = <LogsView />
      break
    case 'inbox':
      body = <InboxView />
      break
    case 'jobs':
      body = <JobsView />
      break
    case 'usage':
      body = <UsageView />
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
