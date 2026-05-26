import { useEffect } from 'react'
import { useStore } from './store'
import { migrateGlobalToPerProject } from './customButtons'
import { pushLog } from './logs'
import Workbench from './components/layout/Workbench'

export default function App() {
  const projects = useStore((s) => s.projects)

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
