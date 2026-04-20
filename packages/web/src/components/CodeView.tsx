import { useEffect, useState } from 'react'
import { highlightToHtml } from '../highlight'

interface Props {
  code: string
  lang?: string | null
  /** Show line numbers column. Default true. */
  lineNumbers?: boolean
}

function withLineNumbers(html: string): string {
  // shiki wraps every source line in <span class="line">…</span>; we tag each
  // with a data-line attribute so CSS can show the line number in ::before.
  let n = 0
  return html.replace(/<span class="line">/g, () => {
    n += 1
    return `<span class="line" data-line="${n}">`
  })
}

export default function CodeView({ code, lang, lineNumbers = true }: Props) {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    highlightToHtml(code, lang)
      .then((h) => {
        if (cancelled) return
        setHtml(lineNumbers ? withLineNumbers(h) : h)
      })
      .catch(() => {
        if (cancelled) return
        setHtml(null)
      })
    return () => {
      cancelled = true
    }
  }, [code, lang, lineNumbers])

  if (!html) {
    return (
      <pre className="bg-[#0d1117] text-[#c9d1d9] p-3 rounded-md overflow-auto text-[12.5px] leading-relaxed font-mono">
        <code>{code}</code>
      </pre>
    )
  }

  return (
    <div
      className={`shiki-wrap rounded-md overflow-auto text-[12.5px] leading-relaxed
                 [&>pre]:!m-0 [&>pre]:!p-3 [&>pre]:font-mono
                 ${lineNumbers ? 'with-linenos' : ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
