import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import type { MemoryEntry, MemoryPayload, MemoryRollbackSelection } from '../../types'

interface Props {
  projectId: string
}

export function MemoryView({ projectId }: Props) {
  const payload = useStore((s) => s.memoryData[projectId])
  const loading = useStore((s) => s.memoryLoading[projectId] === true)
  const errorMsg = useStore((s) => s.memoryError[projectId] ?? null)
  const refreshMemory = useStore((s) => s.refreshMemory)
  const rollbackMemoryItems = useStore((s) => s.rollbackMemoryItems)

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [rollingBack, setRollingBack] = useState(false)

  useEffect(() => {
    setSelected(new Set())
  }, [projectId])

  // Drop any selected lines that no longer exist after a refresh so the
  // rollback button doesn't act on stale indices.
  useEffect(() => {
    if (!payload) return
    const live = new Set(payload.auto.filter((e) => e.kind === 'lesson').map((e) => e.line))
    setSelected((cur) => {
      let changed = false
      const next = new Set<number>()
      for (const line of cur) {
        if (live.has(line)) next.add(line)
        else changed = true
      }
      return changed ? next : cur
    })
  }, [payload])

  const autoLessons = useMemo(
    () => (payload ? payload.auto.filter((e) => e.kind === 'lesson') : []),
    [payload],
  )
  const hasAny = (p: MemoryPayload | undefined): boolean =>
    !!p && (p.auto.length > 1 || p.manual.length > 1)

  const toggle = (line: number) => {
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(line)) next.delete(line)
      else next.add(line)
      return next
    })
  }

  const onRollback = async () => {
    if (selected.size === 0) return
    setRollingBack(true)
    try {
      const items: MemoryRollbackSelection[] = Array.from(selected).map((line) => ({
        kind: 'auto',
        line,
      }))
      await rollbackMemoryItems(projectId, items)
      setSelected(new Set())
    } catch {
      /* store already captured the error */
    } finally {
      setRollingBack(false)
    }
  }

  if (loading && !payload) {
    return <div className="px-3 py-6 text-xs text-muted text-center">加载中…</div>
  }

  if (errorMsg) {
    return (
      <div className="p-2">
        <div className="px-3 py-2 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md">
          {errorMsg}
        </div>
      </div>
    )
  }

  if (!payload) {
    return (
      <div className="px-3 py-6 text-xs text-muted text-center">暂无数据</div>
    )
  }

  const autoHasContent = autoLessons.length > 0
  const manualHasContent = payload.manual.some((e) => e.text.trim().length > 0 && !isHeader(e))

  if (!autoHasContent && !manualHasContent) {
    return (
      <div className="px-3 py-6 text-xs text-muted leading-relaxed">
        还没有记忆条目——归档一次任务后后台会自动评审并追加到 <code className="px-1 rounded bg-white/[0.06]">auto.md</code>，
        你也可以手动往 <code className="px-1 rounded bg-white/[0.06]">dev/memory/manual.md</code> 追写长期经验。
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-auto p-2">
        <Section title="自动沉淀（auto.md）" entries={payload.auto}>
          {(entry) => {
            if (entry.kind === 'raw') return <RawRow key={entry.line} entry={entry} />
            return (
              <LessonRow
                key={entry.line}
                entry={entry}
                checked={selected.has(entry.line)}
                onToggle={() => toggle(entry.line)}
              />
            )
          }}
        </Section>
        <Section title="手动沉淀（manual.md）" entries={payload.manual}>
          {(entry) =>
            entry.kind === 'raw' ? (
              <RawRow key={entry.line} entry={entry} />
            ) : (
              <LessonRow key={entry.line} entry={entry} readonly />
            )
          }
        </Section>
      </div>
      {autoHasContent && (
        <div className="px-2 py-1.5 border-t border-border/40 flex items-center gap-1">
          <div className="text-[11px] text-muted">
            已选 {selected.size} / {autoLessons.length}
          </div>
          <div className="flex-1" />
          <button
            onClick={() => void refreshMemory(projectId)}
            title="刷新"
            className="fluent-btn w-6 h-6 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.08]"
          >
            ⟳
          </button>
          <button
            onClick={() => void onRollback()}
            disabled={selected.size === 0 || rollingBack}
            className="fluent-btn h-6 px-2 inline-flex items-center justify-center rounded text-[11px] text-muted hover:text-fg hover:bg-white/[0.08] disabled:opacity-50"
            title="把选中条目从 auto.md 移到 rejected.md（保留历史不删除）"
          >
            {rollingBack ? '撤回中…' : `撤回选中 (${selected.size})`}
          </button>
        </div>
      )}
      {!autoHasContent && hasAny(payload) && (
        <div className="px-2 py-1.5 border-t border-border/40 flex items-center gap-1">
          <div className="flex-1" />
          <button
            onClick={() => void refreshMemory(projectId)}
            title="刷新"
            className="fluent-btn w-6 h-6 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.08]"
          >
            ⟳
          </button>
        </div>
      )}
    </div>
  )
}

