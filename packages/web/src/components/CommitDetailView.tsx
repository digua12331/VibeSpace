import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from '../api'
import { useStore } from '../store'
import type { ChangeStatus, CommitDetail, CommitFile, DiffResult } from '../types'
import DiffView from './DiffView'

/**
 * 「提交详情」标签内容：点提交图里的某次提交后，在编辑区展示该提交
 * 改动的文件清单，点文件就地展示该文件这次提交的 diff（不开新标签，
 * 因为 openFile 是单槽位会顶掉本标签）。后端能力全部现成：
 * getProjectCommit 取文件清单，getProjectDiff 取单文件 patch。
 */

interface Props {
  projectId: string
  sha: string
}

// git 标准空树 hash：根提交无父时拿它做 diff 基准（git diff <empty> <sha>）。
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

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
      className={`inline-block w-[18px] text-center text-[10px] leading-4 px-1 rounded border shrink-0 ${tone}`}
    >
      {status}
    </span>
  )
}

function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export default function CommitDetailView({ projectId, sha }: Props) {
  const detail = useStore((s) => s.commitDetailCache[projectId]?.[sha] ?? null)
  const setCommitDetailCache = useStore((s) => s.setCommitDetailCache)

  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)

  // ---- 拉取提交详情（SWR：有缓存先用，无缓存才转圈）----
  useEffect(() => {
    let cancelled = false
    const hasCache =
      useStore.getState().commitDetailCache[projectId]?.[sha] != null
    if (!hasCache) setLoading(true)
    setErr(null)
    api
      .getProjectCommit(projectId, sha)
      .then((d) => {
        if (cancelled) return
        setCommitDetailCache(projectId, sha, d)
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, sha, setCommitDetailCache])

  // 详情到手后默认选中第一个文件；切到别的提交时重置选择。
  useEffect(() => {
    setSelectedPath(null)
  }, [projectId, sha])
  useEffect(() => {
    if (selectedPath == null && detail && detail.files.length > 0) {
      setSelectedPath(detail.files[0].path)
    }
  }, [detail, selectedPath])

  const fromRef = useMemo(
    () => (detail && detail.parents[0] ? detail.parents[0] : EMPTY_TREE),
    [detail],
  )

  if (loading && !detail) {
    return <div className="p-4 text-xs text-muted">加载提交详情…</div>
  }
  if (err && !detail) {
    return (
      <div className="p-4 text-xs text-rose-300 whitespace-pre-wrap break-words">
        加载提交失败：{err}
      </div>
    )
  }
  if (!detail) return null

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 文件清单 + diff（提交头已收进左上角的 ❗ 弹窗）*/}
      <div className="flex-1 min-h-0 flex">
        <div className="w-72 shrink-0 border-r border-border/60 overflow-auto">
          <div className="relative px-3 py-1.5 text-[11px] text-muted sticky top-0 bg-bg/90 backdrop-blur flex items-center gap-2">
            <CommitInfoToggle
              detail={detail}
              open={infoOpen}
              onToggle={() => setInfoOpen((v) => !v)}
              onClose={() => setInfoOpen(false)}
            />
            <span>{detail.files.length} 个文件</span>
          </div>
          {detail.files.length === 0 ? (
            <div className="px-3 py-4 text-[11px] text-muted">
              这次提交没有文件改动（可能是空提交或仅合并）。
            </div>
          ) : (
            <ul>
              {detail.files.map((f) => (
                <FileRow
                  key={f.path}
                  file={f}
                  active={selectedPath === f.path}
                  onClick={() => setSelectedPath(f.path)}
                />
              ))}
            </ul>
          )}
        </div>
        <div className="flex-1 min-w-0 overflow-auto">
          {selectedPath ? (
            <FileDiff
              projectId={projectId}
              path={selectedPath}
              from={fromRef}
              to={sha}
            />
          ) : (
            <div className="p-4 text-xs text-muted">选择左侧文件查看改动。</div>
          )}
        </div>
      </div>
    </div>
  )
}

