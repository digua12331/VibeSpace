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
 * 内存兜底：当 store.keepAliveDegraded === true（usedJSHeapSize 超过 2GB 触发）后，本组件
 * 把渲染范围收窄到 recentProjectOrder 前 3 个项目（+ 当前 selectedProjectId 兜底），其余项目
 * 的 SessionView 卸载并跑原 dispose 路径，释放内存。
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

  const liveProjectFilter = useMemo(() => {
    if (!keepAliveDegraded) return null
    const keep = new Set<string>(recentProjectOrder.slice(0, KEEPALIVE_LRU_LIMIT))
    if (selectedProjectId != null) keep.add(selectedProjectId)
    return keep
  }, [keepAliveDegraded, recentProjectOrder, selectedProjectId])

  const renderable = useMemo(() => {
    const base = liveProjectFilter
      ? sessions.filter((s) => liveProjectFilter.has(s.projectId))
      : sessions
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
