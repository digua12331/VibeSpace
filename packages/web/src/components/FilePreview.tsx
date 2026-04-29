import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../api'
import type { DiffResult, FileContent, GitRef } from '../types'
import CodeView from './CodeView'
import CommentsPanel from './CommentsPanel'
import DiffView from './DiffView'
import MarkdownView from './MarkdownView'
import HtmlPreview from './HtmlPreview'
import ImagePreview from './ImagePreview'
import ExcelPreview from './ExcelPreview'

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

function isHtmlPath(p: string): boolean {
  return /\.(html?|htm)$/i.test(p)
}

function isImagePath(p: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i.test(p)
}

function isExcelPath(p: string): boolean {
  return /\.(xlsx?|xlsm|xlsb|ods)$/i.test(p)
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export default function FilePreview({ projectId, path, ref, from, to }: Props) {
  const canMarkdown = isMarkdownPath(path)
  const isHtml = isHtmlPath(path)
  // 图片 / Excel 仅在 WORKTREE 上预览；历史 ref 回退到 Source/Diff(老体验)。
  const isWorktree = !ref || ref === 'WORKTREE'
  const canImage = isImagePath(path) && isWorktree
  const canExcel = isExcelPath(path) && isWorktree
  const canPreview = canMarkdown || isHtml || canImage || canExcel
  const defaultTab: Tab = from && to ? 'diff' : canPreview ? 'preview' : 'source'
  const [tab, setTab] = useState<Tab>(defaultTab)

  // Comments state — only meaningful for markdown files.
  const [anchorCounts, setAnchorCounts] = useState<Record<string, number>>({})
  const [pendingAdd, setPendingAdd] = useState<
    { anchorId: string; x: number; y: number } | null
  >(null)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const previewRef = useRef<HTMLDivElement | null>(null)
  // Comments can only be mutated against the current worktree. History refs
  // and diff views are read-only so we don't pollute historical commits.
  const commentsWritable = canMarkdown && (!ref || ref === 'WORKTREE') && !from && !to
  // Reset per-file state when the user switches tabs / ref.
  useEffect(() => {
    setPendingAdd(null)
    setAnchorCounts({})
  }, [path, projectId])

  // When the selected file changes we rehydrate the default tab choice.
  useEffect(() => {
    setTab(defaultTab)
  }, [path, defaultTab])

  const [file, setFile] = useState<FileContent | null>(null)
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fire the "no diff → fall back to source/preview" auto-switch at most
  // once per distinct file, so a user who deliberately re-clicks the Diff
  // tab on an empty-diff file isn't immediately kicked away.
  const didAutoFallbackRef = useRef(false)
  useEffect(() => {
    didAutoFallbackRef.current = false
  }, [path, from, to])

  useEffect(() => {
    // 图片 / Excel 在 Preview tab 不走 /file —— 这俩组件自己用 raw URL 拉字节。
    // 走 /file 反而会浪费一次最多 1MB 的 base64 拉取。
    if (tab === 'preview' && (canImage || canExcel)) {
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    setError(null)
    setLoading(true)
    const wantDiff = tab === 'diff' && Boolean(from || to)
    const p = wantDiff
      ? api.getProjectDiff(projectId, path, { from, to }).then((d) => {
          if (cancelled) return
          setDiff(d)
          // If the user landed on the diff tab by default but there's nothing
          // to diff (empty patch or context-only), fall back to a viewer tab
          // so the pane isn't a useless "no differences" placeholder. Once
          // per file — a later manual Diff click stays on the empty state.
          const hasRealChange = /(^|\n)[+-](?![+-])/.test(d.patch)
          if (!hasRealChange && !didAutoFallbackRef.current) {
            didAutoFallbackRef.current = true
            setTab(canMarkdown ? 'preview' : 'source')
          }
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
  }, [projectId, path, ref, from, to, tab, canMarkdown, canImage, canExcel])

  // Ensure the md source is available for the comments panel even when the
  // user is on the Diff tab — anchor resolution / orphan detection needs the
  // current file content, not a patch.
  useEffect(() => {
    if (!canMarkdown) return
    const wantDiff = tab === 'diff' && Boolean(from || to)
    if (!wantDiff) return
    let cancelled = false
    api.getProjectFile(projectId, path, ref).then((f) => {
      if (!cancelled) setFile(f)
    }).catch(() => {
      /* error surfaced by the primary fetch on tab switch */
    })
    return () => {
      cancelled = true
    }
  }, [projectId, path, ref, from, to, tab, canMarkdown])

  const onBlockCommentClick = useCallback(
    (anchorId: string) => {
      if (!commentsWritable) return
      // Find the block in the preview container and open the popover anchored
      // near the 💬 icon's bounding box.
      const root = previewRef.current
      const el = root?.querySelector<HTMLElement>(`[data-anchor-id="${CSS.escape(anchorId)}"]`)
      if (el) {
        const r = el.getBoundingClientRect()
        setPendingAdd({ anchorId, x: r.right + 8, y: r.top })
      } else {
        setPendingAdd({ anchorId, x: window.innerWidth / 2 - 160, y: 100 })
      }
      if (panelCollapsed) setPanelCollapsed(false)
    },
    [commentsWritable, panelCollapsed],
  )

  const onLocate = useCallback(
    (anchorId: string) => {
      // Switching to Preview tab so the block is actually in the DOM.
      if (tab !== 'preview') setTab('preview')
      // Defer to the next frame — the tab switch may need one paint to mount
      // MarkdownView.
      requestAnimationFrame(() => {
        const el = previewRef.current?.querySelector<HTMLElement>(
          `[data-anchor-id="${CSS.escape(anchorId)}"]`,
        )
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          // Flash a subtle highlight so the user sees where they landed.
          el.animate(
            [
              { backgroundColor: 'rgba(251, 191, 36, 0.25)' },
              { backgroundColor: 'transparent' },
            ],
            { duration: 1200, easing: 'ease-out' },
          )
        }
      })
    },
    [tab],
  )

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
          {canPreview && (
            <TabButton active={tab === 'preview'} onClick={() => setTab('preview')}>
              Preview
            </TabButton>
          )}
        </div>
      </div>
    ),
    [path, file, showDiffTab, canPreview, tab],
  )

  let body: React.ReactNode
  if (tab === 'preview' && canImage) {
    body = <ImagePreview projectId={projectId} path={path} />
  } else if (tab === 'preview' && canExcel) {
    body = <ExcelPreview projectId={projectId} path={path} />
  } else if (loading) {
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
      body = (
        <MarkdownView
          source={file.content}
          anchorCounts={anchorCounts}
          onBlockCommentClick={onBlockCommentClick}
          readOnly={!commentsWritable}
        />
      )
    } else if (tab === 'preview' && isHtml) {
      body = (
        <HtmlPreview
          projectId={projectId}
          path={path}
          content={file.content}
          truncated={file.truncated}
        />
      )
    } else {
      body = <CodeView code={file.content} lang={file.language} />
    }
  } else {
    body = <div className="px-4 py-6 text-sm text-muted">无内容。</div>
  }

  const showCommentsPanel = canMarkdown
  const mdSource = file?.encoding === 'base64' ? '' : file?.content ?? ''

  const mainColumn = (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      {header}
      <div ref={previewRef} className="flex-1 overflow-auto">
        {body}
      </div>
    </div>
  )

  if (!showCommentsPanel) {
    return (
      <div className="flex-1 flex flex-row min-w-0 min-h-0">{mainColumn}</div>
    )
  }

  return (
    <div className="flex-1 flex flex-row min-w-0 min-h-0">
      {mainColumn}
      <CommentsPanel
        projectId={projectId}
        path={path}
        source={mdSource}
        readOnly={!commentsWritable}
        pendingAdd={pendingAdd}
        onAddConsumed={() => setPendingAdd(null)}
        onAnchorCountsChange={setAnchorCounts}
        collapsed={panelCollapsed}
        onToggleCollapsed={() => setPanelCollapsed((v) => !v)}
        onLocate={onLocate}
      />
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
