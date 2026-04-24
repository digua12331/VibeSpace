import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from '../api'
import type { CommentAnchor, CommentEntry } from '../types'
import { logAction } from '../logs'
import { confirmDialog } from './dialog/DialogHost'
import CommentPopover from './CommentPopover'
import { extractAnchors, matchAnchor } from '../commentAnchor'

interface Props {
  projectId: string
  /** Project-relative POSIX path of the md file. */
  path: string
  /** Current md source — used to resolve orphans by running matchAnchor. */
  source: string
  /** Whether the tab allows mutations (false for commit history / diff view). */
  readOnly: boolean
  /**
   * Request from the panel to pop an "add comment" popover at (x, y) anchored
   * on a particular block. When the user submits, we create the comment.
   */
  pendingAdd: { anchorId: string; x: number; y: number } | null
  onAddConsumed: () => void
  onAnchorCountsChange: (counts: Record<string, number>) => void
  /** Collapsed / expanded — controlled from the outside so FilePreview can hide the panel entirely. */
  collapsed: boolean
  onToggleCollapsed: () => void
  /** Scrolls the markdown preview to a given anchor id (no-op if not in DOM). */
  onLocate: (anchorId: string) => void
}

function formatAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function CommentsPanel({
  projectId,
  path,
  source,
  readOnly,
  pendingAdd,
  onAddConsumed,
  onAnchorCountsChange,
  collapsed,
  onToggleCollapsed,
  onLocate,
}: Props) {
  const [comments, setComments] = useState<CommentEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'orphan'>('all')

  // Load on mount / when projectId+path changes.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .listComments(projectId, path)
      .then((r) => {
        if (!cancelled) setComments(r.comments)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, path])

  // Derive the set of anchors that currently exist in the md source, then
  // classify each comment as matched vs orphan and build per-anchor counts.
  const { anchorCounts, orphanIds } = useMemo(() => {
    const fresh = extractAnchors(source)
    const counts: Record<string, number> = {}
    const orphanSet = new Set<string>()
    for (const c of comments) {
      const m = matchAnchor(c.anchor, fresh)
      if (m) {
        counts[m.anchorId] = (counts[m.anchorId] ?? 0) + 1
      } else {
        orphanSet.add(c.id)
      }
    }
    return { anchorCounts: counts, orphanIds: orphanSet }
  }, [comments, source])

  // Push counts up so MarkdownView's hover badge knows what to show.
  useEffect(() => {
    onAnchorCountsChange(anchorCounts)
  }, [anchorCounts, onAnchorCountsChange])

  const filtered = useMemo(() => {
    if (filter === 'all') return comments
    return comments.filter((c) => orphanIds.has(c.id))
  }, [comments, filter, orphanIds])

  const orphanCount = orphanIds.size
  const totalCount = comments.length

  const handleCreate = useCallback(
    async (anchorId: string, body: string) => {
      // Find the anchor's full metadata from the current source so we can
      // store a useful textPreview alongside the id.
      const fresh = extractAnchors(source)
      const anchor: CommentAnchor | undefined = fresh.find((a) => a.anchorId === anchorId)
      if (!anchor) {
        throw new Error('锚点不存在（内容可能已变更，刷新后重试）')
      }
      const created = await logAction(
        'comments',
        'create',
        () => api.createComment(projectId, path, anchor, body),
        { projectId, meta: { path, anchorId: anchor.anchorId } },
      )
      setComments((prev) => [...prev, created])
    },
    [projectId, path, source],
  )

  const handleUpdate = useCallback(
    async (commentId: string, body: string) => {
      const updated = await logAction(
        'comments',
        'update',
        () => api.updateComment(projectId, commentId, path, body),
        { projectId, meta: { path, id: commentId } },
      )
      setComments((prev) => prev.map((c) => (c.id === commentId ? updated : c)))
    },
    [projectId, path],
  )

  const handleDelete = useCallback(
    async (commentId: string) => {
      const ok = await confirmDialog('删除这条评论？', {
        title: '删除评论',
        variant: 'danger',
        confirmLabel: '删除',
      })
      if (!ok) return
      await logAction(
        'comments',
        'delete',
        () => api.deleteComment(projectId, commentId, path),
        { projectId, meta: { path, id: commentId } },
      )
      setComments((prev) => prev.filter((c) => c.id !== commentId))
    },
    [projectId, path],
  )

  if (collapsed) {
    return (
      <div className="shrink-0 h-full w-8 border-l border-border/60 bg-black/10 flex items-start justify-center">
        <button
          onClick={onToggleCollapsed}
          title={`展开评论 (${totalCount})`}
          className="fluent-btn w-7 h-7 mt-2 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.06]"
        >
          💬
        </button>
      </div>
    )
  }

  return (
    <div className="shrink-0 h-full w-[320px] border-l border-border/60 bg-black/10 flex flex-col min-h-0">
      <div className="h-9 px-2 border-b border-border/60 flex items-center gap-1.5 text-[12px]">
        <span className="text-fg font-medium">评论</span>
        <span className="text-muted tabular-nums">{totalCount}</span>
        {readOnly && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted">
            只读
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={onToggleCollapsed}
          title="折叠"
          className="fluent-btn w-6 h-6 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.06]"
        >
          ›
        </button>
      </div>

      <div className="px-2 py-1.5 border-b border-border/40 flex items-center gap-1">
        <button
          onClick={() => setFilter('all')}
          className={`fluent-btn flex-1 h-6 inline-flex items-center justify-center rounded text-[11px] transition-colors ${
            filter === 'all'
              ? 'bg-white/[0.08] text-fg'
              : 'text-muted hover:text-fg hover:bg-white/[0.04]'
          }`}
        >
          全部 {totalCount}
        </button>
        <button
          onClick={() => setFilter('orphan')}
          className={`fluent-btn flex-1 h-6 inline-flex items-center justify-center rounded text-[11px] transition-colors ${
            filter === 'orphan'
              ? 'bg-white/[0.08] text-fg'
              : 'text-muted hover:text-fg hover:bg-white/[0.04]'
          }`}
          title="锚点已失效的评论（md 内容变了）"
        >
          失效 {orphanCount}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-2 space-y-1.5">
        {loading && <div className="px-2 py-4 text-xs text-muted text-center">加载中…</div>}
        {error && (
          <div className="mx-1 px-2 py-1.5 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded">
            {error}
          </div>
        )}
        {!loading && filtered.length === 0 && !error && (
          <div className="px-2 py-6 text-xs text-muted text-center">
            {filter === 'orphan' ? '没有失效评论' : readOnly ? '暂无评论' : '暂无评论。Preview 里 hover 段落右侧 💬 添加。'}
          </div>
        )}
        {filtered.map((c) => {
          const isOrphan = orphanIds.has(c.id)
          return (
            <div
              key={c.id}
              className={`group rounded border text-[12.5px] ${
                isOrphan
                  ? 'border-rose-500/40 bg-rose-500/5'
                  : 'border-border bg-white/[0.03]'
              }`}
            >
              <div className="flex items-center gap-1 px-2 py-1 border-b border-border/40 text-[10px] text-subtle tabular-nums">
                <span className="font-mono">{c.anchor.blockType}</span>
                <span>·</span>
                <span className="truncate flex-1" title={c.anchor.textPreview}>
                  {c.anchor.textPreview || <em>(空)</em>}
                </span>
                <span>·</span>
                <span>{formatAgo(c.updatedAt)}</span>
                {isOrphan && (
                  <span className="text-rose-300 ml-1">失效</span>
                )}
              </div>
              {editingId === c.id ? (
                <InlineEditor
                  initial={c.body}
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (body) => {
                    await handleUpdate(c.id, body)
                    setEditingId(null)
                  }}
                />
              ) : (
                <div className="px-2 py-1.5">
                  <div className="whitespace-pre-wrap break-words text-fg">{c.body}</div>
                  <div className="mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!isOrphan && (
                      <button
                        onClick={() => onLocate(c.anchor.anchorId)}
                        title="滚动到该段落"
                        className="fluent-btn h-5 px-1.5 text-[10px] rounded text-muted hover:text-fg hover:bg-white/[0.06]"
                      >
                        定位
                      </button>
                    )}
                    {!readOnly && (
                      <>
                        <button
                          onClick={() => setEditingId(c.id)}
                          className="fluent-btn h-5 px-1.5 text-[10px] rounded text-muted hover:text-fg hover:bg-white/[0.06]"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => void handleDelete(c.id)}
                          className="fluent-btn h-5 px-1.5 text-[10px] rounded text-muted hover:text-rose-200 hover:bg-rose-500/10"
                        >
                          删除
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {pendingAdd && !readOnly && (
        <CommentPopover
          x={pendingAdd.x}
          y={pendingAdd.y}
          title="写评论"
          submitLabel="添加"
          onCancel={onAddConsumed}
          onSubmit={async (body) => {
            await handleCreate(pendingAdd.anchorId, body)
            onAddConsumed()
          }}
        />
      )}
    </div>
  )
}

function InlineEditor({
  initial,
  onCancel,
  onSubmit,
}: {
  initial: string
  onCancel: () => void
  onSubmit: (body: string) => void | Promise<void>
}) {
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <div className="px-2 py-1.5 space-y-1">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void submit()
          }
          if (e.key === 'Escape') onCancel()
        }}
        rows={3}
        className="w-full px-2 py-1.5 text-[12.5px] bg-white/[0.04] border border-border rounded focus:border-accent focus:bg-white/[0.06] resize-none outline-none"
      />
      {err && <div className="text-[10px] text-rose-300 px-0.5">{err}</div>}
      <div className="flex justify-end gap-1">
        <button
          onClick={onCancel}
          className="fluent-btn h-5 px-1.5 text-[10px] rounded text-muted hover:text-fg hover:bg-white/[0.06]"
        >
          取消
        </button>
        <button
          disabled={busy || !text.trim()}
          onClick={() => void submit()}
          className="fluent-btn h-5 px-2 text-[10px] rounded bg-accent/15 border border-accent/40 text-accent hover:bg-accent/25 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? '…' : '保存'}
        </button>
      </div>
    </div>
  )

  async function submit() {
    const trimmed = text.trim()
    if (!trimmed) {
      setErr('评论内容不能为空')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await onSubmit(text)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
}
