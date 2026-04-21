import { useCallback, useEffect, useState } from 'react'
import * as api from '../api'
import { pushLog } from '../logs'
import { useStore, type SelectedChange } from '../store'
import type { ChangeEntry, ChangeStatus, ChangesResponse } from '../types'
import { alertDialog, confirmDialog } from './dialog/DialogHost'

interface Props {
  projectId: string
}

const STATUS_TONE: Record<ChangeStatus, string> = {
  M: 'text-amber-300 bg-amber-500/10 border-amber-600/40',
  A: 'text-emerald-300 bg-emerald-500/10 border-emerald-600/40',
  D: 'text-rose-300 bg-rose-500/10 border-rose-600/40',
  R: 'text-sky-300 bg-sky-500/10 border-sky-600/40',
  C: 'text-violet-300 bg-violet-500/10 border-violet-600/40',
  U: 'text-rose-300 bg-rose-500/10 border-rose-600/40',
  '?': 'text-muted bg-white/[0.04] border-border',
}

function StatusBadge({ status }: { status: ChangeStatus }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE['?']
  return (
    <span
      className={`inline-block w-[18px] text-center text-[10px] leading-4 px-1 rounded border ${tone}`}
    >
      {status}
    </span>
  )
}

type Kind = 'staged' | 'unstaged' | 'untracked'

