import { lazy, Suspense } from 'react'
import { useStore } from '../../store'

// 11 个 sidebar view 全部 lazy。首屏只 parse PrimarySidebar 容器本身，
// 切到对应 activity 时才下载并 mount。Suspense 边界包一层在根，所有
// view 共用同一个 fallback——任意时刻只 active 一个 view，单层够用。
const ScmView = lazy(() => import('../sidebar/ScmView'))
const LogsView = lazy(() => import('../sidebar/LogsView'))
const InboxView = lazy(() => import('../sidebar/InboxView'))
const DocsView = lazy(() => import('../sidebar/DocsView'))
const OpenSpecView = lazy(() => import('../sidebar/OpenSpecView'))
const FilesView = lazy(() => import('../sidebar/FilesView'))
const OutputView = lazy(() => import('../sidebar/OutputView'))
const PerfView = lazy(() => import('../sidebar/PerfView'))
const JobsView = lazy(() => import('../sidebar/JobsView'))
const UsageView = lazy(() => import('../sidebar/UsageView'))
const AppearanceView = lazy(() => import('../sidebar/AppearanceView'))
const SkillsView = lazy(() => import('../sidebar/SkillsView'))

const STATIC_TITLES: Record<string, string> = {
  scm: '源代码更改',
  files: '文件',
  output: '策划方案',
  perf: '性能',
  logs: '日志',
  inbox: '通知',
  jobs: '后台任务',
  usage: '使用量',
  appearance: '外观',
  skills: '技能',
}

function SidebarFallback() {
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center text-xs text-subtle">
      <span className="inline-flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse-soft" />
        加载中…
      </span>
    </div>
  )
}

export default function PrimarySidebar() {
  const activity = useStore((s) => s.activity)
  const selectedProjectId = useStore((s) => s.selectedProjectId)
  const projects = useStore((s) => s.projects)
  const workflowMode =
    (selectedProjectId
      ? projects.find((p) => p.id === selectedProjectId)?.workflowMode
      : null) ?? null

  // docs activity 顶栏标题随 workflowMode 变换；mode === null 时显示"工作流未启用"占位。
  // spec-trio 是 OpenSpec + Superpowers + gstack 预设套餐，标题与 OpenSpec 一致显示"规范"。
  const docsTitle =
    workflowMode === 'openspec' || workflowMode === 'spec-trio'
      ? '规范'
      : workflowMode === 'dev-docs'
        ? 'Dev Docs'
        : '工作流'
  const title = activity === 'docs' ? docsTitle : (STATIC_TITLES[activity] ?? activity)

  let body: React.ReactNode
  switch (activity) {
    case 'scm':
      body = <ScmView />
      break
    case 'files':
      body = <FilesView />
      break
    case 'docs':
      body =
        workflowMode === 'openspec' || workflowMode === 'spec-trio' ? (
          <OpenSpecView />
        ) : workflowMode === 'dev-docs' ? (
          <DocsView />
        ) : (
          <div className="flex-1 flex items-center justify-center p-6 text-sm text-muted text-center">
            <div>
              当前项目未启用规范工作流。
              <br />
              点右上角「权限」抽屉的「工作流」tab 选择 Dev Docs / OpenSpec / 规范三件套。
            </div>
          </div>
        )
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
    case 'appearance':
      body = <AppearanceView />
      break
    case 'skills':
      body = <SkillsView />
      break
    default:
      body = null
  }

  return (
    <aside className="h-full flex flex-col fluent-mica border-r border-border/60 min-h-0">
      <div className="h-9 px-3 flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-subtle font-medium border-b border-border/40">
        <span>{title}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <Suspense fallback={<SidebarFallback />}>{body}</Suspense>
      </div>
    </aside>
  )
}
