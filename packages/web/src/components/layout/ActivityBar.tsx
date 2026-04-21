import { useStore, type Activity } from '../../store'

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
  const notifyCount = useStore((s) => s.notifyingSessions.size)
  const notifyPerm = useStore((s) => s.notifyPerm)

  const items: Item[] = [
    { id: 'scm', icon: '📂', label: '源代码更改' },
    { id: 'docs', icon: '📘', label: 'Dev Docs' },
    { id: 'perf', icon: '📊', label: '性能' },
    {
      id: 'logs',
      icon: '📋',
      label: '日志',
      badge: logErrorCount > 0 ? logErrorCount : undefined,
    },
    {
      id: 'inbox',
      icon: '🔔',
      label: '通知',
      badge: notifyCount > 0 ? notifyCount : undefined,
    },
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
      <div className="flex flex-col gap-0.5 pb-1">
        <button
          title={
            notifyPerm === 'granted'
              ? '通知已开启'
              : notifyPerm === 'denied'
                ? '通知被拒绝'
                : notifyPerm === 'unsupported'
                  ? '浏览器不支持'
                  : '点击 🔔 标签启用'
          }
          className={`w-9 h-9 flex items-center justify-center rounded-md text-[12px] ${
            notifyPerm === 'granted'
              ? 'text-emerald-300'
              : notifyPerm === 'denied' || notifyPerm === 'unsupported'
                ? 'text-rose-300'
                : 'text-muted'
          }`}
          disabled
        >
          ●
        </button>
      </div>
    </nav>
  )
}
