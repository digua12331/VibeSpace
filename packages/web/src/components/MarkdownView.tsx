import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { highlightToHtml } from '../highlight'
import { useShikiVersion } from '../theme/store'
import { extractAnchors } from '../commentAnchor'
import { rehypeAnchorIds } from '../rehypeAnchorIds'

// Tags that carry `data-anchor-id` for the comments feature. Keep in sync
// with ANCHOR_TAGS in rehypeAnchorIds.ts.
const ANCHOR_TAG_LIST = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'pre', 'li', 'blockquote', 'hr', 'table',
] as const

// Allow our code-block wrapper to carry the language hint as `data-lang`,
// and preserve `data-anchor-id` on block elements so the comments panel can
// find them in the DOM.
const SCHEMA = (() => {
  const base = {
    ...defaultSchema,
    attributes: {
      ...(defaultSchema.attributes ?? {}),
      code: [
        ...((defaultSchema.attributes?.code as unknown[]) ?? []),
        ['className'],
      ],
      span: [
        ...((defaultSchema.attributes?.span as unknown[]) ?? []),
        ['className'],
        ['style'],
      ],
      pre: [
        ...((defaultSchema.attributes?.pre as unknown[]) ?? []),
        ['className'],
        ['style'],
      ],
    } as Record<string, unknown[]>,
  }
  for (const tag of ANCHOR_TAG_LIST) {
    const existing = (base.attributes[tag] as unknown[] | undefined) ?? []
    base.attributes[tag] = [...existing, ['dataAnchorId']]
  }
  return base
})()

interface CodeBlockProps {
  code: string
  lang: string | null
}

function CodeBlock({ code, lang }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null)
  const shikiVersion = useShikiVersion()

  useEffect(() => {
    let cancelled = false
    highlightToHtml(code, lang)
      .then((h) => {
        if (!cancelled) setHtml(h)
      })
      .catch(() => {
        // Fallback to plain text rendering.
      })
    return () => {
      cancelled = true
    }
  }, [code, lang, shikiVersion])

  if (!html) {
    return (
      <pre className="fluent-card bg-code-bg text-code-fg p-3 rounded-md overflow-auto text-[12.5px] leading-relaxed">
        <code>{code}</code>
      </pre>
    )
  }
  // shiki outputs its own <pre><code>; we just inject.
  return (
    <div
      className="shiki-wrap rounded-md overflow-auto text-[12.5px] leading-relaxed [&>pre]:!p-3 [&>pre]:!m-0"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

interface MarkdownViewProps {
  source: string
  /** anchorId → unread comment count. When count > 0, badge is always visible. */
  anchorCounts?: Record<string, number>
  /** Called when the user clicks the 💬 badge on a block. */
  onBlockCommentClick?: (anchorId: string) => void
  /** When true the hover 💬 is hidden (read-only: historical commit / diff view). */
  readOnly?: boolean
}

interface BlockCommonProps {
  'data-anchor-id'?: string
  className?: string
  children?: React.ReactNode
}

/**
 * Wrap a block element with a hover-visible 💬 badge when the element carries
 * a data-anchor-id. Count badge (when > 0) is always visible.
 */
function useBlockWrapper(
  anchorCounts: Record<string, number> | undefined,
  onClick: ((anchorId: string) => void) | undefined,
  readOnly: boolean,
) {
  return useMemo(() => {
    if (readOnly || !onClick) {
      // No badge rendering in read-only mode. Keep data-anchor-id on the DOM
      // so future interactions (scroll-to-anchor from the panel) still work.
      return null as null | ((tag: string) => React.FC<BlockCommonProps>)
    }
    return function factory(tag: string): React.FC<BlockCommonProps> {
      return function Block(props) {
        const anchorId = props['data-anchor-id']
        const count = anchorId ? anchorCounts?.[anchorId] ?? 0 : 0
        const { children, className, ...rest } = props
        const Tag = tag as keyof React.JSX.IntrinsicElements
        const mergedClass = `${className ?? ''} group/block relative`.trim()
        const hasAnchor = Boolean(anchorId)
        const badge = hasAnchor ? (
          <button
            type="button"
            contentEditable={false}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              if (anchorId) onClick(anchorId)
            }}
            title={count > 0 ? `${count} 条评论` : '添加评论'}
            className={`absolute -right-7 top-0.5 w-6 h-6 inline-flex items-center justify-center rounded text-[11px] tabular-nums select-none transition-opacity ${
              count > 0
                ? 'opacity-100 bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25'
                : 'opacity-0 group-hover/block:opacity-100 text-muted hover:text-fg hover:bg-white/[0.06]'
            }`}
          >
            💬{count > 0 ? <span className="ml-0.5">{count}</span> : null}
          </button>
        ) : null
        // Use createElement so we can keep the prop shape loose without
        // fighting TS over 12 specific intrinsic tag types.
        return (
          <Tag className={mergedClass} {...rest}>
            {children}
            {badge}
          </Tag>
        )
      }
    }
  }, [anchorCounts, onClick, readOnly])
}

