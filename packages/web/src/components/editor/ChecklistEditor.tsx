import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../store'
import type {
  ChecklistItem,
  ChecklistSection,
  ChecklistStatus,
} from '../../types'

interface Props {
  projectId: string
  feature: string
}

export default function ChecklistEditor({ projectId, feature }: Props) {
  const key = `${projectId}::${feature}`
  const doc = useStore((s) => s.checklists[key])
  const loading = useStore((s) => s.checklistsLoading[key] === true)
  const error = useStore((s) => s.checklistsError[key] ?? null)
  const refresh = useStore((s) => s.refreshChecklist)
  const patch = useStore((s) => s.patchChecklistItem)

  useEffect(() => {
    refresh(projectId, feature).catch(() => {
      /* error stored */
    })
  }, [projectId, feature, refresh])

  if (!doc && loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted">
        加载中…
      </div>
    )
  }
  if (!doc && error) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md px-4 py-3 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md">
          <div className="font-medium mb-1">无法打开清单</div>
          <div className="text-[11px] break-words">{error}</div>
        </div>
      </div>
    )
  }
  if (!doc) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted">
        （无数据）
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="px-4 py-2 border-b border-border/40 flex items-center gap-3">
        <span className="text-[13px] font-medium">{doc.feature}</span>
        {doc.version != null && (
          <span className="text-[10px] text-subtle tabular-nums">
            v{doc.version}
          </span>
        )}
        {doc.createdAt && (
          <span className="text-[10px] text-subtle">{doc.createdAt}</span>
        )}
        {error && (
          <span className="ml-auto text-[10px] text-rose-300" title={error}>
            上次保存失败
          </span>
        )}
      </header>
      <div className="flex-1 min-h-0 overflow-auto px-4 py-3 space-y-6">
        {doc.sections.map((section) => (
          <SectionBlock
            key={section.id}
            section={section}
            onPatch={(itemId, itemPatch) =>
              patch(projectId, feature, section.id, itemId, itemPatch).catch(() => {
                /* error stored */
              })
            }
          />
        ))}
        {doc.sections.length === 0 && (
          <div className="text-xs text-muted">（清单没有 sections）</div>
        )}
      </div>
    </div>
  )
}

function SectionBlock({
  section,
  onPatch,
}: {
  section: ChecklistSection
  onPatch: (itemId: string, patch: Record<string, unknown>) => void
}) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-[11px] font-mono text-subtle tabular-nums">
          {section.id}
        </span>
        <h3 className="text-[13px] font-semibold">{section.title ?? '未命名'}</h3>
        <span className="text-[10px] text-subtle ml-auto">
          {section.type ?? 'unknown'}
        </span>
      </div>
      <div className="space-y-3">
        {(section.items ?? []).map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            type={section.type}
            onPatch={(patch) => onPatch(item.id, patch)}
          />
        ))}
      </div>
    </section>
  )
}

