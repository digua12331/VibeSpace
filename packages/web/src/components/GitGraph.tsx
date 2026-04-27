import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from '../api'
import { useStore, type SelectedChange } from '../store'
import type { GraphCommit } from '../types'

/**
 * VS Code-ish commit graph. Reads /graph (newest-first, --all), assigns each
 * commit to a lane, then renders an SVG column with dots + edges + a text
 * column showing subject / author / refs.
 */

interface Props {
  projectId: string
}

const ROW_HEIGHT = 26
const LANE_WIDTH = 14
const DOT_RADIUS = 4
const GRAPH_LEFT_PADDING = 10
const LANE_COLORS = [
  '#60cdff', // accent blue
  '#b4e25d', // green
  '#ff9f66', // orange
  '#e486b9', // pink
  '#c08aff', // violet
  '#f5d76e', // amber
  '#7ce4d6', // teal
]

function laneColor(laneIdx: number): string {
  return LANE_COLORS[laneIdx % LANE_COLORS.length]
}

interface LaneRow {
  commit: GraphCommit
  commitLane: number
  /** Snapshot of activeLanes BEFORE processing the row (map lane → parent sha it was waiting for). */
  lanesBefore: (string | null)[]
  /** Snapshot AFTER processing. */
  lanesAfter: (string | null)[]
  /** Lanes (other than commitLane) that terminated at this commit (merges in). */
  mergedLanes: number[]
  /** For extra parents (beyond first): the lane each was assigned to. */
  newParentLanes: number[]
}

function assignLanes(commits: GraphCommit[]): { rows: LaneRow[]; maxLane: number } {
  const activeLanes: (string | null)[] = []
  const rows: LaneRow[] = []
  let maxLane = 0

  for (const c of commits) {
    const lanesBefore = activeLanes.slice()

    // All lanes currently waiting for this commit's sha are "pointing" at it.
    const incomingLanes: number[] = []
    activeLanes.forEach((s, i) => {
      if (s === c.sha) incomingLanes.push(i)
    })

    // The commit's own lane: first incoming lane, or a new/empty one if none.
    let commitLane: number
    if (incomingLanes.length > 0) {
      commitLane = incomingLanes[0]
    } else {
      // Reuse an empty slot, else append.
      const empty = activeLanes.findIndex((s) => s === null)
      if (empty >= 0) commitLane = empty
      else {
        commitLane = activeLanes.length
        activeLanes.push(null)
      }
    }

    // Merged lanes: every incoming lane except commitLane terminates here.
    const mergedLanes = incomingLanes.filter((l) => l !== commitLane)
    for (const l of mergedLanes) activeLanes[l] = null

    // Parents: first parent continues on commitLane, others spawn new lanes.
    const parents = c.parents
    if (parents.length === 0) {
      activeLanes[commitLane] = null
    } else {
      activeLanes[commitLane] = parents[0]
    }
    const newParentLanes: number[] = []
    for (let i = 1; i < parents.length; i++) {
      let slot = activeLanes.findIndex((s) => s === null)
      if (slot < 0) {
        slot = activeLanes.length
        activeLanes.push(null)
      }
      activeLanes[slot] = parents[i]
      newParentLanes.push(slot)
    }

    // Trim trailing nulls so the graph doesn't get wider than needed.
    while (activeLanes.length > 0 && activeLanes[activeLanes.length - 1] === null) {
      activeLanes.pop()
    }

    maxLane = Math.max(
      maxLane,
      commitLane,
      ...lanesBefore.map((_, i) => i),
      ...activeLanes.map((_, i) => i),
    )

    rows.push({
      commit: c,
      commitLane,
      lanesBefore,
      lanesAfter: activeLanes.slice(),
      mergedLanes,
      newParentLanes,
    })
  }

  return { rows, maxLane }
}

function laneX(lane: number): number {
  return GRAPH_LEFT_PADDING + lane * LANE_WIDTH + LANE_WIDTH / 2
}

