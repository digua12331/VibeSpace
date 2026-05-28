import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'
import * as api from '../../api'
import { alertDialog, confirmDialog } from '../dialog/DialogHost'
import { openContextMenu, type ContextMenuItem } from '../ContextMenu'
import type { BudgetStateSnapshot, DocFileKind, DocTaskSummary, IssueItem, Session, SubtaskOverview, SubtaskRun } from '../../types'
import { MemoryView } from './MemoryView'
import { logAction, pushLog } from '../../logs'
import { dispatchClaude } from '../../dispatchClaude'
import { pickClaudeTarget, sendToSession } from '../../sendToSession'

const EMPTY_TASKS: DocTaskSummary[] = []
const EMPTY_ISSUES: IssueItem[] = []

type DocsViewMode = 'tasks' | 'issues' | 'queue' | 'memory'

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
  const issueJobsPayload = useStore((s) =>
    projectId ? s.issueJobsData[projectId] : undefined,
  )
  const refreshIssueJobs = useStore((s) => s.refreshIssueJobs)
  const taskBudgetsList = useStore((s) =>
    projectId ? s.taskBudgets[projectId] : undefined,
  )
  const refreshTaskBudgets = useStore((s) => s.refreshTaskBudgets)
  const taskSubtasksMap = useStore((s) =>
    projectId ? s.taskSubtasks[projectId] : undefined,
  )
  const refreshTaskSubtasks = useStore((s) => s.refreshTaskSubtasks)
  const sessions = useStore((s) => s.sessions)
  const liveStatus = useStore((s) => s.liveStatus)
  const setSessionTaskLocal = useStore((s) => s.setSessionTaskLocal)
  const setActiveSession = useStore((s) => s.setActiveSession)
  const setActiveTabKind = useStore((s) => s.setActiveTabKind)
  const [view, setView] = useState<DocsViewMode>('tasks')
  const memoryPollRef = useRef<{ id: ReturnType<typeof setTimeout> | null; stopped: boolean }>({ id: null, stopped: false })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [dispatching, setDispatching] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [selectedHashes, setSelectedHashes] = useState<Set<string>>(new Set())
  const [batchDispatching, setBatchDispatching] = useState(false)

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
    setSelectedHashes(new Set())
  }, [projectId])

  // Refresh issue-jobs when entering the queue tab + poll every 2s while
  // visible. WS 'issue-job-state' broadcast also lands in the store via
  // aimonWS — the polling is the cheap belt-and-suspenders fallback.
  useEffect(() => {
    if (!projectId) return
    if (view !== 'queue') return
    refreshIssueJobs(projectId).catch(() => {
      /* error already recorded in store */
    })
    const id = setInterval(() => {
      refreshIssueJobs(projectId).catch(() => {
        /* error already recorded in store */
      })
    }, 2000)
    return () => clearInterval(id)
  }, [projectId, view, refreshIssueJobs])

  // Poll task budgets while viewing the tasks tab so the per-row progress
  // pill + cutoff banner stay fresh. 2s matches the issue-jobs cadence.
  useEffect(() => {
    if (!projectId) return
    if (view !== 'tasks') return
    refreshTaskBudgets(projectId).catch(() => {})
    const id = setInterval(() => {
      refreshTaskBudgets(projectId).catch(() => {})
    }, 2000)
    return () => clearInterval(id)
  }, [projectId, view, refreshTaskBudgets])

  // Poll subtask overview for every expanded task. 3s cadence — slower than
  // budget because subtask state transitions go through verify pipelines that
  // take seconds-to-minutes anyway.
  useEffect(() => {
    if (!projectId) return
    if (view !== 'tasks') return
    const taskNames = Object.keys(expanded).filter((k) => expanded[k])
    if (taskNames.length === 0) return
    const refresh = (): void => {
      for (const name of taskNames) {
        refreshTaskSubtasks(projectId, name).catch(() => {})
      }
    }
    refresh()
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [projectId, view, expanded, refreshTaskSubtasks])

  const budgetByTask = useMemo(() => {
    const m = new Map<string, BudgetStateSnapshot>()
    for (const b of taskBudgetsList ?? []) m.set(b.taskName, b)
    return m
  }, [taskBudgetsList])

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

  function openStatusFile(task: string) {
    if (!projectId) return
    openFile({ projectId, path: `dev/active/${task}/STATUS.md` })
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
    return `继续 ${task}\n\n任务文档：dev/active/${task}/`
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

  function toggleSelectIssue(hash: string) {
    setSelectedHashes((prev) => {
      const next = new Set(prev)
      if (next.has(hash)) next.delete(hash)
      else next.add(hash)
      return next
    })
  }

  async function onBatchDispatch() {
    if (!projectId || selectedHashes.size === 0 || batchDispatching) return
    const hashes = [...selectedHashes]
    const ok = await confirmDialog(
      `将开 ${hashes.length} 个独立 worktree（git 的临时副本），给每条 issue 单独派一个 Claude session 跑专门的"消化 issue" prompt。\n\n` +
      `单 session 最长 90 分钟，并发上限 3，worktree 池上限 5。\n\n` +
      `跑完会在「队列」tab 给你看，AI 不会自动 merge——每条要你手 approve 才会进主分支。`,
      { title: `批量派工 ${hashes.length} 条 issue`, confirmLabel: '开干' },
    )
    if (!ok) return
    setBatchDispatching(true)
    try {
      await logAction(
        'issues',
        'batch-dispatch',
        async () => {
          const { results } = await api.batchDispatchIssues(projectId, hashes)
          const failed = results.filter((r) => !r.ok)
          if (failed.length > 0) {
            // Surface partial failures to the user but don't block — successes
            // already kicked off and will show up in queue tab.
            const lines = failed
              .map((r) => `- ${r.issueHash.slice(0, 8)}: ${r.reason ?? 'unknown'}`)
              .join('\n')
            void alertDialog(
              `${failed.length} / ${results.length} 条派工失败：\n${lines}`,
              { title: '部分派工失败', variant: 'danger' },
            )
          }
          setSelectedHashes(new Set())
          setView('queue')
          await refreshIssueJobs(projectId)
          return results
        },
        { projectId, meta: { count: hashes.length, hashes } },
      )
    } catch {
      /* logAction 已记 error；具体失败上面 alertDialog 已弹 */
    } finally {
      setBatchDispatching(false)
    }
  }

  async function onApproveJob(jobId: string) {
    if (!projectId) return
    const ok = await confirmDialog(
      'approve 后 worktree 会 git merge --no-ff 进主分支，然后 worktree 被删（分支保留）。冲突时会标 merge-conflict 让你手动解。继续？',
      { title: 'approve & merge', confirmLabel: '合并' },
    )
    if (!ok) return
    try {
      await logAction(
        'issues',
        'approve',
        async () => {
          await api.approveIssueJob(projectId, jobId)
          await refreshIssueJobs(projectId)
        },
        { projectId, meta: { jobId } },
      )
    } catch (e: unknown) {
      await alertDialog(
        e instanceof Error ? e.message : String(e),
        { title: 'approve 失败', variant: 'danger' },
      )
    }
  }

  async function onRejectJob(jobId: string) {
    if (!projectId) return
    const ok = await confirmDialog(
      'reject 会删 worktree 但保留分支（30 天后由 git gc 自然回收）。继续？',
      { title: 'reject & 丢', confirmLabel: '丢', variant: 'danger' },
    )
    if (!ok) return
    try {
      await logAction(
        'issues',
        'reject',
        async () => {
          await api.rejectIssueJob(projectId, jobId)
          await refreshIssueJobs(projectId)
        },
        { projectId, meta: { jobId } },
      )
    } catch (e: unknown) {
      await alertDialog(
        e instanceof Error ? e.message : String(e),
        { title: 'reject 失败', variant: 'danger' },
      )
    }
  }

  function aliveSessionsForProject(): Session[] {
    if (!projectId) return []
    return sessions
      .filter((s) => s.projectId === projectId)
      .filter((s) => {
        const st = liveStatus[s.id] ?? s.status
        return st !== 'stopped' && st !== 'crashed'
      })
  }

  function findOwnerOfTask(taskName: string): Session | undefined {
    return aliveSessionsForProject().find((s) => s.task === taskName)
  }

  async function onBindTaskToSession(task: string, sessionId: string) {
    if (!projectId) return
    try {
      await logAction(
        'session',
        'bind-task',
        async () => {
          try {
            const s = await api.bindSessionTask(sessionId, task)
            setSessionTaskLocal(sessionId, task)
            return s
          } catch (err: unknown) {
            const e = err as { status?: number; code?: string }
            if (e?.status === 409 || e?.code === 'task_already_bound') {
              const ok = await confirmDialog(
                `任务 "${task}" 已绑定到别的 session，强制抢占?`,
                { title: '抢占绑定', confirmLabel: '抢占', variant: 'danger' },
              )
              if (!ok) throw new Error('用户取消抢占')
              const s = await api.bindSessionTask(sessionId, task, { force: true })
              setSessionTaskLocal(sessionId, task)
              return s
            }
            throw err
          }
        },
        { projectId, sessionId, meta: { task } },
      )
    } catch {
      /* logAction 已记 error，避免再 alert 噪声 */
    }
  }

  async function onUnbindTask(task: string) {
    const owner = findOwnerOfTask(task)
    if (!owner || !projectId) return
    try {
      await logAction(
        'session',
        'unbind-task',
        async () => {
          const s = await api.bindSessionTask(owner.id, null)
          setSessionTaskLocal(owner.id, null)
          return s
        },
        { projectId, sessionId: owner.id, meta: { task } },
      )
    } catch {
      /* swallow — already logged */
    }
  }

  function openTaskMenu(task: string, x: number, y: number) {
    const alive = aliveSessionsForProject()
    const owner = findOwnerOfTask(task)

    const bindSubmenu: ContextMenuItem[] =
      alive.length === 0
        ? [{ label: '当前没有活 session', disabled: true }]
        : alive.map((s) => ({
            label: `${s.agent}·${s.id.slice(-6)}${owner?.id === s.id ? ' ✓' : ''}`,
            icon: owner?.id === s.id ? '✓' : '·',
            onSelect: () => onBindTaskToSession(task, s.id),
          }))

    const items: ContextMenuItem[] = [
      {
        label: '派 Claude 继续任务',
        icon: '🤖',
        disabled: dispatching,
        onSelect: () =>
          runDispatch(buildContinueTaskPrompt(task), '已派 Claude 继续任务'),
      },
      {
        label: owner
          ? `绑定到 session（已绑 ${owner.agent}·${owner.id.slice(-6)}）`
          : '绑定到 session',
        icon: '🔗',
        submenu: bindSubmenu,
      },
      ...(owner
        ? ([
            {
              label: '解绑当前 session',
              icon: '✂',
              onSelect: () => onUnbindTask(task),
            },
          ] satisfies ContextMenuItem[])
        : []),
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
            {view === 'issues' && (
              <button
                onClick={() => void onBatchDispatch()}
                disabled={selectedHashes.size === 0 || batchDispatching}
                title="给每条选中的 [auto] issue 单独开 worktree 派 Claude，跑完进队列等 review"
                className={`fluent-btn h-6 px-2 inline-flex items-center justify-center rounded text-[11px] disabled:opacity-50 ${
                  selectedHashes.size > 0
                    ? 'text-cyan-200 bg-cyan-500/15 border border-cyan-500/40 hover:bg-cyan-500/25'
                    : 'text-muted hover:text-fg hover:bg-white/[0.08]'
                }`}
              >
                {batchDispatching ? '…' : `⚡ 批量派工 (${selectedHashes.size})`}
              </button>
            )}
            <button
              onClick={() => {
                if (view === 'tasks') void refreshDocs(projectId)
                else if (view === 'issues') void refreshIssues(projectId)
                else if (view === 'queue') void refreshIssueJobs(projectId)
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
          onClick={() => setView('queue')}
          title="批量派工后等待 review 的 worktree 列表"
          className={`fluent-btn flex-1 h-7 inline-flex items-center justify-center rounded text-[12px] transition-colors ${
            view === 'queue'
              ? 'bg-white/[0.08] text-fg'
              : 'text-muted hover:text-fg hover:bg-white/[0.04]'
          }`}
        >
          队列{issueJobsPayload && issueJobsPayload.length > 0 ? ` (${issueJobsPayload.length})` : ''}
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
                如果 AI 不这么做，到右上角「权限」抽屉的「工作流」tab
                点"应用"，把工作流守则写入此项目的
                <code className="mx-0.5 font-mono">CLAUDE.md</code>
                并把可复用配置一并拷进去。
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
                {(() => {
                  const owner = findOwnerOfTask(t.name)
                  // 没活着的 owner —— 不渲染内联按钮，由行的右键菜单"派 Claude 继续任务"承担启动入口
                  if (!owner) return null
                  return (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (!projectId) return
                        setActiveSession(projectId, owner.id)
                        setActiveTabKind('session')
                      }}
                      title={`点击进入终端 ${owner.agent} · ${owner.id}`}
                      className="text-[10px] text-cyan-300/90 bg-cyan-400/10 border border-cyan-400/30 rounded px-1 py-0 leading-4 whitespace-pre hover:bg-cyan-400/20 hover:text-cyan-200 transition-colors"
                    >
                      🔗 {owner.agent}·{owner.id.slice(-6)}
                    </button>
                  )
                })()}
                <BudgetPill budget={budgetByTask.get(t.name)} />
                <SubtasksPill overview={taskSubtasksMap?.[t.name]} />
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
                  <FileRow
                    order="04_status"
                    label="自动状态日志 / 接力点"
                    fileName="STATUS.md"
                    extra={budgetByTask.get(t.name)?.cutoff ? '已停' : undefined}
                    onOpen={() => openStatusFile(t.name)}
                  />
                  {(() => {
                    const b = budgetByTask.get(t.name)
                    if (!b?.cutoff) return null
                    return (
                      <div className="ml-8 mt-1 mb-1 px-2 py-1.5 rounded border border-rose-500/40 bg-rose-500/10 text-[11px] text-rose-100 leading-relaxed">
                        <div className="font-medium">⚠ AI 跑到上限自动停了</div>
                        <div className="text-rose-200/90 mt-0.5">{b.cutoff.message}</div>
                        <div className="text-rose-200/70 mt-1 text-[10px]">
                          下一步：{b.cutoff.nextStep}
                        </div>
                      </div>
                    )
                  })()}
                  <SubtasksPanel
                    projectId={projectId}
                    taskName={t.name}
                    overview={taskSubtasksMap?.[t.name]}
                    onRefresh={() => {
                      if (projectId)
                        refreshTaskSubtasks(projectId, t.name).catch(() => {})
                    }}
                  />
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
          {issues.map((it) => {
            const selectable = !it.done && it.auto
            const selected = selectedHashes.has(it.hash)
            return (
              <div
                key={`${it.hash}-${it.line}`}
                className={`group flex items-center gap-1.5 pl-1 pr-2 py-1 rounded text-sm ${
                  selected ? 'bg-cyan-500/10' : 'hover:bg-white/[0.04]'
                }`}
                title={it.auto ? `[auto] 可批量派工\n${it.text}` : it.text}
              >
                {selectable ? (
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleSelectIssue(it.hash)}
                    title="勾选后用顶部「批量派工」按钮一起派"
                    className="w-3 h-3 shrink-0 accent-cyan-500 cursor-pointer"
                  />
                ) : (
                  <span
                    className="w-3 shrink-0"
                    title={
                      it.done
                        ? '已完成'
                        : '未标 [auto]，不能批量派；可以用末尾 🤖 单条派'
                    }
                  />
                )}
                <span
                  className={`inline-flex w-4 h-4 items-center justify-center rounded border text-[10px] shrink-0 ${
                    it.done
                      ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-border bg-white/[0.04] text-muted'
                  }`}
                >
                  {it.done ? '✓' : ''}
                </span>
                {it.auto && !it.done && (
                  <span className="text-[9px] leading-3 px-1 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 shrink-0 font-mono">
                    auto
                  </span>
                )}
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
            )
          })}
        </div>
      )}

      {view === 'queue' && projectId && (
        <div className="flex-1 min-h-0 overflow-auto p-2 space-y-1.5">
          {!issueJobsPayload && (
            <div className="px-3 py-6 text-xs text-muted text-center">加载中…</div>
          )}
          {issueJobsPayload && issueJobsPayload.length === 0 && (
            <div className="px-3 py-6 text-xs text-muted">
              <div className="text-center mb-3">队列空。</div>
              <div className="text-left leading-relaxed">
                到「问题」tab 勾选几条带{' '}
                <span className="font-mono px-1 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-300">
                  auto
                </span>{' '}
                标签的 issue，按上方「⚡ 批量派工」即可把它们派给独立的 Claude session
                跑。这里会显示每个 session 的状态、worktree 路径，和 approve / reject 按钮。
              </div>
            </div>
          )}
          {issueJobsPayload?.map((job) => (
            <IssueJobCard
              key={job.jobId}
              job={job}
              onApprove={() => void onApproveJob(job.jobId)}
              onReject={() => void onRejectJob(job.jobId)}
            />
          ))}
        </div>
      )}

      {view === 'memory' && projectId && <MemoryView projectId={projectId} />}
    </div>
  )
}