export default function MarkdownView({
  source,
  anchorCounts,
  onBlockCommentClick,
  readOnly = false,
}: MarkdownViewProps) {
  // Pre-compute comment anchors so the rehype plugin can assign stable
  // data-anchor-id values that match what the comments panel looks up.
  const anchors = useMemo(() => extractAnchors(source), [source])
  const rehypePlugins = useMemo(
    () =>
      [
        [rehypeAnchorIds, { anchors }],
        [rehypeSanitize, SCHEMA],
      ] as const,
    [anchors],
  )
  const blockFactory = useBlockWrapper(anchorCounts, onBlockCommentClick, readOnly)
  // Extract language from className='language-xxx' that react-markdown forwards.
  const components = useMemo(() => {
    const base: Record<string, unknown> = {
      code(props: {
        inline?: boolean
        className?: string
        children?: React.ReactNode
      }) {
        const { inline, className, children } = props
        const text = String(children ?? '').replace(/\n$/, '')
        if (inline) {
          return (
            <code className="px-1 py-0.5 rounded bg-white/[0.06] text-[13px] font-mono border border-white/[0.06]">
              {children}
            </code>
          )
        }
        const match = /language-([\w+-]+)/.exec(className ?? '')
        return <CodeBlock code={text} lang={match?.[1] ?? null} />
      },
      a(props: { href?: string; children?: React.ReactNode }) {
        return (
          <a
            href={props.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            {props.children}
          </a>
        )
      },
    }
    if (blockFactory) {
      // Wrap anchored block tags except <pre> (handled by CodeBlock which
      // swaps the entire subtree) and <hr> (void element, no children for a
      // badge to anchor onto — orphan-count fallback suffices).
      const wrappable = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'blockquote', 'table']
      for (const tag of wrappable) {
        base[tag] = blockFactory(tag)
      }
    }
    return base
  }, [blockFactory])

  return (
    <div className="markdown-body text-[14px] leading-7 prose-invert max-w-none px-4 py-3 pr-10
                    [&_h1]:text-[22px] [&_h1]:font-semibold [&_h1]:mt-2 [&_h1]:mb-4 [&_h1]:border-b [&_h1]:border-border [&_h1]:pb-2
                    [&_h2]:text-[18px] [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-1
                    [&_h3]:text-[16px] [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2
                    [&_p]:my-2
                    [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-2
                    [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-2
                    [&_li]:my-1
                    [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_blockquote]:italic
                    [&_table]:w-full [&_table]:border-collapse [&_table]:my-3
                    [&_th]:border [&_th]:border-border [&_th]:bg-white/[0.03] [&_th]:px-2 [&_th]:py-1 [&_th]:text-left
                    [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1
                    [&_hr]:border-border [&_hr]:my-4
                    [&_img]:max-w-full [&_img]:rounded">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins as never}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
