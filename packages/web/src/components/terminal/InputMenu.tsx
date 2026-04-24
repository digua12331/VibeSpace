import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  open: boolean
  /** Element the menu anchors above (the floating input). */
  anchorRef: React.RefObject<HTMLElement | null>
  items: readonly string[]
  selectedIndex: number
  /**
   * Called when user clicks an item (index >= 0) or dismisses by clicking
   * outside (index === -1). Keyboard navigation is handled upstream by the
   * input's own onKeyDown — see Context D1.
   */
  onPick: (index: number) => void
  /** Called when the user hovers a row, so arrow/mouse stay in sync. */
  onHover: (index: number) => void
  maxRows?: number
}

interface Position {
  left: number
  bottom: number
  minWidth: number
}

function computePosition(anchor: HTMLElement): Position {
  const rect = anchor.getBoundingClientRect()
  return {
    left: rect.left,
    // Anchor the menu's bottom edge 4px above the input's top edge.
    bottom: window.innerHeight - rect.top + 4,
    minWidth: Math.max(280, rect.width),
  }
}

export default function InputMenu({
  open,
  anchorRef,
  items,
  selectedIndex,
  onPick,
  onHover,
  maxRows = 10,
}: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<Position | null>(null)

  // Recompute position whenever the menu opens OR the anchor resizes /
  // the window resizes. Splitter drags with the menu open are rare but
  // handled — the ResizeObserver on the anchor catches them.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const anchor = anchorRef.current
    if (!anchor) return
    setPos(computePosition(anchor))
    const onResize = () => {
      if (anchorRef.current) setPos(computePosition(anchorRef.current))
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(anchor)
    window.addEventListener('resize', onResize)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [open, anchorRef])

  // Dismiss on click outside the menu (but not on the anchor — clicks
  // there are handled by the input's own focus logic).
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const target = e.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onPick(-1)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, onPick, anchorRef])

  // Scroll the selected row into view when selectedIndex changes via
  // keyboard navigation.
  useEffect(() => {
    if (!open) return
    const menu = menuRef.current
    if (!menu) return
    const row = menu.querySelector<HTMLElement>(
      `[data-idx="${selectedIndex}"]`,
    )
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, open])

  if (!open || !pos) return null

  const visible = items.slice(0, maxRows * 4) // keep DOM modest on huge lists

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 max-h-[280px] overflow-y-auto rounded-win border border-border bg-card shadow-flyout py-1 text-sm font-mono text-fg"
      style={{
        left: pos.left,
        bottom: pos.bottom,
        minWidth: pos.minWidth,
      }}
    >
      {items.length === 0 ? (
        <div className="px-3 py-1.5 text-subtle text-xs">无匹配</div>
      ) : (
        visible.map((label, idx) => {
          const active = idx === selectedIndex
          return (
            <div
              key={`${idx}:${label}`}
              data-idx={idx}
              onMouseEnter={() => onHover(idx)}
              onMouseDown={(e) => {
                // Prevent input from losing focus (which would close the
                // menu via mousedown-outside) before the click resolves.
                e.preventDefault()
                onPick(idx)
              }}
              className={`px-3 py-1 cursor-pointer truncate ${
                active ? 'bg-accent/20 text-fg' : 'text-muted hover:bg-white/[0.05]'
              }`}
              title={label}
            >
              {label}
            </div>
          )
        })
      )}
    </div>,
    document.body,
  )
}