interface IssueJobCardProps {
  job: import('../../types').IssueJob
  onApprove: () => void
  onReject: () => void
}

function IssueJobCard({ job, onApprove, onReject }: IssueJobCardProps) {
  const [expanded, setExpanded] = useState(false)

  const stateStyle = JOB_STATE_STYLES[job.state] ?? JOB_STATE_STYLES.unknown
  const elapsed = (job.endedAt ?? Date.now()) - job.startedAt
  const elapsedStr = formatJobDuration(elapsed)
  const canApprove = job.state === 'review-ready' || job.state === 'unknown'
  const showErrorBlock = !!job.errorReason && job.state !== 'running'

  return (
    <div className="rounded border border-border bg-white/[0.02] p-2 text-[12px] space-y-1">
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border tabular-nums shrink-0 ${stateStyle}`}
          title={job.errorReason ?? job.state}
        >
          {job.state}
        </span>
        <span className="text-[10px] text-subtle tabular-nums shrink-0">
          {elapsedStr}
        </span>
        <span className="flex-1 truncate text-fg" title={job.issueText}>
          {job.issueText}
        </span>
      </div>
      <div
        className="text-[10px] text-subtle font-mono truncate cursor-default"
        title={job.worktreePath}
      >
        {job.worktreePath}
      </div>
      {showErrorBlock && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full text-left text-[10px] text-rose-300 hover:text-rose-200"
        >
          {expanded ? '▾ 收起错误' : '▸ 展开错误'}
        </button>
      )}
      {showErrorBlock && expanded && (
        <pre className="text-[10px] leading-tight text-rose-200 bg-rose-500/5 border border-rose-500/30 rounded p-1.5 max-h-40 overflow-auto whitespace-pre-wrap">
          {job.errorReason}
          {job.verifyLog ? `\n\n--- verify log ---\n${job.verifyLog.slice(-2000)}` : ''}
        </pre>
      )}
      <div className="flex items-center gap-1.5 pt-0.5">
        <button
          onClick={onApprove}
          disabled={!canApprove}
          title={
            canApprove
              ? '合并这条 worktree 进主分支'
              : `当前状态 '${job.state}' 不允许 approve`
          }
          className="fluent-btn h-6 px-2 text-[11px] rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          ✓ approve
        </button>
        <button
          onClick={onReject}
          title="删掉 worktree（分支保留）"
          className="fluent-btn h-6 px-2 text-[11px] rounded border border-rose-500/40 bg-rose-500/5 text-rose-200 hover:bg-rose-500/15"
        >
          ✕ reject
        </button>
      </div>
    </div>
  )
}

interface BudgetPillProps {
  budget: BudgetStateSnapshot | undefined
}

function BudgetPill({ budget }: BudgetPillProps) {
  if (!budget) return null
  const { rounds, limits, elapsedMinutes, cutoff } = budget
  const roundsRatio = limits.maxRounds > 0 ? rounds / limits.maxRounds : 0
  const elapsedRatio =
    limits.maxElapsedMinutes > 0 ? elapsedMinutes / limits.maxElapsedMinutes : 0
  const worstRatio = Math.max(roundsRatio, elapsedRatio)

  let style = 'border-border bg-white/[0.04] text-muted'
  let label: string
  if (cutoff) {
    style = 'border-rose-500/40 bg-rose-500/15 text-rose-200'
    label = '⚠ 已停'
  } else if (worstRatio >= 0.9) {
    style = 'border-amber-500/40 bg-amber-500/10 text-amber-200'
    label = '近上限'
  } else if (worstRatio >= 0.7) {
    style = 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
    label = `${rounds}/${limits.maxRounds}`
  } else {
    label = `${rounds}/${limits.maxRounds}`
  }

  const tooltip = cutoff
    ? `已停：${cutoff.message}\n下一步：${cutoff.nextStep}`
    : `跑了 ${rounds} 轮 / 上限 ${limits.maxRounds}\n` +
      `已用 ${Math.round(elapsedMinutes)} 分钟 / 上限 ${limits.maxElapsedMinutes}\n` +
      `大致消耗 ${budget.tokensApprox} tokens（近似值）\n` +
      `验收失败 ${budget.verifyFailCount} / 上限 ${limits.maxVerifyFails}`

  return (
    <span
      className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border tabular-nums shrink-0 font-mono ${style}`}
      title={tooltip}
    >
      {label}
    </span>
  )
}