function statusPill(status: ChecklistStatus | undefined) {
  const s = status ?? 'pending'
  const map: Record<ChecklistStatus, string> = {
    locked:
      'border-emerald-600/40 bg-emerald-500/10 text-emerald-300',
    modified:
      'border-amber-600/40 bg-amber-500/10 text-amber-200',
    pending:
      'border-border bg-white/[0.04] text-muted',
  }
  const labels: Record<ChecklistStatus, string> = {
    locked: '已锁定',
    modified: '已修改',
    pending: '待定',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border ${map[s]}`}
    >
      {labels[s]}
    </span>
  )
}

function ItemCard({
  item,
  type,
  onPatch,
}: {
  item: ChecklistItem
  type: string | undefined
  onPatch: (patch: Record<string, unknown>) => void
}) {
  const isDecision = type === 'decision' || (!type && item.recommend != null)
  const isRisk = type === 'risk' || (!type && item.risk != null)

  if (isDecision) {
    return <DecisionCard item={item} onPatch={onPatch} />
  }
  if (isRisk) {
    return <RiskCard item={item} onPatch={onPatch} />
  }
  return (
    <div className="px-3 py-2 rounded border border-border bg-white/[0.02]">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] font-mono text-subtle tabular-nums">
          {item.id}
        </span>
        <span className="text-[12.5px] font-medium">{item.title ?? '（无标题）'}</span>
        <span className="ml-auto">{statusPill(item.status)}</span>
      </div>
      <div className="text-[11px] text-muted">
        未知 section 类型，无法提供快捷编辑；请直接编辑 checklist.json。
      </div>
    </div>
  )
}

function DecisionCard({
  item,
  onPatch,
}: {
  item: ChecklistItem
  onPatch: (patch: Record<string, unknown>) => void
}) {
  const alts = item.alternatives ?? []
  const initialChoice = (item.userChoice as string | undefined) ?? ''
  const [customDraft, setCustomDraft] = useState<string>(
    initialChoice === 'custom' ? (item.userAnswer as string) ?? '' : '',
  )
  const [customOpen, setCustomOpen] = useState<boolean>(initialChoice === 'custom')

  // When the doc is replaced from the server (different userChoice), resync.
  const seed = useMemo(() => `${item.userChoice ?? ''}::${item.userAnswer ?? ''}`, [
    item.userChoice,
    item.userAnswer,
  ])
  useEffect(() => {
    setCustomDraft(item.userChoice === 'custom' ? (item.userAnswer as string) ?? '' : '')
    setCustomOpen(item.userChoice === 'custom')
  }, [seed, item.userChoice, item.userAnswer])

  function chooseRecommend() {
    onPatch({ status: 'locked', userChoice: 'recommend', userAnswer: null })
  }
  function chooseAlternative(idx: number) {
    onPatch({ status: 'modified', userChoice: `alt:${idx}`, userAnswer: null })
  }
  function saveCustom() {
    onPatch({ status: 'modified', userChoice: 'custom', userAnswer: customDraft })
  }

  const selected = initialChoice
  return (
    <div className="px-3 py-2 rounded border border-border bg-white/[0.02]">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-mono text-subtle tabular-nums">
          {item.id}
        </span>
        <span className="text-[12.5px] font-medium">{item.title ?? '（无标题）'}</span>
        <span className="ml-auto">{statusPill(item.status)}</span>
      </div>

      {item.recommend && (
        <div className="mb-1.5 text-[12px]">
          <span className="text-subtle mr-1.5">推荐：</span>
          <span>{item.recommend}</span>
        </div>
      )}
      {alts.length > 0 && (
        <div className="mb-1.5 text-[12px]">
          <span className="text-subtle mr-1.5">备选：</span>
          <span className="text-muted">
            {alts.map((a, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                <span>{a}</span>
              </span>
            ))}
          </span>
        </div>
      )}
      {item.reason && (
        <div className="mb-1.5 text-[11px] text-muted italic">
          {item.reason}
        </div>
      )}
      {selected === 'custom' && item.userAnswer && (
        <div className="mb-1.5 text-[12px]">
          <span className="text-subtle mr-1.5">自定义答案：</span>
          <span>{item.userAnswer as string}</span>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <ChoiceButton
          active={selected === 'recommend'}
          onClick={chooseRecommend}
        >
          采纳推荐
        </ChoiceButton>
        {alts.map((_, idx) => (
          <ChoiceButton
            key={idx}
            active={selected === `alt:${idx}`}
            onClick={() => chooseAlternative(idx)}
          >
            选备选 {idx + 1}
          </ChoiceButton>
        ))}
        <ChoiceButton
          active={selected === 'custom'}
          onClick={() => setCustomOpen((o) => !o)}
        >
          自定义
        </ChoiceButton>
      </div>

      {customOpen && (
        <div className="mt-2 flex items-center gap-2">
          <input
            value={customDraft}
            onChange={(e) => setCustomDraft(e.target.value)}
            placeholder="写入自定义答案…"
            className="flex-1 px-2 py-1 text-[12px] bg-white/[0.04] border border-border rounded focus:border-accent focus:bg-white/[0.06]"
          />
          <button
            onClick={saveCustom}
            disabled={customDraft.trim().length === 0}
            className="fluent-btn h-7 px-3 text-[12px] rounded border border-border hover:bg-white/[0.08] disabled:opacity-50"
          >
            保存
          </button>
        </div>
      )}
    </div>
  )
}

function RiskCard({
  item,
  onPatch,
}: {
  item: ChecklistItem
  onPatch: (patch: Record<string, unknown>) => void
}) {
  const current = (item.status as ChecklistStatus) ?? 'pending'
  function setStatus(next: ChecklistStatus) {
    onPatch({ status: next })
  }
  return (
    <div className="px-3 py-2 rounded border border-border bg-white/[0.02]">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] font-mono text-subtle tabular-nums">
          {item.id}
        </span>
        <span className="text-[12.5px] font-medium flex-1 truncate">
          {(item.risk as string | undefined) ?? item.title ?? '（无描述）'}
        </span>
        <span>{statusPill(item.status)}</span>
      </div>
      {item.mitigation && (
        <div className="mb-1.5 text-[12px]">
          <span className="text-subtle mr-1.5">处理建议：</span>
          <span>{item.mitigation as string}</span>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {(['pending', 'locked', 'modified'] as ChecklistStatus[]).map((st) => (
          <ChoiceButton
            key={st}
            active={current === st}
            onClick={() => setStatus(st)}
          >
            {st === 'pending' ? '待定' : st === 'locked' ? '已锁定' : '已修改'}
          </ChoiceButton>
        ))}
      </div>
    </div>
  )
}

function ChoiceButton({
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
      className={`fluent-btn h-7 px-2.5 text-[12px] rounded border transition-colors ${
        active
          ? 'border-accent bg-white/[0.08] text-fg'
          : 'border-border bg-transparent text-muted hover:text-fg hover:bg-white/[0.04]'
      }`}
    >
      {children}
    </button>
  )
}
