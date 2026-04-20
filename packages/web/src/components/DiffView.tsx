import { useMemo } from 'react'
import { DiffView as GitDiffView, DiffModeEnum } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view.css'

interface Props {
  patch: string
  /** File extension / shiki lang id for syntax coloring inside the diff. */
  lang?: string | null
  fileName?: string
  mode?: 'split' | 'unified'
}

/**
 * The server hands us a single unified diff string produced by `git diff`. The
 * component wants an array of hunk strings, so we slice the raw patch on hunk
 * boundaries and drop the file header (no `@@` in it — @git-diff-view parses
 * file names from its own `data.*.fileName`).
 */
function splitHunks(patch: string): string[] {
  if (!patch.trim()) return []
  const lines = patch.split('\n')
  const hunks: string[] = []
  let current: string[] | null = null
  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current) hunks.push(current.join('\n'))
      current = [line]
    } else if (current) {
      current.push(line)
    }
    // Lines before the first hunk header are the file/metadata preamble — drop.
  }
  if (current) hunks.push(current.join('\n'))
  return hunks
}

export default function DiffView({ patch, lang, fileName, mode = 'unified' }: Props) {
  const hunks = useMemo(() => splitHunks(patch), [patch])
  const data = useMemo(
    () => ({
      oldFile: {
        fileName: fileName ?? null,
        fileLang: lang ?? null,
        content: null,
      },
      newFile: {
        fileName: fileName ?? null,
        fileLang: lang ?? null,
        content: null,
      },
      hunks,
    }),
    [hunks, lang, fileName],
  )

  if (hunks.length === 0) {
    return (
      <div className="px-4 py-6 text-sm text-muted">
        没有可显示的差异（文件可能是新增/删除或内容相同）。
      </div>
    )
  }

  return (
    <div className="diff-view-host">
      <GitDiffView
        data={data}
        diffViewMode={mode === 'split' ? DiffModeEnum.Split : DiffModeEnum.Unified}
        diffViewTheme="dark"
        diffViewHighlight={Boolean(lang)}
        diffViewWrap={false}
        diffViewFontSize={12}
      />
    </div>
  )
}
