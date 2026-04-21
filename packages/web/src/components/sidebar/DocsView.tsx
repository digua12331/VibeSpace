import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import * as api from '../../api'
import { alertDialog, confirmDialog } from '../dialog/DialogHost'
import type { DocFileKind, DocTaskSummary } from '../../types'

const EMPTY_TASKS: DocTaskSummary[] = []

/**
 * Display order + labels for the three Dev Docs files. The `order` prefix is
 * shown to the user so scanning a task's children is a glance rather than a
 * read. Keys match server-side kinds.
 */
const DOC_ROWS: Array<{ kind: DocFileKind; order: string; label: string }> = [
  { kind: 'plan', order: '01_plan', label: '做什么 / 怎么做' },
  { kind: 'context', order: '02_context', label: '关键文件 / 决策' },
  { kind: 'tasks', order: '03_tasks', label: '任务清单' },
]

function formatTimeAgo(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时前`
  const days = Math.floor(diff / 86400_000)
  if (days < 30) return `${days}天前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function StatusPill({ task }: { task: DocTaskSummary }) {
  if (task.status === 'done') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-emerald-600/40 bg-emerald-500/10 text-emerald-300">
        ✓ 完成
      </span>
    )
  }
  if (task.status === 'doing') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-amber-600/40 bg-amber-500/10 text-amber-200 tabular-nums">
        进行中 {task.checked}/{task.total}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-border bg-white/[0.04] text-muted">
      未开始
    </span>
  )
}

interface FileRowProps {
  order: string
  label: string
  extra?: string
  onOpen: () => void
  fileName: string
}

function FileRow({ order, label, extra, onOpen, fileName }: FileRowProps) {
  return (
    <button
      onClick={onOpen}
      className="fluent-btn w-full text-left pl-8 pr-3 py-1 text-[12.5px] rounded hover:bg-white/[0.06] flex items-center gap-2"
      title={`打开 ${fileName}`}
    >
      <span className="font-mono text-subtle tabular-nums shrink-0">
        {order}
      </span>
      <span className="text-subtle">:</span>
      <span className="flex-1 truncate">{label}</span>
      {extra && (
        <span className="text-[10px] text-subtle tabular-nums shrink-0">
          {extra}
        </span>
      )}
    </button>
  )
}

