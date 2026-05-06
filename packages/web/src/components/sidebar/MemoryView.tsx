import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import { logAction } from '../../logs'
import type { LessonSeverity, MemoryEntry, MemoryPayload, MemoryRollbackSelection } from '../../types'

interface Props {
  projectId: string
}

type FilterValue = '__all' | '__none' | string
type SeverityFilterValue = '__all' | '__none' | LessonSeverity

interface MemoryFilter {
  category: FilterValue
  severity: SeverityFilterValue
  files: FilterValue
}

const DEFAULT_FILTER: MemoryFilter = { category: '__all', severity: '__all', files: '__all' }

const SEVERITY_LABEL: Record<LessonSeverity, string> = {
  info: '一般',
  warn: '警告',
  error: '严重',
}

export function MemoryView({ projectId }: Props) {
  const payload = useStore((s) => s.memoryData[projectId])
  const loading = useStore((s) => s.memoryLoading[projectId] === true)
  const errorMsg = useStore((s) => s.memoryError[projectId] ?? null)
  const refreshMemory = useStore((s) => s.refreshMemory)
  const rollbackMemoryItems = useStore((s) => s.rollbackMemoryItems)

  const alerts = useStore((s) => s.alerts)
  const dismissAlert = useStore((s) => s.dismissAlert)
  const markAlertRead = useStore((s) => s.markAlertRead)
  const openFile = useStore((s) => s.openFile)

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [rollingBack, setRollingBack] = useState(false)
  const [filter, setFilter] = useState<MemoryFilter>(DEFAULT_FILTER)
  const [alertsCollapsed, setAlertsCollapsed] = useState(false)

  useEffect(() => {
    setSelected(new Set())
    setFilter(DEFAULT_FILTER)
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

  // Aggregate distinct categories / files across all lesson rows (auto + manual)
  // so the filter dropdowns reflect what's actually present right now.
  const facets = useMemo(() => {
    const categories = new Set<string>()
    const files = new Set<string>()
    if (payload) {
      for (const e of [...payload.auto, ...payload.manual]) {
        if (e.kind !== 'lesson') continue
        if (e.category) categories.add(e.category)
        if (e.files) for (const f of e.files) files.add(f)
      }
    }
    return {
      categories: Array.from(categories).sort(),
      files: Array.from(files).sort(),
    }
  }, [payload])

  const filterActive =
    filter.category !== '__all' || filter.severity !== '__all' || filter.files !== '__all'

  const filteredAuto = useMemo(
    () => (payload ? applyFilter(payload.auto, filter) : []),
    [payload, filter],
  )
  const filteredManual = useMemo(
    () => (payload ? applyFilter(payload.manual, filter) : []),
    [payload, filter],
  )

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
      <AlertsBar
        alerts={alerts}
        collapsed={alertsCollapsed}
        onToggleCollapsed={() => setAlertsCollapsed((v) => !v)}
        onCopyDraft={async (alert) => {
          await logAction('memory', 'alert-copy-draft', async () => {
            const draft = formatAlertDraft(alert)
            await navigator.clipboard.writeText(draft)
            // Best-effort: open manual.md so the user can paste right in.
            // openFile is local state only; never throws.
            try {
              openFile({
                projectId,
                path: 'dev/memory/manual.md',
              })
            } catch {
              /* sidebar action not critical */
            }
          }, { projectId, meta: { alertId: alert.id, scope: alert.key.scope, action: alert.key.action } })
        }}
        onMarkRead={async (alertId) => {
          await logAction('memory', 'alert-mark-read', async () => {
            markAlertRead(alertId)
          }, { projectId, meta: { alertId } })
        }}
        onDismiss={async (alertId) => {
          await logAction('memory', 'alert-dismiss', async () => {
            dismissAlert(alertId)
          }, { projectId, meta: { alertId } })
        }}
      />
      <FilterBar
        value={filter}
        onChange={setFilter}
        categories={facets.categories}
        files={facets.files}
        active={filterActive}
      />
      <div className="flex-1 min-h-0 overflow-auto p-2">
        <Section title="自动沉淀（auto.md）" entries={filteredAuto}>
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
        <Section title="手动沉淀（manual.md）" entries={filteredManual}>
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

interface AlertEntryShape {
  id: string
  ts: number
  key: { scope: string; action: string; actionIsFallback: boolean; projectId?: string }
  count: number
  firstAt: number
  lastAt: number
  sampleMsg: string
  read: boolean
}

function formatAlertDraft(a: AlertEntryShape): string {
  // Single-line manual.md entry the user can paste-and-edit. Date is "today",
  // task name marks the source so future review can trace it back.
  const today = new Date().toISOString().slice(0, 10)
  const span = Math.max(1, Math.round((a.lastAt - a.firstAt) / 1000))
  const sample = (a.sampleMsg || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const actionLabel = a.key.actionIsFallback ? `${a.key.action}*` : a.key.action
  return `- [${today} / error-loop:${a.key.scope}/${actionLabel}] [建议大哥确认并改写为正式经验] 同一类错误 ${a.count} 次 / ${span}s（最近：${sample}）（上下文：检测自动告警，重启后状态清零）[category=踩坑; severity=warn]`
}

function AlertsBar({
  alerts,
  collapsed,
  onToggleCollapsed,
  onCopyDraft,
  onMarkRead,
  onDismiss,
}: {
  alerts: AlertEntryShape[]
  collapsed: boolean
  onToggleCollapsed: () => void
  onCopyDraft: (alert: AlertEntryShape) => void
  onMarkRead: (alertId: string) => void
  onDismiss: (alertId: string) => void
}) {
  if (alerts.length === 0) return null
  const unread = alerts.filter((a) => !a.read).length
  return (
    <div className="border-b border-rose-500/30 bg-rose-500/[0.06]">
      <button
        onClick={onToggleCollapsed}
        className="w-full px-2 py-1.5 flex items-center gap-1.5 text-[11px] text-rose-200/90 hover:bg-rose-500/[0.10]"
        title={collapsed ? '展开告警卡片' : '折叠告警卡片'}
      >
        <span className="font-medium">⚠️ 当前运行期间检测到错误循环</span>
        <span className="px-1.5 py-0.5 rounded bg-rose-500/30 text-rose-100 text-[10px] tabular-nums">
          {unread > 0 ? `${unread} 未读 / ${alerts.length}` : `${alerts.length}`}
        </span>
        <span className="flex-1" />
        <span className="text-rose-200/70">{collapsed ? '展开 ▾' : '折叠 ▴'}</span>
      </button>
      {!collapsed && (
        <div className="px-2 pb-2 space-y-1.5 max-h-48 overflow-auto">
          {alerts.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              onCopyDraft={() => onCopyDraft(a)}
              onMarkRead={() => onMarkRead(a.id)}
              onDismiss={() => onDismiss(a.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AlertCard({
  alert,
  onCopyDraft,
  onMarkRead,
  onDismiss,
}: {
  alert: AlertEntryShape
  onCopyDraft: () => void
  onMarkRead: () => void
  onDismiss: () => void
}) {
  const span = Math.max(1, Math.round((alert.lastAt - alert.firstAt) / 1000))
  const actionLabel = alert.key.actionIsFallback ? `${alert.key.action}*` : alert.key.action
  return (
    <div
      className={`rounded border text-[11px] px-2 py-1.5 ${
        alert.read
          ? 'border-border/40 bg-white/[0.03] text-fg/70'
          : 'border-rose-500/40 bg-rose-500/[0.10] text-fg'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-medium tabular-nums">
          {alert.key.scope} · {actionLabel}
        </span>
        <span className="text-subtle">
          {alert.count} 次 / {span}s
        </span>
        {alert.key.projectId && (
          <span className="text-[10px] px-1 rounded bg-white/[0.05] text-subtle">
            project:{alert.key.projectId.slice(0, 8)}
          </span>
        )}
        <span className="flex-1" />
        <button
          onClick={onCopyDraft}
          className="fluent-btn px-1.5 py-0.5 rounded text-[10px] text-fg hover:bg-white/[0.10]"
          title="生成 manual.md 草稿，复制到剪贴板并打开 manual.md（不会自动写入文件）"
        >
          复制草稿
        </button>
        {!alert.read && (
          <button
            onClick={onMarkRead}
            className="fluent-btn px-1.5 py-0.5 rounded text-[10px] text-muted hover:text-fg hover:bg-white/[0.10]"
            title="标记已读（卡片仍保留）"
          >
            已读
          </button>
        )}
        <button
          onClick={onDismiss}
          className="fluent-btn w-5 h-5 rounded text-[12px] text-muted hover:text-fg hover:bg-white/[0.10]"
          title="关闭这条告警"
        >
          ×
        </button>
      </div>
      {alert.sampleMsg && (
        <div className="mt-0.5 text-subtle truncate" title={alert.sampleMsg}>
          {alert.sampleMsg}
        </div>
      )}
      {alert.key.actionIsFallback && (
        <div className="text-[10px] text-subtle italic">* action 由 msg 哈希生成（原始日志无 action 字段）</div>
      )}
    </div>
  )
}

function applyFilter(entries: MemoryEntry[], f: MemoryFilter): MemoryEntry[] {
  // raw rows (headers / blank lines / rolled-back markers) always stay so
  // section skeletons render the same shape; only lesson rows are filtered.
  return entries.filter((e) => {
    if (e.kind !== 'lesson') return true
    if (f.category === '__none') {
      if (e.category) return false
    } else if (f.category !== '__all') {
      if (e.category !== f.category) return false
    }
    if (f.severity === '__none') {
      if (e.severity) return false
    } else if (f.severity !== '__all') {
      if (e.severity !== f.severity) return false
    }
    if (f.files === '__none') {
      if (e.files && e.files.length > 0) return false
    } else if (f.files !== '__all') {
      if (!e.files || !e.files.includes(f.files)) return false
    }
    return true
  })
}

function FilterBar({
  value,
  onChange,
  categories,
  files,
  active,
}: {
  value: MemoryFilter
  onChange: (next: MemoryFilter) => void
  categories: string[]
  files: string[]
  active: boolean
}) {
  const baseSelect =
    'fluent-btn h-6 px-1 rounded text-[11px] bg-white/[0.04] hover:bg-white/[0.08] text-fg/90 border border-border/40'
  return (
    <div className="px-2 py-1.5 border-b border-border/40 flex items-center gap-1 flex-wrap text-[11px]">
      <span className="text-subtle shrink-0">筛选</span>
      <select
        className={baseSelect}
        value={value.category}
        onChange={(e) => onChange({ ...value, category: e.target.value })}
        title="按类别筛选"
      >
        <option value="__all">类别：全部</option>
        <option value="__none">未分类</option>
        {categories.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select
        className={baseSelect}
        value={value.severity}
        onChange={(e) => onChange({ ...value, severity: e.target.value as SeverityFilterValue })}
        title="按严重度筛选"
      >
        <option value="__all">严重度：全部</option>
        <option value="__none">未标严重度</option>
        <option value="info">{SEVERITY_LABEL.info}（info）</option>
        <option value="warn">{SEVERITY_LABEL.warn}（warn）</option>
        <option value="error">{SEVERITY_LABEL.error}（error）</option>
      </select>
      <select
        className={baseSelect}
        value={value.files}
        onChange={(e) => onChange({ ...value, files: e.target.value })}
        title="按关联文件筛选"
        disabled={files.length === 0}
      >
        <option value="__all">文件：全部</option>
        <option value="__none">无关联文件</option>
        {files.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      {active && (
        <button
          onClick={() => onChange(DEFAULT_FILTER)}
          className="fluent-btn h-6 px-2 rounded text-muted hover:text-fg hover:bg-white/[0.08]"
          title="清除全部筛选"
        >
          清除
        </button>
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
  const conclusion = entry.body ?? extractConclusion(entry.text)
  const tagBits: string[] = []
  if (entry.category) tagBits.push(`类别=${entry.category}`)
  if (entry.severity) tagBits.push(`严重度=${SEVERITY_LABEL[entry.severity]}`)
  if (entry.files && entry.files.length > 0) tagBits.push(`文件=${entry.files.join(', ')}`)
  const tooltipParts = [entry.date, entry.task, conclusion, ...tagBits].filter(
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
