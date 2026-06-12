import { useEffect, useRef, useState } from 'react'
import * as api from '../../api'
import { logAction } from '../../logs'
import type { RadarArticle } from '../../types'
import MarkdownView from '../MarkdownView'

/* ---------------------------------------------------------------------------
 * AI 资讯详情：上半部分渲染打开时的 radarMarkdown 快照（标题/来源/链接，
 * 列表刷新或条目消失后仍可读），下半部分挂载后按 storyId 异步抓原文正文。
 *
 * 正文是后端提取的纯文本（不含 HTML），用 whitespace-pre-wrap 直接渲染，
 * 不过 MarkdownView——从渲染层面杜绝原文内容注入页面结构。
 * 失败保留快照并给重试按钮；旧资讯掉出当日列表后抓不到属预期（404）。
 * ------------------------------------------------------------------------- */

type ArticleState =
  | { kind: 'loading' }
  | { kind: 'ok'; article: RadarArticle }
  | { kind: 'error'; message: string }

export default function RadarStoryView({
  storyId,
  fallbackMarkdown,
}: {
  storyId: string
  fallbackMarkdown?: string
}) {
  const [state, setState] = useState<ArticleState>({ kind: 'loading' })
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function load() {
    setState({ kind: 'loading' })
    try {
      const article = await logAction(
        'radar',
        'fetch-article',
        () => api.getRadarArticle(storyId),
        { meta: { storyId } },
      )
      if (!mounted.current) return
      setState({ kind: 'ok', article })
    } catch (e: unknown) {
      if (!mounted.current) return
      setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId])

  return (
    <div className="flex-1 overflow-auto">
      <div className="px-4 py-4">
        <MarkdownView
          source={fallbackMarkdown ?? '（内容缺失，请回到 AI资讯 列表重新打开）'}
          readOnly
        />

        <div className="mt-4 pt-3 border-t border-border/40">
          <div className="text-[13px] font-semibold text-fg mb-2">原文正文</div>
          {state.kind === 'loading' && (
            <div className="text-xs text-subtle">
              <span className="inline-flex items-center gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse-soft" />
                正在抓取原文…
              </span>
            </div>
          )}
          {state.kind === 'error' && (
            <div className="text-xs text-rose-300/90 bg-rose-400/10 border border-rose-400/20 rounded px-2.5 py-2 break-all">
              原文抓取失败：{state.message}
              <button
                onClick={() => void load()}
                className="fluent-btn ml-2 px-2 h-5 rounded text-[11px] border border-border/60 text-muted hover:text-fg hover:bg-white/[0.06]"
              >
                重试
              </button>
            </div>
          )}
          {state.kind === 'ok' && (
            <div className="text-[12.5px] text-fg/90 leading-relaxed whitespace-pre-wrap break-words">
              {state.article.textContent}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
