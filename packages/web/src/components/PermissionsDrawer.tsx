import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import * as api from '../api'
import { logAction } from '../logs'
import { useStore } from '../store'
import { alertDialog, confirmDialog } from './dialog/DialogHost'
import {
  BUTTON_COLORS,
  BUTTON_COLOR_LABELS,
  BUTTON_COLOR_SWATCH,
  getCustomButtons,
  makeId,
  onCustomButtonsChange,
  setCustomButtons,
  type ButtonColor,
  type CustomButton,
} from '../customButtons'
import type {
  CatalogCodexField,
  CliConfigState,
  ClaudePreset,
  CodexPreset,
  GstackStatus,
  PermissionCatalog,
  ProbeFile,
  Project,
  Session,
  TriState,
  WorkflowMode,
  WorkflowStatus,
} from '../types'

interface Props {
  project: Project
  onClose: () => void
}

type CodexValues = Record<string, string | boolean | string[]>

const TRISTATE_ORDER: TriState[] = ['off', 'allow', 'ask', 'deny']
const TRISTATE_LABEL: Record<TriState, string> = {
  off: '关闭',
  allow: '允许',
  ask: '询问',
  deny: '拒绝',
}
const TRISTATE_COLOR: Record<TriState, string> = {
  off: 'bg-bg text-muted border-border',
  allow: 'bg-emerald-900/60 text-emerald-200 border-emerald-700',
  ask: 'bg-amber-900/50 text-amber-200 border-amber-700',
  deny: 'bg-rose-900/60 text-rose-200 border-rose-700',
}

