import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import * as api from '../../api'
import { alertDialog, confirmDialog, promptDialog } from '../dialog/DialogHost'
import { logAction, pushLog } from '../../logs'
import type { OpenSpecChange, OpenSpecChangeFile } from '../../types'

const EMPTY_CHANGES: OpenSpecChange[] = []

const FILE_ROWS: Array<{ kind: OpenSpecChangeFile; order: string; label: string }> = [
  { kind: 'proposal', order: '01_proposal', label: '需求 / 动机' },
  { kind: 'design', order: '02_design', label: '技术方案' },
  { kind: 'tasks', order: '03_tasks', label: '任务清单' },
]

const NAME_FORBIDDEN = /[\\/:*?"<>|]/

function validateChangeName(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return '名称不能为空'
  if (NAME_FORBIDDEN.test(trimmed)) return '不能包含 \\ / : * ? " < > | 这些字符'
  if (!/[一-龥]/.test(trimmed)) return '至少包含一个中文字符'
  return null
}

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

interface FileRowProps {
  order: string
  label: string
  exists: boolean
  fileName: string
  onOpen: () => void
}

function FileRow({ order, label, exists, fileName, onOpen }: FileRowProps) {
  return (
    <button
      onClick={onOpen}
      className="fluent-btn w-full text-left pl-8 pr-3 py-1 text-[12.5px] rounded hover:bg-white/[0.06] flex items-center gap-2"
      title={`打开 ${fileName}`}
    >
      <span className="font-mono text-subtle tabular-nums shrink-0">{order}</span>
      <span className="text-subtle">:</span>
      <span className={`flex-1 truncate ${exists ? '' : 'text-subtle italic'}`}>
        {label}
        {!exists ? '（缺失）' : ''}
      </span>
    </button>
  )
}

export default function OpenSpecView() {
  const projectId = useStore((s) => s.selectedProjectId)
  const projects = useStore((s) => s.projects)
  const openFile = useStore((s) => s.openFile)
  const [changes, setChanges] = useState<OpenSpecChange[]>(EMPTY_CHANGES)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  const project = useMemo(
    () => projects.find((p) => p.id === projectId),
    [projects, projectId],
  )

  async function refresh(pid: string) {
    setLoading(true)
    setError(null)
    try {
      const r = await api.listOpenSpecChanges(pid)
      setChanges(r.changes)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!projectId) return
    void refresh(projectId)
  }, [projectId])

  useEffect(() => {
    setQuery('')
    setSearchOpen(false)
    setExpanded({})
  }, [projectId])

  if (!projectId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-sm text-muted text-center">
        <div>请先在左侧「项目」列表中选中一个项目</div>
      </div>
    )
  }

  function toggle(name: string) {
    setExpanded((st) => ({ ...st, [name]: !st[name] }))
  }

  function openChangeFile(name: string, kind: OpenSpecChangeFile) {
    if (!projectId) return
    const path = `openspec/changes/${name}/${kind}.md`
    openFile({ projectId, path })
  }

  async function onCreateChange() {
    if (!projectId) return
    const name = await promptDialog('新 change 名称（中文必填，不含 \\ / : * ? " < > |）', {
      title: '新建 OpenSpec change',
      placeholder: '例：用户登录改造',
      confirmLabel: '创建',
      validate: validateChangeName,
    })
    if (!name) return
    const trimmed = name.trim()
    try {
      await logAction(
        'openspec',
        'create',
        async () => {
          await api.createOpenSpecChange(projectId, trimmed)
          await refresh(projectId)
        },
        { projectId, meta: { name: trimmed } },
      )
      setExpanded((st) => ({ ...st, [trimmed]: true }))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      await alertDialog(msg, { title: '创建 change 失败', variant: 'danger' })
    }
  }

  async function onArchiveChange(name: string) {
    if (!projectId) return
    const ok = await confirmDialog(
      `归档 change "${name}"? 整个目录会被移到 openspec/archive/<name>-<时间戳>/。`,
      { title: '归档 change', confirmLabel: '归档' },
    )
    if (!ok) return
    try {
      await logAction(
        'openspec',
        'archive',
        async () => {
          await api.archiveOpenSpecChange(projectId, name)
          await refresh(projectId)
        },
        { projectId, meta: { name } },
      )
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      await alertDialog(msg, { title: '归档失败', variant: 'danger' })
    }
  }

  function toggleSearch() {
    setSearchOpen((v) => {
      const next = !v
      if (!next) setQuery('')
      return next
    })
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return changes
    return changes.filter((c) => c.name.toLowerCase().includes(q))
  }, [changes, query])

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
              title="搜索 change"
              className={`fluent-btn w-6 h-6 inline-flex items-center justify-center rounded hover:bg-white/[0.08] ${
                searchOpen ? 'text-accent bg-white/[0.06]' : 'text-muted hover:text-fg'
              }`}
            >
              🔍
            </button>
            <button
              onClick={() => void onCreateChange()}
              title="新建 change"
              className="fluent-btn w-6 h-6 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.08]"
            >
              ＋
            </button>
            <button
              onClick={() => void refresh(projectId)}
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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQuery('')
                setSearchOpen(false)
              }
            }}
            placeholder="搜索 change…"
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
        {loading && changes.length === 0 && (
          <div className="px-3 py-6 text-xs text-muted text-center">加载中…</div>
        )}
        {error && (
          <div className="mx-1 mb-2 px-3 py-2 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md">
            {error}
          </div>
        )}
        {!loading && changes.length === 0 && !error && (
          <div className="px-3 py-6 text-xs text-muted">
            <div className="text-center mb-3">还没有 change。</div>
            <div className="text-left leading-relaxed">
              点上方
              <span className="mx-1 inline-flex items-center justify-center w-5 h-5 rounded border border-border bg-white/[0.04] font-mono">
                ＋
              </span>
              新建一份 change，会在
              <code className="mx-0.5 font-mono">openspec/changes/&lt;名字&gt;/</code>
              下生成
              <code className="mx-0.5 font-mono">proposal.md</code>
              <code className="mx-0.5 font-mono">design.md</code>
              <code className="mx-0.5 font-mono">tasks.md</code>
              三件骨架。
            </div>
          </div>
        )}
        {!loading && changes.length > 0 && filtered.length === 0 && hasQuery && (
          <div className="px-3 py-6 text-xs text-muted text-center">
            没有匹配"{query.trim()}"的 change。
          </div>
        )}
        {filtered.map((c) => {
          const open = !!expanded[c.name]
          const totalFiles =
            (c.files.proposal ? 1 : 0) + (c.files.design ? 1 : 0) + (c.files.tasks ? 1 : 0)
          return (
            <div key={c.name} className="text-sm">
              <div
                className="group flex items-center gap-1.5 pl-1 pr-2 py-1 rounded hover:bg-white/[0.04] cursor-pointer"
                onClick={() => toggle(c.name)}
                title="点击展开 / 折叠"
              >
                <span className="inline-block w-4 text-center text-[11px] text-muted">
                  {open ? '▾' : '▸'}
                </span>
                <span className="flex-1 truncate font-medium">{c.name}</span>
                <span
                  className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border tabular-nums ${
                    totalFiles === 3
                      ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300'
                      : 'border-amber-600/40 bg-amber-500/10 text-amber-200'
                  }`}
                >
                  {totalFiles}/3
                </span>
                <span className="text-[10px] text-subtle tabular-nums shrink-0">
                  {formatTimeAgo(c.updatedAt)}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void onArchiveChange(c.name)
                  }}
                  title="归档"
                  className="opacity-0 group-hover:opacity-100 w-5 h-5 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.08]"
                >
                  📦
                </button>
              </div>
              {open && (
                <div className="mt-0.5 mb-1 space-y-0.5">
                  {FILE_ROWS.map((row) => (
                    <FileRow
                      key={row.kind}
                      order={row.order}
                      label={row.label}
                      exists={c.files[row.kind]}
                      fileName={`${c.name}/${row.kind}.md`}
                      onOpen={() => {
                        if (!c.files[row.kind]) {
                          pushLog({
                            level: 'warn',
                            scope: 'openspec',
                            projectId: projectId ?? undefined,
                            msg: `打开缺失文件 ${c.name}/${row.kind}.md`,
                          })
                        }
                        openChangeFile(c.name, row.kind)
                      }}
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
