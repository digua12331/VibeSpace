import * as api from './api'
import { useStore } from './store'
import { alertDialog } from './components/dialog/DialogHost'

export interface DispatchClaudeOpts {
  projectId: string
  prompt: string
  successTitle: string
}

export async function dispatchClaude(opts: DispatchClaudeOpts): Promise<void> {
  const { projectId, prompt, successTitle } = opts
  try {
    const session = await api.createSession({ projectId, agent: 'claude' })
    const st = useStore.getState()
    st.addSession(session)
    st.setActiveSession(projectId, session.id)
    let clipboardOk = false
    try {
      await navigator.clipboard.writeText(prompt)
      clipboardOk = true
    } catch {
      /* fall through to dialog fallback */
    }
    if (clipboardOk) {
      await alertDialog(
        '已新建 Claude 终端并聚焦。请在终端里按 Ctrl+V 粘贴、再按回车发送。',
        { title: successTitle },
      )
    } else {
      await alertDialog(
        `已新建 Claude 终端，但自动复制到剪贴板失败。请手动复制下面的 prompt：\n\n${prompt}`,
        { title: successTitle },
      )
    }
  } catch (e: unknown) {
    await alertDialog(
      e instanceof Error ? e.message : String(e),
      { title: '派单失败', variant: 'danger' },
    )
    throw e
  }
}
