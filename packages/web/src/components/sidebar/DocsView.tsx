import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import * as api from '../../api'
import { alertDialog, confirmDialog } from '../dialog/DialogHost'
import { openContextMenu, type ContextMenuItem } from '../ContextMenu'
import type { DocFileKind, DocTaskSummary, IssueItem } from '../../types'
import { MemoryView } from './MemoryView'
import { logAction, pushLog } from '../../logs'
import { dispatchClaude } from '../../dispatchClaude'
import { pickClaudeTarget, sendToSession } from '../../sendToSession'

const EMPTY_TASKS: DocTaskSummary[] = []
const EMPTY_ISSUES: IssueItem[] = []

type DocsViewMode = 'tasks' | 'issues' | 'memory'

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
  if (task.status === 'blocked') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-rose-600/40 bg-rose-500/15 text-rose-200 tabular-nums">
        阻塞 {task.checked}/{task.total}
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

  const issuesPayload = useStore((s) =>
    projectId ? s.issuesData[projectId] : undefined,
  )
  const issuesLoading = useStore((s) =>
    projectId ? s.issuesLoading[projectId] === true : false,
  )
  const issuesError = useStore((s) =>
    projectId ? s.issuesError[projectId] ?? null : null,
  )
  const refreshIssues = useStore((s) => s.refreshIssues)
  const refreshMemory = useStore((s) => s.refreshMemory)
  const [view, setView] = useState<DocsViewMode>('tasks')
  const memoryPollRef = useRef<{ id: ReturnType<typeof setTimeout> | null; stopped: boolean }>({ id: null, stopped: false })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [applyingRules, setApplyingRules] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!projectId) return
    refreshDocs(projectId).catch(() => {
      /* error already recorded in store */
    })
  }, [projectId, refreshDocs])

  useEffect(() => {
    if (!projectId) return
    if (view !== 'issues') return
    refreshIssues(projectId).catch(() => {
      /* error already recorded in store */
    })
  }, [projectId, view, refreshIssues])

  useEffect(() => {
    if (!projectId) return
    if (view !== 'memory') return
    refreshMemory(projectId).catch(() => {
      /* error already recorded in store */
    })
  }, [projectId, view, refreshMemory])

  useEffect(() => {
    return () => {
      memoryPollRef.current.stopped = true
      if (memoryPollRef.current.id) clearTimeout(memoryPollRef.current.id)
    }
  }, [projectId])

  // Reset the search UI when the project changes so the query from project A
  // doesn't linger after the user picks project B.
  useEffect(() => {
    setQuery('')
    setSearchOpen(false)
    setView('tasks')
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

  const issues = issuesPayload?.items ?? EMPTY_ISSUES
  const openIssues = useMemo(() => issues.filter((it) => !it.done), [issues])

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
    if (!projectId) return
    const ok = await confirmDialog(
      `归档任务 "${task}"? 该任务目录会被移动到 dev/archive/ 下。`,
      { title: '归档任务', confirmLabel: '归档' },
    )
    if (!ok) return
    try {
      await logAction(
        'docs',
        'archive',
        () => archiveDocsTask(projectId, task),
        { projectId, meta: { task } },
      )
      // Backend kicks off a codex/gemini review in the background. Poll every
      // 3s for up to 2 min so 「记忆」tab picks up the new auto.md entry (or
      // the review-failed row in rejected.md) without the user having to
      // manually refresh.
      startMemoryPoll(projectId)
    } catch (e: unknown) {
      await alertDialog(
        e instanceof Error ? e.message : String(e),
        { title: '归档失败', variant: 'danger' },
      )
    }
  }

  function startMemoryPoll(pid: string) {
    if (memoryPollRef.current.id) clearTimeout(memoryPollRef.current.id)
    memoryPollRef.current = { id: null, stopped: false }
    let rounds = 0
    const tick = () => {
      if (memoryPollRef.current.stopped) return
      rounds += 1
      refreshMemory(pid).catch(() => {
        /* error already recorded in store */
      })
      if (rounds >= 40) return
      memoryPollRef.current.id = setTimeout(tick, 3000)
    }
    memoryPollRef.current.id = setTimeout(tick, 3000)
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

  function openIssuesFile() {
    if (!projectId) return
    openFile({ projectId, path: 'dev/issues.md' })
  }

  function buildSingleIssuePrompt(text: string): string {
    return [
      '请处理 dev/issues.md 里的这条问题：',
      '',
      text,
      '',
      '处理完成后：在 dev/issues.md 里把这条的 [ ] 改成 [x]，然后简述改动。',
    ].join('\n')
  }

  function buildContinueTaskPrompt(task: string): string {
    return `继续 ${task}`
  }

  function buildAllIssuesPrompt(items: IssueItem[]): string {
    const lines = [
      '请依次处理 dev/issues.md 里以下未处理的问题，每处理完一条就把对应行的 [ ] 改成 [x]：',
      '',
    ]
    items.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.text}`)
    })
    return lines.join('\n')
  }

  async function runDispatch(prompt: string, successTitle: string) {
    if (!projectId || dispatching) return
    setDispatching(true)
    try {
      // Prefer injecting into an existing claude session's input box: user
      // gets to edit before hitting Enter, and no clipboard/paste detour. Fall
      // back to the spawn+clipboard flow only when the project has no live
      // claude — mid-spawn pty isn't ready to receive pending text.
      const target = pickClaudeTarget(projectId)
      if (target) {
        await sendToSession(projectId, target, prompt, {
          scope: 'docs',
          meta: { kind: successTitle },
        })
      } else {
        await dispatchClaude({ projectId, prompt, successTitle })
      }
    } catch {
      /* alertDialog already shown inside dispatchClaude */
    } finally {
      setDispatching(false)
    }
  }

  async function onDispatchIssue(issue: IssueItem) {
    await runDispatch(buildSingleIssuePrompt(issue.text), '已派 Claude 处理此问题')
  }

  async function onDispatchAllIssues() {
    if (openIssues.length === 0) return
    await runDispatch(buildAllIssuesPrompt(openIssues), '已派 Claude 处理全部未处理问题')
  }

  function openTaskMenu(task: string, x: number, y: number) {
    const items: ContextMenuItem[] = [
      {
        label: '派 Claude 继续任务',
        icon: '🤖',
        disabled: dispatching,
        onSelect: () =>
          runDispatch(buildContinueTaskPrompt(task), '已派 Claude 继续任务'),
      },
      { divider: true, label: '' },
      {
        label: '归档',
        icon: '📦',
        onSelect: () => onArchive(task),
      },
    ]
    pushLog({
      level: 'info',
      scope: 'docs-ctxmenu',
      projectId: projectId ?? undefined,
      msg: `openTaskMenu -> openContextMenu task=${task} xy=${x},${y} items=${items.length}`,
    })
    openContextMenu({ x, y, items })
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
            {view === 'tasks' && (
              <button
                onClick={toggleSearch}
                title="搜索任务"
                className={`fluent-btn w-6 h-6 inline-flex items-center justify-center rounded hover:bg-white/[0.08] ${
                  searchOpen ? 'text-accent bg-white/[0.06]' : 'text-muted hover:text-fg'
                }`}
              >
                🔍
              </button>
            )}
            {view === 'issues' && openIssues.length > 0 && (
              <button
                onClick={() => void onDispatchAllIssues()}
                disabled={dispatching}
                title={`新建 Claude 终端并把全部 ${openIssues.length} 条未处理问题拼成列表放进剪贴板`}
                className="fluent-btn h-6 px-2 inline-flex items-center justify-center rounded text-[11px] text-muted hover:text-fg hover:bg-white/[0.08] disabled:opacity-50"
              >
                {dispatching ? '…' : `🤖 派全部 (${openIssues.length})`}
              </button>
            )}
            <button
              onClick={() => void onApplyRules()}
              disabled={applyingRules}
              title="把 Dev Docs 工作流守则写入此项目的 CLAUDE.md（让 AI 学会 plan→context→tasks 流程）"
              className="fluent-btn w-6 h-6 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.08] disabled:opacity-50"
            >
              {applyingRules ? '…' : '⚙'}
            </button>
            <button
              onClick={() => {
                if (view === 'tasks') void refreshDocs(projectId)
                else if (view === 'issues') void refreshIssues(projectId)
                else void refreshMemory(projectId)
              }}
              title="刷新"
              className="fluent-btn w-6 h-6 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.08]"
            >
              ⟳
            </button>
          </div>
        </div>
      )}

      <div className="px-2 py-1.5 border-b border-border/40 flex items-center gap-1">
        <button
          onClick={() => setView('tasks')}
          className={`fluent-btn flex-1 h-7 inline-flex items-center justify-center rounded text-[12px] transition-colors ${
            view === 'tasks'
              ? 'bg-white/[0.08] text-fg'
              : 'text-muted hover:text-fg hover:bg-white/[0.04]'
          }`}
        >
          任务
        </button>
        <button
          onClick={() => setView('issues')}
          className={`fluent-btn flex-1 h-7 inline-flex items-center justify-center rounded text-[12px] transition-colors ${
            view === 'issues'
              ? 'bg-white/[0.08] text-fg'
              : 'text-muted hover:text-fg hover:bg-white/[0.04]'
          }`}
        >
          问题{openIssues.length > 0 ? ` (${openIssues.length})` : ''}
        </button>
        <button
          onClick={() => setView('memory')}
          className={`fluent-btn flex-1 h-7 inline-flex items-center justify-center rounded text-[12px] transition-colors ${
            view === 'memory'
              ? 'bg-white/[0.08] text-fg'
              : 'text-muted hover:text-fg hover:bg-white/[0.04]'
          }`}
          title="归档评审自动沉淀的经验 + 手动长期经验"
        >
          记忆
        </button>
      </div>

      {view === 'tasks' && searchOpen && (
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

      {view === 'tasks' && (
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
                  pushLog({
                    level: 'info',
                    scope: 'docs-ctxmenu',
                    projectId: projectId ?? undefined,
                    msg: `row onContextMenu fired task=${t.name} target=${(e.target as HTMLElement)?.tagName} xy=${e.clientX},${e.clientY}`,
                  })
                  e.preventDefault()
                  openTaskMenu(t.name, e.clientX, e.clientY)
                }}
                title="点击展开，右键菜单（派 Claude 继续 / 归档）"
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
      )}

      {view === 'issues' && (
        <div className="flex-1 min-h-0 overflow-auto p-2 space-y-0.5">
          {issuesLoading && issues.length === 0 && (
            <div className="px-3 py-6 text-xs text-muted text-center">加载中…</div>
          )}
          {issuesError && (
            <div className="mx-1 mb-2 px-3 py-2 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md">
              {issuesError}
            </div>
          )}
          {!issuesLoading && issues.length === 0 && !issuesError && (
            <div className="px-3 py-6 text-xs text-muted">
              <div className="text-center mb-3">还没有问题。</div>
              <div className="text-left leading-relaxed">
                AI 在执行其它任务时发现无关死代码/问题，会自动追加到项目根下的
                <code className="mx-0.5 font-mono">dev/issues.md</code>。
                你也可以
                <button
                  onClick={openIssuesFile}
                  className="mx-0.5 underline text-fg hover:text-accent"
                >
                  打开 issues.md
                </button>
                手动维护。
              </div>
            </div>
          )}
          {issues.map((it) => (
            <div
              key={`${it.line}-${it.text}`}
              className="group flex items-center gap-1.5 pl-1 pr-2 py-1 rounded hover:bg-white/[0.04] text-sm"
              title={it.text}
            >
              <span
                className={`inline-flex w-4 h-4 items-center justify-center rounded border text-[10px] shrink-0 ${
                  it.done
                    ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-border bg-white/[0.04] text-muted'
                }`}
              >
                {it.done ? '✓' : ''}
              </span>
              <span
                className={`flex-1 truncate ${
                  it.done ? 'text-subtle line-through' : 'text-fg'
                }`}
              >
                {it.text}
              </span>
              <button
                onClick={openIssuesFile}
                title="打开 dev/issues.md"
                className="opacity-0 group-hover:opacity-100 w-5 h-5 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.08]"
              >
                📄
              </button>
              {!it.done && (
                <button
                  onClick={() => void onDispatchIssue(it)}
                  disabled={dispatching}
                  title="新建一个 Claude 终端并把这条问题放到剪贴板"
                  className="opacity-0 group-hover:opacity-100 w-5 h-5 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.08] disabled:opacity-50"
                >
                  🤖
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {view === 'memory' && projectId && <MemoryView projectId={projectId} />}
    </div>
  )
}