const JOB_STATE_STYLES: Record<string, string> = {
  pending: 'border-border bg-white/[0.04] text-muted',
  running: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
  verifying: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
  'review-ready': 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300',
  failed: 'border-rose-500/40 bg-rose-500/15 text-rose-200',
  cancelled: 'border-border bg-white/[0.04] text-subtle',
  'merge-conflict': 'border-amber-500/40 bg-amber-500/10 text-amber-200',
  unknown: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-200',
}

function formatJobDuration(ms: number): string {
  if (ms < 1000) return '<1s'
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m`
  return `${(ms / 3600_000).toFixed(1)}h`
}

// ---------- 大任务自拆并行：UI 组件 ----------

interface SubtasksPillProps {
  overview: SubtaskOverview | undefined
}

function SubtasksPill({ overview }: SubtasksPillProps) {
  if (!overview || !overview.parsed || !overview.graph) return null
  const total = overview.graph.subtasks.length
  if (total === 0) return null
  const merged = overview.runs.filter((r) => r.state === 'merged').length
  const failed = overview.runs.filter(
    (r) => r.state === 'failed' || r.state === 'cancelled' || r.state === 'merge-conflict',
  ).length
  let style = 'border-border bg-white/[0.04] text-muted'
  if (failed > 0) {
    style = 'border-rose-500/40 bg-rose-500/10 text-rose-200'
  } else if (merged === total) {
    style = 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300'
  } else if (merged / total >= 0.3) {
    style = 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
  }
  return (
    <span
      className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border tabular-nums shrink-0 font-mono ${style}`}
      title={`子任务 ${merged}/${total} 已合并${failed > 0 ? `；${failed} 个出问题` : ''}`}
    >
      子 {merged}/{total}
    </span>
  )
}

