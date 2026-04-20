import { useEffect, useState } from 'react'
import { useStore } from './store'
import { currentPermission, requestPermission } from './notify'
import { aimonWS } from './ws'
import ProjectSidebar from './components/ProjectSidebar'
import SessionGrid from './components/SessionGrid'
import NewProjectDialog from './components/NewProjectDialog'
import LogDrawer from './components/LogDrawer'
import ChangesDrawer from './components/ChangesDrawer'

export default function App() {
  const wsState = useStore((s) => s.wsState)
  const serverVersion = useStore((s) => s.serverVersion)
  const refreshProjects = useStore((s) => s.refreshProjects)
  const refreshSessions = useStore((s) => s.refreshSessions)
  const notifyPerm = useStore((s) => s.notifyPerm)
  const setNotifyPerm = useStore((s) => s.setNotifyPerm)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)
  const [bootLoading, setBootLoading] = useState(true)
  const logOpen = useStore((s) => s.logOpen)
  const toggleLog = useStore((s) => s.toggleLog)
  const logCount = useStore((s) => s.logs.length)
  const logErrorCount = useStore((s) => s.logs.filter((l) => l.level === 'error').length)
  const selectedProjectId = useStore((s) => s.selectedProjectId)
  const openChanges = useStore((s) => s.openChanges)

  useEffect(() => {
    setBootLoading(true)
    Promise.all([refreshProjects(), refreshSessions()])
      .then(() => setBootError(null))
      .catch((e: unknown) => {
        setBootError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setBootLoading(false))
  }, [refreshProjects, refreshSessions])

  // Re-fetch projects + sessions whenever the WS reconnects: lets a server
  // restart re-populate the UI without a manual page refresh.
  useEffect(() => {
    if (wsState !== 'open') return
    refreshProjects().catch(() => { /* shown via bootError on next try */ })
    refreshSessions().catch(() => { /* same */ })
  }, [wsState, refreshProjects, refreshSessions])

  // Keep store in sync if browser perm changed elsewhere.
  useEffect(() => {
    setNotifyPerm(currentPermission())
  }, [setNotifyPerm])

  async function onNotifyClick() {
    if (notifyPerm === 'default') {
      const next = await requestPermission()
      setNotifyPerm(next)
    }
  }

  function onRetry() {
    setBootError(null)
    setBootLoading(true)
    aimonWS.connect()
    Promise.all([refreshProjects(), refreshSessions()])
      .then(() => setBootError(null))
      .catch((e: unknown) => setBootError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBootLoading(false))
  }

  const notifyTitle =
    notifyPerm === 'granted'
      ? '通知已开启 (waiting_input 时弹出)'
      : notifyPerm === 'denied'
        ? '通知被拒绝 (浏览器设置中开启)'
        : notifyPerm === 'unsupported'
          ? '此浏览器不支持通知'
          : '点击启用 waiting_input 通知'
  const notifyColor =
    notifyPerm === 'granted'
      ? 'text-emerald-300 border-emerald-600/40 bg-emerald-500/10'
      : notifyPerm === 'denied' || notifyPerm === 'unsupported'
        ? 'text-rose-300 border-rose-600/40 bg-rose-500/10'
        : 'text-muted border-border hover:text-fg hover:bg-white/[0.04]'

  const dot =
    wsState === 'open'
      ? 'bg-emerald-400'
      : wsState === 'connecting'
        ? 'bg-amber-400 animate-pulse-soft'
        : 'bg-rose-500'
  const label =
    wsState === 'open' ? 'connected' : wsState === 'connecting' ? 'connecting' : 'closed'

  return (
    <div className="h-full flex flex-col bg-bg text-fg">
      <header className="h-12 flex items-center justify-between px-4 border-b border-border/60 fluent-mica">
        <div className="flex items-center gap-3">
          <span className="font-display font-semibold tracking-wide text-[15px]">aimon</span>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
            {label}
            {serverVersion && <span className="ml-1 text-subtle">v{serverVersion}</span>}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => selectedProjectId && openChanges(selectedProjectId)}
            disabled={!selectedProjectId}
            title={selectedProjectId ? '查看源代码更改' : '请先选中一个项目'}
            className={`fluent-btn px-2.5 py-1 text-sm rounded-md border ${
              selectedProjectId
                ? 'border-border text-muted hover:text-fg hover:bg-white/[0.04]'
                : 'border-border/50 text-subtle cursor-not-allowed'
            }`}
          >
            📂 更改
          </button>
          <button
            onClick={toggleLog}
            title={logOpen ? '收起项目日志' : '展开项目日志'}
            className={`fluent-btn px-2.5 py-1 text-sm rounded-md border ${
              logErrorCount > 0
                ? 'border-rose-600/40 text-rose-300 bg-rose-500/10'
                : logOpen
                  ? 'border-accent/40 text-accent bg-accent/10'
                  : 'border-border text-muted hover:text-fg hover:bg-white/[0.04]'
            }`}
          >
            📋 日志 {logCount > 0 && <span className="opacity-70">({logCount}{logErrorCount > 0 ? `, ${logErrorCount}❗` : ''})</span>}
          </button>
          <button
            onClick={() => void onNotifyClick()}
            title={notifyTitle}
            disabled={notifyPerm === 'unsupported' || notifyPerm === 'denied'}
            className={`fluent-btn px-2.5 py-1 text-sm rounded-md border disabled:cursor-not-allowed ${notifyColor}`}
          >
            🔔 {notifyPerm}
          </button>
          <button
            onClick={() => setNewProjectOpen(true)}
            className="fluent-btn px-3 py-1 text-sm rounded-md bg-accent text-[#003250] font-medium hover:bg-accent-2 border border-accent/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
          >
            + 项目
          </button>
        </div>
      </header>

      {wsState === 'closed' && (
        <div className="px-4 py-2 text-xs text-rose-200 bg-rose-900/30 border-b border-rose-700/40 flex items-center justify-between">
          <span>
            后端 WebSocket 已断开,正在自动重连… 如未恢复请确认 server 是否在 127.0.0.1:8787 运行。
          </span>
          <button
            onClick={onRetry}
            className="fluent-btn ml-3 px-2 py-0.5 rounded-md border border-rose-600/50 hover:bg-rose-500/20"
          >
            立即重试
          </button>
        </div>
      )}

      {bootError && (
        <div className="px-4 py-2 text-xs text-rose-200 bg-rose-900/30 border-b border-rose-700/40 flex items-center justify-between">
          <span>后端连接失败: {bootError}</span>
          <button
            onClick={onRetry}
            className="fluent-btn ml-3 px-2 py-0.5 rounded-md border border-rose-600/50 hover:bg-rose-500/20"
          >
            重试
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <ProjectSidebar onNewProject={() => setNewProjectOpen(true)} />
        <main className="flex-1 overflow-auto relative">
          {bootLoading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg/60 backdrop-blur-sm">
              <div className="text-sm text-muted flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse-soft" />
                正在加载…
              </div>
            </div>
          )}
          <SessionGrid />
          <LogDrawer />
        </main>
      </div>

      {newProjectOpen && <NewProjectDialog onClose={() => setNewProjectOpen(false)} />}
      <ChangesDrawer />
    </div>
  )
}
