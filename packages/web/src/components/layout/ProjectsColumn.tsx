import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import * as api from '../../api'
import PermissionsDrawer from '../PermissionsDrawer'
import { alertDialog, confirmDialog } from '../dialog/DialogHost'
import { logAction } from '../../logs'

interface ContextMenuState {
  projectId: string
  projectName: string
  x: number
  y: number
}

export default function ProjectsColumn({
  onNewProject,
}: {
  onNewProject: () => void
}) {
  const projects = useStore((s) => s.projects)
  const sessions = useStore((s) => s.sessions)
  const selected = useStore((s) => s.selectedProjectId)
  const select = useStore((s) => s.selectProject)
  const setActivity = useStore((s) => s.setActivity)
  const refreshProjects = useStore((s) => s.refreshProjects)
  const refreshSessions = useStore((s) => s.refreshSessions)

  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [permProjectId, setPermProjectId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [changeCount, setChangeCount] = useState<number | null>(null)

  useEffect(() => {
    if (!menu) {
      setChangeCount(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const r = await api.getProjectChanges(menu.projectId)
        if (cancelled) return
        setChangeCount(r.enabled ? r.staged.length + r.unstaged.length : null)
      } catch {
        if (!cancelled) setChangeCount(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [menu])

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
    const ok = await confirmDialog(
      `确认删除项目 "${name}"? (其下 sessions 也会被终止)`,
      { title: '删除项目', variant: 'danger', confirmLabel: '删除' },
    )
    if (!ok) return
    setBusy(id)
    try {
      await logAction(
        'project',
        'delete',
        async () => {
          await api.deleteProject(id)
          await refreshProjects()
          await refreshSessions()
        },
        { projectId: id, meta: { name } },
      )
    } catch (e: unknown) {
      await alertDialog(
        `删除失败: ${e instanceof Error ? e.message : String(e)}`,
        { title: '删除失败', variant: 'danger' },
      )
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
    const MENU_W = 180
    const MENU_H = 140
    const EDGE_PAD = 4
    // Anchor the menu's left edge to the project row's left edge. The
    // projects column is narrow, so opening to the right of the row would
    // spill into the next column; starting at the row's left keeps the whole
    // menu within (or immediately adjacent to) the projects column.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = rect.left + 30
    if (x + MENU_W + EDGE_PAD > vw) x = Math.max(EDGE_PAD, vw - MENU_W - EDGE_PAD)
    if (x < EDGE_PAD) x = EDGE_PAD
    let y = rect.top + 30
    if (y + MENU_H + EDGE_PAD > vh) y = Math.max(EDGE_PAD, vh - MENU_H - EDGE_PAD)
    setMenu({ projectId: id, projectName: name, x, y })
  }

  function openScmFor(pid: string) {
    select(pid)
    setActivity('scm')
  }

  function openFilesFor(pid: string) {
    select(pid)
    setActivity('files')
  }

  return (
    <aside className="h-full flex flex-col fluent-mica border-r border-border/60 min-h-0">
      <div className="h-9 px-3 flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-subtle font-medium border-b border-border/40">
        <span>项目</span>
        <span className="text-[10px] normal-case tracking-normal text-subtle tabular-nums">
          {projects.length}
        </span>
      </div>

      <div className="flex-1 overflow-auto px-2 py-1.5 space-y-0.5">
        <button
          onClick={() => select(null)}
          className={`fluent-btn relative w-full text-left pl-3 pr-3 py-2 text-sm rounded-md ${
            selected === null
              ? 'fluent-selection-indicator bg-white/[0.06] text-fg'
              : 'text-fg hover:bg-white/[0.04]'
          }`}
        >
          <span className={selected === null ? 'font-medium' : 'opacity-90'}>
            全部 sessions
          </span>
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
            className={`fluent-btn group flex items-center gap-2 px-3 py-2 text-sm rounded-md cursor-pointer ${
              selected === p.id
                ? 'fluent-selection-indicator bg-white/[0.08]'
                : 'hover:bg-white/[0.04]'
            } ${busy === p.id ? 'opacity-50 pointer-events-none' : ''}`}
            onClick={() => select(p.id)}
            onContextMenu={(e) => openMenu(e, p.id, p.name)}
            title="右键可管理"
          >
            <div className="flex-1 min-w-0">
              <div
                className={`truncate ${selected === p.id ? 'text-fg font-medium' : 'text-fg'}`}
              >
                {p.name}
              </div>
              <div className="truncate text-xs text-muted font-mono">{p.path}</div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation()
                openScmFor(p.id)
              }}
              title="查看此项目的代码更改"
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 w-6 h-6 inline-flex items-center justify-center rounded text-[13px] text-muted hover:text-fg hover:bg-white/[0.08]"
            >
              🌿
            </button>
            <span className="text-xs text-subtle shrink-0 tabular-nums min-w-[16px] text-right">
              {countFor(p.id)}
            </span>
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
          className="fixed z-50 min-w-[170px] rounded-lg fluent-acrylic shadow-flyout py-1 text-sm animate-fluent-in"
        >
          <button
            role="menuitem"
            onClick={() => {
              const { projectId } = menu
              setMenu(null)
              openScmFor(projectId)
            }}
            className="fluent-btn flex items-center w-full text-left px-3 py-1.5 mx-1 rounded hover:bg-white/[0.06]"
          >
            <span className="flex-1">🌿 代码更改</span>
            {changeCount != null && changeCount > 0 && (
              <span className="ml-2 shrink-0 rounded-full bg-rose-500 text-white text-[10px] leading-none tabular-nums font-medium px-1.5 py-0.5">
                {changeCount > 99 ? '99+' : changeCount}
              </span>
            )}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              const { projectId } = menu
              setMenu(null)
              openFilesFor(projectId)
            }}
            className="fluent-btn block w-full text-left px-3 py-1.5 mx-1 rounded hover:bg-white/[0.06]"
          >
            📁 文件
          </button>
          <button
            role="menuitem"
            onClick={async () => {
              const { projectId } = menu
              setMenu(null)
              try {
                await api.openInVscode(projectId)
              } catch (e: unknown) {
                await alertDialog(
                  e instanceof Error ? e.message : String(e),
                  { title: '启动 VSCode 失败', variant: 'danger' },
                )
              }
            }}
            className="fluent-btn block w-full text-left px-3 py-1.5 mx-1 rounded hover:bg-white/[0.06]"
          >
            🧩 用 VSCode 打开
          </button>
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
