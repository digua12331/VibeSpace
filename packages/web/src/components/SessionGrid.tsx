import { useEffect, useMemo, useRef, useState } from 'react'
import { ReactGridLayout } from 'react-grid-layout/legacy'
import type { Layout as LayoutArray } from 'react-grid-layout'
import { useStore } from '../store'
import SessionTile from './SessionTile'
import StartSessionMenu from './StartSessionMenu'
import type { Session, TileLayout } from '../types'

const DEFAULT_COLS = 12
const DEFAULT_ROW_HEIGHT = 40
const DEFAULT_TILE_W = 6
const DEFAULT_TILE_H = 11
const MIN_TILE_W = 3
const MIN_TILE_H = 6

export default function SessionGrid() {
  const sessions = useStore((s) => s.sessions)
  const projects = useStore((s) => s.projects)
  const selectedProjectId = useStore((s) => s.selectedProjectId)
  const layoutByProject = useStore((s) => s.layoutByProject)
  const layoutDirty = useStore((s) =>
    selectedProjectId ? !!s.layoutDirty[selectedProjectId] : false,
  )
  const loadProjectLayout = useStore((s) => s.loadProjectLayout)
  const setProjectLayout = useStore((s) => s.setProjectLayout)
  const saveProjectLayout = useStore((s) => s.saveProjectLayout)
  const tileSizeByAgent = useStore((s) => s.tileSizeByAgent)
  const rememberTileSize = useStore((s) => s.rememberTileSize)

  const hostRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1200)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w && w > 0) setWidth(Math.floor(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fetch layout on project switch (cached after first load).
  useEffect(() => {
    if (!selectedProjectId) return
    void loadProjectLayout(selectedProjectId)
  }, [selectedProjectId, loadProjectLayout])

  const visible = useMemo(() => {
    const filtered = selectedProjectId
      ? sessions.filter((s) => s.projectId === selectedProjectId)
      : sessions
    return [...filtered].sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
  }, [sessions, selectedProjectId])

  // Compose the effective RGL layout: saved tiles first, new sessions placed
  // next to the most-recently-started tile (same w/h), wrapping to a new row
  // if there's no space to the right. compactType is null so we can't use
  // y=Infinity — we must compute a real grid coordinate.
  const effectiveLayout = useMemo<LayoutArray>(() => {
    const saved = selectedProjectId
      ? (layoutByProject[selectedProjectId]?.tiles ?? [])
      : []
    const visibleIds = new Set(visible.map((s) => s.id))
    const kept = saved.filter((t) => visibleIds.has(t.i))
    const savedIds = new Set(kept.map((t) => t.i))
    const sessionById = new Map(visible.map((s) => [s.id, s]))
    const agentSizes = selectedProjectId
      ? (tileSizeByAgent[selectedProjectId] ?? {})
      : {}

    // Process new sessions oldest-first so the newest ends up rightmost.
    const newSessions = visible
      .filter((s) => !savedIds.has(s.id))
      .slice()
      .sort((a, b) => a.started_at - b.started_at)

    const placed: TileLayout[] = kept.slice()
    for (const s of newSessions) {
      placed.push(placeNewTile(s, placed, sessionById, agentSizes))
    }

    return placed.map((t) => ({
      i: t.i,
      x: t.x,
      y: t.y,
      w: t.w,
      h: t.h,
      minW: t.minW ?? MIN_TILE_W,
      minH: t.minH ?? MIN_TILE_H,
    }))
  }, [visible, layoutByProject, selectedProjectId, tileSizeByAgent])

  function onLayoutChange(next: LayoutArray) {
    if (!selectedProjectId) return
    const visibleIds = new Set(visible.map((s) => s.id))
    const sessionById = new Map(visible.map((s) => [s.id, s]))
    const tiles: TileLayout[] = next
      .filter((t) => visibleIds.has(t.i))
      .map((t) => ({
        i: t.i,
        x: t.x,
        y: t.y,
        w: t.w,
        h: t.h,
        minW: t.minW,
        minH: t.minH,
      }))
    const prev = layoutByProject[selectedProjectId]
    // Skip identity updates — RGL fires onLayoutChange on every render.
    if (prev && sameTiles(prev.tiles, tiles)) return

    // Remember size-by-agent so a later fresh launch of the same agent type
    // opens at the user's last chosen dimensions, even after the current
    // tile is closed.
    const prevById = new Map(prev?.tiles.map((t) => [t.i, t]) ?? [])
    for (const t of tiles) {
      const prior = prevById.get(t.i)
      if (prior && prior.w === t.w && prior.h === t.h) continue
      const sess = sessionById.get(t.i)
      if (sess) rememberTileSize(selectedProjectId, sess.agent, t.w, t.h)
    }

    setProjectLayout(selectedProjectId, {
      cols: prev?.cols ?? DEFAULT_COLS,
      rowHeight: prev?.rowHeight ?? DEFAULT_ROW_HEIGHT,
      tiles,
      updatedAt: Date.now(),
    })
  }

  async function onSave() {
    if (!selectedProjectId || saving) return
    setSaving(true)
    setSaveError(null)
    try {
      await saveProjectLayout(selectedProjectId)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const projectName = selectedProjectId
    ? (projects.find((p) => p.id === selectedProjectId)?.name ?? selectedProjectId)
    : '全部项目'

  const rowHeight = selectedProjectId
    ? (layoutByProject[selectedProjectId]?.rowHeight ?? DEFAULT_ROW_HEIGHT)
    : DEFAULT_ROW_HEIGHT
  const cols = selectedProjectId
    ? (layoutByProject[selectedProjectId]?.cols ?? DEFAULT_COLS)
    : DEFAULT_COLS

  return (
    <div className="p-5" ref={hostRef}>
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.1em] text-subtle">当前视图</div>
          <div className="text-lg font-display font-semibold truncate">{projectName}</div>
        </div>
        <div className="flex items-center gap-2">
          {selectedProjectId && visible.length > 0 && (
            <>
              {saveError && (
                <span className="text-xs text-rose-300 truncate max-w-[240px]" title={saveError}>
                  保存失败: {saveError}
                </span>
              )}
              <button
                onClick={() => void onSave()}
                disabled={!layoutDirty || saving}
                title={layoutDirty ? '保存当前布局到此项目' : '布局已保存'}
                className="fluent-btn px-3 py-1.5 text-xs rounded-md border border-border bg-white/[0.03] disabled:opacity-40 hover:bg-white/[0.08]"
              >
                {saving ? '保存中…' : layoutDirty ? '💾 保存布局' : '✓ 已保存'}
              </button>
            </>
          )}
          <StartSessionMenu projectId={selectedProjectId} />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="border border-dashed border-border rounded-win py-20 text-center text-muted bg-white/[0.02]">
          {selectedProjectId
            ? '此项目还没有 session,点击右上角 ▶ 启动'
            : '还没有任何 session'}
        </div>
      ) : selectedProjectId ? (
        <ReactGridLayout
          className="aimon-layout"
          layout={effectiveLayout}
          cols={cols}
          rowHeight={rowHeight}
          width={width}
          margin={[12, 12]}
          containerPadding={[0, 0]}
          draggableHandle=".drag-handle"
          draggableCancel=".no-drag"
          resizeHandles={['se', 'e', 's']}
          onLayoutChange={onLayoutChange}
          compactType={null}
          preventCollision={true}
          useCSSTransforms={true}
        >
          {visible.map((s) => (
            <div key={s.id} className="overflow-hidden">
              <SessionTile session={s} />
            </div>
          ))}
        </ReactGridLayout>
      ) : (
        // Global view (no project selected) — keep legacy auto grid, layouts
        // are per-project and don't apply here.
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
          {visible.map((s) => (
            <div key={s.id} className="h-[460px]">
              <SessionTile session={s} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function sameTiles(a: TileLayout[], b: TileLayout[]): boolean {
  if (a.length !== b.length) return false
  const byId = new Map(a.map((t) => [t.i, t]))
  for (const t of b) {
    const p = byId.get(t.i)
    if (!p) return false
    if (p.x !== t.x || p.y !== t.y || p.w !== t.w || p.h !== t.h) return false
  }
  return true
}

function collides(
  x: number,
  y: number,
  w: number,
  h: number,
  placed: readonly TileLayout[],
): boolean {
  for (const t of placed) {
    if (x < t.x + t.w && x + w > t.x && y < t.y + t.h && y + h > t.y) return true
  }
  return false
}

/**
 * Place a new tile, picking its w/h from (in order):
 *   1. Remembered size for this agent in this project (so a fresh `claude`
 *      session inherits the dimensions the user last chose for a `claude`
 *      tile, even if no other `claude` tile is currently open).
 *   2. The most-recently-started existing tile (original behavior).
 *   3. DEFAULT_TILE_W / DEFAULT_TILE_H.
 *
 * Placement: try the slot to the right of the ref first (same row), wrap to
 * a fresh row if there's no horizontal room or a collision.
 */
function placeNewTile(
  session: Session,
  placed: readonly TileLayout[],
  sessionById: Map<string, Session>,
  agentSizes: Record<string, { w: number; h: number }>,
): TileLayout {
  let ref: TileLayout | null = null
  let refStartedAt = -Infinity
  for (const t of placed) {
    const sess = sessionById.get(t.i)
    if (!sess) continue
    if (sess.started_at > refStartedAt) {
      refStartedAt = sess.started_at
      ref = t
    }
  }
  const remembered = agentSizes[session.agent]
  const w = remembered?.w ?? ref?.w ?? DEFAULT_TILE_W
  const h = remembered?.h ?? ref?.h ?? DEFAULT_TILE_H
  const base = { i: session.id, w, h, minW: MIN_TILE_W, minH: MIN_TILE_H } as const

  if (!ref) return { ...base, x: 0, y: 0 }

  // Try the slot immediately right of the reference tile.
  const candX = ref.x + ref.w
  if (candX + w <= DEFAULT_COLS && !collides(candX, ref.y, w, h, placed)) {
    return { ...base, x: candX, y: ref.y }
  }

  // No horizontal room → wrap to a new row below anything overlapping ref's band.
  let rowBottom = ref.y + ref.h
  for (const t of placed) {
    const overlapsBand = t.y < ref.y + ref.h && t.y + t.h > ref.y
    if (overlapsBand) rowBottom = Math.max(rowBottom, t.y + t.h)
  }
  // If the ref's width exceeds the grid, clamp to fit.
  const clampedW = Math.min(w, DEFAULT_COLS)
  return { ...base, w: clampedW, x: 0, y: rowBottom }
}