// 叹号按钮 + 就地弹出的提交信息面板（原顶部提交头的内容）。按钮和面板同在本
// 组件内，直接用相对/绝对定位，不走 portal；点面板外或按 Esc 收起。
function CommitInfoToggle({
  detail,
  open,
  onToggle,
  onClose,
}: {
  detail: CommitDetail
  open: boolean
  onToggle: () => void
  onClose: () => void
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (el && !el.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, el, onClose])

  return (
    <div className="relative" ref={setEl}>
      <button
        onClick={onToggle}
        title="提交信息"
        className={`w-[18px] h-[18px] inline-flex items-center justify-center rounded-full border text-[11px] leading-none shrink-0 ${
          open
            ? 'bg-accent/20 border-accent/60 text-accent'
            : 'bg-white/[0.04] border-border text-muted hover:text-fg hover:bg-white/[0.08]'
        }`}
      >
        !
      </button>
      {open && (
        <div className="absolute left-0 top-[22px] z-20 w-80 max-w-[80vw] rounded-md border border-border bg-bg shadow-lg px-3 py-2.5">
          <div className="text-[13px] text-fg font-medium break-words">
            {detail.subject || '(无提交说明)'}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted flex-wrap">
            <span>{detail.author}</span>
            <span>·</span>
            <span>{shortDate(detail.date)}</span>
            <span>·</span>
            <span className="font-mono text-subtle">{detail.shortSha}</span>
            {detail.parents.length > 1 && (
              <span className="text-[10px] px-1 py-0.5 rounded border border-border text-subtle">
                合并提交 · 与第一父提交比较
              </span>
            )}
          </div>
          {detail.body && (
            <div className="mt-1.5 text-[11.5px] text-fg/70 whitespace-pre-wrap break-words max-h-40 overflow-auto">
              {detail.body}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FileRow({
  file,
  active,
  onClick,
}: {
  file: CommitFile
  active: boolean
  onClick: () => void
}) {
  const title = file.renamedFrom ? `${file.renamedFrom} → ${file.path}` : file.path
  return (
    <li
      onClick={onClick}
      title={title}
      className={`flex items-center gap-2 px-3 py-1 text-[12px] cursor-pointer ${
        active
          ? 'bg-accent/15 border-l-2 border-l-accent'
          : 'hover:bg-white/[0.04] border-l-2 border-l-transparent'
      }`}
    >
      <StatusBadge status={file.status} />
      <span className="font-mono truncate flex-1 text-left">{file.path}</span>
      <span className="shrink-0 text-[10px] tabular-nums">
        {file.additions > 0 && <span className="text-emerald-300">+{file.additions}</span>}
        {file.additions > 0 && file.deletions > 0 && ' '}
        {file.deletions > 0 && <span className="text-rose-300">-{file.deletions}</span>}
      </span>
    </li>
  )
}

function FileDiff({
  projectId,
  path,
  from,
  to,
}: {
  projectId: string
  path: string
  from: string
  to: string
}) {
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    let cancelled = false
    setLoading(true)
    setErr(null)
    setDiff(null)
    api
      .getProjectDiff(projectId, path, { from, to })
      .then((d) => {
        if (!cancelled) setDiff(d)
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, path, from, to])

  useEffect(() => load(), [load])

  if (loading) return <div className="p-4 text-xs text-muted">加载差异…</div>
  if (err) {
    return (
      <div className="p-4 text-xs text-rose-300 whitespace-pre-wrap break-words">
        加载差异失败：{err}
      </div>
    )
  }
  if (!diff) return null
  if (diff.isBinary) {
    return (
      <div className="p-4 text-xs text-muted">
        二进制文件，无法展示文本差异。
      </div>
    )
  }
  return (
    <div className="p-2">
      <DiffView patch={diff.patch} />
    </div>
  )
}
