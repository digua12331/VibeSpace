import { logAction } from './logs'
import { useStore } from './store'
import type { AgentKind } from './types'

export interface DispatchTarget {
  id: string
  agent: AgentKind
}

/**
 * Route text into a session's floating input instead of writing straight to
 * the pty: switch to its tab and queue the text so the SessionView's useEffect
 * appends it to whatever the user has already typed. The user hits Enter
 * themselves. Callers: file right-click menu (scope='files') and Dev Docs
 * dispatch (scope='docs').
 */
export async function sendToSession(
  projectId: string,
  target: DispatchTarget,
  text: string,
  opts?: { scope?: string; meta?: Record<string, unknown> },
): Promise<void> {
  const scope = opts?.scope ?? 'files'
  await logAction(
    scope,
    'send-to-session',
    async () => {
      const st = useStore.getState()
      st.setActiveTabKind('session')
      st.setActiveSession(projectId, target.id)
      st.queuePendingInput(target.id, text)
    },
    {
      projectId,
      sessionId: target.id,
      meta: { ...opts?.meta, agent: target.agent },
    },
  )
}

/**
 * Pick a live claude session for dispatch. Prefers the project's most-recently
 * active session if it happens to be a live claude, otherwise the first live
 * claude. Returns null when no claude session is alive — callers typically
 * fall back to spawning one.
 */
export function pickClaudeTarget(projectId: string): DispatchTarget | null {
  const st = useStore.getState()
  const alive = st.sessions.filter((s) => {
    if (s.projectId !== projectId) return false
    if (s.agent !== 'claude') return false
    const status = st.liveStatus[s.id] ?? s.status
    return status !== 'stopped' && status !== 'crashed'
  })
  if (alive.length === 0) return null
  const activeId = st.activeSessionIdByProject[projectId]
  const pick = alive.find((s) => s.id === activeId) ?? alive[0]
  return { id: pick.id, agent: pick.agent }
}
