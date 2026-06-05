import { useEffect, useMemo, useState } from 'react'
import { useStore, HUB_PROJECT_ID } from '../../store'
import * as api from '../../api'
import PermissionsDrawer from '../PermissionsDrawer'
import { alertDialog, confirmDialog } from '../dialog/DialogHost'
import { logAction } from '../../logs'
import { sendToSession } from '../../sendToSession'
import { runBatFile } from '../runExecutable'
import StartScriptDialog from '../StartScriptDialog'
import type { Project } from '../../types'

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
  const liveStatus = useStore((s) => s.liveStatus)
  const activeSessionIdByProject = useStore((s) => s.activeSessionIdByProject)
  const selected = useStore((s) => s.selectedProjectId)
  const select = useStore((s) => s.selectProject)
  const setActivity = useStore((s) => s.setActivity)
  const refreshProjects = useStore((s) => s.refreshProjects)
  const refreshSessions = useStore((s) => s.refreshSessions)
  const memByProject = useStore((s) => s.memByProject)

  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [permProjectId, setPermProjectId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [changeCount, setChangeCount] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<'active' | 'inactive'>('active')
  const [scriptDialogProject, setScriptDialogProject] = useState<Project | null>(null)
  const [launching, setLaunching] = useState<string | null>(null)

  const { activeProjects, inactiveProjects } = useMemo(() => {
    const active: typeof projects = []
    const inactive: typeof projects = []
    for (const p of projects) {
      // __hub__ 系统项目永远不出现在普通项目卡列表（顶部窄图标按钮单独渲染）
      if (p.id === HUB_PROJECT_ID) continue
      const count = sessions.filter((s) => s.projectId === p.id && s.ended_at == null).length
      if (count >= 1) active.push(p)
      else inactive.push(p)
    }
    return { activeProjects: active, inactiveProjects: inactive }
  }, [projects, sessions])

  const currentList = activeTab === 'active' ? activeProjects : inactiveProjects

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
    return sessions.filter((s) => s.projectId === pid && s.ended_at == null).length
  }

  // 项目级 AI 终端内存：后端 mem-stats ticker 每 10s 推一次（字节）。
  // 0/缺失 → 返回 null，前端不渲染数字（无 AI 会话/快照失败时静默）。
  // <1 GB 显示整数 MB；≥1 GB 显示 1 位小数 GB。tabular-nums 等宽对齐。
  function memFor(pid: string): string | null {
    const bytes = memByProject[pid]
    if (!bytes || bytes <= 0) return null
    const mb = bytes / (1024 * 1024)
    if (mb < 1024) return `${Math.round(mb)} MB`
    return `${(mb / 1024).toFixed(1)} GB`
  }

  function openMenu(e: React.MouseEvent, id: string, name: string) {
    e.preventDefault()
    e.stopPropagation()
    const MENU_W = 180
    const MENU_H = 170
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

  // 一键启动：解析项目的启动脚本，有就直接在新终端跑（runBatFile 自带 fs/run-bat 日志），
  // 没有（resolved=null）就弹「设置启动脚本」让大哥选一个 bat。
  async function onLaunch(p: Project) {
    if (launching) return
    setLaunching(p.id)
    try {
      const { resolved } = await api.getStartScript(p.id)
      if (resolved) {
        await runBatFile(p.id, resolved)
      } else {
        setScriptDialogProject(p)
      }
    } catch (e: unknown) {
      await alertDialog(
        `启动失败: ${e instanceof Error ? e.message : String(e)}`,
        { title: '启动失败', variant: 'danger' },
      )
    } finally {
      setLaunching(null)
    }
  }

  function openFilesFor(pid: string) {
    select(pid)
    setActivity('files')
  }

  function pickCurrentTerminal(): { projectId: string; id: string; agent: typeof sessions[number]['agent'] } | null {
    const pid = selected
    if (!pid) return null
    const alive = sessions.filter((s) => {
      if (s.projectId !== pid) return false
      const status = liveStatus[s.id] ?? s.status
      return status !== 'stopped' && status !== 'crashed'
    })
    if (alive.length === 0) return null
    const activeId = activeSessionIdByProject[pid]
    const pick = alive.find((s) => s.id === activeId) ?? alive[0]
    return { projectId: pid, id: pick.id, agent: pick.agent }
  }

  return (
    <aside className="h-full flex flex-col fluent-mica border-r border-border/60 min-h-0">
      <div className="h-9 px-3 flex items-center justify-between text-[11px] uppercase tracking-[0.12em] text-subtle font-medium border-b border-border/40">
        <span>项目</span>
        <span className="text-[10px] normal-case tracking-normal text-subtle tabular-nums">
          {projects.length}
        </span>
      </div>

      <div className="flex gap-1 px-2 py-1 border-b border-border/30">
        {(['active', 'inactive'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`flex-1 text-xs py-1 rounded-sm transition-colors ${
              activeTab === t
                ? 'bg-white/[0.08] text-fg font-medium'
                : 'text-subtle hover:text-fg'
            }`}
          >
            {t === 'active' ? '激活' : '未激活'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-2 py-1.5 space-y-0.5">
        {/* 总控台入口：缩成 ActivityBar 风格的 44px 窄图标按钮（hover tooltip
            显完整文字）。__hub__ 是系统项目，点击 = selectProject('__hub__')
            自动切到 hub-dashboard activity (见 store.selectProject)。 */}
        <div className="flex items-center gap-1 px-1 py-1">
          <button
            onClick={() => select(HUB_PROJECT_ID)}
            onContextMenu={(e) => e.preventDefault()}
            className={`w-9 h-9 inline-flex items-center justify-center rounded-md text-lg border ${
              selected === HUB_PROJECT_ID
                ? 'bg-accent/20 border-accent/50 text-accent'
                : 'border-transparent text-fg hover:bg-white/[0.06]'
            }`}
            title="总控台：跨项目状态看板 + 派工"
          >
            📊
          </button>
          <button
            onClick={() => select(null)}
            className={`fluent-btn flex-1 text-left pl-2 pr-2 py-1.5 text-sm rounded-md ${
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
        </div>
        {projects.length === 0 && (
          <div className="px-3 py-6 text-xs text-muted text-center">
            还没有项目
            <br />
            点击下方 + 新建
          </div>
        )}
        {projects.length > 0 && currentList.length === 0 && (
          <div className="px-3 py-6 text-xs text-muted text-center">
            {activeTab === 'active' ? '当前没有运行中的终端' : '所有项目均已激活'}
          </div>
        )}
        {currentList.map((p) => (
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
                void onLaunch(p)
              }}
              disabled={launching === p.id}
              title="一键运行此项目的启动脚本（start.bat），没有就让你指定一个"
              className="w-6 h-6 shrink-0 inline-flex items-center justify-center rounded text-[12px] text-muted hover:text-accent hover:bg-white/[0.08] disabled:opacity-40"
            >
              ▶
            </button>
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
            {(() => {
              const mem = memFor(p.id)
              return (
                <span className="flex items-center gap-2 shrink-0 text-xs text-subtle tabular-nums">
                  {mem && (
                    <span title="该项目下所有 AI 终端进程树的驻留内存（每 10s 刷新）">
                      {mem}
                    </span>
                  )}
                  <span className="min-w-[16px] text-right">{countFor(p.id)}</span>
                </span>
              )
            })()}
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
          {(() => {
            const target = pickCurrentTerminal()
            const disabled = !target
            return (
              <button
                role="menuitem"
                disabled={disabled}
                title={
                  target
                    ? `把项目路径填入当前 ${target.agent} 终端的输入框`
                    : '请先在另一个项目里打开终端，再来这里发送路径'
                }
                onClick={() => {
                  if (!target) return
                  const { projectId } = menu
                  const proj = projects.find((p) => p.id === projectId)
                  setMenu(null)
                  if (!proj) return
                  const text = `"${proj.path}" `
                  void sendToSession(
                    target.projectId,
                    { id: target.id, agent: target.agent },
                    text,
                    {
                      scope: 'project',
                      meta: {
                        source: 'projects-column',
                        sourceProjectId: projectId,
                        path: proj.path,
                        agent: target.agent,
                      },
                    },
                  )
                }}
                className={`fluent-btn block w-full text-left px-3 py-1.5 mx-1 rounded ${
                  disabled
                    ? 'opacity-40 cursor-not-allowed'
                    : 'hover:bg-white/[0.06]'
                }`}
              >
                💬 发送到终端
              </button>
            )
          })()}
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
              const { projectId } = menu
              const proj = projects.find((p) => p.id === projectId)
              setMenu(null)
              if (proj) setScriptDialogProject(proj)
            }}
            className="fluent-btn block w-full text-left px-3 py-1.5 mx-1 rounded hover:bg-white/[0.06]"
          >
            🚀 设置启动脚本…
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

      {scriptDialogProject && (
        <StartScriptDialog
          project={scriptDialogProject}
          onClose={() => setScriptDialogProject(null)}
          onChanged={() => void refreshProjects()}
        />
      )}
    </aside>
  )
}
