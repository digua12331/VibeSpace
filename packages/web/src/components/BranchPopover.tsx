import { useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../api'
import { logAction } from '../logs'
import type { BranchRef } from '../types'
import { confirmDialog } from './dialog/DialogHost'

interface Props {
  projectId: string
  currentBranch: string | null
  /** Anchor element rect (chip position) — popover renders below it. */
  anchor: { left: number; top: number; bottom: number }
  onClose: () => void
  /** Called after a successful op so parent can refresh changes/graph. */
  onChanged: () => void
}

const PANEL_W = 320

export default function BranchPopover({
  projectId,
  currentBranch,
  anchor,
  onClose,
  onChanged,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [branches, setBranches] = useState<BranchRef[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  async function load(): Promise<void> {
    try {
      const rows = await api.getProjectBranches(projectId)
      setBranches(rows)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  // Click-outside + Escape close.
  useEffect(() => {
    function onDoc(e: MouseEvent): void {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const local = useMemo(
    () => (branches ?? []).filter((b) => b.kind === 'local').sort((a, b) => a.shortName.localeCompare(b.shortName)),
    [branches],
  )
  const remote = useMemo(
    () =>
      (branches ?? [])
        .filter((b) => b.kind === 'remote')
        // Hide HEAD aliases like `origin/HEAD`.
        .filter((b) => !b.shortName.endsWith('/HEAD'))
        .sort((a, b) => a.shortName.localeCompare(b.shortName)),
    [branches],
  )

  async function withBusy<T>(
    tag: string,
    action: string,
    fn: () => Promise<T>,
    meta?: Record<string, unknown>,
  ): Promise<T | null> {
    setBusy(tag)
    setErr(null)
    try {
      const r = await logAction('git', action, fn, { projectId, meta })
      onChanged()
      await load()
      return r
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setBusy(null)
    }
  }

  async function onCheckout(name: string): Promise<void> {
    if (name === currentBranch) {
      onClose()
      return
    }
    const r = await withBusy(`checkout:${name}`, 'checkout', () => api.gitCheckoutBranch(projectId, name), {
      branch: name,
    })
    if (r) onClose()
  }

  async function onMerge(name: string): Promise<void> {
    const ok = await confirmDialog(`将分支 “${name}” 合并到当前分支 “${currentBranch ?? '?'}”？`, {
      title: '合并分支',
      confirmLabel: '合并',
    })
    if (!ok) return
    const r = await withBusy(`merge:${name}`, 'merge', () => api.gitMergeBranch(projectId, name), {
      branch: name,
    })
    if (r) onClose()
  }

  async function onDelete(name: string): Promise<void> {
    // First try safe delete.
    const r1 = await withBusy(`delete:${name}`, 'branch-delete', () => api.gitDeleteBranch(projectId, name), {
      branch: name,
      force: false,
    })
    if (r1) return
    // If safe delete failed, offer force.
    const ok = await confirmDialog(
      `分支 “${name}” 未完全合并到当前分支，强制删除将丢弃其上的提交。是否继续？`,
      { title: '强制删除分支', variant: 'danger', confirmLabel: '强制删除' },
    )
    if (!ok) return
    await withBusy(`forcedelete:${name}`, 'branch-delete', () => api.gitDeleteBranch(projectId, name, { force: true }), {
      branch: name,
      force: true,
    })
  }

  async function onCreate(): Promise<void> {
    const name = newName.trim()
    if (!name) return
    const r = await withBusy(
      `create:${name}`,
      'branch-create',
      () => api.gitCreateBranch(projectId, name, { checkout: true }),
      { branch: name, checkout: true },
    )
    if (r) {
      setNewName('')
      onClose()
    }
  }

  // Position: clamp to viewport.
  const left = Math.max(4, Math.min(anchor.left, (typeof window !== 'undefined' ? window.innerWidth : 1024) - PANEL_W - 4))
  const top = anchor.bottom + 4

  return (
    <div
      ref={rootRef}
      style={{ position: 'fixed', left, top, width: PANEL_W, zIndex: 50 }}
      className="bg-bg border border-border/70 rounded-md shadow-xl text-sm flex flex-col max-h-[60vh] min-h-0"
    >
      {/* New branch input */}
      <div className="px-2 py-2 border-b border-border/60 flex items-center gap-1">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void onCreate()
            }
          }}
          placeholder="新建分支名…"
          className="flex-1 bg-black/30 border border-border/60 rounded px-2 py-1 text-[12px] font-mono text-fg placeholder:text-subtle focus:outline-none focus:border-accent/60"
        />
        <button
          onClick={() => void onCreate()}
          disabled={busy != null || !newName.trim()}
          className="fluent-btn px-2 py-1 text-[11px] rounded border border-accent/60 bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-40"
        >
          新建并切换
        </button>
      </div>

      {err && (
        <div className="px-2 py-1.5 text-[11px] text-rose-300 break-words whitespace-pre-wrap border-b border-border/60">
          {err}
        </div>
      )}

      {/* Branch list */}
      <div className="flex-1 overflow-auto">
        {!branches && <div className="px-3 py-4 text-xs text-muted">加载中…</div>}

        {local.length > 0 && (
          <Section title={`本地分支 (${local.length})`}>
            {local.map((b) => (
              <BranchRow
                key={b.name}
                name={b.shortName}
                isCurrent={b.shortName === currentBranch}
                busy={busy != null}
                onCheckout={() => void onCheckout(b.shortName)}
                onMerge={() => void onMerge(b.shortName)}
                onDelete={() => void onDelete(b.shortName)}
              />
            ))}
          </Section>
        )}

        {remote.length > 0 && (
          <Section title={`远程分支 (${remote.length})`}>
            {remote.map((b) => (
              <BranchRow
                key={b.name}
                name={b.shortName}
                isCurrent={false}
                isRemote
                busy={busy != null}
                onCheckout={() => void onCheckout(b.shortName)}
              />
            ))}
          </Section>
        )}

        {branches && local.length === 0 && remote.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted text-center">尚无分支</div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border/40 last:border-b-0">
      <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted bg-black/20 sticky top-0">
        {title}
      </div>
      <div className="py-0.5">{children}</div>
    </div>
  )
}

function BranchRow({
  name,
  isCurrent,
  isRemote,
  busy,
  onCheckout,
  onMerge,
  onDelete,
}: {
  name: string
  isCurrent: boolean
  isRemote?: boolean
  busy: boolean
  onCheckout: () => void
  onMerge?: () => void
  onDelete?: () => void
}) {
  return (
    <div
      className={`group flex items-center gap-2 px-3 py-1 text-[12.5px] cursor-pointer ${
        isCurrent
          ? 'bg-accent/15 border-l-2 border-l-accent'
          : 'hover:bg-white/[0.04] border-l-2 border-l-transparent'
      }`}
      title={isCurrent ? `当前分支：${name}` : `切换到 ${name}`}
      onClick={() => {
        if (!busy) onCheckout()
      }}
    >
      <span className="text-[10px] text-muted w-3">{isCurrent ? '✓' : isRemote ? '☁' : ' '}</span>
      <span className="font-mono truncate flex-1">{name}</span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        {!isCurrent && onMerge && (
          <RowAction
            onClick={onMerge}
            disabled={busy}
            title="将此分支合并到当前分支"
          >
            ⇘
          </RowAction>
        )}
        {!isCurrent && onDelete && (
          <RowAction
            onClick={onDelete}
            disabled={busy}
            title="删除分支"
            className="hover:text-rose-300"
          >
            🗑
          </RowAction>
        )}
      </div>
    </div>
  )
}

function RowAction({
  children,
  title,
  onClick,
  disabled,
  className = '',
}: {
  children: React.ReactNode
  title: string
  onClick: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      disabled={disabled}
      title={title}
      className={`w-5 h-5 inline-flex items-center justify-center rounded text-[12px] text-muted hover:bg-white/[0.08] disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  )
}
