import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { highlightToHtml } from '../highlight'

// Allow our code-block wrapper to carry the language hint as `data-lang`.
const SCHEMA = {
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
  },
}

interface CodeBlockProps {
  code: string
  lang: string | null
}

function CodeBlock({ code, lang }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null)

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
  }, [code, lang])

  if (!html) {
    return (
      <pre className="fluent-card bg-[#0d1117] text-[#c9d1d9] p-3 rounded-md overflow-auto text-[12.5px] leading-relaxed">
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

export default function MarkdownView({ source }: { source: string }) {
  // Extract language from className='language-xxx' that react-markdown forwards.
  const components = useMemo(
    () => ({
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
    }),
    [],
  )

  return (
    <div className="markdown-body text-[14px] leading-7 prose-invert max-w-none px-4 py-3
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
        rehypePlugins={[[rehypeSanitize, SCHEMA]]}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}
