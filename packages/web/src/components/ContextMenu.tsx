import { useEffect, useState } from 'react'

export interface ContextMenuItem {
  label: string
  icon?: string
  danger?: boolean
  disabled?: boolean
  divider?: boolean
  submenu?: ContextMenuItem[]
  onSelect?: () => void | Promise<void>
}

interface Opts {
  x: number
  y: number
  items: ContextMenuItem[]
}

interface PendingMenu extends Opts {
  id: number
}

let sequence = 0
let current: PendingMenu | null = null
const listeners = new Set<(pending: PendingMenu | null) => void>()

function notify() {
  for (const l of listeners) l(current)
}

export function openContextMenu(opts: Opts): void {
  sequence += 1
  current = { ...opts, id: sequence }
  notify()
}

export function closeContextMenu(): void {
  if (!current) return
  current = null
  notify()
}

const MENU_W = 220
const ITEM_H = 28
// Slack so the flyout doesn't end up flush against the viewport edge.
const EDGE_PAD = 4

function clampToViewport(x: number, y: number, itemCount: number): { x: number; y: number } {
  if (typeof window === 'undefined') return { x, y }
  const vw = window.innerWidth
  const vh = window.innerHeight
  const h = itemCount * ITEM_H + 8
  let cx = x
  let cy = y
  if (cx + MENU_W + EDGE_PAD > vw) cx = Math.max(EDGE_PAD, vw - MENU_W - EDGE_PAD)
  if (cy + h + EDGE_PAD > vh) cy = Math.max(EDGE_PAD, vh - h - EDGE_PAD)
  return { x: cx, y: cy }
}

export default function ContextMenu() {
  const [menu, setMenu] = useState<PendingMenu | null>(null)
  const [submenuAt, setSubmenuAt] = useState<{ index: number; x: number; y: number } | null>(null)

  useEffect(() => {
    const l = (next: PendingMenu | null) => {
      setMenu(next)
      setSubmenuAt(null)
    }
    listeners.add(l)
    l(current)
    return () => {
      listeners.delete(l)
    }
  }, [])

  useEffect(() => {
    if (!menu) return
    const close = () => closeContextMenu()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    // Mousedown catches outside clicks without waiting for a full click cycle.
    window.addEventListener('mousedown', close)
    window.addEventListener('contextmenu', close)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  if (!menu) return null

  const { x, y } = clampToViewport(menu.x, menu.y, menu.items.length)

  function invoke(item: ContextMenuItem) {
    if (item.disabled || item.submenu) return
    closeContextMenu()
    // Run after unmount so any modal the handler opens (confirmDialog, etc.)
    // doesn't share the same keyboard-dismissal tick as this menu.
    queueMicrotask(() => {
      try {
        const result = item.onSelect?.()
        if (result && typeof (result as Promise<unknown>).catch === 'function') {
          void (result as Promise<unknown>).catch(() => {})
        }
      } catch {
        // swallow — handlers are expected to surface their own errors
      }
    })
  }

  return (
    <div
      className="fixed z-[70]"
      style={{ left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <MenuBody
        items={menu.items}
        onInvoke={invoke}
        hoveredIndex={submenuAt?.index ?? null}
        onHover={(idx, rect) => {
          const sub = menu.items[idx]?.submenu
          if (sub && rect) {
            // Position submenu to the right of the parent row, or flip left if
            // it would overflow the viewport.
            const rightX = rect.right
            const vw = typeof window !== 'undefined' ? window.innerWidth : 9999
            const subX =
              rightX + MENU_W + EDGE_PAD <= vw ? rightX : rect.left - MENU_W
            setSubmenuAt({ index: idx, x: subX, y: rect.top })
          } else {
            setSubmenuAt(null)
          }
        }}
      />
      {submenuAt && menu.items[submenuAt.index]?.submenu && (
        <div
          className="fixed z-[71]"
          style={{ left: submenuAt.x, top: submenuAt.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <MenuBody
            items={menu.items[submenuAt.index]!.submenu!}
            onInvoke={invoke}
            hoveredIndex={null}
            onHover={() => {}}
          />
        </div>
      )}
    </div>
  )
}

function MenuBody({
  items,
  onInvoke,
  hoveredIndex,
  onHover,
}: {
  items: ContextMenuItem[]
  onInvoke: (item: ContextMenuItem) => void
  hoveredIndex: number | null
  onHover: (index: number, rect: DOMRect | null) => void
}) {
  return (
    <div
      className="fluent-acrylic rounded-lg shadow-flyout py-1 animate-fluent-in"
      style={{ minWidth: MENU_W }}
    >
      {items.map((it, i) => {
        if (it.divider) {
          return <div key={`d${i}`} className="h-px mx-2 my-1 bg-white/[0.08]" />
        }
        const active = hoveredIndex === i
        return (
          <button
            key={i}
            type="button"
            disabled={it.disabled}
            onClick={() => onInvoke(it)}
            onMouseEnter={(e) => onHover(i, e.currentTarget.getBoundingClientRect())}
            className={`fluent-btn w-full text-left px-3 py-1.5 mx-1 rounded text-sm flex items-center gap-2 disabled:opacity-40 ${
              it.danger
                ? 'text-rose-300 hover:bg-rose-500/15'
                : active
                  ? 'bg-white/[0.06]'
                  : 'hover:bg-white/[0.06]'
            }`}
            style={{ width: 'calc(100% - 0.5rem)' }}
          >
            {it.icon && <span className="shrink-0 w-4 text-center">{it.icon}</span>}
            <span className="flex-1 truncate">{it.label}</span>
            {it.submenu && <span className="text-muted">▸</span>}
          </button>
        )
      })}
    </div>
  )
}
