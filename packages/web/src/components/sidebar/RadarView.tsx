import { useEffect, useRef, useState } from 'react'
import { useStore, RADAR_TAB_PROJECT_ID } from '../../store'
import * as api from '../../api'
import { logAction } from '../../logs'
import type { RadarDailyBrief, RadarStory } from '../../types'

/* ---------------------------------------------------------------------------
 * AI 资讯雷达：读 LearnPrompt/ai-news-radar 的公开精选数据（经本地后端代理），
 * 列表展示故事线，点条目在编辑区开只读 markdown 详情页签。
 *
 * 列表状态放本组件 useState——后端有 10 分钟缓存，重进侧栏重新请求即可，
 * 不进全局 store。刷新失败保留上一次成功列表，只挂错误横幅。
 * ------------------------------------------------------------------------- */

const STALE_AFTER_MS = 36 * 3600_000
const FUTURE_SLACK_MS = 5 * 60_000

function formatTimeAgo(ts: number): string {
  if (!ts) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时前`
  const days = Math.floor(diff / 86400_000)
  if (days < 30) return `${days}天前`
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function formatAbsolute(iso: string | null): string {
  if (!iso) return '未知'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '未知'
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 上游文本是外部输入：转义 markdown 特殊字符，防止标题/理由改变详情页结构。 */
function escapeMd(s: string): string {
  return s.replace(/([\\`*_{}[\]()#+\-!|<>~])/g, '\\$1')
}

function buildStoryMarkdown(story: RadarStory): string {
  const lines: string[] = []
  lines.push(`# ${escapeMd(story.title)}`)
  lines.push('')
  const facts: string[] = []
  if (story.category) facts.push(`分类：${escapeMd(story.category)}`)
  if (story.importanceLabel) facts.push(`重要度：${escapeMd(story.importanceLabel)}`)
  if (story.score != null) facts.push(`评分：${story.score}`)
  facts.push(`来源数：${story.sourceCount}`)
  if (story.earliestAt || story.latestAt) {
    facts.push(`时间：${formatAbsolute(story.earliestAt)} ～ ${formatAbsolute(story.latestAt)}`)
  }
  lines.push(facts.map((f) => `**${f}**`).join(' · '))
  lines.push('')
  if (story.reasons.length > 0) {
    lines.push('## 入选理由')
    lines.push('')
    for (const r of story.reasons) lines.push(`- ${escapeMd(r)}`)
    lines.push('')
  }
  if (story.sources.length > 0) {
    lines.push(`## 来源（${story.sources.length}）`)
    lines.push('')
    for (const s of story.sources) {
      const label = `${escapeMd(s.sourceName)} — ${escapeMd(s.title)}`
      const time = s.publishedAt ? `（${formatAbsolute(s.publishedAt)}）` : ''
      // 只渲染 http/https 链接（后端已过滤，这里兜底）
      lines.push(s.url ? `- [${label}](${s.url})${time}` : `- ${label}${time}`)
    }
    lines.push('')
  }
  if (story.primaryUrl) {
    lines.push('## 原文')
    lines.push('')
    lines.push(`- [${story.primaryUrl}](${story.primaryUrl})`)
    lines.push('')
  }
  lines.push('---')
  lines.push('')
  lines.push('数据来源：[AI News Radar](https://github.com/LearnPrompt/ai-news-radar)（公开数据，自动更新）')
  return lines.join('\n')
}

type Freshness =
  | { kind: 'ok' }
  | { kind: 'stale'; hours: number }
  | { kind: 'invalid' }

function checkFreshness(generatedAt: string | null): Freshness {
  if (!generatedAt) return { kind: 'invalid' }
  const t = Date.parse(generatedAt)
  if (Number.isNaN(t) || t > Date.now() + FUTURE_SLACK_MS) return { kind: 'invalid' }
  const age = Date.now() - t
  if (age > STALE_AFTER_MS) return { kind: 'stale', hours: Math.floor(age / 3600_000) }
  return { kind: 'ok' }
}

function importanceBadgeClass(label: string): string {
  // 复用项目现有 chip 配色习惯（cyan/emerald/amber 三档），不发明新色
  if (/高|重大|热/.test(label)) return 'text-amber-300/90 bg-amber-400/10 border-amber-400/30'
  if (/多源/.test(label)) return 'text-cyan-300/90 bg-cyan-400/10 border-cyan-400/30'
  return 'text-emerald-300/90 bg-emerald-400/10 border-emerald-400/30'
}

