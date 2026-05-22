import { memo, useMemo } from 'react'
import { useStore } from '../../store'
import SessionView from './SessionView'
import { KEEPALIVE_LRU_LIMIT } from '../../perf-marks'
import type { Session } from '../../types'

/**
 * 全局终端宿主：把所有 sessions 的 SessionView 挂在 Workbench 顶层、跨项目切换不卸载。
 *
 * 旧做法是 EditorArea 按 selectedProjectId 过滤后 map 渲染 SessionView，切项目导致旧项目
 * 全部 SessionView unmount → xterm `term.dispose()` + WS unsubscribe，新项目又全部 mount →
 * 重建 xterm + 重新 subscribe + replay 历史。session 多时这一拆一建就是用户感知到的"卡"。
 *
 * 提到这里后，跨项目切换只改 SessionView 的 `active` prop（visibility:hidden 隐藏，组件本身
 * 不卸载），xterm 实例和 PTY 订阅原地保留。
 *
 * 保活预算：始终只渲染「当前 selectedProjectId + recentProjectOrder 前 KEEPALIVE_LRU_LIMIT
 * 个项目」的 SessionView，其余项目的会话只留标签、不挂 xterm。这样跨项目开很多会话时后台
 * 不会无限累积 xterm 实例。被剔除的 SessionView 走原 unmount 路径（term.dispose() + WS
 * 退订），用户切回该项目时重新挂载并 replay 后端历史。
 *
 * 内存兜底：当 store.keepAliveDegraded === true（usedJSHeapSize 超过 2GB 触发）后，预算进一步
 * 收窄到仅当前 selectedProjectId 一个项目，作为第二道防线。
 */
const ALL_KEY = '__all__'

function TerminalHostInner() {
  const sessions = useStore((s) => s.sessions)
  const selectedProjectId = useStore((s) => s.selectedProjectId)
  const activeMap = useStore((s) => s.activeSessionIdByProject)
  const activeTabKind = useStore((s) => s.activeTabKind)
  const keepAliveDegraded = useStore((s) => s.keepAliveDegraded)
  const recentProjectOrder = useStore((s) => s.recentProjectOrder)
  const removeSession = useStore((s) => s.removeSession)
  const addSession = useStore((s) => s.addSession)
  const setActiveSession = useStore((s) => s.setActiveSession)
  const setActiveTabKind = useStore((s) => s.setActiveTabKind)

  // 保活集合：当前项目 + 最近 N 个项目。降级时 N=0（只剩当前项目）。
  const liveProjectFilter = useMemo(() => {
    const limit = keepAliveDegraded ? 0 : KEEPALIVE_LRU_LIMIT
    const keep = new Set<string>(recentProjectOrder.slice(0, limit))
    if (selectedProjectId != null) keep.add(selectedProjectId)
    return keep
  }, [keepAliveDegraded, recentProjectOrder, selectedProjectId])

  const renderable = useMemo(() => {
    const base = sessions.filter((s) => liveProjectFilter.has(s.projectId))
    return [...base].sort((a, b) => a.started_at - b.started_at)
  }, [sessions, liveProjectFilter])

  // 计算"哪个 session 是当前 active tab"。当 selectedProjectId 为 null（"全部 sessions"
  // 视图）时落到 ALL_KEY，与 EditorArea 的约定保持一致。
  const sessionKey = selectedProjectId ?? ALL_KEY
  const storedActive = activeMap[sessionKey] ?? null
  const visibleNow = useMemo(() => {
    return selectedProjectId
      ? renderable.filter((s) => s.projectId === selectedProjectId)
      : renderable
  }, [renderable, selectedProjectId])
  const activeSessionId =
    (storedActive && visibleNow.some((s) => s.id === storedActive) && storedActive) ||
    (visibleNow[visibleNow.length - 1]?.id ?? null)

  function handleRestart(oldId: string, next: Session) {
    removeSession(oldId)
    addSession(next)
    setActiveSession(next.projectId, next.id)
    setActiveTabKind('session')
  }

  return (
    <>
      {renderable.map((s) => {
        const visible =
          (selectedProjectId == null || s.projectId === selectedProjectId) &&
          activeTabKind === 'session' &&
          s.id === activeSessionId
        return (
          <SessionView
            key={s.id}
            session={s}
            active={visible}
            onClose={removeSession}
            onRestart={handleRestart}
          />
        )
      })}
    </>
  )
}

const TerminalHost = memo(TerminalHostInner)
export default TerminalHost
