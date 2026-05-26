import { useStore, HUB_PROJECT_ID, type Activity } from '../../store'

interface Item {
  id: Activity
  icon: string
  label: string
  badge?: number
}

export default function ActivityBar() {
  const activity = useStore((s) => s.activity)
  const setActivity = useStore((s) => s.setActivity)
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const logErrorCount = useStore(
    (s) => s.logs.filter((l) => l.level === 'error').length,
  )
  const selectedProjectId = useStore((s) => s.selectedProjectId)
  const projects = useStore((s) => s.projects)
  const currentProject = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId)
    : undefined
  const workflowMode = currentProject?.workflowMode ?? null

  // 规范工作流 tab 形态：dev-docs → Dev Docs；openspec / spec-trio → 规范；null → 隐藏。
  // spec-trio 是 OpenSpec + Superpowers + gstack 预设套餐，侧栏按 OpenSpec 形态渲染。
  const docsItem: Item | null =
    workflowMode === 'dev-docs'
      ? { id: 'docs', icon: '📝', label: 'Dev Docs' }
      : workflowMode === 'openspec' || workflowMode === 'spec-trio'
        ? { id: 'docs', icon: '📜', label: '规范' }
        : null

  // Icons are chosen so no two items share a silhouette — at 16px each row
  // has to be readable at a glance.
  // hub-dashboard 只在选了 __hub__ 项目时出现 (Codex 第 30 点：避免普通项目
  // 下用户以为看板是项目级 view)
  const isHubProject = selectedProjectId === HUB_PROJECT_ID

  const items: Item[] = [
    ...(isHubProject
      ? [{ id: 'hub-dashboard' as Activity, icon: '📊', label: '总控台看板' }]
      : []),
    { id: 'files', icon: '📁', label: '文件' },
    { id: 'scm', icon: '🌿', label: '源代码更改' },
    ...(docsItem ? [docsItem] : []),
    { id: 'projectdocs', icon: '📄', label: '文档' },
    { id: 'skills', icon: '🧩', label: '技能' },
    {
      id: 'logs',
      icon: '📋',
      label: '日志',
      badge: logErrorCount > 0 ? logErrorCount : undefined,
    },
    { id: 'appearance', icon: '🎨', label: '外观' },
  ]

  function onClick(id: Activity) {
    if (activity === id && !sidebarCollapsed) {
      toggleSidebar()
      return
    }
    if (sidebarCollapsed) toggleSidebar()
    setActivity(id)
  }

  return (
    <nav className="h-full w-full shrink-0 flex flex-col items-center py-1 border-r border-border/60 fluent-mica">
      <div className="flex flex-col gap-0.5 flex-1">
        {items.map((it) => {
          const active = activity === it.id && !sidebarCollapsed
          return (
            <button
              key={it.id}
              onClick={() => onClick(it.id)}
              title={it.label}
              className={`fluent-btn relative w-9 h-9 flex items-center justify-center rounded-md text-[16px] ${
                active
                  ? 'bg-white/[0.08] text-fg'
                  : 'text-muted hover:text-fg hover:bg-white/[0.04]'
              }`}
            >
              <span>{it.icon}</span>
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r bg-accent" />
              )}
              {it.badge != null && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] leading-4 text-center bg-rose-500 text-white">
                  {it.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
