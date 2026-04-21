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
 * `@git-diff-view/core` expects each entry in `hunks` to be a full unified
 * diff string (including `@@` headers). Pass the whole patch as one element
 * and let the library parse multiple hunks internally. Strip everything
 * before the first `@@` so `diff --git` / `index` / `---` / `+++` preamble
 * lines don't confuse the parser.
 */
function prepareHunks(patch: string): string[] {
  if (!patch.trim()) return []
  const idx = patch.indexOf('@@')
  if (idx < 0) return []
  return [patch.slice(idx)]
}

export default function DiffView({ patch, lang, fileName, mode = 'unified' }: Props) {
  const hunks = useMemo(() => prepareHunks(patch), [patch])
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
