import * as api from './api'
import { useStore } from './store'
import { alertDialog } from './components/dialog/DialogHost'
import { logAction } from './logs'

export interface DispatchClaudeOpts {
  projectId: string
  prompt: string
  successTitle: string
}

export async function dispatchClaude(opts: DispatchClaudeOpts): Promise<void> {
  const { projectId, prompt, successTitle } = opts
  try {
    await logAction(
      'docs',
      'dispatch',
      async () => {
        const session = await api.createSession({ projectId, agent: 'claude' })
        const st = useStore.getState()
        st.addSession(session)
        st.setActiveSession(projectId, session.id)
        st.setActiveTabKind('session')
        // Queue the prompt into pendingInputBySession. When SessionView mounts
        // for this new session, its drain effect (see SessionView.tsx) reads
        // the queue and fills the floating input — same path as sendToSession
        // for already-alive sessions. No clipboard detour, no extra dialog;
        // the user reviews the prefilled text and presses Enter.
        st.queuePendingInput(session.id, prompt)
      },
      { projectId, meta: { target: 'claude', kind: successTitle } },
    )
  } catch (e: unknown) {
    await alertDialog(
      e instanceof Error ? e.message : String(e),
      { title: '派单失败', variant: 'danger' },
    )
    throw e
  }
}
