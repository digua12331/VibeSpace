import { useEffect, useState } from 'react'
import { useStore } from '../store'
import * as api from '../api'
import PermissionsDrawer from './PermissionsDrawer'

interface ContextMenuState {
  projectId: string
  projectName: string
  x: number
  y: number
}

export default function ProjectSidebar({ onNewProject }: { onNewProject: () => void }) {
  const [permProjectId, setPermProjectId] = useState<string | null>(null)
  const projects = useStore((s) => s.projects)
  const sessions = useStore((s) => s.sessions)
  const selected = useStore((s) => s.selectedProjectId)
  const select = useStore((s) => s.selectProject)
  const openChanges = useStore((s) => s.openChanges)
  const refreshProjects = useStore((s) => s.refreshProjects)
  const refreshSessions = useStore((s) => s.refreshSessions)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  async function onDelete(id: string, name: string) {
    if (!confirm(`确认删除项目 "${name}"? (其下 sessions 也会被终止)`)) return
    setBusy(id)
    try {
      await api.deleteProject(id)
      await refreshProjects()
      await refreshSessions()
    } catch (e: unknown) {
      alert(`删除失败: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  function countFor(pid: string): number {
    return sessions.filter((s) => s.projectId === pid).length
  }

  function openMenu(e: React.MouseEvent, id: string, name: string) {
    e.preventDefault()
    e.stopPropagation()
    // Clamp so the menu doesn't clip the viewport edges.
    const MENU_W = 140
    const MENU_H = 44
    const x = Math.min(e.clientX, window.innerWidth - MENU_W - 4)
    const y = Math.min(e.clientY, window.innerHeight - MENU_H - 4)
    setMenu({ projectId: id, projectName: name, x, y })
  }

  return (
    <aside className="w-[260px] shrink-0 border-r border-border/60 fluent-mica flex flex-col">
      <div className="px-4 pt-3 pb-2 text-[11px] uppercase tracking-[0.1em] text-subtle font-medium">
        项目
      </div>
      <div className="flex-1 overflow-auto px-2 pb-2 space-y-0.5">
        <button
          onClick={() => select(null)}
          className={`fluent-btn relative w-full text-left pl-3 pr-3 py-2 text-sm rounded-md ${
            selected === null
              ? 'fluent-selection-indicator bg-white/[0.06] text-fg'
              : 'text-fg hover:bg-white/[0.04]'
          }`}
        >
          <span className={selected === null ? 'font-medium' : 'opacity-90'}>全部 sessions</span>
          <span className="ml-2 text-xs text-subtle">({sessions.length})</span>
        </button>
        {projects.length === 0 && (
          <div className="px-3 py-6 text-xs text-muted text-center">
            还没有项目
            <br />
            点击下方 + 新建
          </div>
        )}
        {projects.map((p) => (
          <div
            key={p.id}
            className={`fluent-btn group flex items-center px-3 py-2 text-sm rounded-md cursor-pointer ${
              selected === p.id
                ? 'fluent-selection-indicator bg-white/[0.08]'
                : 'hover:bg-white/[0.04]'
            } ${busy === p.id ? 'opacity-50 pointer-events-none' : ''}`}
            onClick={() => select(p.id)}
            onContextMenu={(e) => openMenu(e, p.id, p.name)}
            title="右键菜单可删除"
          >
            <div className="flex-1 min-w-0">
              <div
                className={`truncate ${selected === p.id ? 'text-fg font-medium' : 'text-fg'}`}
              >
                {p.name}
              </div>
              <div className="truncate text-xs text-muted font-mono">{p.path}</div>
            </div>
            <span className="text-xs text-subtle ml-2 shrink-0 tabular-nums">{countFor(p.id)}</span>
          </div>
        ))}
      </div>
      <button
        onClick={onNewProject}
        className="fluent-btn m-3 px-3 py-2 text-sm rounded-md border border-dashed border-border hover:border-accent/60 hover:text-accent hover:bg-white/[0.04] text-muted"
      >
        + 新建项目
      </button>

      {menu && (
        <div
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          className="fixed z-50 min-w-[160px] rounded-lg fluent-acrylic shadow-flyout py-1 text-sm animate-fluent-in"
        >
          <button
            role="menuitem"
            onClick={() => {
              const { projectId } = menu
              setMenu(null)
              setPermProjectId(projectId)
            }}
            className="fluent-btn block w-full text-left px-3 py-1.5 mx-1 rounded hover:bg-white/[0.06]"
          >
            ⚙ 权限配置
          </button>
          <button
            role="menuitem"
            onClick={() => {
              const { projectId } = menu
              setMenu(null)
              openChanges(projectId)
            }}
            className="fluent-btn block w-full text-left px-3 py-1.5 mx-1 rounded hover:bg-white/[0.06]"
          >
            📂 代码更改
          </button>
          <button
            role="menuitem"
            onClick={() => {
              const { projectId, projectName } = menu
              setMenu(null)
              void onDelete(projectId, projectName)
            }}
            className="fluent-btn block w-full text-left px-3 py-1.5 mx-1 rounded text-rose-300 hover:bg-rose-500/15"
          >
            删除项目
          </button>
        </div>
      )}

      {permProjectId && (() => {
        const proj = projects.find((p) => p.id === permProjectId)
        if (!proj) return null
        return <PermissionsDrawer project={proj} onClose={() => setPermProjectId(null)} />
      })()}
    </aside>
  )
}