export default function RadarView() {
  const openFile = useStore((s) => s.openFile)
  const [brief, setBrief] = useState<RadarDailyBrief | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function load(force: boolean) {
    if (loading) return
    setLoading(true)
    try {
      const result = await logAction(
        'radar',
        'fetch',
        () => api.getRadarDailyBrief(force),
        { meta: { force } },
      )
      if (!mounted.current) return
      setBrief(result)
      setError(null)
    } catch (e: unknown) {
      if (!mounted.current) return
      // 刷新失败保留旧列表，只挂错误横幅
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }

  useEffect(() => {
    void load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openStory(story: RadarStory) {
    openFile({
      projectId: RADAR_TAB_PROJECT_ID,
      // path 存 storyId：参与 editorTabKey 拼接，同一故事去重、不同故事不冲突
      path: story.storyId,
      kind: 'radar',
      radarTitle: story.title,
      radarMarkdown: buildStoryMarkdown(story),
    })
  }

  const freshness = brief ? checkFreshness(brief.generatedAt) : null

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* 顶部：数据时间 + 刷新 */}
      <div className="shrink-0 px-3 py-2 flex items-center justify-between gap-2 border-b border-border/40">
        <div className="min-w-0 text-[11px] text-subtle truncate" title={brief?.generatedAt ?? ''}>
          {brief ? `数据时间 ${formatAbsolute(brief.generatedAt)}` : '尚未加载'}
        </div>
        <button
          onClick={() => void load(true)}
          disabled={loading}
          className="fluent-btn shrink-0 px-2 h-6 rounded text-[11px] border border-border/60 text-muted hover:text-fg hover:bg-white/[0.06] disabled:opacity-50 disabled:cursor-not-allowed"
          title="强制拉取最新数据（绕过 10 分钟缓存）"
        >
          {loading ? '刷新中…' : '刷新'}
        </button>
      </div>

      {/* 状态横幅 */}
      {freshness && freshness.kind !== 'ok' && (
        <div className="shrink-0 px-3 py-1.5 text-[11px] text-amber-300/90 bg-amber-400/10 border-b border-amber-400/20">
          {freshness.kind === 'stale'
            ? `数据已 ${freshness.hours} 小时未更新，可能不是最新资讯`
            : '数据时间异常（缺失或来自未来），内容仅供参考'}
        </div>
      )}
      {error && (
        <div className="shrink-0 px-3 py-1.5 text-[11px] text-rose-300/90 bg-rose-400/10 border-b border-rose-400/20 break-all">
          拉取失败：{error}
          {brief ? '（下方为上次成功的数据）' : ''}
        </div>
      )}

      {/* 列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {!brief && loading && (
          <div className="p-4 text-xs text-subtle text-center">
            <span className="inline-flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse-soft" />
              正在拉取资讯…
            </span>
          </div>
        )}
        {!brief && !loading && !error && (
          <div className="p-4 text-xs text-subtle text-center">暂无数据</div>
        )}
        {brief && brief.items.length === 0 && (
          <div className="p-4 text-xs text-subtle text-center">
            今日暂无精选资讯（上游未产出达标故事）
          </div>
        )}
        {brief?.items.map((story, i) => {
          const ts = story.latestAt ? Date.parse(story.latestAt) : NaN
          return (
            <button
              key={`${story.storyId}:${i}`}
              onClick={() => openStory(story)}
              className="w-full text-left px-3 py-2 border-b border-border/30 hover:bg-white/[0.04] focus:outline-none focus:bg-white/[0.06]"
              title={story.title}
            >
              <div className="text-[12.5px] text-fg leading-snug line-clamp-2">
                {story.title}
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-subtle">
                {story.importanceLabel && (
                  <span
                    className={`px-1 py-0 leading-4 rounded border whitespace-nowrap ${importanceBadgeClass(story.importanceLabel)}`}
                  >
                    {story.importanceLabel}
                  </span>
                )}
                <span className="whitespace-nowrap">{story.sourceCount} 个来源</span>
                {!Number.isNaN(ts) && (
                  <span className="whitespace-nowrap" title={formatAbsolute(story.latestAt)}>
                    {formatTimeAgo(ts)}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