function Section({
  title,
  entries,
  children,
}: {
  title: string
  entries: MemoryEntry[]
  children: (entry: MemoryEntry) => React.ReactNode
}) {
  // Skip the header (first `# ...` line) and immediately-following blockquotes /
  // empty lines — they're the skeleton explanation the user already read once.
  const body = stripSkeleton(entries)
  if (body.length === 0) {
    return (
      <div className="mb-3">
        <div className="px-1 pb-1 text-[11px] uppercase tracking-wider text-subtle">
          {title}
        </div>
        <div className="px-2 py-2 text-[11px] text-subtle italic">（空）</div>
      </div>
    )
  }
  return (
    <div className="mb-3">
      <div className="px-1 pb-1 text-[11px] uppercase tracking-wider text-subtle">
        {title}
      </div>
      <div className="space-y-0.5">{body.map((entry) => children(entry))}</div>
    </div>
  )
}

function stripSkeleton(entries: MemoryEntry[]): MemoryEntry[] {
  // Drop the leading header block (# …, blank, > …, > …, blank) before the
  // first lesson. Everything after we keep as-is so the user sees their own
  // scribbles too.
  const firstLessonIdx = entries.findIndex((e) => e.kind === 'lesson')
  if (firstLessonIdx === -1) {
    // No lessons — still drop the header block so the section appears empty.
    return entries.filter((e) => e.kind === 'raw' && !isHeader(e) && e.text.trim().length > 0)
  }
  return entries.slice(0).reduce<MemoryEntry[]>((acc, e, idx) => {
    if (idx < firstLessonIdx && isHeader(e)) return acc
    if (e.kind === 'raw' && e.text.trim().length === 0 && acc.length === 0) return acc
    acc.push(e)
    return acc
  }, [])
}

function isHeader(e: MemoryEntry): boolean {
  if (e.kind !== 'raw') return false
  const t = e.text.trimStart()
  return t.startsWith('#') || t.startsWith('>') || t.startsWith('<!--')
}

function LessonRow({
  entry,
  checked,
  onToggle,
  readonly,
}: {
  entry: MemoryEntry
  checked?: boolean
  onToggle?: () => void
  readonly?: boolean
}) {
  const conclusion = extractConclusion(entry.text)
  const tooltipParts = [entry.date, entry.task, conclusion].filter(
    (s): s is string => !!s && s.length > 0,
  )
  const tooltip = tooltipParts.join(' / ')
  return (
    <div
      className="group flex items-center gap-1.5 pl-1 pr-2 py-1 rounded hover:bg-white/[0.04] text-sm"
      title={tooltip}
    >
      {!readonly ? (
        <input
          type="checkbox"
          checked={!!checked}
          onChange={onToggle}
          className="shrink-0"
        />
      ) : (
        <span className="inline-block w-4 shrink-0" />
      )}
      {entry.date && (
        <span className="text-[10px] text-subtle tabular-nums shrink-0">
          {entry.date}
        </span>
      )}
      <span className="flex-1 truncate text-fg/90">{conclusion}</span>
    </div>
  )
}

function RawRow({ entry }: { entry: MemoryEntry }) {
  const t = entry.text
  if (!t || !t.trim()) return null
  if (isHeader(entry)) return null
  return (
    <div
      className="flex items-center gap-1.5 pl-1 pr-2 py-1 rounded hover:bg-white/[0.04] text-sm"
      title={t}
    >
      <span className="inline-block w-4 shrink-0" />
      <span className="flex-1 truncate text-[11px] text-subtle">{t}</span>
    </div>
  )
}

function extractConclusion(raw: string): string {
  // raw shape: `- [<date> / <task>] <conclusion>`
  const m = /^- \[[^\]]+\] (.+)$/.exec(raw)
  return m ? m[1] : raw
}
