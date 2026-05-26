import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import * as api from '../../api'
import type { HubStatusResponse, HubProject } from '../../types'
import { logAction } from '../../logs'
import { confirmDialog } from '../dialog/DialogHost'
import HubProjectCard from '../hub/HubProjectCard'
import HubDispatchDialog from '../hub/HubDispatchDialog'

const STATUS_POLL_MS = 5000

/**
 * 总控台看板 (sidebar view)。原 HubView 看板部分搬过来——D1 翻转后主区改用
 * 普通 EditorArea + SessionView，看板作为 sidebar view 显示，仅在
 * selectedProjectId === '__hub__' 时 ActivityBar 才显示入口图标。
 */
export default function HubDashboardView() {
  const [status, setStatus] = useState<HubStatusResponse | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [dispatchTarget, setDispatchTarget] = useState<HubProject | null>(null)
  const selectProject = useStore((s) => s.selectProject)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async (): Promise<void> => {
      try {
        const r = await api.getHubStatus()
        if (!alive) return
        setStatus(r)
        setLoadErr(null)
      } catch (e) {
        if (!alive) return
        setLoadErr((e as Error).message)
      } finally {
        if (alive) timer = setTimeout(() => void tick(), STATUS_POLL_MS)
      }
    }
    void tick()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
    }
  }, [])

  async function refreshNow(): Promise<void> {
    try {
      setStatus(await api.getHubStatus())
    } catch { /* next tick retries */ }
  }

  function onOpenProject(projectId: string): void {
    selectProject(projectId)
  }

  async function onStopAll(p: HubProject): Promise<void> {
    const sids = p.sessions.map((s) => s.id)
    if (sids.length === 0) return
    const ok = await confirmDialog(
      `确定要停止项目 "${p.name}" 下所有 ${sids.length} 个 AI 终端?`,
      { title: '停止所有 AI 终端', variant: 'danger', confirmLabel: '全部停止' },
    )
    if (!ok) return
    await logAction(
      'hub',
      'stop-sessions',
      async () => {
        await Promise.all(
          sids.map((sid) => api.deleteSession(sid).catch(() => undefined)),
        )
      },
      { projectId: p.id, meta: { sessionIds: sids, count: sids.length } },
    )
    await refreshNow()
  }

  async function onStopOne(p: HubProject, sid: string): Promise<void> {
    const ok = await confirmDialog(
      `确定停止 session ${sid.slice(0, 6)}?`,
      { title: '停止 session', variant: 'danger', confirmLabel: '停止' },
    )
    if (!ok) return
    await logAction('hub', 'stop-session', () => api.deleteSession(sid), {
      projectId: p.id,
      sessionId: sid,
    })
    await refreshNow()
  }

  if (loadErr && !status) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-rose-300 text-xs p-4">
        加载总控台失败: {loadErr}
      </div>
    )
  }
  if (!status) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-muted text-xs">
        加载中…
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 py-2 text-[11px] text-muted border-b border-border/40">
        全部 {status.projects.length} 个项目 · 每 {STATUS_POLL_MS / 1000}s 刷新
      </div>
      <div className="flex-1 overflow-auto p-2 space-y-2">
        {status.projects.length === 0 && (
          <div className="text-center text-muted text-xs py-8">
            还没有项目。点左下角 "+ 项目" 开始。
          </div>
        )}
        {status.projects.map((p) => (
          <HubProjectCard
            key={p.id}
            project={p}
            onOpen={() => onOpenProject(p.id)}
            onDispatch={() => setDispatchTarget(p)}
            onStopAll={() => void onStopAll(p)}
            onStopOne={(sid) => void onStopOne(p, sid)}
            onOpenSession={() => onOpenProject(p.id)}
          />
        ))}
      </div>
      {dispatchTarget && (
        <HubDispatchDialog
          project={dispatchTarget}
          onClose={() => setDispatchTarget(null)}
          onSuccess={() => {
            setDispatchTarget(null)
            void refreshNow()
          }}
        />
      )}
    </div>
  )
}
