import { useEffect, useState } from 'react'
import { pushLog } from '../logs'

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
  pushLog({
    level: 'info',
    scope: 'ctxmenu',
    msg: `openContextMenu called id=${sequence} items=${opts.items.length} listeners=${listeners.size}`,
  })
  notify()
}

export function closeContextMenu(): void {
  if (!current) return
  pushLog({
    level: 'info',
    scope: 'ctxmenu',
    msg: `closeContextMenu id=${current.id}`,
  })
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
      pushLog({
        level: 'info',
        scope: 'ctxmenu',
        msg: `listener notified -> setMenu(${next ? `id=${next.id} items=${next.items.length}` : 'null'})`,
      })
      setMenu(next)
      setSubmenuAt(null)
    }
    listeners.add(l)
    pushLog({
      level: 'info',
      scope: 'ctxmenu',
      msg: `ContextMenu mounted; listeners now=${listeners.size}; current=${current ? `id=${current.id}` : 'null'}`,
    })
    l(current)
    return () => {
      listeners.delete(l)
      pushLog({
        level: 'info',
        scope: 'ctxmenu',
        msg: `ContextMenu unmounted; listeners now=${listeners.size}`,
      })
    }
  }, [])

  useEffect(() => {
    if (!menu) return
    pushLog({
      level: 'info',
      scope: 'ctxmenu',
      msg: `menu visible id=${menu.id}; attaching close listeners`,
    })
    const close = (source: string) => {
      pushLog({
        level: 'warn',
        scope: 'ctxmenu',
        msg: `close triggered by ${source} (menu id=${menu.id})`,
      })
      closeContextMenu()
    }
    const onMouseDown = () => close('mousedown')
    const onContextMenuEvt = () => close('contextmenu')
    const onResize = () => close('resize')
    const onBlur = () => close('blur')
    const onScroll = () => close('scroll')
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close('Escape')
      }
    }
    // Keydown is safe to attach immediately — not related to the opening click.
    window.addEventListener('keydown', onKey)
    // Defer the pointer-based close listeners by one tick. React 18 flushes the
    // state update synchronously inside the opening `contextmenu` event, so this
    // effect runs *before* that same event finishes bubbling to `window`. If we
    // attached `contextmenu`/`mousedown` now, the very click that opened the
    // menu would immediately re-trigger them and dismiss the menu.
    let attached = false
    const tid = window.setTimeout(() => {
      window.addEventListener('mousedown', onMouseDown)
      window.addEventListener('contextmenu', onContextMenuEvt)
      window.addEventListener('resize', onResize)
      window.addEventListener('blur', onBlur)
      window.addEventListener('scroll', onScroll, true)
      attached = true
    }, 0)
    return () => {
      window.clearTimeout(tid)
      window.removeEventListener('keydown', onKey)
      if (attached) {
        window.removeEventListener('mousedown', onMouseDown)
        window.removeEventListener('contextmenu', onContextMenuEvt)
        window.removeEventListener('resize', onResize)
        window.removeEventListener('blur', onBlur)
        window.removeEventListener('scroll', onScroll, true)
      }
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
