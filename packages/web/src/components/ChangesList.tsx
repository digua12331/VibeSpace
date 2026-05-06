import { useCallback, useEffect, useRef, useState } from 'react'
import * as api from '../api'
import { logAction } from '../logs'
import { useStore, type SelectedChange } from '../store'
import type { ChangeEntry, ChangeStatus, ChangesResponse } from '../types'
import { alertDialog, confirmDialog } from './dialog/DialogHost'
import { openContextMenu } from './ContextMenu'
import { buildFileContextItems, type FileContextSession } from './fileContextMenu'
import BranchPopover from './BranchPopover'

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
  // SWR：data 直接派生自 store 缓存，跨项目切换瞬间用上次的 changes 撑画面，
  // load() 后台静默刷新写回 cache 触发重渲染。无 cache 时为 null，沿用原 loading 路径。
  const data = useStore(
    (s) => s.projectChangesCache[projectId] ?? null,
  ) as ChangesResponse | null
  const setProjectChangesCache = useStore((s) => s.setProjectChangesCache)
  const [loading, setLoading] = useState(false)
  // 用缓存撑画面期间的"后台刷新中"标记，给右上角小角标用，防止用户基于旧数据点错。
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<null | 'stage-all' | 'commit' | string>(null)
  const [message, setMessage] = useState('')
  const [stashCount, setStashCount] = useState(0)
  const [branchOpen, setBranchOpen] = useState(false)
  const [branchAnchor, setBranchAnchor] = useState<{ left: number; top: number; bottom: number } | null>(null)
  const branchChipRef = useRef<HTMLButtonElement | null>(null)

  const selected = useStore((s) => s.selectedChange)
  const selectChange = useStore((s) => s.selectChange)
  const openFile = useStore((s) => s.openFile)
  const sessions = useStore((s) => s.sessions)
  const liveStatus = useStore((s) => s.liveStatus)
  const bumpFilesRefresh = useStore((s) => s.bumpFilesRefresh)

  const load = useCallback(async () => {
    const hasCache =
      useStore.getState().projectChangesCache[projectId] != null
    if (hasCache) setRefreshing(true)
    else setLoading(true)
    setErr(null)
    try {
      const changes = await api.getProjectChanges(projectId)
      setProjectChangesCache(projectId, changes)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [projectId, setProjectChangesCache])

  const loadStashCount = useCallback(async () => {
    try {
      const list = await api.gitListStashes(projectId)
      setStashCount(list.length)
    } catch {
      setStashCount(0)
    }
  }, [projectId])

  useEffect(() => {
    void load()
    void loadStashCount()
  }, [load, loadStashCount])

  function aliveSessions(): FileContextSession[] {
    return sessions
      .filter((s) => {
        if (s.projectId !== projectId) return false
        const st = liveStatus[s.id] ?? s.status
        return st !== 'stopped' && st !== 'crashed'
      })
      .map((s) => ({ id: s.id, agent: s.agent }))
  }

  function onRowContextMenu(e: React.MouseEvent, path: string): void {
    e.preventDefault()
    e.stopPropagation()
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: buildFileContextItems({
        projectId,
        path,
        kind: 'file',
        sessions: aliveSessions(),
        onAfterDelete: () => {
          void load()
          bumpFilesRefresh()
        },
        onAfterGitignore: () => {
          void load()
          bumpFilesRefresh()
        },
      }),
    })
  }

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

  /**
   * Wrap a git mutation in: busy-state toggling, logAction start/end pair, and
   * a post-mutation `load()` so the UI reflects the new tree. Returns null on
   * failure (so callers can short-circuit) and the result on success.
   */
  async function withBusy<T>(
    tag: string,
    action: string,
    fn: () => Promise<T>,
    meta?: Record<string, unknown>,
  ): Promise<T | null> {
    setBusy(tag)
    setErr(null)
    try {
      const r = await logAction('git', action, fn, { projectId, meta })
      await load()
      // Stash count may have changed (push/pop/reset). Cheap, fire-and-forget.
      void loadStashCount()
      return r
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setErr(msg)
      return null
    } finally {
      setBusy(null)
    }
  }

  // ---- remote ops ----

  async function onPull() {
    await withBusy('pull', 'pull', () => api.gitPull(projectId))
  }

  async function onPush() {
    await withBusy('push', 'push', () => api.gitPush(projectId))
  }

  async function onFetch() {
    await withBusy('fetch', 'fetch', () => api.gitFetch(projectId))
  }

  // ---- stash / undo commit ----

  async function onStash() {
    if (!data || data.enabled !== true) return
    if (data.staged.length + data.unstaged.length + data.untracked.length === 0) {
      await alertDialog('当前没有可暂存到草稿的改动。', { title: '草稿暂存' })
      return
    }
    await withBusy('stash', 'stash-create', () => api.gitCreateStash(projectId))
  }

  async function onStashPop() {
    if (stashCount === 0) return
    await withBusy('stash-pop', 'stash-pop', () => api.gitPopStash(projectId))
  }

  async function onUndoCommit() {
    const ok = await confirmDialog(
      '撤销最后一次提交？提交记录会回退一步，但代码会保留在「已暂存」区，方便你重新提交。',
      { title: '撤销最后一次提交', confirmLabel: '撤销' },
    )
    if (!ok) return
    await withBusy('reset-soft', 'reset-soft', () => api.gitResetSoftLastCommit(projectId))
  }

  // ---- branch popover ----

  function openBranchPopover() {
    const el = branchChipRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setBranchAnchor({ left: rect.left, top: rect.top, bottom: rect.bottom })
    setBranchOpen(true)
  }

  async function onStage(paths: string[]) {
    if (paths.length === 0) return
    await withBusy(
      `stage(${paths.length})`,
      'stage',
      () => api.stagePaths(projectId, paths),
      { count: paths.length },
    )
  }

  async function onUnstage(paths: string[]) {
    if (paths.length === 0) return
    await withBusy(
      `unstage(${paths.length})`,
      'unstage',
      () => api.unstagePaths(projectId, paths),
      { count: paths.length },
    )
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
    await withBusy(
      `discard(${total})`,
      'discard',
      () => api.discardPaths(projectId, { tracked, untracked }),
      { tracked: tracked.length, untracked: untracked.length },
    )
  }

  async function onStageAll() {
    if (!data || data.enabled !== true) return
    const paths = [
      ...data.unstaged.map((e) => e.path),
      ...data.untracked.map((e) => e.path),
    ]
    if (paths.length === 0) return
    await withBusy(
      'stage-all',
      'stage-all',
      () => api.stagePaths(projectId, paths),
      { count: paths.length },
    )
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
      const stagePaths = [
        ...data.unstaged.map((e) => e.path),
        ...data.untracked.map((e) => e.path),
      ]
      const res = await withBusy(
        'stage-all',
        'stage-all',
        () => api.stagePaths(projectId, stagePaths),
        { count: stagePaths.length },
      )
      if (!res) return
    }
    const r = await withBusy(
      'commit',
      'commit',
      () => api.createCommit(projectId, { message: msg }),
      { message: msg.slice(0, 200) },
    )
    if (r) {
      setMessage('')
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

  const detached = data.detached === true || data.branch == null
  const remoteOpsDisabled = busy != null || detached
  const remoteHint = detached ? '当前不在分支上 (detached HEAD)' : ''

  return (
    <div className="flex flex-col h-full text-sm">
      {/* branch + remote ops header (row 1) */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 gap-1">
        <div className="flex items-center gap-2 min-w-0">
          <button
            ref={branchChipRef}
            onClick={openBranchPopover}
            disabled={busy != null}
            title="切换 / 新建 / 删除 / 合并分支"
            className="fluent-btn flex items-center gap-1 min-w-0 px-2 py-0.5 rounded-md border border-border/60 hover:border-accent/60 hover:bg-white/[0.04] disabled:opacity-50"
          >
            <span className="text-xs text-muted">🌿</span>
            <span className="font-mono text-fg truncate text-[12.5px]">
              {data.branch ?? '(detached)'}
            </span>
            {(data.ahead > 0 || data.behind > 0) && (
              <span className="text-[10px] text-muted whitespace-nowrap">↑{data.ahead} ↓{data.behind}</span>
            )}
            <span className="text-[9px] text-muted">▾</span>
          </button>
          {refreshing && (
            <span
              title="正在后台刷新这份变更列表（你看到的是上次切走时的快照）"
              className="text-[10px] text-amber-400/80 animate-pulse-soft whitespace-nowrap"
            >
              ⟳ 刷新中
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => void onPull()}
            disabled={remoteOpsDisabled}
            title={remoteHint || '从远程拉取并快进合并 (pull --ff-only)'}
            className="fluent-btn px-1.5 py-0.5 rounded-md border border-border text-muted hover:text-fg hover:border-accent/60 text-xs disabled:opacity-40"
          >
            {busy === 'pull' ? '…' : '⬇'}
          </button>
          <button
            onClick={() => void onPush()}
            disabled={remoteOpsDisabled}
            title={remoteHint || '推送当前分支到远程'}
            className="fluent-btn px-1.5 py-0.5 rounded-md border border-border text-muted hover:text-fg hover:border-accent/60 text-xs disabled:opacity-40"
          >
            {busy === 'push' ? '…' : '⬆'}
          </button>
          <button
            onClick={() => void onFetch()}
            disabled={busy != null}
            title="获取远程更新但不合并 (fetch --all --prune)"
            className="fluent-btn px-1.5 py-0.5 rounded-md border border-border text-muted hover:text-fg hover:border-accent/60 text-xs disabled:opacity-40"
          >
            {busy === 'fetch' ? '…' : '⤵'}
          </button>
          <span className="w-1" />
          <button
            onClick={() => void onStageAll()}
            disabled={busy != null || workingChanges === 0}
            title="全部暂存 (+)"
            className="fluent-btn px-2 py-0.5 rounded-md border border-border text-muted hover:text-fg text-xs disabled:opacity-40"
          >
            ＋ 全部
          </button>
          <button
            onClick={() => {
              void load()
              void loadStashCount()
            }}
            disabled={busy != null}
            title="刷新"
            className="fluent-btn px-2 py-0.5 rounded-md border border-border text-muted hover:text-fg text-xs disabled:opacity-40"
          >
            🔄
          </button>
        </div>
      </div>

      {branchOpen && branchAnchor && (
        <BranchPopover
          projectId={projectId}
          currentBranch={data.branch ?? null}
          anchor={branchAnchor}
          onClose={() => setBranchOpen(false)}
          onChanged={() => {
            void load()
          }}
        />
      )}

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
          className="fluent-btn w-full px-3 py-1.5 text-sm rounded-md bg-accent text-on-accent font-medium hover:bg-accent-2 border border-accent/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy === 'commit' ? '提交中…' : `✓ 提交 (${data.staged.length > 0 ? data.staged.length : workingChanges})`}
        </button>
        {/* Secondary row: stash / unstash / undo last commit */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => void onStash()}
            disabled={busy != null || totalChanges === 0}
            title="把当前所有改动收进草稿抽屉 (git stash)，腾出干净工作区"
            className="fluent-btn flex-1 px-2 py-1 text-[11.5px] rounded-md border border-border text-muted hover:text-fg hover:border-accent/60 disabled:opacity-40"
          >
            {busy === 'stash' ? '…' : '草稿暂存'}
          </button>
          <button
            onClick={() => void onStashPop()}
            disabled={busy != null || stashCount === 0}
            title={stashCount === 0 ? '没有草稿可取出' : '取出最新一个草稿 (git stash pop)'}
            className="fluent-btn flex-1 px-2 py-1 text-[11.5px] rounded-md border border-border text-muted hover:text-fg hover:border-accent/60 disabled:opacity-40"
          >
            {busy === 'stash-pop' ? '…' : `取出草稿 (${stashCount})`}
          </button>
          <button
            onClick={() => void onUndoCommit()}
            disabled={busy != null}
            title="把最后一次提交退回到「已暂存」状态，代码不会丢 (reset --soft HEAD~1)"
            className="fluent-btn flex-1 px-2 py-1 text-[11.5px] rounded-md border border-border text-muted hover:text-fg hover:border-accent/60 disabled:opacity-40"
          >
            {busy === 'reset-soft' ? '…' : '撤销提交'}
          </button>
        </div>
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
              onContextMenu={(ev) => onRowContextMenu(ev, e.path)}
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
              onContextMenu={(ev) => onRowContextMenu(ev, e.path)}
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
              onContextMenu={(ev) => onRowContextMenu(ev, e.path)}
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
  onContextMenu,
  onStage,
  onUnstage,
  onDiscard,
}: {
  entry: ChangeEntry
  active: boolean
  busy: boolean
  kind: Kind
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  onStage?: () => void
  onUnstage?: () => void
  onDiscard?: () => void
}) {
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
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