export default function DocsView() {
  const projectId = useStore((s) => s.selectedProjectId)
  const projects = useStore((s) => s.projects)
  const storedTasks = useStore((s) =>
    projectId ? s.docsTasks[projectId] : undefined,
  )
  const tasks = storedTasks ?? EMPTY_TASKS
  const loading = useStore((s) =>
    projectId ? s.docsLoading[projectId] === true : false,
  )
  const error = useStore((s) =>
    projectId ? s.docsError[projectId] ?? null : null,
  )
  const refreshDocs = useStore((s) => s.refreshDocs)
  const archiveDocsTask = useStore((s) => s.archiveDocsTask)
  const openFile = useStore((s) => s.openFile)

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [applyingRules, setApplyingRules] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!projectId) return
    refreshDocs(projectId).catch(() => {
      /* error already recorded in store */
    })
  }, [projectId, refreshDocs])

  // Reset the search UI when the project changes so the query from project A
  // doesn't linger after the user picks project B.
  useEffect(() => {
    setQuery('')
    setSearchOpen(false)
  }, [projectId])

  // Auto-focus the input the instant the search bar opens.
  useEffect(() => {
    if (searchOpen) {
      // Defer to next frame so the input has been committed to the DOM.
      const id = requestAnimationFrame(() => searchInputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [searchOpen])

  const filteredTasks = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tasks
    return tasks.filter((t) => t.name.toLowerCase().includes(q))
  }, [tasks, query])

  if (!projectId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-sm text-muted text-center">
        <div>请先在左侧「项目」列表中选中一个项目</div>
      </div>
    )
  }

  const project = projects.find((p) => p.id === projectId)

  function openDoc(task: string, kind: DocFileKind) {
    if (!projectId) return
    const path = `dev/active/${task}/${task}-${kind}.md`
    openFile({ projectId, path })
  }

  async function onApplyRules() {
    if (!projectId) return
    setApplyingRules(true)
    try {
      const r = await api.applyDevDocsGuidelines(projectId)
      await alertDialog(
        r.wrote
          ? `已写入 Dev Docs 工作流守则到 CLAUDE.md：\n${r.target}\n\n重启当前项目下的 AI session 让它生效。`
          : `CLAUDE.md 里已存在这份守则，无需重复追加：\n${r.target}`,
        { title: r.wrote ? '已应用' : '已存在' },
      )
    } catch (e: unknown) {
      await alertDialog(
        e instanceof Error ? e.message : String(e),
        { title: '应用失败', variant: 'danger' },
      )
    } finally {
      setApplyingRules(false)
    }
  }

  async function onArchive(task: string) {
    const ok = await confirmDialog(
      `归档任务 "${task}"? 该任务目录会被移动到 dev/archive/ 下。`,
      { title: '归档任务', confirmLabel: '归档' },
    )
    if (!ok) return
    try {
      await archiveDocsTask(projectId, task)
    } catch (e: unknown) {
      await alertDialog(
        e instanceof Error ? e.message : String(e),
        { title: '归档失败', variant: 'danger' },
      )
    }
  }

  function toggle(name: string) {
    setExpanded((st) => ({ ...st, [name]: !st[name] }))
  }

  function toggleSearch() {
    setSearchOpen((v) => {
      const next = !v
      if (!next) setQuery('')
      return next
    })
  }

  const hasQuery = query.trim().length > 0

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {project && (
        <div
          className="px-3 py-1.5 text-[11px] text-muted border-b border-border/40 truncate flex items-center justify-between gap-2"
          title={project.path}
        >
          <span className="truncate">{project.name}</span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={toggleSearch}
              title="搜索任务"
              className={`fluent-btn w-6 h-6 inline-flex items-center justify-center rounded hover:bg-white/[0.08] ${
                searchOpen ? 'text-accent bg-white/[0.06]' : 'text-muted hover:text-fg'
              }`}
            >
              🔍
            </button>
            <button
              onClick={() => void onApplyRules()}
              disabled={applyingRules}
              title="把 Dev Docs 工作流守则写入此项目的 CLAUDE.md（让 AI 学会 plan→context→tasks 流程）"
              className="fluent-btn w-6 h-6 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.08] disabled:opacity-50"
            >
              {applyingRules ? '…' : '⚙'}
            </button>
            <button
              onClick={() => void refreshDocs(projectId)}
              title="刷新"
              className="fluent-btn w-6 h-6 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.08]"
            >
              ⟳
            </button>
          </div>
        </div>
      )}

      {searchOpen && (
        <div className="px-2 py-1.5 border-b border-border/40 flex items-center gap-1.5">
          <input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('')
                setSearchOpen(false)
              }
            }}
            placeholder="搜索任务名…"
            className="flex-1 px-2 py-1 text-[12px] bg-white/[0.04] border border-border rounded focus:border-accent focus:bg-white/[0.06] transition-colors"
          />
          {hasQuery && (
            <button
              onClick={() => setQuery('')}
              title="清空"
              className="fluent-btn w-5 h-5 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.08]"
            >
              ✕
            </button>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto p-2 space-y-0.5">
        {loading && tasks.length === 0 && (
          <div className="px-3 py-6 text-xs text-muted text-center">加载中…</div>
        )}
        {error && (
          <div className="mx-1 mb-2 px-3 py-2 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md">
            {error}
          </div>
        )}
        {!loading && tasks.length === 0 && !error && (
          <div className="px-3 py-6 text-xs text-muted">
            <div className="text-center mb-3">还没有任务。</div>
            <div className="text-left leading-relaxed">
              任务由 AI 自动创建，不由你手动新建：在右边终端里启动一个 AI
              session，向它描述新功能或改动，它会先写
              <code className="mx-0.5 font-mono">plan.md</code>
              →<code className="mx-0.5 font-mono">context.md</code>
              →<code className="mx-0.5 font-mono">tasks.md</code>
              三份文件到 <code className="font-mono">dev/active/&lt;任务名&gt;/</code>。
              <div className="mt-3">
                如果 AI 不这么做，点顶部的 <span className="text-fg">⚙</span>
                把 Dev Docs 工作流守则写入此项目的
                <code className="mx-0.5 font-mono">CLAUDE.md</code>。
              </div>
            </div>
          </div>
        )}
        {!loading && tasks.length > 0 && filteredTasks.length === 0 && hasQuery && (
          <div className="px-3 py-6 text-xs text-muted text-center">
            没有匹配"{query.trim()}"的任务。
          </div>
        )}
        {filteredTasks.map((t) => {
          const open = !!expanded[t.name]
          return (
            <div key={t.name} className="text-sm">
              <div
                className="group flex items-center gap-1.5 pl-1 pr-2 py-1 rounded hover:bg-white/[0.04] cursor-pointer"
                onClick={() => toggle(t.name)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  void onArchive(t.name)
                }}
                title="点击展开，右键归档"
              >
                <span className="inline-block w-4 text-center text-[11px] text-muted">
                  {open ? '▾' : '▸'}
                </span>
                <span className="flex-1 truncate font-medium">{t.name}</span>
                <StatusPill task={t} />
                <span className="text-[10px] text-subtle tabular-nums shrink-0">
                  {formatTimeAgo(t.updatedAt)}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void onArchive(t.name)
                  }}
                  title="归档"
                  className="opacity-0 group-hover:opacity-100 w-5 h-5 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.08]"
                >
                  📦
                </button>
              </div>
              {open && (
                <div className="mt-0.5 mb-1 space-y-0.5">
                  {DOC_ROWS.map((row) => (
                    <FileRow
                      key={row.kind}
                      order={row.order}
                      label={row.label}
                      fileName={`${t.name}-${row.kind}.md`}
                      extra={
                        row.kind === 'tasks' && t.total > 0
                          ? `${t.checked}/${t.total}`
                          : undefined
                      }
                      onOpen={() => openDoc(t.name, row.kind)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