export default function ChangesList({ projectId }: Props) {
  const [data, setData] = useState<ChangesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'stage-all' | 'commit' | string>(null)
  const [message, setMessage] = useState('')

  const selected = useStore((s) => s.selectedChange)
  const selectChange = useStore((s) => s.selectChange)
  const openFile = useStore((s) => s.openFile)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const changes = await api.getProjectChanges(projectId)
      setData(changes)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  function selectWorkingFile(entry: ChangeEntry, kind: Kind): void {
    const sel: SelectedChange = {
      path: entry.path,
      status: entry.status,
      ref: 'WORKTREE',
      from: kind === 'staged' ? 'HEAD' : kind === 'unstaged' ? 'INDEX' : undefined,
      to: kind === 'untracked' ? undefined : 'WORKTREE',
    }
    selectChange(sel)
    openFile({ projectId, ...sel })
  }

  async function withBusy<T>(tag: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(tag)
    try {
      const r = await fn()
      await load()
      return r
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setErr(msg)
      pushLog({ level: 'error', scope: 'git', projectId, msg: `${tag}: ${msg}` })
      return null
    } finally {
      setBusy(null)
    }
  }

  async function onStage(paths: string[]) {
    if (paths.length === 0) return
    await withBusy(`stage(${paths.length})`, () => api.stagePaths(projectId, paths))
  }

  async function onUnstage(paths: string[]) {
    if (paths.length === 0) return
    await withBusy(`unstage(${paths.length})`, () => api.unstagePaths(projectId, paths))
  }

  async function onDiscard(tracked: string[], untracked: string[]) {
    const total = tracked.length + untracked.length
    if (total === 0) return
    const ok = await confirmDialog(`丢弃 ${total} 项更改? 此操作不可撤销。`, {
      title: '丢弃更改',
      variant: 'danger',
      confirmLabel: '丢弃',
    })
    if (!ok) return
    await withBusy(`discard(${total})`, () =>
      api.discardPaths(projectId, { tracked, untracked }),
    )
  }

  async function onStageAll() {
    if (!data || data.enabled !== true) return
    const paths = [
      ...data.unstaged.map((e) => e.path),
      ...data.untracked.map((e) => e.path),
    ]
    if (paths.length === 0) return
    await withBusy('stage-all', () => api.stagePaths(projectId, paths))
  }

  async function onCommit() {
    const msg = message.trim()
    if (!msg) {
      await alertDialog('请先输入提交信息', { title: '无法提交' })
      return
    }
    if (!data || data.enabled !== true) return
    if (data.staged.length === 0) {
      const ok = await confirmDialog('没有已暂存的更改。是否先暂存全部并提交?', {
        title: '暂存并提交',
        confirmLabel: '暂存并提交',
      })
      if (!ok) return
      const res = await withBusy('stage-all', () =>
        api.stagePaths(projectId, [
          ...data.unstaged.map((e) => e.path),
          ...data.untracked.map((e) => e.path),
        ]),
      )
      if (!res) return
    }
    const r = await withBusy('commit', () => api.createCommit(projectId, { message: msg }))
    if (r) {
      setMessage('')
      pushLog({
        level: 'info',
        scope: 'git',
        projectId,
        msg: `提交 ${r.shortSha}: ${r.summary}`,
      })
    }
  }

  function onCommitKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void onCommit()
    }
  }

  if (loading && !data) {
    return <div className="p-4 text-sm text-muted">加载中…</div>
  }
  if (err && !data) {
    return (
      <div className="p-4 text-sm text-rose-300 break-words whitespace-pre-wrap">
        {err}
        <div className="mt-2">
          <button
            onClick={() => void load()}
            className="fluent-btn px-2 py-0.5 rounded-md border border-border text-muted hover:text-fg"
          >
            重试
          </button>
        </div>
      </div>
    )
  }
  if (data && !data.enabled) {
    return (
      <div className="p-4 text-sm text-muted">此项目目录不是 Git 仓库。</div>
    )
  }
  if (!data) return null

  const selectedPath = selected?.path ?? null
  const selectedCommit = selected?.commitSha ?? null
  const totalChanges = data.staged.length + data.unstaged.length + data.untracked.length
  const workingChanges = data.unstaged.length + data.untracked.length

  return (
    <div className="flex flex-col h-full text-sm">
      {/* branch + refresh header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-muted">🌿</span>
          <span className="font-mono text-fg truncate">
            {data.branch ?? '(detached)'}
          </span>
          {(data.ahead > 0 || data.behind > 0) && (
            <span className="text-[10px] text-muted">↑{data.ahead} ↓{data.behind}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void onStageAll()}
            disabled={busy != null || workingChanges === 0}
            title="全部暂存 (+)"
            className="fluent-btn px-2 py-0.5 rounded-md border border-border text-muted hover:text-fg text-xs disabled:opacity-40"
          >
            ＋ 全部
          </button>
          <button
            onClick={() => void load()}
            disabled={busy != null}
            title="刷新"
            className="fluent-btn px-2 py-0.5 rounded-md border border-border text-muted hover:text-fg text-xs disabled:opacity-40"
          >
            🔄
          </button>
        </div>
      </div>

      {/* commit message + commit button */}
      <div className="px-3 py-2 border-b border-border/60 space-y-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={onCommitKey}
          rows={3}
          placeholder={`消息 (Ctrl+Enter 在 "${data.branch ?? 'HEAD'}" 提交)`}
          className="w-full resize-none bg-black/30 border border-border/60 rounded-md px-2 py-1.5 text-[13px] font-mono text-fg placeholder:text-subtle focus:outline-none focus:border-accent/60"
        />
        <button
          onClick={() => void onCommit()}
          disabled={busy != null || !message.trim()}
          className="fluent-btn w-full px-3 py-1.5 text-sm rounded-md bg-accent text-[#003250] font-medium hover:bg-accent-2 border border-accent/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy === 'commit' ? '提交中…' : `✓ 提交 (${data.staged.length})`}
        </button>
        {err && (
          <div className="text-[11px] text-rose-300 whitespace-pre-wrap break-words">{err}</div>
        )}
      </div>

      {/* changes list */}
      <div className="flex-1 overflow-auto">
        <Section
          title={`已暂存 (${data.staged.length})`}
          actions={
            data.staged.length > 0 && (
              <SectionAction
                onClick={() => void onUnstage(data.staged.map((e) => e.path))}
                disabled={busy != null}
                title="取消暂存全部"
              >−</SectionAction>
            )
          }
          hidden={data.staged.length === 0}
        >
          {data.staged.map((e) => (
            <FileRow
              key={`s:${e.path}`}
              entry={e}
              active={selectedPath === e.path && !selectedCommit}
              busy={busy != null}
              kind="staged"
              onClick={() => selectWorkingFile(e, 'staged')}
              onUnstage={() => void onUnstage([e.path])}
            />
          ))}
        </Section>

        <Section
          title={`未暂存 (${data.unstaged.length})`}
          actions={
            data.unstaged.length > 0 && (
              <>
                <SectionAction
                  onClick={() => void onDiscard(data.unstaged.map((e) => e.path), [])}
                  disabled={busy != null}
                  title="丢弃全部 (危险)"
                >↶</SectionAction>
                <SectionAction
                  onClick={() => void onStage(data.unstaged.map((e) => e.path))}
                  disabled={busy != null}
                  title="暂存全部"
                >＋</SectionAction>
              </>
            )
          }
          hidden={data.unstaged.length === 0}
        >
          {data.unstaged.map((e) => (
            <FileRow
              key={`u:${e.path}`}
              entry={e}
              active={selectedPath === e.path && !selectedCommit}
              busy={busy != null}
              kind="unstaged"
              onClick={() => selectWorkingFile(e, 'unstaged')}
              onStage={() => void onStage([e.path])}
              onDiscard={() => void onDiscard([e.path], [])}
            />
          ))}
        </Section>

        <Section
          title={`未跟踪 (${data.untracked.length})`}
          actions={
            data.untracked.length > 0 && (
              <>
                <SectionAction
                  onClick={() => void onDiscard([], data.untracked.map((e) => e.path))}
                  disabled={busy != null}
                  title="删除所有未跟踪文件 (危险)"
                >↶</SectionAction>
                <SectionAction
                  onClick={() => void onStage(data.untracked.map((e) => e.path))}
                  disabled={busy != null}
                  title="添加全部"
                >＋</SectionAction>
              </>
            )
          }
          hidden={data.untracked.length === 0}
        >
          {data.untracked.map((e) => (
            <FileRow
              key={`n:${e.path}`}
              entry={e}
              active={selectedPath === e.path && !selectedCommit}
              busy={busy != null}
              kind="untracked"
              onClick={() => selectWorkingFile(e, 'untracked')}
              onStage={() => void onStage([e.path])}
              onDiscard={() => void onDiscard([], [e.path])}
            />
          ))}
        </Section>

        {totalChanges === 0 && (
          <div className="px-3 py-6 text-xs text-muted text-center">
            工作树干净。
          </div>
        )}
      </div>
    </div>
  )
}

