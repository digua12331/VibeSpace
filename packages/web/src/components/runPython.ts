import * as api from '../api'
import { aimonWS } from '../ws'
import { useStore } from '../store'
import { logAction } from '../logs'

/**
 * Spawn a fresh cmd session, focus it, then write a single line that cd's
 * into the script's directory and invokes the PATH-resident `python`. Mirrors
 * the .bat "执行" path in fileContextMenu.ts so the conpty 120ms warm-up
 * applies the same way. Errors propagate out so the caller can show a dialog;
 * logAction has already recorded an ERROR entry.
 */
export async function runPythonFile(projectId: string, path: string): Promise<void> {
  await logAction(
    'fs',
    'run-python',
    async () => {
      const s = await api.createSession({ projectId, agent: 'cmd' })
      const st = useStore.getState()
      st.addSession(s)
      st.setActiveSession(projectId, s.id)
      st.setActiveTabKind('session')
      aimonWS.subscribe([s.id])
      await new Promise((r) => setTimeout(r, 120))
      const winPath = path.replace(/\//g, '\\')
      const slash = winPath.lastIndexOf('\\')
      const dir = slash >= 0 ? winPath.slice(0, slash) : '.'
      const file = slash >= 0 ? winPath.slice(slash + 1) : winPath
      const line = `cd /d "${dir}" && python "${file}"\r`
      aimonWS.sendInput(s.id, line)
    },
    { projectId, meta: { path } },
  )
}
