import { useEffect, useState } from 'react'
import * as api from '../../api'
import { logAction } from '../../logs'
import type {
  ClaudeUsage,
  ModelFamily,
  UsageBucket,
} from '../../types'

const FAMILY_ORDER: ModelFamily[] = ['opus', 'sonnet', 'haiku', 'other']
const FAMILY_LABEL: Record<ModelFamily, string> = {
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
  other: '其他',
}

function fmt(n: number): string {
  if (n === 0) return '0'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  return `${(n / 1_000_000_000).toFixed(2)}B`
}

function bucketTotal(b: UsageBucket): number {
  const t = b.total
  return t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens
}

function fmtTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtRemaining(endMs: number): string {
  const diff = endMs - Date.now()
  if (diff <= 0) return '已结束'
  const mins = Math.round(diff / 60000)
  if (mins < 60) return `约 ${mins} 分钟后结束`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `约 ${h}h${m}m 后结束`
}

function BucketCard({
  title,
  subtitle,
  bucket,
}: {
  title: string
  subtitle?: string
  bucket: UsageBucket
}) {
  const t = bucket.total
  const total = t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens
  return (
    <div className="px-3 py-2 border-b border-border/40">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-[0.1em] text-subtle">{title}</span>
        <span className="text-[11px] tabular-nums text-fg/80">总 {fmt(total)}</span>
      </div>
      {subtitle && (
        <div className="text-[10px] text-subtle/80 mt-0.5">{subtitle}</div>
      )}
      <div className="mt-1.5 grid grid-cols-4 gap-1.5 text-[10px]">
        <div>
          <div className="text-subtle">Input</div>
          <div className="tabular-nums text-fg/90">{fmt(t.inputTokens)}</div>
        </div>
        <div>
          <div className="text-subtle">Output</div>
          <div className="tabular-nums text-fg/90">{fmt(t.outputTokens)}</div>
        </div>
        <div>
          <div className="text-subtle">Cache W</div>
          <div className="tabular-nums text-fg/90">{fmt(t.cacheCreationTokens)}</div>
        </div>
        <div>
          <div className="text-subtle">Cache R</div>
          <div className="tabular-nums text-fg/90">{fmt(t.cacheReadTokens)}</div>
        </div>
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-1.5 text-[10px]">
        {FAMILY_ORDER.map((f) => {
          const m = bucket.byModel[f]
          const fam = m.inputTokens + m.outputTokens + m.cacheCreationTokens + m.cacheReadTokens
          return (
            <div key={f} className={fam === 0 ? 'opacity-40' : ''}>
              <div className="text-subtle">{FAMILY_LABEL[f]}</div>
              <div className="tabular-nums text-fg/80">{fmt(fam)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SevenDayChart({ data }: { data: ClaudeUsage['last7days'] }) {
  const max = Math.max(1, ...data.map((d) => d.totalTokens))
  return (
    <div className="px-3 py-2 border-b border-border/40">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-[0.1em] text-subtle">最近 7 天</span>
        <span className="text-[11px] tabular-nums text-fg/80">
          峰值 {fmt(max === 1 ? 0 : max)}
        </span>
      </div>
      <div className="mt-2 flex items-end gap-1 h-16">
        {data.map((d) => {
          const h = d.totalTokens > 0 ? Math.max(2, (d.totalTokens / max) * 100) : 0
          return (
            <div
              key={d.date}
              className="flex-1 flex flex-col items-center gap-1"
              title={`${d.date}: ${fmt(d.totalTokens)} tokens`}
            >
              <div className="w-full flex-1 flex flex-col-reverse">
                <div
                  className="w-full rounded-sm bg-sky-400/60"
                  style={{ height: `${h}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-1 text-[9px] text-subtle">
        {data.map((d) => (
          <div key={d.date} className="flex-1 text-center tabular-nums">
            {d.date.slice(5)}
          </div>
        ))}
      </div>
    </div>
  )
}

function OtherCliPlaceholder() {
  return (
    <div className="px-3 py-2 border-b border-border/40 text-[11px] text-muted">
      <div className="uppercase tracking-[0.1em] text-subtle text-[11px]">其他 CLI</div>
      <div className="mt-1.5 space-y-1">
        <div>
          <span className="text-fg/80">Codex</span>
          <span className="text-subtle/80 ml-2">
            走 OpenAI API key，本地无 token 历史 ·{' '}
          </span>
          <a
            href="https://platform.openai.com/usage"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            OpenAI Usage
          </a>
        </div>
        <div>
          <span className="text-fg/80">Gemini</span>
          <span className="text-subtle/80 ml-2">
            走 Google API key，本地无 token 历史 ·{' '}
          </span>
          <a
            href="https://aistudio.google.com/app/usage"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            AI Studio Usage
          </a>
        </div>
      </div>
    </div>
  )
}

export default function UsageView() {
  const [usage, setUsage] = useState<ClaudeUsage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const data = await logAction('usage', 'read', () => api.getClaudeUsage())
      setUsage(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 py-1.5 flex items-center justify-between text-[11px] border-b border-border/40">
        <span className="text-fg/80 font-medium">Claude Code</span>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="fluent-btn px-2 py-0.5 rounded border border-border/60 hover:bg-white/[0.04] disabled:opacity-50 text-[11px]"
          title="重新解析 ~/.claude/projects/ 下的 jsonl"
        >
          {loading ? '加载中…' : '⟳ 刷新'}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {error && (
          <div className="mx-3 my-2 px-3 py-2 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md">
            读取失败: {error}
            <button
              onClick={() => void load()}
              className="ml-2 underline hover:text-rose-100"
            >
              重试
            </button>
          </div>
        )}

        {!usage && !error && (
          <div className="px-3 py-6 text-xs text-muted text-center">
            {loading ? '正在解析 jsonl…' : '点击右上"刷新"开始'}
          </div>
        )}

        {usage && (
          <>
            <BucketCard title="今日" bucket={usage.today} />
            <BucketCard
              title="近 5 小时"
              subtitle={`${fmtTime(usage.last5h.windowStartMs)} – ${fmtTime(usage.last5h.windowEndMs)} · ${fmtRemaining(usage.last5h.windowEndMs)} · 参考用，非官方剩余配额`}
              bucket={usage.last5h}
            />
            <SevenDayChart data={usage.last7days} />
            <OtherCliPlaceholder />
            <div className="px-3 py-2 text-[10px] text-subtle">
              扫描 {usage.filesScanned} 个 jsonl · {usage.entriesScanned} 条消息
              {usage.skipped > 0 ? ` · ${usage.skipped} 行未计入` : ''}
              {usage.note ? ` · ${usage.note}` : ''}
              {bucketTotal(usage.today) === 0 && (
                <span className="ml-1 text-amber-300/80">（今日暂无用量）</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
