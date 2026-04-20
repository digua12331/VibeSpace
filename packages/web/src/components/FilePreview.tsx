import { useEffect, useMemo, useState } from 'react'
import * as api from '../api'
import type { DiffResult, FileContent, GitRef } from '../types'
import CodeView from './CodeView'
import DiffView from './DiffView'
import MarkdownView from './MarkdownView'

type Tab = 'diff' | 'source' | 'preview'

interface Props {
  projectId: string
  path: string
  /** Which ref to fetch raw content from. Default: WORKTREE. */
  ref?: GitRef
  /** Diff boundary. Defaults: from=HEAD, to=WORKTREE. */
  from?: GitRef
  to?: GitRef
}

function isMarkdownPath(p: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(p)
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export default function FilePreview({ projectId, path, ref, from, to }: Props) {
  const canMarkdown = isMarkdownPath(path)
  const defaultTab: Tab = from && to ? 'diff' : canMarkdown ? 'preview' : 'source'
  const [tab, setTab] = useState<Tab>(defaultTab)

  // When the selected file changes we rehydrate the default tab choice.
  useEffect(() => {
    setTab(defaultTab)
  }, [path, defaultTab])

  const [file, setFile] = useState<FileContent | null>(null)
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    setLoading(true)
    const wantDiff = tab === 'diff' && Boolean(from || to)
    const p = wantDiff
      ? api.getProjectDiff(projectId, path, { from, to }).then((d) => {
          if (!cancelled) setDiff(d)
        })
      : api.getProjectFile(projectId, path, ref).then((f) => {
          if (!cancelled) setFile(f)
        })
    p.catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, path, ref, from, to, tab])

  const showDiffTab = Boolean(from || to)

  const header = useMemo(
    () => (
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border/60 bg-black/20">
        <div className="min-w-0 flex items-center gap-2">
          <span className="text-sm font-mono text-fg truncate" title={path}>
            {path}
          </span>
          {file?.truncated && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-600/40">
              已截断 ({prettyBytes(file.size)})
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs">
          {showDiffTab && (
            <TabButton active={tab === 'diff'} onClick={() => setTab('diff')}>
              Diff
            </TabButton>
          )}
          <TabButton active={tab === 'source'} onClick={() => setTab('source')}>
            Source
          </TabButton>
          {canMarkdown && (
            <TabButton active={tab === 'preview'} onClick={() => setTab('preview')}>
              Preview
            </TabButton>
          )}
        </div>
      </div>
    ),
    [path, file, showDiffTab, canMarkdown, tab],
  )

  let body: React.ReactNode
  if (loading) {
    body = <div className="px-4 py-6 text-sm text-muted">加载中…</div>
  } else if (error) {
    body = (
      <div className="px-4 py-6 text-sm text-rose-300 whitespace-pre-wrap break-words">
        {error}
      </div>
    )
  } else if (tab === 'diff' && diff) {
    if (diff.isBinary) {
      body = <div className="px-4 py-6 text-sm text-muted">二进制文件，无法显示差异。</div>
    } else {
      body = <DiffView patch={diff.patch} lang={null} fileName={diff.path} />
    }
  } else if ((tab === 'source' || tab === 'preview') && file) {
    if (file.encoding === 'base64') {
      body = (
        <div className="px-4 py-6 text-sm text-muted">
          二进制文件 ({prettyBytes(file.size)})，不显示内容。
        </div>
      )
    } else if (tab === 'preview' && canMarkdown) {
      body = <MarkdownView source={file.content} />
    } else {
      body = <CodeView code={file.content} lang={file.language} />
    }
  } else {
    body = <div className="px-4 py-6 text-sm text-muted">无内容。</div>
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {header}
      <div className="flex-1 overflow-auto">{body}</div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`fluent-btn px-2.5 py-1 rounded-md border ${
        active
          ? 'bg-accent/15 border-accent/40 text-accent'
          : 'border-border text-muted hover:text-fg hover:bg-white/[0.04]'
      }`}
    >
      {children}
    </button>
  )
}
