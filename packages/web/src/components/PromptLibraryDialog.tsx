import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BUILTIN_PROMPTS,
  addUserPrompt,
  deleteUserPrompt,
  getUserPrompts,
  onUserPromptsChange,
  updateUserPrompt,
  type Prompt,
  type UserPrompt,
} from '../prompts'
import { confirmDialog } from './dialog/DialogHost'

interface Props {
  open: boolean
  onClose: () => void
  onSend: (text: string) => void
}

type EditorState =
  | { mode: 'list' }
  | { mode: 'create' }
  | { mode: 'edit'; prompt: UserPrompt }

function previewLines(content: string): string {
  const src = content.replace(/\s+/g, ' ').trim()
  // Simple truncation — CSS `line-clamp` handles the visual cap, but we still
  // keep a hard char ceiling so the DOM doesn't carry multi-KB strings per row.
  return src.length > 160 ? src.slice(0, 160) + '…' : src
}

export default function PromptLibraryDialog({ open, onClose, onSend }: Props) {
  const [userPrompts, setUserPromptsState] = useState<UserPrompt[]>(() => getUserPrompts())
  const [query, setQuery] = useState('')
  const [editor, setEditor] = useState<EditorState>({ mode: 'list' })
  const [formName, setFormName] = useState('')
  const [formContent, setFormContent] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => onUserPromptsChange(setUserPromptsState), [])

  // Reset transient UI state when the dialog opens / closes, so a previous
  // session's editor state or query doesn't leak across opens.
  useEffect(() => {
    if (open) {
      setEditor({ mode: 'list' })
      setQuery('')
      setFormError(null)
      // Defer focus until after the modal animates in.
      const id = requestAnimationFrame(() => searchRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [open])

  useEffect(() => {
    if (editor.mode === 'edit') {
      setFormName(editor.prompt.name)
      setFormContent(editor.prompt.content)
      setFormError(null)
      const id = requestAnimationFrame(() => nameInputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
    if (editor.mode === 'create') {
      setFormName('')
      setFormContent('')
      setFormError(null)
      const id = requestAnimationFrame(() => nameInputRef.current?.focus())
      return () => cancelAnimationFrame(id)
    }
  }, [editor])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        // In editor mode, Escape goes back to list first rather than closing.
        if (editor.mode !== 'list') setEditor({ mode: 'list' })
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, editor.mode, onClose])

  const allPrompts = useMemo<Prompt[]>(
    () => [...BUILTIN_PROMPTS, ...userPrompts],
    [userPrompts],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allPrompts
    return allPrompts.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.content.toLowerCase().includes(q),
    )
  }, [allPrompts, query])

  if (!open) return null

  function handleSend(p: Prompt) {
    onSend(p.content)
  }

  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      const first = filtered[0]
      if (first) handleSend(first)
    }
  }

  function handleSaveForm() {
    const name = formName.trim()
    const content = formContent.trim()
    if (!name) {
      setFormError('名称不能为空')
      return
    }
    if (!content) {
      setFormError('内容不能为空')
      return
    }
    if (editor.mode === 'edit') {
      updateUserPrompt(editor.prompt.id, { name, content })
    } else if (editor.mode === 'create') {
      addUserPrompt({ name, content })
    }
    setEditor({ mode: 'list' })
  }

  async function handleDelete(p: UserPrompt) {
    const ok = await confirmDialog(`删除提示词 "${p.name}"? 此操作不可撤销。`, {
      title: '删除提示词',
      variant: 'danger',
      confirmLabel: '删除',
    })
    if (!ok) return
    deleteUserPrompt(p.id)
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-[520px] max-w-[90vw] max-h-[70vh] flex flex-col fluent-acrylic rounded-win shadow-dialog animate-fluent-in"
      >
        <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between gap-2 shrink-0">
          <div className="text-[15px] font-display font-semibold">
            {editor.mode === 'create'
              ? '新建提示词'
              : editor.mode === 'edit'
                ? '编辑提示词'
                : '提示词库'}
          </div>
          <button
            onClick={onClose}
            className="fluent-btn w-6 h-6 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.08]"
            title="关闭 (Esc)"
          >
            ✕
          </button>
        </div>

        {editor.mode === 'list' ? (
          <>
            <div className="px-3 py-2 border-b border-border/40 flex items-center gap-2 shrink-0">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleSearchKey}
                placeholder="搜索提示词… 回车发送第一条"
                className="flex-1 px-3 py-1.5 bg-white/[0.04] border border-border rounded-md focus:border-accent focus:bg-white/[0.06] text-sm transition-colors"
              />
              <button
                onClick={() => setEditor({ mode: 'create' })}
                className="fluent-btn px-3 py-1.5 text-sm rounded-md border border-border bg-white/[0.03] hover:bg-white/[0.08] shrink-0"
              >
                ＋ 添加
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto p-2 space-y-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-8 text-xs text-muted text-center">
                  没有匹配的提示词。
                </div>
              ) : (
                filtered.map((p) => {
                  const isUser = !p.builtin
                  return (
                    <div
                      key={p.id}
                      className="group flex items-start gap-2 px-2 py-1.5 rounded hover:bg-white/[0.04]"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-[13px]">
                          <span className="font-medium truncate">{p.name}</span>
                          {!isUser && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded border border-border text-subtle shrink-0">
                              内置
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-muted line-clamp-2 break-words">
                          {previewLines(p.content)}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isUser && (
                          <>
                            <button
                              onClick={() =>
                                setEditor({ mode: 'edit', prompt: p as UserPrompt })
                              }
                              title="编辑"
                              className="opacity-0 group-hover:opacity-100 w-6 h-6 inline-flex items-center justify-center rounded text-muted hover:text-fg hover:bg-white/[0.08]"
                            >
                              ✎
                            </button>
                            <button
                              onClick={() => void handleDelete(p as UserPrompt)}
                              title="删除"
                              className="opacity-0 group-hover:opacity-100 w-6 h-6 inline-flex items-center justify-center rounded text-rose-300 hover:bg-rose-500/15"
                            >
                              🗑
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => handleSend(p)}
                          className="fluent-btn px-2.5 py-1 text-xs rounded-md bg-accent text-on-accent font-medium hover:bg-accent-2 border border-accent/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
                        >
                          发送
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto p-4 space-y-3">
            <label className="block">
              <span className="block text-xs text-muted mb-1.5">名称</span>
              <input
                ref={nameInputRef}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="w-full px-3 py-2 bg-white/[0.04] border border-border rounded-md focus:border-accent focus:bg-white/[0.06] text-sm transition-colors"
                placeholder="例如：重构成函数式风格"
              />
            </label>
            <label className="block">
              <span className="block text-xs text-muted mb-1.5">内容</span>
              <textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                rows={8}
                className="w-full px-3 py-2 bg-white/[0.04] border border-border rounded-md focus:border-accent focus:bg-white/[0.06] text-sm font-mono leading-relaxed transition-colors resize-none"
                placeholder="完整的 prompt 文本。支持 @<path> 引用文件。"
              />
            </label>
            {formError && (
              <div className="px-3 py-2 text-xs text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-md">
                {formError}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditor({ mode: 'list' })}
                className="fluent-btn px-4 py-1.5 text-sm rounded-md border border-border bg-white/[0.03] hover:bg-white/[0.08]"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveForm}
                className="fluent-btn px-4 py-1.5 text-sm rounded-md bg-accent text-on-accent font-medium hover:bg-accent-2 border border-accent/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
              >
                保存
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