function shortDate(iso: string): string {
  try {
    const d = new Date(iso)
    const now = Date.now()
    const diff = now - d.getTime()
    if (diff < 60_000) return '刚刚'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}天前`
    return d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })
  } catch {
    return iso
  }
}

export default function GitGraph({ projectId }: Props) {
  const [commits, setCommits] = useState<GraphCommit[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const selectedChange = useStore((s) => s.selectedChange)
  const selectChange = useStore((s) => s.selectChange)
  const openFile = useStore((s) => s.openFile)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const g = await api.getProjectGraph(projectId, { limit: 200, all: true })
      setCommits(g)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  const { rows, maxLane } = useMemo(() => assignLanes(commits), [commits])
  const graphWidth = GRAPH_LEFT_PADDING * 2 + (maxLane + 1) * LANE_WIDTH

  function onCommitClick(c: GraphCommit) {
    // Open a synthetic file entry to show the commit's root README-ish. Better:
    // we just set selectedChange to the commit and the user can then click files
    // from the ChangesList's expanded commit section. For now, toggle preview by
    // opening the commit itself as a virtual file is not ideal. Minimal behavior:
    // just signal the selection so users see the sha. Keep it a no-op otherwise.
    const sel: SelectedChange = {
      path: c.subject || c.shortSha,
      status: 'M',
      ref: c.sha,
      commitSha: c.sha,
      ...(c.parents[0] ? { from: c.parents[0], to: c.sha } : {}),
    }
    selectChange(sel)
  }
  // Keep openFile referenced so eslint-unused-vars doesn't trigger — reserved
  // for a future "open commit as file list" flow.
  void openFile

  if (loading && commits.length === 0) {
    return <div className="p-4 text-xs text-muted">加载图表…</div>
  }
  if (err) {
    return (
      <div className="p-4 text-xs text-rose-300 break-words whitespace-pre-wrap">
        {err}
      </div>
    )
  }
  if (commits.length === 0) {
    return <div className="p-4 text-xs text-muted text-center">无提交历史。</div>
  }

  const totalHeight = rows.length * ROW_HEIGHT

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 text-xs">
        <span className="text-muted">图表 · {commits.length} 提交</span>
        <button
          onClick={() => void load()}
          className="fluent-btn px-2 py-0.5 rounded border border-border text-muted hover:text-fg"
          title="刷新"
        >
          🔄
        </button>
      </div>
      <div className="flex-1 overflow-auto relative font-mono text-[11.5px]">
        <div
          className="relative"
          style={{ height: totalHeight, minWidth: '100%' }}
        >
          <svg
            width={graphWidth}
            height={totalHeight}
            className="absolute top-0 left-0 pointer-events-none"
          >
            {rows.map((row, i) => (
              <RowEdges
                key={row.commit.sha}
                row={row}
                nextRow={rows[i + 1] ?? null}
                rowIndex={i}
              />
            ))}
            {rows.map((row, i) => {
              const cx = laneX(row.commitLane)
              const cy = i * ROW_HEIGHT + ROW_HEIGHT / 2
              const color = laneColor(row.commitLane)
              return (
                <g key={`${row.commit.sha}-dot`}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={DOT_RADIUS}
                    fill={row.commit.isHead ? '#ffffff' : color}
                    stroke={color}
                    strokeWidth={1.5}
                  />
                </g>
              )
            })}
          </svg>
          <ul className="relative">
            {rows.map((row) => {
              const active = selectedChange?.commitSha === row.commit.sha
              return (
                <li
                  key={row.commit.sha}
                  onClick={() => onCommitClick(row.commit)}
                  style={{
                    height: ROW_HEIGHT,
                    paddingLeft: graphWidth + 8,
                  }}
                  className={`flex items-center gap-2 pr-2 cursor-pointer ${
                    active ? 'bg-accent/15' : 'hover:bg-white/[0.04]'
                  }`}
                >
                  {row.commit.isHead && (
                    <span className="text-[10px] px-1 py-0.5 rounded border border-emerald-500/40 text-emerald-300 bg-emerald-500/10">
                      HEAD
                    </span>
                  )}
                  {row.commit.refs.map((r) => (
                    <span
                      key={r}
                      title={r}
                      className="text-[10px] px-1 py-0.5 rounded border border-sky-500/40 text-sky-300 bg-sky-500/10 max-w-[120px] truncate shrink-0"
                    >
                      {r}
                    </span>
                  ))}
                  <span className="truncate flex-1 text-fg">{row.commit.subject}</span>
                  <span className="text-subtle truncate max-w-[80px]">{row.commit.author}</span>
                  <span className="text-subtle shrink-0 w-[56px] text-right">
                    {shortDate(row.commit.date)}
                  </span>
                  <span className="text-muted shrink-0 w-[50px] text-right">
                    {row.commit.shortSha}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}

function RowEdges({
  row,
  nextRow,
  rowIndex,
}: {
  row: LaneRow
  nextRow: LaneRow | null
  rowIndex: number
}) {
  const yTop = rowIndex * ROW_HEIGHT
  const yMid = yTop + ROW_HEIGHT / 2
  const yBot = yTop + ROW_HEIGHT
  const cx = laneX(row.commitLane)

  const lines: React.ReactElement[] = []

  // Upper half: incoming vertical lines for all lanes that were non-null BEFORE this row.
  row.lanesBefore.forEach((sha, lane) => {
    if (sha == null) return
    if (lane === row.commitLane) {
      // This incoming line leads into the commit dot on commitLane. Draw from
      // top to dot center in lane color matching the incoming edge.
      lines.push(
        <line
          key={`up-${lane}-${row.commit.sha}`}
          x1={laneX(lane)}
          y1={yTop}
          x2={cx}
          y2={yMid}
          stroke={laneColor(lane)}
          strokeWidth={1.5}
        />,
      )
    } else if (row.mergedLanes.includes(lane)) {
      // Merge: curve from top of this lane to the commit dot.
      const from = laneX(lane)
      lines.push(
        <path
          key={`merge-${lane}-${row.commit.sha}`}
          d={`M ${from} ${yTop} C ${from} ${yMid}, ${cx} ${yTop}, ${cx} ${yMid}`}
          stroke={laneColor(lane)}
          strokeWidth={1.5}
          fill="none"
        />,
      )
    } else {
      // Pass-through upper half: straight vertical from top to mid (continues in lower half if still active).
      lines.push(
        <line
          key={`passU-${lane}-${row.commit.sha}`}
          x1={laneX(lane)}
          y1={yTop}
          x2={laneX(lane)}
          y2={yMid}
          stroke={laneColor(lane)}
          strokeWidth={1.5}
        />,
      )
    }
  })

  // Lower half: outgoing vertical lines per lane that is non-null AFTER this row.
  row.lanesAfter.forEach((sha, lane) => {
    if (sha == null) return
    if (lane === row.commitLane) {
      // Line from dot center down to bottom of row in commitLane color.
      lines.push(
        <line
          key={`downPrimary-${row.commit.sha}-${lane}`}
          x1={cx}
          y1={yMid}
          x2={cx}
          y2={yBot}
          stroke={laneColor(row.commitLane)}
          strokeWidth={1.5}
        />,
      )
    } else if (row.newParentLanes.includes(lane)) {
      // Split: curve from dot to new lane at bottom of row.
      const to = laneX(lane)
      lines.push(
        <path
          key={`split-${lane}-${row.commit.sha}`}
          d={`M ${cx} ${yMid} C ${cx} ${yBot}, ${to} ${yMid}, ${to} ${yBot}`}
          stroke={laneColor(lane)}
          strokeWidth={1.5}
          fill="none"
        />,
      )
    } else {
      // Pass-through lower half.
      lines.push(
        <line
          key={`passD-${lane}-${row.commit.sha}`}
          x1={laneX(lane)}
          y1={yMid}
          x2={laneX(lane)}
          y2={yBot}
          stroke={laneColor(lane)}
          strokeWidth={1.5}
        />,
      )
    }
  })

  void nextRow
  return <g>{lines}</g>
}
