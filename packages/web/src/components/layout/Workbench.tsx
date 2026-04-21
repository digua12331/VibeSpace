import { useEffect, useRef, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import type { PanelImperativeHandle, PanelSize } from 'react-resizable-panels'
import { useStore } from '../../store'
import { currentPermission, requestPermission } from '../../notify'
import { aimonWS } from '../../ws'
import ActivityBar from './ActivityBar'
import PrimarySidebar from './PrimarySidebar'
import ProjectsColumn from './ProjectsColumn'
import EditorArea from '../editor/EditorArea'
import NewProjectDialog from '../NewProjectDialog'
import DialogHost, { confirmDialog } from '../dialog/DialogHost'

export default function Workbench() {
  const wsState = useStore((s) => s.wsState)
  const serverVersion = useStore((s) => s.serverVersion)
  const refreshProjects = useStore((s) => s.refreshProjects)
  const refreshSessions = useStore((s) => s.refreshSessions)
  const notifyPerm = useStore((s) => s.notifyPerm)
  const setNotifyPerm = useStore((s) => s.setNotifyPerm)

  const projectsColumnSize = useStore((s) => s.projectsColumnSize)
  const setProjectsColumnSize = useStore((s) => s.setProjectsColumnSize)
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed)
  const sidebarSize = useStore((s) => s.sidebarSize)
  const setSidebarSize = useStore((s) => s.setSidebarSize)

  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)
  const [bootLoading, setBootLoading] = useState(true)

  const sidebarRef = useRef<PanelImperativeHandle | null>(null)

  useEffect(() => {
    setBootLoading(true)
    Promise.all([refreshProjects(), refreshSessions()])
      .then(() => setBootError(null))
      .catch((e: unknown) =>
        setBootError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setBootLoading(false))
  }, [refreshProjects, refreshSessions])

  useEffect(() => {
    if (wsState !== 'open') return
    refreshProjects().catch(() => {})
    refreshSessions().catch(() => {})
  }, [wsState, refreshProjects, refreshSessions])

  useEffect(() => {
    setNotifyPerm(currentPermission())
  }, [setNotifyPerm])

  // Reflect store's collapsed flags onto the actual Panel handles.
  useEffect(() => {
    const h = sidebarRef.current
    if (!h) return
    if (sidebarCollapsed) h.collapse()
    else if (h.isCollapsed()) h.expand()
  }, [sidebarCollapsed])

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
      {wsState === 'closed' && (
        <div className="px-4 py-1.5 text-xs text-rose-200 bg-rose-900/30 border-b border-rose-700/40 flex items-center justify-between">
          <span>
            后端 WebSocket 已断开，正在自动重连… 如未恢复请确认 server 是否在 127.0.0.1:8787 运行。
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
        <div className="px-4 py-1.5 text-xs text-rose-200 bg-rose-900/30 border-b border-rose-700/40 flex items-center justify-between">
          <span>后端连接失败: {bootError}</span>
          <button
            onClick={onRetry}
            className="fluent-btn ml-3 px-2 py-0.5 rounded-md border border-rose-600/50 hover:bg-rose-500/20"
          >
            重试
          </button>
        </div>
      )}

      <div className="flex-1 flex min-h-0 relative">
        {bootLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-bg/60 backdrop-blur-sm">
            <div className="text-sm text-muted flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse-soft" />
              正在加载…
            </div>
          </div>
        )}
        <Group orientation="horizontal" id="aimon-main-hsplit" className="flex-1 min-h-0 flex">
          <Panel
            minSize="8%"
            maxSize="40%"
            defaultSize={`${projectsColumnSize}%`}
            onResize={(s: PanelSize) => setProjectsColumnSize(s.asPercentage)}
          >
            <ProjectsColumn onNewProject={() => setNewProjectOpen(true)} />
          </Panel>
          <Separator className="w-[3px] bg-transparent hover:bg-accent/40 active:bg-accent/70 transition-colors" />
          <Panel minSize="44px" maxSize="44px" defaultSize="44px">
            <ActivityBar />
          </Panel>
          <Panel
            panelRef={sidebarRef}
            collapsible
            collapsedSize="0%"
            minSize="8%"
            maxSize="35%"
            defaultSize={`${sidebarSize}%`}
            onResize={(s: PanelSize) => setSidebarSize(s.asPercentage)}
          >
            <PrimarySidebar />
          </Panel>
          <Separator className="w-[3px] bg-transparent hover:bg-accent/40 active:bg-accent/70 transition-colors" />
          <Panel minSize="30%">
            <EditorArea />
          </Panel>
        </Group>
      </div>

      <footer className="h-6 flex items-center justify-between px-3 border-t border-border/60 bg-black/30 text-[11px] text-muted">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
            {label}
          </span>
          {serverVersion && <span className="text-subtle">v{serverVersion}</span>}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              const ok = await confirmDialog('重置布局与持久化设置 (页面会刷新)?', {
                title: '重置布局',
                variant: 'danger',
                confirmLabel: '重置',
              })
              if (!ok) return
              try {
                localStorage.removeItem('aimon_workbench_v3')
                localStorage.removeItem('aimon_workbench_v2')
                localStorage.removeItem('aimon_workbench_v1')
                localStorage.removeItem('aimon_layouts_v1')
                localStorage.removeItem('aimon_tile_size_by_agent_v1')
              } catch { /* ignore */ }
              location.reload()
            }}
            className="hover:text-fg"
            title="清除本地布局 & 偏好"
          >
            ⟳ 重置布局
          </button>
          <button
            onClick={() => void onNotifyClick()}
            disabled={notifyPerm === 'unsupported' || notifyPerm === 'denied'}
            title={
              notifyPerm === 'granted'
                ? '通知已开启'
                : notifyPerm === 'denied'
                  ? '通知被拒绝 (浏览器设置中开启)'
                  : notifyPerm === 'unsupported'
                    ? '此浏览器不支持通知'
                    : '点击启用 waiting_input 通知'
            }
            className="hover:text-fg disabled:cursor-not-allowed"
          >
            🔔 {notifyPerm}
          </button>
          <button
            onClick={() => setNewProjectOpen(true)}
            className="hover:text-accent"
            title="新建项目"
          >
            + 项目
          </button>
        </div>
      </footer>

      {newProjectOpen && <NewProjectDialog onClose={() => setNewProjectOpen(false)} />}
      <DialogHost />
    </div>
  )
}
