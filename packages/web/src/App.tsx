import { useEffect } from 'react'
import { useStore } from './store'
import { getAppSettings } from './api'
import { migrateGlobalToPerProject } from './customButtons'
import { pushLog } from './logs'
import Workbench from './components/layout/Workbench'

export default function App() {
  const projects = useStore((s) => s.projects)
  const setTerminalKeybindings = useStore((s) => s.setTerminalKeybindings)
  const setMaxAiTerminals = useStore((s) => s.setMaxAiTerminals)

  // Load app settings once on startup so the terminal can honor the user's
  // custom abort/interrupt alt keys without waiting for the Settings dialog
  // to be opened. Failure is non-fatal — defaults (Esc / Ctrl+C only) hold.
  useEffect(() => {
    getAppSettings()
      .then((s) => {
        if (s.terminalKeybindings) setTerminalKeybindings(s.terminalKeybindings)
        if (typeof s.maxAiTerminals === 'number') setMaxAiTerminals(s.maxAiTerminals)
      })
      .catch(() => {
        /* settings unreachable — keep built-in defaults */
      })
  }, [setTerminalKeybindings, setMaxAiTerminals])

  // One-shot migration of legacy global custom-buttons into per-project
  // buckets. Idempotent inside migrateGlobalToPerProject (marker flag), so
  // re-runs on projects updates are cheap no-ops after the first success.
  useEffect(() => {
    if (projects.length === 0) return
    const result = migrateGlobalToPerProject(projects.map((p) => p.id))
    if (result == null) return
    pushLog({
      level: 'info',
      scope: 'session',
      msg: 'custom-buttons-migrated',
      meta: { projectCount: result.projectCount, buttonCount: result.buttonCount },
    })
  }, [projects])

  return <Workbench />
}