export default function PermissionsDrawer({ project, onClose }: Props) {
  const sessions = useStore((s) => s.sessions)
  const projectSessions = sessions.filter(
    (s) => s.projectId === project.id && s.ended_at == null,
  )

  const [catalog, setCatalog] = useState<PermissionCatalog | null>(null)
  const [state, setState] = useState<CliConfigState | null>(null)
  const [selections, setSelections] = useState<Record<string, TriState>>({})
  const [codexValues, setCodexValues] = useState<CodexValues>({})
  const [customInput, setCustomInput] = useState('')
  const [customKind, setCustomKind] = useState<'allow' | 'ask' | 'deny'>('allow')
  const [customEntries, setCustomEntries] = useState<{ allow: string[]; ask: string[]; deny: string[] }>(
    { allow: [], ask: [], deny: [] },
  )
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'claude' | 'codex'>('claude')
  const [mode, setMode] = useState<'workflow' | 'permissions' | 'buttons' | 'tools'>('workflow')
  const [dirty, setDirty] = useState(false)
  const [initNeeded, setInitNeeded] = useState(false)
  const [postSaveDialog, setPostSaveDialog] = useState<null | { sessions: Session[] }>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([api.getCliConfigCatalog(), api.getProjectCliConfig(project.id)])
      .then(([cat, st]) => {
        if (cancelled) return
        setCatalog(cat)
        setState(st)
        setSelections(st.claude.selections)
        setCodexValues(st.codex.values)
        setCustomEntries(st.claude.custom)
        setInitNeeded(!st.probe.claudeDir.exists || !st.probe.codexDir.exists)
        setDirty(false)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [project.id])

  function markDirty() {
    setDirty(true)
  }

  function setItemState(itemId: string, next: TriState) {
    setSelections((prev) => ({ ...prev, [itemId]: next }))
    markDirty()
  }

  function applyClaudePreset(p: ClaudePreset) {
    if (!catalog) return
    const next: Record<string, TriState> = {}
    if (p.applyAllAllow) {
      // Every catalog item set to allow
      for (const g of catalog.claude.groups) {
        for (const it of g.items) next[it.id] = 'allow'
      }
    } else if (p.id === 'clear') {
      // Explicit "clear all" — set every catalog item to off
      for (const g of catalog.claude.groups) {
        for (const it of g.items) next[it.id] = 'off'
      }
    } else {
      // Start from current state, overlay preset
      Object.assign(next, selections)
      // Reset all catalog items that preset *doesn't* mention to off
      for (const g of catalog.claude.groups) {
        for (const it of g.items) {
          if (!(it.id in p.selections)) next[it.id] = 'off'
        }
      }
    }
    for (const [k, v] of Object.entries(p.selections)) next[k] = v
    setSelections(next)
    markDirty()
  }

  function applyCodexPreset(p: CodexPreset) {
    setCodexValues({ ...p.values })
    markDirty()
  }

  function setCodex(path: string, value: string | boolean | string[] | undefined) {
    setCodexValues((prev) => {
      const next = { ...prev }
      if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
        delete next[path]
      } else {
        next[path] = value
      }
      return next
    })
    markDirty()
  }

  function addCustom() {
    const v = customInput.trim()
    if (!v) return
    setCustomEntries((prev) => {
      if (prev[customKind].includes(v)) return prev
      return { ...prev, [customKind]: [...prev[customKind], v] }
    })
    setCustomInput('')
    markDirty()
  }

  function removeCustom(kind: 'allow' | 'ask' | 'deny', v: string) {
    setCustomEntries((prev) => ({ ...prev, [kind]: prev[kind].filter((x) => x !== v) }))
    markDirty()
  }

  async function onInitConfigs() {
    setSaving(true)
    try {
      await api.initProjectCliConfig(project.id, ['claude', 'codex'], false)
      const st = await api.getProjectCliConfig(project.id)
      setState(st)
      setSelections(st.claude.selections)
      setCodexValues(st.codex.values)
      setCustomEntries(st.claude.custom)
      setInitNeeded(false)
    } catch (e: unknown) {
      await alertDialog(
        `初始化失败: ${e instanceof Error ? e.message : String(e)}`,
        { title: '初始化失败', variant: 'danger' },
      )
    } finally {
      setSaving(false)
    }
  }

  async function onSave() {
    setSaving(true)
    setError(null)
    try {
      await api.saveProjectCliConfig(project.id, {
        claude: { selections, custom: customEntries },
        codex: { values: codexValues },
      })
      setDirty(false)
      // Re-fetch so selections reflect the normalized state from server
      const st = await api.getProjectCliConfig(project.id)
      setState(st)
      setSelections(st.claude.selections)
      setCodexValues(st.codex.values)
      setCustomEntries(st.claude.custom)
      // If any sessions alive, open restart prompt
      if (projectSessions.length > 0) {
        setPostSaveDialog({ sessions: projectSessions })
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const groupedCount = useMemo(() => {
    if (!catalog) return { allow: 0, ask: 0, deny: 0 }
    const out = { allow: 0, ask: 0, deny: 0 }
    for (const s of Object.values(selections)) {
      if (s === 'allow' || s === 'ask' || s === 'deny') out[s]++
    }
    return out
  }, [catalog, selections])

  const modal = (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
        onClick={() => !saving && onClose()}
      />
      <div
        className="relative w-[720px] max-w-full h-[85vh] fluent-acrylic rounded-win flex flex-col shadow-dialog overflow-hidden animate-fluent-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 h-12 border-b border-border/60 bg-white/[0.02] gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <span className="text-sm text-muted shrink-0">设置</span>
            <span className="truncate text-fg font-semibold">{project.name}</span>
            {mode === 'permissions' && dirty && (
              <span className="text-xs text-amber-300 shrink-0">● 未保存</span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {mode === 'permissions' && (
              <button
                onClick={() => void onSave()}
                disabled={saving || !dirty}
                title={!dirty ? '没有未保存的改动' : '写入 .claude/settings.local.json 和 .codex/config.toml'}
                className="fluent-btn px-3 py-1 text-sm rounded-md bg-accent text-on-accent font-medium hover:bg-accent-2 border border-accent/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? '保存中…' : '💾 保存'}
              </button>
            )}
            <button
              className="fluent-btn text-muted hover:text-fg text-sm px-2.5 py-1 border border-border bg-white/[0.03] hover:bg-white/[0.08] rounded-md"
              onClick={onClose}
              disabled={saving}
              title="关闭 (未保存的改动会丢失)"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex border-b border-border bg-bg/20">
          <TabBtn active={mode === 'workflow'} onClick={() => setMode('workflow')}>
            📐 工作流
          </TabBtn>
          <TabBtn active={mode === 'permissions'} onClick={() => setMode('permissions')}>
            🛡 权限
          </TabBtn>
          <TabBtn active={mode === 'buttons'} onClick={() => setMode('buttons')}>
            🎛 按钮
          </TabBtn>
          <TabBtn active={mode === 'tools'} onClick={() => setMode('tools')}>
            🧰 工具集
          </TabBtn>
        </div>

        {mode === 'permissions' && (
          <>
            <div className="px-4 py-2 text-xs text-muted border-b border-border truncate" title={project.path}>
              {project.path}
            </div>

            {state && <DetectionPanel state={state} />}

            <div className="flex border-b border-border bg-bg/30">
              <TabBtn active={tab === 'claude'} onClick={() => setTab('claude')}>
                Claude <span className="ml-1 text-muted">({groupedCount.allow}/{groupedCount.ask}/{groupedCount.deny})</span>
              </TabBtn>
              <TabBtn active={tab === 'codex'} onClick={() => setTab('codex')}>
                Codex
              </TabBtn>
            </div>

            {initNeeded && state && (
              <div className="px-4 py-2 text-xs text-amber-300 bg-amber-950/40 border-b border-amber-900/40 flex items-center justify-between gap-3">
                <span>
                  {(() => {
                    const missing: string[] = []
                    if (!state.probe.claudeDir.exists) missing.push('.claude/')
                    if (!state.probe.codexDir.exists) missing.push('.codex/')
                    return missing.length === 2
                      ? <>项目下还没有 <code>.claude/</code> 或 <code>.codex/</code> 配置目录。</>
                      : <>项目下还没有 <code>{missing[0]}</code> 配置目录。</>
                  })()}
                </span>
                <button
                  onClick={() => void onInitConfigs()}
                  disabled={saving}
                  className="px-2 py-0.5 rounded border border-amber-700/60 hover:bg-amber-900/30 disabled:opacity-50 shrink-0"
                >
                  一键初始化模板
                </button>
              </div>
            )}

            <div className="flex-1 overflow-auto">
              {loading && <div className="p-4 text-sm text-muted">加载中…</div>}
              {error && <div className="p-4 text-sm text-rose-300">错误: {error}</div>}
              {!loading && !error && catalog && (
                <>
                  {tab === 'claude' && (
                    <ClaudeTab
                      catalog={catalog}
                      selections={selections}
                      onSet={setItemState}
                      onApplyPreset={applyClaudePreset}
                      sharedInfo={state?.claude.shared ?? null}
                      sharedError={state?.claude.sharedError ?? null}
                      custom={customEntries}
                      onRemoveCustom={removeCustom}
                      customInput={customInput}
                      setCustomInput={setCustomInput}
                      customKind={customKind}
                      setCustomKind={setCustomKind}
                      onAddCustom={addCustom}
                    />
                  )}
                  {tab === 'codex' && (
                    <CodexTab
                      catalog={catalog}
                      values={codexValues}
                      setValue={setCodex}
                      onApplyPreset={applyCodexPreset}
                    />
                  )}
                </>
              )}
            </div>

            <div className="h-8 border-t border-border px-4 flex items-center justify-between bg-bg/40 text-xs text-muted">
              <span>
                Claude: {state?.claude.fileExists ? '✓' : '×'} · Codex:{' '}
                {state?.codex.fileExists ? '✓' : '×'}
              </span>
              <span>{dirty ? '有改动 — 点顶部 💾 保存' : saving ? '…' : '已同步'}</span>
            </div>
          </>
        )}

        {mode === 'workflow' && <WorkflowTab project={project} />}

        {mode === 'buttons' && <ButtonsTab />}

        {mode === 'tools' && <ToolsTab />}
      </div>

      {postSaveDialog && (
        <PostSaveRestartDialog
          sessions={postSaveDialog.sessions}
          onClose={() => setPostSaveDialog(null)}
        />
      )}
    </div>
  )

  // Portal to document.body so the modal escapes any transform/overflow
  // ancestors (e.g. the resizable-panels container) that would otherwise
  // clip `fixed inset-0` to the panel's bounds.
  if (typeof document === 'undefined') return modal
  return createPortal(modal, document.body)
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm border-b-2 transition-colors ${
        active ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}

function ClaudeTab({
  catalog,
  selections,
  onSet,
  onApplyPreset,
  sharedInfo,
  sharedError,
  custom,
  onRemoveCustom,
  customInput,
  setCustomInput,
  customKind,
  setCustomKind,
  onAddCustom,
}: {
  catalog: PermissionCatalog
  selections: Record<string, TriState>
  onSet: (id: string, v: TriState) => void
  onApplyPreset: (p: ClaudePreset) => void
  sharedInfo: { allow: string[]; ask: string[]; deny: string[] } | null
  sharedError: string | null
  custom: { allow: string[]; ask: string[]; deny: string[] }
  onRemoveCustom: (k: 'allow' | 'ask' | 'deny', v: string) => void
  customInput: string
  setCustomInput: (v: string) => void
  customKind: 'allow' | 'ask' | 'deny'
  setCustomKind: (k: 'allow' | 'ask' | 'deny') => void
  onAddCustom: () => void
}) {
  return (
    <div className="p-4 space-y-6">
      {catalog.claude.presets && catalog.claude.presets.length > 0 && (
        <PresetBar
          presets={catalog.claude.presets.map((p) => ({
            id: p.id,
            label: p.label,
            description: p.description,
            onApply: () => onApplyPreset(p),
          }))}
        />
      )}

      {sharedError && (
        <div className="text-xs text-rose-300 bg-rose-950/40 border border-rose-900/60 rounded p-2">
          <strong>.claude/settings.json 解析失败：</strong> {sharedError}
        </div>
      )}
      {sharedInfo && (sharedInfo.allow.length + sharedInfo.ask.length + sharedInfo.deny.length > 0) && (
        <div className="text-xs text-muted bg-bg/30 border border-border/60 rounded p-2 space-y-1">
          <div className="text-fg">
            ⚠ 检测到团队共享 <code>.claude/settings.json</code>（{sharedInfo.allow.length + sharedInfo.ask.length + sharedInfo.deny.length} 条）
          </div>
          <div>这些权限也会生效，但本面板只编辑 <code>settings.local.json</code>。</div>
          {sharedInfo.allow.length > 0 && (
            <div className="font-mono text-[11px] pt-1">
              allow: {sharedInfo.allow.slice(0, 5).join(', ')}
              {sharedInfo.allow.length > 5 && ` … +${sharedInfo.allow.length - 5}`}
            </div>
          )}
        </div>
      )}

      {catalog.claude.groups.map((g) => (
        <section key={g.id}>
          <div className="text-sm font-medium text-fg mb-1">{g.label}</div>
          {g.description && (
            <div className="text-xs text-muted mb-2">{g.description}</div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {g.items.map((it) => {
              const state = selections[it.id] ?? 'off'
              return (
                <div
                  key={it.id}
                  className="flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-border/60 bg-bg/30"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-fg truncate" title={String(it.value)}>
                      {it.label}
                    </div>
                    <div className="text-[11px] text-muted truncate font-mono">
                      {Array.isArray(it.value) ? it.value.join(', ') : it.value}
                    </div>
                  </div>
                  <TriStatePicker
                    value={state}
                    onChange={(v) => onSet(it.id, v)}
                  />
                </div>
              )
            })}
          </div>
        </section>
      ))}

      <section>
        <div className="text-sm font-medium text-fg mb-1">自定义条目</div>
        <div className="text-xs text-muted mb-2">
          目录外的 Bash 模式、Read/Edit glob、MCP 工具等，可在此自由增删。支持例如 <code>Bash(git push:*)</code>、<code>Read(src/**)</code>、<code>mcp__filesystem__read_file</code>。
        </div>
        <div className="flex items-center gap-2 mb-3">
          <select
            value={customKind}
            onChange={(e) => setCustomKind(e.target.value as 'allow' | 'ask' | 'deny')}
            className="bg-bg border border-border text-sm rounded px-2 py-1"
          >
            <option value="allow">allow</option>
            <option value="ask">ask</option>
            <option value="deny">deny</option>
          </select>
          <input
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onAddCustom()
              }
            }}
            placeholder="例如 Bash(docker compose:*)"
            className="flex-1 bg-bg border border-border text-sm rounded px-2 py-1 font-mono"
          />
          <button
            onClick={onAddCustom}
            className="px-3 py-1 text-sm rounded border border-accent/40 bg-accent/15 text-accent hover:bg-accent/25"
          >
            添加
          </button>
        </div>
        {(['allow', 'ask', 'deny'] as const).map((k) =>
          custom[k].length === 0 ? null : (
            <div key={k} className="mb-2">
              <div className="text-xs text-muted uppercase mb-1">{k}</div>
              <div className="flex flex-wrap gap-1.5">
                {custom[k].map((v) => (
                  <span
                    key={v}
                    className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border font-mono ${TRISTATE_COLOR[k]}`}
                  >
                    {v}
                    <button
                      onClick={() => onRemoveCustom(k, v)}
                      className="opacity-60 hover:opacity-100"
                      title="移除"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ),
        )}
      </section>
    </div>
  )
}

function TriStatePicker({
  value,
  onChange,
}: {
  value: TriState
  onChange: (v: TriState) => void
}) {
  return (
    <div className="flex rounded overflow-hidden border border-border text-[11px] shrink-0">
      {TRISTATE_ORDER.map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          title={TRISTATE_LABEL[s]}
          className={`px-2 py-0.5 transition-colors ${
            value === s
              ? TRISTATE_COLOR[s]
              : 'bg-bg/60 text-muted hover:text-fg'
          }`}
        >
          {TRISTATE_LABEL[s]}
        </button>
      ))}
    </div>
  )
}

function CodexTab({
  catalog,
  values,
  setValue,
  onApplyPreset,
}: {
  catalog: PermissionCatalog
  values: CodexValues
  setValue: (path: string, v: string | boolean | string[] | undefined) => void
  onApplyPreset: (p: CodexPreset) => void
}) {
  return (
    <div className="p-4 space-y-4">
      {catalog.codex.presets && catalog.codex.presets.length > 0 && (
        <PresetBar
          presets={catalog.codex.presets.map((p) => ({
            id: p.id,
            label: p.label,
            description: p.description,
            onApply: () => onApplyPreset(p),
          }))}
        />
      )}
      {catalog.codex.fields.map((f) => (
        <CodexField key={f.id} field={f} value={values[f.path]} setValue={setValue} />
      ))}
    </div>
  )
}

function PresetBar({
  presets,
}: {
  presets: { id: string; label: string; description?: string; onApply: () => void }[]
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted mb-2">预设</div>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <button
            key={p.id}
            onClick={p.onApply}
            title={p.description ?? ''}
            className="px-2.5 py-1 text-xs rounded border border-border bg-bg/60 text-fg hover:bg-accent/15 hover:border-accent/40 hover:text-accent"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function DetectionPanel({ state }: { state: CliConfigState }) {
  const p = state.probe
  const row = (label: string, f: ProbeFile, icon: string) => {
    const status = !f.exists
      ? { color: 'text-muted', text: '未找到' }
      : f.parseError
        ? { color: 'text-rose-300', text: `解析失败: ${f.parseError}` }
        : f.error
          ? { color: 'text-rose-300', text: f.error }
          : { color: 'text-emerald-300', text: `${f.size ?? 0} B` }
    return (
      <div className="flex items-center gap-2 text-xs py-0.5">
        <span>{icon}</span>
        <span className="text-muted">{label}</span>
        <span className={status.color + ' truncate'}>{status.text}</span>
      </div>
    )
  }
  return (
    <div className="px-4 py-2 border-b border-border bg-bg/20 text-xs">
      <div className="flex items-center gap-4 flex-wrap">
        <span className={p.claudeDir.exists ? 'text-emerald-300' : 'text-muted'}>
          {p.claudeDir.exists ? '✓' : '×'} .claude/
        </span>
        <span className={p.codexDir.exists ? 'text-emerald-300' : 'text-muted'}>
          {p.codexDir.exists ? '✓' : '×'} .codex/
        </span>
      </div>
      <div className="mt-1 grid grid-cols-1 sm:grid-cols-3 gap-x-4">
        {row('settings.json', p.claudeSettings, '📄')}
        {row('settings.local.json', p.claudeLocal, '📝')}
        {row('config.toml', p.codexConfig, '⚙')}
      </div>
    </div>
  )
}

function CodexField({
  field,
  value,
  setValue,
}: {
  field: CatalogCodexField
  value: string | boolean | string[] | undefined
  setValue: (path: string, v: string | boolean | string[] | undefined) => void
}) {
  const base = 'rounded border border-border/60 bg-bg/30 p-3'
  if (field.kind === 'single') {
    return (
      <div className={base}>
        <div className="text-sm text-fg mb-2">{field.label}</div>
        <div className="flex flex-wrap gap-1.5">
          <OptionPill
            active={value === undefined || value === ''}
            onClick={() => setValue(field.path, undefined)}
            label="(未设置)"
          />
          {field.options?.map((o) => (
            <OptionPill
              key={o.value}
              active={value === o.value}
              onClick={() => setValue(field.path, o.value)}
              label={o.label}
            />
          ))}
        </div>
      </div>
    )
  }
  if (field.kind === 'bool') {
    return (
      <div className={base + ' flex items-center justify-between'}>
        <div className="text-sm text-fg">{field.label}</div>
        <div className="flex gap-1.5">
          <OptionPill
            active={value === undefined}
            onClick={() => setValue(field.path, undefined)}
            label="(未设置)"
          />
          <OptionPill
            active={value === true}
            onClick={() => setValue(field.path, true)}
            label="true"
          />
          <OptionPill
            active={value === false}
            onClick={() => setValue(field.path, false)}
            label="false"
          />
        </div>
      </div>
    )
  }
  // stringList
  const list = Array.isArray(value) ? value : []
  return (
    <div className={base}>
      <div className="text-sm text-fg mb-2">{field.label}</div>
      <textarea
        rows={3}
        placeholder={field.placeholder ?? '一行一个'}
        className="w-full bg-bg border border-border rounded text-sm font-mono px-2 py-1"
        value={list.join('\n')}
        onChange={(e) => {
          const next = e.target.value
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
          setValue(field.path, next.length ? next : undefined)
        }}
      />
    </div>
  )
}

function OptionPill({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 text-xs rounded border transition-colors ${
        active
          ? 'bg-accent/20 text-accent border-accent/40'
          : 'bg-bg/60 text-muted border-border hover:text-fg'
      }`}
    >
      {label}
    </button>
  )
}

function ButtonsTab() {
  const [list, setList] = useState<CustomButton[]>(() => getCustomButtons())

  useEffect(() => onCustomButtonsChange(setList), [])

  function persist(next: CustomButton[]) {
    setCustomButtons(next)
    // setCustomButtons emits to listeners (including our own), which updates
    // `list`. No local setState call needed.
  }

  function addNew() {
    const next: CustomButton = {
      id: makeId(),
      text: '新按钮',
      color: 'slate',
      command: '',
      showInTopbar: true,
    }
    persist([...list, next])
  }

  function update(id: string, patch: Partial<CustomButton>) {
    persist(list.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }

  function remove(id: string) {
    persist(list.filter((b) => b.id !== id))
  }

  return (
    <div className="flex-1 overflow-auto p-4 space-y-3">
      <div className="text-xs text-muted leading-relaxed">
        自定义会显示在每个终端顶部栏上的快捷按钮。点击时会把命令发送给所属终端（自动追加回车）。
        设置是全局的，所有终端共享。
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-fg">已配置 {list.length} 个按钮</div>
        <button
          onClick={addNew}
          className="px-3 py-1 text-sm rounded border border-accent/40 bg-accent/15 text-accent hover:bg-accent/25"
        >
          + 新增按钮
        </button>
      </div>

      {list.length === 0 && (
        <div className="text-xs text-muted bg-bg/30 border border-border/60 rounded p-3">
          还没有自定义按钮。点击右上角 “+ 新增按钮” 开始配置。例如添加一个 “提交” 按钮，命令填 <code>/commit</code>。
        </div>
      )}

      <div className="space-y-2">
        {list.map((b) => (
          <ButtonRow
            key={b.id}
            btn={b}
            onChange={(patch) => update(b.id, patch)}
            onRemove={() => remove(b.id)}
          />
        ))}
      </div>
    </div>
  )
}

function ButtonRow({
  btn,
  onChange,
  onRemove,
}: {
  btn: CustomButton
  onChange: (patch: Partial<CustomButton>) => void
  onRemove: () => void
}) {
  // Pull agent ids that the user has actually used so the per-agent editor
  // offers relevant suggestions. Falls back to the built-in shells.
  const sessions = useStore((s) => s.sessions)
  const agentSuggestions = useMemo(() => {
    const set = new Set<string>(['shell', 'cmd', 'pwsh'])
    for (const s of sessions) set.add(s.agent)
    return Array.from(set)
  }, [sessions])

  const overrides = btn.commandByAgent ?? {}
  const overrideEntries = Object.entries(overrides)

  function updateOverride(agent: string, command: string) {
    const next = { ...overrides }
    if (command === '') delete next[agent]
    else next[agent] = command
    onChange({ commandByAgent: Object.keys(next).length > 0 ? next : undefined })
  }

  function renameOverrideAgent(oldAgent: string, newAgent: string) {
    if (oldAgent === newAgent) return
    const next = { ...overrides }
    const cmd = next[oldAgent] ?? ''
    delete next[oldAgent]
    if (newAgent) next[newAgent] = cmd
    onChange({ commandByAgent: Object.keys(next).length > 0 ? next : undefined })
  }

  function removeOverride(agent: string) {
    const next = { ...overrides }
    delete next[agent]
    onChange({ commandByAgent: Object.keys(next).length > 0 ? next : undefined })
  }

  function addOverride() {
    // Seed with the first suggestion that isn't already overridden, or empty.
    const candidate = agentSuggestions.find((a) => !(a in overrides)) ?? ''
    if (candidate in overrides) return
    onChange({
      commandByAgent: {
        ...overrides,
        [candidate]: '',
      },
    })
  }

  const datalistId = `agents-${btn.id}`

  return (
    <div className="border border-border/60 rounded bg-bg/30 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          value={btn.text}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="按钮文本"
          className="flex-1 bg-bg border border-border text-sm rounded px-2 py-1"
        />
        <label className="flex items-center gap-1 text-xs text-muted shrink-0 cursor-pointer">
          <input
            type="checkbox"
            checked={btn.showInTopbar}
            onChange={(e) => onChange({ showInTopbar: e.target.checked })}
          />
          显示在顶部栏
        </label>
        <button
          onClick={onRemove}
          title="删除"
          className="px-2 py-1 text-xs rounded border border-rose-700/60 text-rose-300 hover:bg-rose-900/30"
        >
          ✕
        </button>
      </div>

      <div className="space-y-1">
        <div className="text-[11px] text-muted">默认命令（留空则使用下面的终端特定命令）</div>
        <input
          value={btn.command}
          onChange={(e) => onChange({ command: e.target.value })}
          placeholder="发送到终端的命令，例如 /resume"
          className="w-full bg-bg border border-border text-sm rounded px-2 py-1 font-mono"
        />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-muted">针对不同终端的命令（覆盖默认）</div>
          <button
            onClick={addOverride}
            className="text-[11px] text-accent hover:underline"
          >
            + 添加
          </button>
        </div>
        {overrideEntries.length === 0 && (
          <div className="text-[11px] text-subtle italic">
            未配置。例如 claude 用 /clear，cmd 用 cls。
          </div>
        )}
        {overrideEntries.length > 0 && (
          <datalist id={datalistId}>
            {agentSuggestions.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        )}
        {overrideEntries.map(([agent, cmd]) => (
          <div key={agent} className="flex items-center gap-2">
            <input
              list={datalistId}
              value={agent}
              onChange={(e) => renameOverrideAgent(agent, e.target.value.trim())}
              placeholder="终端类型 (claude/codex/cmd…)"
              className="w-40 bg-bg border border-border text-sm rounded px-2 py-1 font-mono"
            />
            <input
              value={cmd}
              onChange={(e) => updateOverride(agent, e.target.value)}
              placeholder="对该终端发送的命令"
              className="flex-1 bg-bg border border-border text-sm rounded px-2 py-1 font-mono"
            />
            <button
              onClick={() => removeOverride(agent)}
              title="删除该条"
              className="px-2 py-1 text-xs rounded border border-border text-muted hover:text-fg hover:border-fg/30"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted">颜色:</span>
        {BUTTON_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => onChange({ color: c })}
            title={BUTTON_COLOR_LABELS[c]}
            className={`w-6 h-6 rounded-full ${BUTTON_COLOR_SWATCH[c]} border-2 ${
              btn.color === c ? 'border-fg' : 'border-transparent hover:border-fg/40'
            }`}
          />
        ))}
        <span className="ml-auto text-xs text-muted">预览:</span>
        <ButtonPreview color={btn.color} text={btn.text} />
      </div>
    </div>
  )
}

function ButtonPreview({ color, text }: { color: ButtonColor; text: string }) {
  // Mirrors the classes used by SessionTile so the preview matches reality.
  const colorClass = {
    slate: 'border-border text-muted',
    emerald: 'border-emerald-700/60 text-emerald-300',
    amber: 'border-amber-700/60 text-amber-300',
    sky: 'border-sky-700/60 text-sky-300',
    violet: 'border-violet-700/60 text-violet-300',
    rose: 'border-rose-700/60 text-rose-300',
  }[color]
  return (
    <span className={`px-2 py-0.5 text-xs rounded border ${colorClass}`}>
      {text || '按钮'}
    </span>
  )
}

type WorkflowChoice = 'none' | WorkflowMode

function WorkflowTab({ project }: { project: Project }) {
  const setWorkflowMode = useStore((s) => s.setWorkflowMode)
  const [status, setStatus] = useState<WorkflowStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [choice, setChoice] = useState<WorkflowChoice>('dev-docs')
  const [superpowersChoice, setSuperpowersChoice] = useState(false)

  async function refresh() {
    try {
      const s = await api.getWorkflowStatus(project.id)
      setStatus(s)
      setLoadError(null)
      // 把 UI 选择同步成"当前生效的状态"（不是用户已经在编辑的草稿）。
      setChoice(s.detectedMode ?? 'none')
      setSuperpowersChoice(s.superpowers.enabled)
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    let cancelled = false
    setStatus(null)
    setLoadError(null)
    api
      .getWorkflowStatus(project.id)
      .then((s) => {
        if (cancelled) return
        setStatus(s)
        setChoice(s.detectedMode ?? 'none')
        setSuperpowersChoice(s.superpowers.enabled)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [project.id])

  async function applyWorkflowClick() {
    if (busy) return
    if (!status) return
    const detectedMode = status.detectedMode
    const wantsMode = choice === 'none' ? null : choice
    const wantsSuperpowers = superpowersChoice

    // 切换模式（dev-docs ↔ openspec / ... ↔ none）需要先卸掉旧模式：避免双重应用残留两套文件。
    const switchingFromMode =
      detectedMode != null && detectedMode !== wantsMode ? detectedMode : null
    // 切换 mode 时，若用户同步取消了 Superpowers 勾选，把 Superpowers 段一起卸——否则
    // 切完后 CLAUDE.md 里旧的 Superpowers 段会残留，与"下拉菜单选哪个就只剩哪个"语义不符。
    // Superpowers 只在"用户主动取消勾选"时才动，保持它的独立勾选语义不变。
    const switchOffSuperpowers =
      switchingFromMode != null && status.superpowers.enabled && !wantsSuperpowers
    if (switchingFromMode) {
      const tail = switchOffSuperpowers
        ? '会先卸掉旧模式 + Superpowers 段（保留你已写入的内容文件，仅撤回工作流脚手架）。'
        : '会先卸掉旧模式（保留你已写入的内容文件，仅撤回工作流脚手架）。'
      const ok = await confirmDialog(
        `当前已应用 "${switchingFromMode === 'dev-docs' ? 'Dev Docs' : 'OpenSpec'}"。切换到 "${
          wantsMode === null
            ? '无'
            : wantsMode === 'dev-docs'
              ? 'Dev Docs'
              : 'OpenSpec'
        }" ${tail}`,
        { title: '切换工作流', confirmLabel: '继续切换' },
      )
      if (!ok) return
    }
    setBusy(true)
    try {
      // 1) 卸旧模式（当且仅当用户在切换）；若同步取消了 Superpowers，合并到同一次 remove 调用
      if (switchingFromMode || switchOffSuperpowers) {
        await logAction(
          'project',
          'remove-workflow',
          () =>
            api.removeWorkflow(project.id, {
              ...(switchingFromMode ? { mode: switchingFromMode } : {}),
              ...(switchOffSuperpowers ? { superpowers: true } : {}),
            }),
          {
            projectId: project.id,
            meta: { mode: switchingFromMode, superpowers: switchOffSuperpowers, reason: 'switch' },
          },
        )
      }

      // 2) 应用新模式 / Superpowers（任一非空就发请求；都为空则什么也不做）
      const needsApply = wantsMode !== null || wantsSuperpowers !== status.superpowers.enabled
      if (wantsMode !== null) {
        const result = await logAction(
          'project',
          'apply-workflow',
          () =>
            api.applyWorkflow(project.id, {
              mode: wantsMode,
              ...(wantsSuperpowers ? { superpowers: true } : {}),
            }),
          {
            projectId: project.id,
            meta: { mode: wantsMode, superpowers: wantsSuperpowers },
          },
        )
        if (result.partial) {
          await alertDialog('部分应用失败，请查看 LogsView 日志', {
            title: '工作流应用部分失败',
            variant: 'danger',
          })
        }
      } else if (wantsSuperpowers && !status.superpowers.enabled) {
        // 用户只想加 Superpowers，模式仍为"无"——单独 apply superpowers
        await logAction(
          'project',
          'apply-workflow',
          () => api.applyWorkflow(project.id, { superpowers: true }),
          { projectId: project.id, meta: { superpowers: true } },
        )
      } else if (!wantsSuperpowers && status.superpowers.enabled && wantsMode === null) {
        // 用户只想去掉 Superpowers，模式仍为"无"——单独 remove superpowers
        await logAction(
          'project',
          'remove-workflow',
          () => api.removeWorkflow(project.id, { superpowers: true }),
          { projectId: project.id, meta: { superpowers: false } },
        )
      } else if (!needsApply) {
        // 用户没改任何东西，直接走 refresh 拉最新状态即可
      }

      // Optimistic local mirror so侧栏互斥渲染（T15）立刻响应。
      setWorkflowMode(project.id, wantsMode)
      await refresh()
    } catch (e: unknown) {
      await alertDialog(
        `应用失败: ${e instanceof Error ? e.message : String(e)}`,
        { title: '应用工作流失败', variant: 'danger' },
      )
    } finally {
      setBusy(false)
    }
  }

  async function removeAllClick() {
    if (busy || !status || status.applied === 'none') return
    const detectedMode = status.detectedMode
    const ok = await confirmDialog(
      detectedMode === 'openspec'
        ? '会撤销 OpenSpec 脚手架（保留 openspec/changes 目录里你已写入的内容；只删 AGENTS.md 与空白脚手架）以及已拷的 Harness 文件夹。'
        : '会撤销 CLAUDE.md 中工作流段落（含其后所有内容）以及 Harness 拷贝的文件夹（.aimon/skills、.aimon/docs、.claude/agents、CUSTOMIZE 等）。请先备份你写过的内容。',
      { title: '卸载工作流', confirmLabel: '确认卸载', variant: 'danger' },
    )
    if (!ok) return
    setBusy(true)
    try {
      await logAction(
        'project',
        'remove-workflow',
        () =>
          api.removeWorkflow(project.id, {
            ...(detectedMode ? { mode: detectedMode } : {}),
            ...(status.superpowers.enabled ? { superpowers: true } : {}),
          }),
        { projectId: project.id },
      )
      setWorkflowMode(project.id, null)
      await refresh()
    } catch (e: unknown) {
      await alertDialog(
        `卸载失败: ${e instanceof Error ? e.message : String(e)}`,
        { title: '卸载工作流失败', variant: 'danger' },
      )
    } finally {
      setBusy(false)
    }
  }

  const claudeMdExists = status?.devDocs.claudeMdExists ?? false

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      <div className="text-xs text-muted leading-relaxed">
        项目工作流：选 <strong>Dev Docs</strong>（plan → context → tasks 三段式）
        或 <strong>OpenSpec</strong>（proposal → design → tasks 提案式），
        系统会往项目根 <code className="font-mono">CLAUDE.md</code> 写守则段落，
        并把可复用配置目录拷进项目；切回"无"会反向撤销。
        <strong> Superpowers</strong> 与上面二选一正交，只在 CLAUDE.md 写一段引导提示。
      </div>

      <div className="rounded border border-border/60 bg-bg/30 p-3 space-y-3">
        <div className="text-sm text-fg/90">项目工作流</div>
        <div className="text-[11px] text-muted leading-relaxed">
          {claudeMdExists
            ? '当前项目 CLAUDE.md 已存在；应用会在文件末尾追加工作流段落。'
            : '当前项目暂无 CLAUDE.md；应用会自动创建。'}
        </div>

        {loadError && (
          <div className="text-xs text-rose-300">读取状态失败: {loadError}</div>
        )}
        {!status && !loadError && (
          <div className="text-xs text-muted">加载中…</div>
        )}

        {status && (
          <>
            <div className="text-[11px] text-muted leading-relaxed">
              当前状态：模式{' '}
              <span className="text-fg/85">
                {status.detectedMode === 'dev-docs'
                  ? 'Dev Docs'
                  : status.detectedMode === 'openspec'
                    ? 'OpenSpec'
                    : '无'}
              </span>
              {' · '}
              整体{' '}
              {status.applied === 'full' ? (
                <span className="text-emerald-300">已应用</span>
              ) : status.applied === 'partial' ? (
                <span className="text-amber-300">部分已应用</span>
              ) : (
                <span className="text-muted">未应用</span>
              )}
              {' · '}
              Superpowers{' '}
              <span
                className={
                  status.superpowers.enabled
                    ? 'text-emerald-300'
                    : 'text-muted'
                }
              >
                {status.superpowers.enabled ? '已启用' : '未启用'}
              </span>
            </div>

            <label className="block">
              <span className="block text-xs text-muted mb-1">规范工作流</span>
              <select
                value={choice}
                onChange={(e) => setChoice(e.target.value as WorkflowChoice)}
                disabled={busy}
                className="w-full px-2 py-1.5 bg-white/[0.04] border border-border rounded-md text-xs focus:border-accent focus:bg-white/[0.06] transition-colors disabled:opacity-50"
              >
                <option value="dev-docs">Dev Docs（plan / context / tasks 三段式）</option>
                <option value="openspec">OpenSpec（proposal / design / tasks 提案式）</option>
                <option value="none">无（不装配规范工作流）</option>
              </select>
            </label>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={superpowersChoice}
                onChange={(e) => setSuperpowersChoice(e.target.checked)}
                disabled={busy}
                className="mt-0.5 accent-accent"
              />
              <span className="text-xs leading-snug">
                <span className="text-fg font-medium">启用 Superpowers 7 步流程提示</span>
                <span className="block text-[11px] text-muted mt-0.5">
                  在 <code className="font-mono">CLAUDE.md</code> 写引导段；
                  真正约束需在 Claude Code 插件市场装 Superpowers 本体。
                </span>
              </span>
            </label>

            <div className="flex items-center justify-end gap-2">
              {status.applied !== 'none' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeAllClick()}
                  className="fluent-btn px-3 py-1 text-xs rounded-md border border-rose-700/60 text-rose-300 hover:bg-rose-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy ? '处理中…' : '卸载全部'}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void applyWorkflowClick()}
                className="fluent-btn px-3 py-1 text-xs rounded-md bg-accent text-on-accent font-medium hover:bg-accent-2 border border-accent/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy ? '处理中…' : '应用 / 切换'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ToolsTab() {
  const [status, setStatus] = useState<GstackStatus | null>(null)
  const [busy, setBusy] = useState<null | 'install' | 'update' | 'uninstall'>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [trailing, setTrailing] = useState<string | null>(null)

  async function refresh() {
    try {
      const s = await api.getGstackStatus()
      setStatus(s)
      setLoadError(null)
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    let cancelled = false
    setStatus(null)
    setLoadError(null)
    api
      .getGstackStatus()
      .then((s) => {
        if (cancelled) return
        setStatus(s)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function runAction(
    action: 'install' | 'update' | 'uninstall',
    confirmMsg?: string,
  ) {
    if (busy) return
    if (confirmMsg) {
      const ok = await confirmDialog(confirmMsg, {
        title: '确认',
        confirmLabel: '确认',
        variant: action === 'uninstall' ? 'danger' : undefined,
      })
      if (!ok) return
    }
    setBusy(action)
    setTrailing(null)
    try {
      const result = await logAction(
        'installer',
        `gstack-${action}`,
        () =>
          action === 'install'
            ? api.installGstack()
            : action === 'update'
              ? api.updateGstack()
              : api.uninstallGstack(),
        {},
      )
      setStatus(result.status)
      if (result.trailingLog) setTrailing(result.trailingLog)
      if (!result.ok) {
        await alertDialog(
          [
            `操作失败 (${result.errorCode ?? 'unknown'})`,
            result.errorMessage ?? '',
            result.trailingLog ? `\n--- 末尾日志 ---\n${result.trailingLog}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          { title: 'gstack 操作失败', variant: 'danger' },
        )
      }
    } catch (e: unknown) {
      await alertDialog(
        `操作失败: ${e instanceof Error ? e.message : String(e)}`,
        { title: 'gstack 操作失败', variant: 'danger' },
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      <div className="text-xs text-muted leading-relaxed">
        <strong>gstack</strong>（28 个 Claude Code 技能集合，含
        <code className="mx-0.5 font-mono">/browse</code>
        <code className="mx-0.5 font-mono">/qa</code>
        <code className="mx-0.5 font-mono">/ship</code>
        等）。安装后会 git clone 到
        <code className="mx-0.5 font-mono">~/.claude/skills/gstack</code>
        并跑 <code className="mx-0.5 font-mono">bun ./setup</code>，触发方式仍是在 Claude
        会话里打 slash 命令。需要本机有 <code className="font-mono">git</code> 和
        <code className="mx-0.5 font-mono">bun</code>。
      </div>

      <div className="rounded border border-border/60 bg-bg/30 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm text-fg/90">gstack</div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy != null}
            className="fluent-btn px-2 py-0.5 text-[11px] rounded border border-border text-muted hover:text-fg hover:bg-white/[0.06] disabled:opacity-50"
          >
            刷新状态
          </button>
        </div>

        {loadError && (
          <div className="text-xs text-rose-300">读取状态失败: {loadError}</div>
        )}
        {!status && !loadError && (
          <div className="text-xs text-muted">加载中…</div>
        )}

        {status && (
          <>
            <div className="text-[11px] text-muted leading-relaxed space-y-0.5">
              <div>
                <span className="text-fg/70 mr-1">状态：</span>
                {status.installed ? (
                  <span className="text-emerald-300">
                    ✓ 已安装{status.version ? `（${status.version}）` : ''}
                  </span>
                ) : (
                  <span className="text-muted">未安装</span>
                )}
              </div>
              <div>
                <span className="text-fg/70 mr-1">位置：</span>
                <code className="font-mono">{status.location}</code>
              </div>
              <div>
                <span className="text-fg/70 mr-1">git：</span>
                {status.gitAvailable ? (
                  <span className="text-emerald-300">可用</span>
                ) : (
                  <span className="text-rose-300">缺失（需先安装 git）</span>
                )}
                <span className="mx-2 text-subtle">·</span>
                <span className="text-fg/70 mr-1">bun：</span>
                {status.bunAvailable ? (
                  <span className="text-emerald-300">可用</span>
                ) : (
                  <a
                    href="https://bun.sh"
                    target="_blank"
                    rel="noreferrer"
                    className="text-amber-300 underline hover:text-amber-200"
                  >
                    缺失（点此到 bun.sh 安装）
                  </a>
                )}
              </div>
              <div>
                <span className="text-fg/70 mr-1">仓库：</span>
                <code className="font-mono break-all">{status.repoUrl}</code>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={
                  busy != null ||
                  status.installed ||
                  !status.gitAvailable ||
                  !status.bunAvailable
                }
                onClick={() => void runAction('install')}
                className="fluent-btn px-3 py-1 text-xs rounded-md bg-accent text-on-accent font-medium hover:bg-accent-2 border border-accent/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy === 'install' ? '安装中…' : '安装'}
              </button>
              <button
                type="button"
                disabled={busy != null || !status.installed}
                onClick={() => void runAction('update')}
                className="fluent-btn px-3 py-1 text-xs rounded-md border border-border bg-white/[0.03] text-fg hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy === 'update' ? '更新中…' : '更新'}
              </button>
              <button
                type="button"
                disabled={busy != null || !status.installed}
                onClick={() =>
                  void runAction('uninstall', '会删除 ~/.claude/skills/gstack 目录。继续？')
                }
                className="fluent-btn px-3 py-1 text-xs rounded-md border border-rose-700/60 text-rose-300 hover:bg-rose-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy === 'uninstall' ? '卸载中…' : '卸载'}
              </button>
              <button
                type="button"
                disabled={busy != null}
                onClick={() => void refresh()}
                className="fluent-btn px-3 py-1 text-xs rounded-md border border-border bg-white/[0.03] text-muted hover:text-fg hover:bg-white/[0.08] disabled:opacity-50"
              >
                查看状态
              </button>
            </div>

            {trailing && (
              <pre className="mt-1 max-h-40 overflow-auto text-[10.5px] font-mono text-muted bg-black/30 border border-border/60 rounded px-2 py-1.5 whitespace-pre-wrap">
                {trailing}
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function PostSaveRestartDialog({
  sessions,
  onClose,
}: {
  sessions: Session[]
  onClose: () => void
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(sessions.map((s) => s.id)))
  const [busy, setBusy] = useState(false)

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function restartSelected() {
    if (picked.size === 0) {
      onClose()
      return
    }
    setBusy(true)
    const errors: string[] = []
    for (const id of picked) {
      try {
        await api.restartSession(id)
      } catch (e) {
        errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    setBusy(false)
    if (errors.length > 0) {
      await alertDialog(`部分重启失败:\n${errors.join('\n')}`, {
        title: '部分重启失败',
        variant: 'danger',
      })
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm">
      <div className="fluent-acrylic rounded-win w-[480px] max-w-full shadow-dialog animate-fluent-in">
        <div className="px-4 py-3 border-b border-border/60">
          <div className="text-base font-display font-semibold text-fg">配置已保存</div>
          <div className="text-xs text-muted mt-0.5">
            检测到 {sessions.length} 个进行中的 session。重启才能让新权限对这些 session 生效。
          </div>
        </div>
        <div className="p-3 max-h-[240px] overflow-auto">
          {sessions.map((s) => (
            <label
              key={s.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.05] cursor-pointer"
            >
              <input
                type="checkbox"
                checked={picked.has(s.id)}
                onChange={() => togglePick(s.id)}
                className="accent-accent"
              />
              <span className="text-sm">🤖 {s.agent}</span>
              <span className="text-xs text-subtle">({s.status})</span>
              <span className="text-xs text-subtle ml-auto font-mono">…{s.id.slice(-6)}</span>
            </label>
          ))}
        </div>
        <div className="px-4 py-3 border-t border-border/60 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="fluent-btn px-3 py-1.5 text-sm rounded-md border border-border bg-white/[0.03] text-muted hover:bg-white/[0.08] hover:text-fg"
          >
            稍后重启
          </button>
          <button
            onClick={() => void restartSelected()}
            disabled={busy || picked.size === 0}
            className="fluent-btn px-3 py-1.5 text-sm rounded-md bg-accent text-on-accent font-medium hover:bg-accent-2 border border-accent/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] disabled:opacity-50"
          >
            {busy ? '重启中…' : `重启选中 (${picked.size})`}
          </button>
        </div>
      </div>
    </div>
  )
}
