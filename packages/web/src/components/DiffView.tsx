import { useMemo } from 'react'

interface Props {
  patch: string
  /** Unused — kept for API compatibility with earlier signatures. */
  lang?: string | null
  /** Unused. */
  fileName?: string
  /** Unused. */
  mode?: 'split' | 'unified'
}

type LineKind = 'add' | 'del' | 'ctx' | 'hunk' | 'meta'

interface DiffLine {
  kind: LineKind
  /** Old-file line number, or null when this line isn't present in old. */
  oldNo: number | null
  /** New-file line number, or null when this line isn't present in new. */
  newNo: number | null
  /** Visible content (prefix char stripped for add/del/ctx; hunk/meta kept raw). */
  text: string
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/**
 * Parse a unified diff (whole patch including optional `diff --git` / `index`
 * / `---` / `+++` preamble) into a flat list of typed lines with line numbers.
 * Every transformation is deterministic and operates line-by-line so CRLF vs
 * LF, trailing whitespace, and unusual file headers all pass through without
 * breaking the prefix-based classification.
 */
function parseDiff(patch: string): DiffLine[] {
  if (!patch) return []
  const normalized = patch.replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  // The last element after split('\n') on a trailing-newline patch is '' —
  // drop it so we don't emit a spurious final context line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  const out: DiffLine[] = []
  let oldNo = 0
  let newNo = 0
  let inHunk = false

  for (const raw of lines) {
    if (raw.startsWith('@@')) {
      const m = HUNK_HEADER_RE.exec(raw)
      if (m) {
        oldNo = parseInt(m[1], 10)
        newNo = parseInt(m[2], 10)
        inHunk = true
        out.push({ kind: 'hunk', oldNo: null, newNo: null, text: raw })
        continue
      }
      // Malformed hunk header — fall through as meta.
    }

    if (!inHunk) {
      // Preamble: diff --git / index / --- / +++ / mode changes — keep as meta
      // lines so users can still see them, but muted.
      if (raw.length > 0) {
        out.push({ kind: 'meta', oldNo: null, newNo: null, text: raw })
      }
      continue
    }

    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      out.push({ kind: 'add', oldNo: null, newNo: newNo, text: raw.slice(1) })
      newNo += 1
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      out.push({ kind: 'del', oldNo: oldNo, newNo: null, text: raw.slice(1) })
      oldNo += 1
    } else if (raw.startsWith('\\')) {
      // "\ No newline at end of file" markers — render as context-muted.
      out.push({ kind: 'meta', oldNo: null, newNo: null, text: raw })
    } else {
      // Context line (leading space) or a stray blank line inside a hunk.
      const text = raw.startsWith(' ') ? raw.slice(1) : raw
      out.push({ kind: 'ctx', oldNo: oldNo, newNo: newNo, text })
      oldNo += 1
      newNo += 1
    }
  }

  return out
}

function lineClass(kind: LineKind): string {
  switch (kind) {
    case 'add':
      return 'bg-emerald-500/10 text-emerald-200'
    case 'del':
      return 'bg-rose-500/10 text-rose-200'
    case 'hunk':
      return 'bg-sky-500/10 text-sky-300 font-medium'
    case 'meta':
      return 'text-subtle'
    case 'ctx':
    default:
      return 'text-fg/85'
  }
}

function prefix(kind: LineKind): string {
  switch (kind) {
    case 'add': return '+'
    case 'del': return '-'
    case 'hunk':
    case 'meta': return ''
    case 'ctx':
    default: return ' '
  }
}

export default function DiffView({ patch }: Props) {
  const rows = useMemo(() => parseDiff(patch), [patch])

  const hasChange = useMemo(
    () => rows.some((r) => r.kind === 'add' || r.kind === 'del'),
    [rows],
  )

  if (rows.length === 0 || !hasChange) {
    return (
      <div className="px-4 py-6 text-sm text-muted">
        没有可显示的差异（文件可能是新增/删除或内容相同）。
      </div>
    )
  }

  return (
    <div className="font-mono text-[12.5px] leading-[1.45] bg-[#0d1117] rounded-md overflow-auto">
      <table className="w-full border-collapse">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={lineClass(r.kind)}>
              <td className="select-none text-right px-2 w-[48px] text-subtle tabular-nums border-r border-white/[0.04]">
                {r.oldNo ?? ''}
              </td>
              <td className="select-none text-right px-2 w-[48px] text-subtle tabular-nums border-r border-white/[0.04]">
                {r.newNo ?? ''}
              </td>
              <td className="px-2 whitespace-pre">
                <span className="select-none opacity-60 mr-1">
                  {prefix(r.kind)}
                </span>
                {r.text}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