interface SubtasksPanelProps {
  projectId: string | null
  taskName: string
  overview: SubtaskOverview | undefined
  onRefresh: () => void
}

function SubtasksPanel({
  projectId,
  taskName,
  overview,
  onRefresh,
}: SubtasksPanelProps) {
  const [busy, setBusy] = useState(false)
  if (!projectId) return null
  if (!overview) {
    return (
      <div className="ml-8 mt-1 text-[11px] text-subtle">
        加载子任务结构中…
      </div>
    )
  }
  if (!overview.parsed) {
    if (overview.parseReason === 'no-section') {
      return null // 任务未声明 ## 自拆与依赖 段 → 隐藏入口
    }
    return (
      <div className="ml-8 mt-1 mb-1 px-2 py-1.5 rounded border border-amber-500/40 bg-amber-500/10 text-[11px] text-amber-200">
        <div className="font-medium">⚠ 自拆配置错误（{overview.parseReason}）</div>
        {overview.parseDetail && (
          <div className="text-amber-100/80 mt-0.5">{overview.parseDetail}</div>
        )}
      </div>
    )
  }
  const graph = overview.graph!
  const total = graph.subtasks.length
  const merged = overview.runs.filter((r) => r.state === 'merged').length
  const reviewReady = overview.runs.filter((r) => r.state === 'review-ready')
  const runsBySubtaskId = new Map(overview.runs.map((r) => [r.subtaskId, r]))
  const dispatched = overview.runs.length

  const onDispatch = async (): Promise<void> => {
    if (!projectId) return
    setBusy(true)
    try {
      await logAction(
        'subtasks',
        'dispatch',
        async () => {
          await api.dispatchSubtasks(projectId, taskName)
        },
        { projectId, meta: { taskName, total } },
      )
      onRefresh()
    } catch (err) {
      await alertDialog((err as Error).message || String(err), {
        title: '派工失败',
        variant: 'danger',
      })
    } finally {
      setBusy(false)
    }
  }

  const onApproveAll = async (): Promise<void> => {
    if (!projectId) return
    if (reviewReady.length === 0) {
      await alertDialog('所有子任务必须先变成 review-ready 状态。', {
        title: '暂无可 approve 的子任务',
      })
      return
    }
    const sure = await confirmDialog(
      `将按拓扑序逐个 merge ${reviewReady.length} 个子任务的 worktree 到主分支。`,
      { title: '确认 approve 全部子任务', confirmLabel: '开始 merge' },
    )
    if (!sure) return
    setBusy(true)
    try {
      const result = await logAction(
        'subtasks',
        'approve-all',
        async () => {
          return api.approveAllSubtasks(projectId, taskName)
        },
        { projectId, meta: { taskName } },
      )
      if (!result.ok && result.failed.length > 0) {
        await alertDialog(
          result.failed
            .map((f) => `子任务 #${f.subtaskId}: ${f.reason}`)
            .join('\n'),
          { title: 'approve 中断', variant: 'danger' },
        )
      }
      onRefresh()
    } catch (err) {
      await alertDialog((err as Error).message || String(err), {
        title: 'approve 失败',
        variant: 'danger',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ml-8 mt-1 mb-1 px-2 py-1.5 rounded border border-cyan-500/30 bg-cyan-500/[0.04] text-[11px]">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-cyan-300 font-medium">子任务（共 {total}，已合并 {merged}）</span>
        <span className="flex-1" />
        <button
          onClick={onDispatch}
          disabled={busy || dispatched > 0}
          className="text-[10px] px-1.5 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          title={dispatched > 0 ? '已经派工过' : '按依赖顺序派工，每个子任务跑在独立 worktree'}
        >
          一键派工
        </button>
        <button
          onClick={onApproveAll}
          disabled={busy || reviewReady.length === 0}
          className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-600/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          title="按拓扑序逐个 merge 所有 review-ready 子任务的 worktree"
        >
          approve 全部
        </button>
      </div>
      {graph.auto_edges.length > 0 && (
        <div className="mb-1 text-[10px] text-amber-200/80 italic">
          自动新增 {graph.auto_edges.length} 条依赖边（write_files 重叠）
        </div>
      )}
      <div className="space-y-0.5">
        {graph.subtasks.map((spec) => {
          const run = runsBySubtaskId.get(spec.id)
          const state = run?.state ?? 'not-dispatched'
          const style = JOB_STATE_STYLES[state] ?? 'border-border bg-white/[0.04] text-subtle'
          const depLabel =
            spec.depends_on.length === 0
              ? '无依赖'
              : `← ${spec.depends_on.join(', ')}`
          return (
            <SubtaskRow
              key={spec.id}
              projectId={projectId}
              taskName={taskName}
              spec={spec}
              run={run}
              state={state}
              style={style}
              depLabel={depLabel}
              onRefresh={onRefresh}
            />
          )
        })}
      </div>
    </div>
  )
}

interface SubtaskRowProps {
  projectId: string
  taskName: string
  spec: { id: number; title: string; write_files: string[]; depends_on: number[] }
  run: SubtaskRun | undefined
  state: string
  style: string
  depLabel: string
  onRefresh: () => void
}

function SubtaskRow({
  projectId,
  taskName,
  spec,
  run,
  state,
  style,
  depLabel,
  onRefresh,
}: SubtaskRowProps) {
  const [busy, setBusy] = useState(false)
  const canApprove = run?.state === 'review-ready' || run?.state === 'unknown'
  const canReject = !!run

  const onApprove = async (): Promise<void> => {
    setBusy(true)
    try {
      await logAction(
        'subtasks',
        'approve-one',
        async () => api.approveSubtask(projectId, taskName, spec.id),
        { projectId, meta: { taskName, subtaskId: spec.id } },
      )
      onRefresh()
    } catch (err) {
      await alertDialog((err as Error).message || String(err), {
        title: 'approve 失败',
        variant: 'danger',
      })
    } finally {
      setBusy(false)
    }
  }
  const onReject = async (): Promise<void> => {
    const sure = await confirmDialog(
      `将删除 worktree 并丢弃本子任务的改动。\n标题：${spec.title}`,
      {
        title: `确认 reject 子任务 #${spec.id}`,
        confirmLabel: '删除',
        variant: 'danger',
      },
    )
    if (!sure) return
    setBusy(true)
    try {
      await logAction(
        'subtasks',
        'reject-one',
        async () => api.rejectSubtask(projectId, taskName, spec.id),
        { projectId, meta: { taskName, subtaskId: spec.id } },
      )
      onRefresh()
    } catch (err) {
      await alertDialog((err as Error).message || String(err), {
        title: 'reject 失败',
        variant: 'danger',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5 pl-1 pr-0.5 py-0.5 rounded hover:bg-white/[0.03]">
      <span className="inline-block w-5 text-center text-[10px] text-subtle tabular-nums">
        #{spec.id}
      </span>
      <span className="flex-1 truncate text-[11px]" title={`write_files:\n  ${spec.write_files.join('\n  ')}`}>
        {spec.title}
      </span>
      <span className="text-[10px] text-subtle shrink-0">{depLabel}</span>
      <span
        className={`inline-flex items-center text-[10px] px-1 py-0.5 rounded border tabular-nums shrink-0 font-mono ${style}`}
        title={run?.errorReason ?? state}
      >
        {state}
      </span>
      {canApprove && (
        <button
          onClick={onApprove}
          disabled={busy}
          className="text-[10px] px-1 py-0 rounded border border-emerald-600/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40"
          title="单独 merge 这个子任务"
        >
          ✓
        </button>
      )}
      {canReject && (
        <button
          onClick={onReject}
          disabled={busy}
          className="text-[10px] px-1 py-0 rounded border border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 disabled:opacity-40"
          title="删除子任务的 worktree（丢弃改动）"
        >
          ✕
        </button>
      )}
    </div>
  )
}
