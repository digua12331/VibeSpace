import { useStore } from '../../store'
import { currentPermission, requestPermission } from '../../notify'

export default function InboxView() {
  const notifyPerm = useStore((s) => s.notifyPerm)
  const setNotifyPerm = useStore((s) => s.setNotifyPerm)
  const notifying = useStore((s) => s.notifyingSessions)
  const sessions = useStore((s) => s.sessions)
  const projects = useStore((s) => s.projects)
  const selectProject = useStore((s) => s.selectProject)
  const setActiveSession = useStore((s) => s.setActiveSession)
  const clearNotify = useStore((s) => s.clearNotify)
  const clearAllNotify = useStore((s) => s.clearAllNotify)

  async function onClickGrant() {
    if (notifyPerm === 'default') {
      const next = await requestPermission()
      setNotifyPerm(next)
    } else {
      setNotifyPerm(currentPermission())
    }
  }

  const waiting = Array.from(notifying).map((id) => {
    const s = sessions.find((x) => x.id === id)
    const p = s ? projects.find((pp) => pp.id === s.projectId) : undefined
    return { id, session: s, project: p }
  })

  const permTone =
    notifyPerm === 'granted'
      ? 'text-emerald-300 border-emerald-600/40 bg-emerald-500/10'
      : notifyPerm === 'denied' || notifyPerm === 'unsupported'
        ? 'text-rose-300 border-rose-600/40 bg-rose-500/10'
        : 'text-muted border-border'

  const permLabel =
    notifyPerm === 'granted'
      ? '已启用'
      : notifyPerm === 'denied'
        ? '被拒绝 (请在浏览器设置中开启)'
        : notifyPerm === 'unsupported'
          ? '此浏览器不支持'
          : '未启用'

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-auto">
      <div className="p-3 border-b border-border/40">
        <div className="text-[11px] text-subtle uppercase tracking-widest mb-1.5">
          通知权限
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className={`text-xs px-2 py-1 rounded border ${permTone}`}>
            🔔 {permLabel}
          </span>
          <button
            onClick={() => void onClickGrant()}
            disabled={notifyPerm === 'granted' || notifyPerm === 'denied' || notifyPerm === 'unsupported'}
            className="fluent-btn px-2 py-1 text-xs rounded-md border border-border text-muted hover:text-fg hover:bg-white/[0.04] disabled:opacity-50"
          >
            {notifyPerm === 'granted' ? '已授权' : '请求授权'}
          </button>
        </div>
      </div>

      <div className="p-3">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-subtle uppercase tracking-widest">
            等待输入 ({waiting.length})
          </span>
          {waiting.length > 0 && (
            <button
              onClick={clearAllNotify}
              className="fluent-btn px-2 py-0.5 text-[11px] rounded border border-border text-muted hover:text-fg hover:bg-white/[0.04]"
            >
              全部清除
            </button>
          )}
        </div>
        {waiting.length === 0 ? (
          <div className="text-xs text-muted py-4 text-center">
            当前没有会话在等待你的输入。
          </div>
        ) : (
          <div className="space-y-1">
            {waiting.map(({ id, session, project }) => (
              <button
                key={id}
                onClick={() => {
                  if (session) {
                    selectProject(session.projectId)
                    setActiveSession(session.projectId, session.id)
                  }
                  clearNotify(id)
                }}
                className="w-full text-left px-2 py-2 rounded border border-rose-600/40 bg-rose-500/10 hover:bg-rose-500/15 text-sm"
              >
                <div className="font-medium text-fg truncate">
                  {project?.name ?? '(未知项目)'} · {session?.agent ?? 'agent'}
                </div>
                <div className="text-[11px] text-muted font-mono truncate">
                  session {id.slice(-8)}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
