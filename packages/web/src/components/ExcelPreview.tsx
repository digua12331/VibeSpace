import { useEffect, useMemo, useState } from 'react'
import { projectRawUrl } from '../api'
import { logAction } from '../logs'

interface Props {
  projectId: string
  path: string
}

interface Parsed {
  sheets: { name: string; rows: unknown[][] }[]
}

const MAX_ROWS = 1000
const MAX_COLS = 50

function colLabel(idx: number): string {
  let n = idx
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return s
}

function fmt(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

export default function ExcelPreview({ projectId, path }: Props) {
  const [data, setData] = useState<Parsed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sheetIdx, setSheetIdx] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)
    setSheetIdx(0)

    void logAction(
      'file',
      'preview-xlsx',
      async () => {
        const res = await fetch(projectRawUrl(projectId, path))
        if (!res.ok) {
          if (res.status === 413) throw new Error('文件过大（超过 50 MB）无法预览')
          if (res.status === 404) throw new Error('文件不存在或已被移动')
          throw new Error(`HTTP ${res.status} ${res.statusText}`)
        }
        const buf = await res.arrayBuffer()
        const XLSX = await import('xlsx')
        const wb = XLSX.read(buf, { type: 'array' })
        const sheets = wb.SheetNames.map((name) => {
          const ws = wb.Sheets[name]
          const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
            header: 1,
            defval: '',
            blankrows: false,
          })
          return { name, rows }
        })
        if (cancelled) return { sheets: 0 }
        setData({ sheets })
        return { sheets: sheets.length, totalRows: sheets.reduce((a, s) => a + s.rows.length, 0) }
      },
      { projectId, meta: { path } },
    )
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [projectId, path])

  const current = data?.sheets[sheetIdx] ?? null
  const truncated = useMemo(() => {
    if (!current) return null
    const total = current.rows.length
    const wide = current.rows.reduce((m, r) => Math.max(m, r.length), 0)
    const cutRows = total > MAX_ROWS
    const cutCols = wide > MAX_COLS
    if (!cutRows && !cutCols) return null
    return { total, wide, cutRows, cutCols }
  }, [current])

  const view = useMemo(() => {
    if (!current) return [] as unknown[][]
    return current.rows.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS))
  }, [current])

  const colCount = view.reduce((m, r) => Math.max(m, r.length), 0)

  if (loading) {
    return <div className="px-4 py-6 text-sm text-muted">加载并解析 Excel 中…</div>
  }
  if (error) {
    return (
      <div className="px-4 py-6 text-sm text-rose-300 whitespace-pre-wrap break-words">
        {error}
      </div>
    )
  }
  if (!data || data.sheets.length === 0) {
    return <div className="px-4 py-6 text-sm text-muted">该文件无任何 sheet。</div>
  }

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border/60 bg-black/20 overflow-x-auto">
        {data.sheets.map((s, i) => (
          <button
            key={s.name}
            onClick={() => setSheetIdx(i)}
            className={`fluent-btn px-2.5 py-1 text-xs rounded-md border whitespace-nowrap ${
              i === sheetIdx
                ? 'bg-accent/15 border-accent/40 text-accent'
                : 'border-border text-muted hover:text-fg hover:bg-white/[0.04]'
            }`}
            title={s.name}
          >
            {s.name}
            <span className="ml-1 text-[10px] opacity-60">({s.rows.length})</span>
          </button>
        ))}
      </div>

      {truncated && (
        <div className="px-3 py-1.5 text-[11px] text-amber-300 bg-amber-500/10 border-b border-amber-600/40">
          共 {truncated.total} 行 / {truncated.wide} 列
          {truncated.cutRows && `，已截断到前 ${MAX_ROWS} 行`}
          {truncated.cutCols && `，已截断到前 ${MAX_COLS} 列`}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {view.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted">该 sheet 无数据。</div>
        ) : (
          <table className="border-collapse text-[12px] font-mono select-text">
            <thead className="sticky top-0 bg-bg z-10">
              <tr>
                <th className="sticky left-0 z-20 bg-bg border border-border/60 px-2 py-1 text-subtle text-[10px] w-10"></th>
                {Array.from({ length: colCount }, (_, i) => (
                  <th
                    key={i}
                    className="border border-border/60 px-2 py-1 text-subtle text-[10px] font-normal min-w-[80px]"
                  >
                    {colLabel(i)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.map((row, ri) => (
                <tr key={ri}>
                  <td className="sticky left-0 bg-bg border border-border/60 px-2 py-1 text-subtle text-[10px] text-right">
                    {ri + 1}
                  </td>
                  {Array.from({ length: colCount }, (_, ci) => (
                    <td
                      key={ci}
                      className="border border-border/40 px-2 py-1 align-top whitespace-pre-wrap break-words"
                    >
                      {fmt(row[ci])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
