import { useCallback, useEffect, useState } from 'react'
import * as api from '../api'
import { useStore, type SelectedChange } from '../store'
import type {
  ChangeEntry,
  ChangeStatus,
  ChangesResponse,
  CommitDetail,
  CommitSummary,
} from '../types'

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

function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function ChangesList({ projectId }: Props) {
  const [data, setData] = useState<ChangesResponse | null>(null)
  const [commits, setCommits] = useState<CommitSummary[]>([])
  const [expandedSha, setExpandedSha] = useState<string | null>(null)
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const selected = useStore((s) => s.selectedChange)
  const selectChange = useStore((s) => s.selectChange)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const [changes, log] = await Promise.all([
        api.getProjectChanges(projectId),
        api.listProjectCommits(projectId, { limit: 30 }),
      ])
      setData(changes)
      setCommits(log)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!expandedSha) {
      setCommitDetail(null)
      return
    }
    let cancelled = false
    api
      .getProjectCommit(projectId, expandedSha)
      .then((d) => { if (!cancelled) setCommitDetail(d) })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      })
    return () => { cancelled = true }
  }, [expandedSha, projectId])

  function selectWorkingFile(
    entry: ChangeEntry,
    kind: 'staged' | 'unstaged' | 'untracked',
  ): void {
    const sel: SelectedChange = {
      path: entry.path,
      status: entry.status,
      ref: 'WORKTREE',
      from: kind === 'staged' ? 'HEAD' : kind === 'unstaged' ? 'INDEX' : undefined,
      to: kind === 'untracked' ? undefined : 'WORKTREE',
    }
    selectChange(sel)
  }

  function selectCommitFile(sha: string, filePath: string, status: ChangeStatus): void {
    const parent = commitDetail?.parents?.[0]
    const sel: SelectedChange = {
      path: filePath,
      status,
      ref: sha,
      commitSha: sha,
      ...(parent ? { from: parent, to: sha } : {}),
    }
    selectChange(sel)
  }

  if (loading && !data) {
    return <div className="p-4 text-sm text-muted">加载中…</div>
  }
  if (err) {
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
      <div className="p-4 text-sm text-muted">
        此项目目录不是 Git 仓库。
      </div>
    )
  }
  if (!data) return null

  const selectedPath = selected?.path ?? null
  const selectedCommit = selected?.commitSha ?? null

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-muted">分支</span>
          <span className="font-mono text-fg truncate">{data.branch ?? '(detached)'}</span>
          {(data.ahead > 0 || data.behind > 0) && (
            <span className="text-[10px] text-muted">↑{data.ahead} ↓{data.behind}</span>
          )}
        </div>
        <button
          onClick={() => void load()}
          className="fluent-btn px-2 py-0.5 rounded-md border border-border text-muted hover:text-fg text-xs"
        >
          🔄 刷新
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <Section title={`已暂存 (${data.staged.length})`}>
          {data.staged.map((e) => (
            <FileRow
              key={`s:${e.path}`}
              entry={e}
              active={selectedPath === e.path && !selectedCommit}
              onClick={() => selectWorkingFile(e, 'staged')}
            />
          ))}
        </Section>
        <Section title={`未暂存 (${data.unstaged.length})`}>
          {data.unstaged.map((e) => (
            <FileRow
              key={`u:${e.path}`}
              entry={e}
              active={selectedPath === e.path && !selectedCommit}
              onClick={() => selectWorkingFile(e, 'unstaged')}
            />
          ))}
        </Section>
        <Section title={`未跟踪 (${data.untracked.length})`}>
          {data.untracked.map((e) => (
            <FileRow
              key={`n:${e.path}`}
              entry={e}
              active={selectedPath === e.path && !selectedCommit}
              onClick={() => selectWorkingFile(e, 'untracked')}
            />
          ))}
        </Section>

        <div className="border-t border-border/60 mt-1">
          <div className="px-3 py-2 text-xs text-muted sticky top-0 bg-bg/90 backdrop-blur">
            最近提交 ({commits.length})
          </div>
          {commits.map((c) => (
            <div key={c.sha} className="border-b border-border/40 last:border-b-0">
              <button
                onClick={() =>
                  setExpandedSha((cur) => (cur === c.sha ? null : c.sha))
                }
                className={`w-full text-left px-3 py-1.5 hover:bg-white/[0.03] ${
                  expandedSha === c.sha ? 'bg-white/[0.04]' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-muted">{c.shortSha}</span>
                  <span className="text-[11px] text-subtle">{shortDate(c.date)}</span>
                </div>
                <div className="text-[13px] truncate">{c.subject}</div>
                <div className="text-[11px] text-muted truncate">{c.author}</div>
              </button>
              {expandedSha === c.sha && (
                <div className="pl-4 pb-2 pr-2">
                  {!commitDetail || commitDetail.sha !== c.sha ? (
                    <div className="text-xs text-muted py-1">加载提交…</div>
                  ) : (
                    commitDetail.files.map((f) => (
                      <button
                        key={f.path}
                        onClick={() => selectCommitFile(c.sha, f.path, f.status)}
                        className={`flex items-center w-full gap-2 px-2 py-1 text-[12.5px] rounded-md ${
                          selectedPath === f.path && selectedCommit === c.sha
                            ? 'bg-accent/15 border border-accent/30'
                            : 'hover:bg-white/[0.04] border border-transparent'
                        }`}
                      >
                        <StatusBadge status={f.status} />
                        <span className="font-mono truncate flex-1 text-left">{f.path}</span>
                        {(f.additions > 0 || f.deletions > 0) && (
                          <span className="text-[10px] text-muted">
                            <span className="text-emerald-300">+{f.additions}</span>{' '}
                            <span className="text-rose-300">-{f.deletions}</span>
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  const arr = Array.isArray(children) ? children : [children]
  if (arr.length === 0 || arr.every((c) => !c)) return null
  return (
    <div className="border-b border-border/40">
      <div className="px-3 py-1.5 text-xs text-muted sticky top-0 bg-bg/90 backdrop-blur">
        {title}
      </div>
      <div className="py-0.5">{children}</div>
    </div>
  )
}

function FileRow({
  entry,
  active,
  onClick,
}: {
  entry: ChangeEntry
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center w-full gap-2 px-3 py-1 text-[12.5px] ${
        active
          ? 'bg-accent/15 border-l-2 border-l-accent'
          : 'hover:bg-white/[0.04] border-l-2 border-l-transparent'
      }`}
      title={entry.renamedFrom ? `${entry.renamedFrom} → ${entry.path}` : entry.path}
    >
      <StatusBadge status={entry.status} />
      <span className="font-mono truncate flex-1 text-left">{entry.path}</span>
    </button>
  )
}