function Section({
  title,
  children,
  actions,
  hidden,
}: {
  title: string
  children: React.ReactNode
  actions?: React.ReactNode
  hidden?: boolean
}) {
  if (hidden) return null
  return (
    <div className="border-b border-border/40">
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-muted sticky top-0 bg-bg/90 backdrop-blur">
        <span>{title}</span>
        <div className="flex items-center gap-1">{actions}</div>
      </div>
      <div className="py-0.5">{children}</div>
    </div>
  )
}

function SectionAction({
  children,
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      disabled={disabled}
      title={title}
      className="w-5 h-5 inline-flex items-center justify-center rounded text-[11px] text-muted hover:text-fg hover:bg-white/[0.08] disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function FileRow({
  entry,
  active,
  busy,
  kind,
  onClick,
  onStage,
  onUnstage,
  onDiscard,
}: {
  entry: ChangeEntry
  active: boolean
  busy: boolean
  kind: Kind
  onClick: () => void
  onStage?: () => void
  onUnstage?: () => void
  onDiscard?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`group flex items-center w-full gap-2 px-3 py-1 text-[12.5px] cursor-pointer ${
        active
          ? 'bg-accent/15 border-l-2 border-l-accent'
          : 'hover:bg-white/[0.04] border-l-2 border-l-transparent'
      }`}
      title={entry.renamedFrom ? `${entry.renamedFrom} → ${entry.path}` : entry.path}
    >
      <StatusBadge status={entry.status} />
      <span className="font-mono truncate flex-1 text-left">{entry.path}</span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        {kind !== 'staged' && onDiscard && (
          <RowAction
            onClick={onDiscard}
            disabled={busy}
            title="丢弃更改"
            className="hover:text-rose-300"
          >↶</RowAction>
        )}
        {onStage && (
          <RowAction onClick={onStage} disabled={busy} title="暂存" className="hover:text-emerald-300">
            ＋
          </RowAction>
        )}
        {onUnstage && (
          <RowAction onClick={onUnstage} disabled={busy} title="取消暂存">
            −
          </RowAction>
        )}
      </div>
    </div>
  )
}

function RowAction({
  children,
  title,
  onClick,
  disabled,
  className = '',
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      disabled={disabled}
      title={title}
      className={`w-5 h-5 inline-flex items-center justify-center rounded text-[12px] text-muted hover:bg-white/[0.08] disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  )
}
