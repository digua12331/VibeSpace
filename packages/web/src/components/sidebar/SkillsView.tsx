import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import * as api from '../../api'
import { alertDialog, confirmDialog, promptDialog } from '../dialog/DialogHost'
import { logAction } from '../../logs'
import {
  SKILL_AGENT_LABELS,
  SKILL_AGENT_TYPES,
  type LibrarySkillEntry,
  type LocalLibrary,
  type MarketSearchResult,
  type MarketSkill,
  type SkillAgentType,
  type SkillCatalogResult,
  type SkillEntry,
  type SkillMarketSearchSource,
} from '../../types'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'
type Mode = 'catalog' | 'market'

export default function SkillsView() {
  const projectId = useStore((s) => s.selectedProjectId)
  const projects = useStore((s) => s.projects)
  const project = projects.find((p) => p.id === projectId)

  const [mode, setMode] = useState<Mode>('catalog')
  const [agent, setAgent] = useState<SkillAgentType>('claude-code')
  const [data, setData] = useState<SkillCatalogResult | null>(null)
  const [state, setState] = useState<LoadState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [useSymlink, setUseSymlink] = useState(false)

  const [library, setLibrary] = useState<LocalLibrary | null>(null)
  const [libState, setLibState] = useState<LoadState>('idle')
  const [libError, setLibError] = useState<string | null>(null)

  const [marketQ, setMarketQ] = useState('')
  const [marketSource, setMarketSource] = useState<SkillMarketSearchSource>('all')
  const [marketResult, setMarketResult] = useState<MarketSearchResult | null>(null)
  const [marketState, setMarketState] = useState<LoadState>('idle')
  const [marketError, setMarketError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState<
    | 'lib-install'
    | 'lib-delete'
    | 'global-install'
    | 'project-uninstall'
    | null
  >(null)

  async function refreshCatalog(pid: string, ag: SkillAgentType) {
    setState('loading')
    setError(null)
    try {
      const r = await api.scanSkillCatalog(pid, ag)
      setData(r)
      setState('ready')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setState('error')
    }
  }

  async function refreshLibrary() {
    setLibState('loading')
    setLibError(null)
    try {
      const r = await api.getSkillLibrary()
      setLibrary(r)
      setLibState('ready')
    } catch (e: unknown) {
      setLibError(e instanceof Error ? e.message : String(e))
      setLibState('error')
    }
  }

  useEffect(() => {
    if (!projectId) return
    if (mode !== 'catalog') return
    refreshCatalog(projectId, agent).catch(() => {
      /* state already records the error */
    })
  }, [projectId, agent, mode])

  useEffect(() => {
    if (mode !== 'catalog') return
    refreshLibrary().catch(() => {
      /* state already records the error */
    })
  }, [mode])

  async function onInstall(srcPath: string, srcId: string) {
    if (!projectId) return
    try {
      await logAction(
        'skill-catalog',
        'add',
        () =>
          api.addSkillToProject(projectId, agent, {
            srcPath,
            useSymlink,
          }),
        { projectId, meta: { agent, src: srcId, useSymlink } },
      )
      await refreshCatalog(projectId, agent)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      await alertDialog(msg, { title: '安装失败', variant: 'danger' })
    }
  }

  async function onUninstall(skill: SkillEntry) {
    if (!projectId) return
    const ok = await confirmDialog(
      `从项目卸载 "${skill.name}"？${skill.isSymlink ? '（这是一个链接，仅会断开链接，不会删除全局副本）' : '（会删除项目下的整个 skill 文件夹）'}`,
      { title: '卸载技能', confirmLabel: '卸载', variant: 'danger' },
    )
    if (!ok) return
    try {
      await logAction(
        'skill-catalog',
        'remove',
        () =>
          api.removeSkillFromProject(projectId, agent, {
            skillName: skill.id,
          }),
        { projectId, meta: { agent, skill: skill.id } },
      )
      await refreshCatalog(projectId, agent)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      await alertDialog(msg, { title: '卸载失败', variant: 'danger' })
    }
  }

  async function onAddFromPath() {
    if (!projectId) return
    const input = await promptDialog(
      '粘贴磁盘上一个 skill 文件夹的绝对路径（必须含 SKILL.md）：',
      {
        title: '从路径添加技能',
        placeholder: 'F:\\path\\to\\some-skill',
        defaultValue: '',
      },
    )
    if (!input || !input.trim()) return
    try {
      await logAction(
        'skill-catalog',
        'add-from-path',
        () =>
          api.addSkillToProject(projectId, agent, {
            srcPath: input.trim(),
            useSymlink,
          }),
        { projectId, meta: { agent, srcPath: input.trim(), useSymlink } },
      )
      await refreshCatalog(projectId, agent)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      await alertDialog(msg, { title: '添加失败', variant: 'danger' })
    }
  }

  async function onDeleteLibraryItem(s: LibrarySkillEntry) {
    if (bulkBusy) return
    const ok = await confirmDialog(
      `从本地库删除 "${s.name}"？这会从磁盘删除整个 skill 文件夹。\n（不影响已经装到项目里的副本）`,
      { title: '从本地库删除', confirmLabel: '删除', variant: 'danger' },
    )
    if (!ok) return
    try {
      await logAction(
        'skill-market',
        'delete-library',
        () => api.deleteLibrarySkill({ name: s.id, source: s.source }),
        { meta: { name: s.id, source: s.source } },
      )
      await refreshLibrary()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      await alertDialog(msg, { title: '删除失败', variant: 'danger' })
    }
  }

  async function onBulkInstallLibrary(items: LibrarySkillEntry[]) {
    if (!projectId || items.length === 0 || bulkBusy) return
    setBulkBusy('lib-install')
    let okN = 0
    let fail = 0
    const errors: string[] = []
    try {
      for (const s of items) {
        try {
          await logAction(
            'skill-catalog',
            'add',
            () =>
              api.addSkillToProject(projectId, agent, {
                srcPath: s.path,
                useSymlink,
              }),
            { projectId, meta: { agent, src: s.id, useSymlink, bulk: true } },
          )
          okN += 1
        } catch (e: unknown) {
          fail += 1
          errors.push(`${s.name}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      await refreshCatalog(projectId, agent)
      if (fail === 0) {
        await alertDialog(`已安装 ${okN} 个 skill 到本项目。`, { title: '全部装到本项目' })
      } else {
        await alertDialog(
          `成功 ${okN} 个，失败 ${fail} 个：\n${errors.slice(0, 6).join('\n')}${
            errors.length > 6 ? '\n…' : ''
          }`,
          { title: '部分失败', variant: 'danger' },
        )
      }
    } finally {
      setBulkBusy(null)
    }
  }

  async function onBulkDeleteLibrary(items: LibrarySkillEntry[], groupKey: string) {
    if (items.length === 0 || bulkBusy) return
    const ok = await confirmDialog(
      `从本地库删除 "${groupKey}" 整组（${items.length} 个）？\n会从磁盘删除 ${items.length} 个 skill 文件夹。\n（不影响已经装到项目里的副本）`,
      { title: '从本地库删除整组', confirmLabel: '全部删除', variant: 'danger' },
    )
    if (!ok) return
    setBulkBusy('lib-delete')
    let okN = 0
    let fail = 0
    const errors: string[] = []
    try {
      for (const s of items) {
        try {
          await logAction(
            'skill-market',
            'delete-library',
            () => api.deleteLibrarySkill({ name: s.id, source: s.source }),
            { meta: { name: s.id, source: s.source, bulk: true } },
          )
          okN += 1
        } catch (e: unknown) {
          fail += 1
          errors.push(`${s.name}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      await refreshLibrary()
      if (fail === 0) {
        await alertDialog(`已从本地库删除 ${okN} 个 skill。`, { title: '全部卸载' })
      } else {
        await alertDialog(
          `成功 ${okN} 个，失败 ${fail} 个：\n${errors.slice(0, 6).join('\n')}${
            errors.length > 6 ? '\n…' : ''
          }`,
          { title: '部分失败', variant: 'danger' },
        )
      }
    } finally {
      setBulkBusy(null)
    }
  }

  async function onBulkInstallFromGlobal(items: SkillEntry[]) {
    if (!projectId || items.length === 0 || bulkBusy) return
    setBulkBusy('global-install')
    let okN = 0
    let fail = 0
    const errors: string[] = []
    try {
      for (const s of items) {
        try {
          await logAction(
            'skill-catalog',
            'add',
            () =>
              api.addSkillToProject(projectId, agent, {
                srcPath: s.path,
                useSymlink,
              }),
            { projectId, meta: { agent, src: s.id, useSymlink, bulk: true } },
          )
          okN += 1
        } catch (e: unknown) {
          fail += 1
          errors.push(`${s.name}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      await refreshCatalog(projectId, agent)
      if (fail === 0) {
        await alertDialog(`已安装 ${okN} 个 skill 到本项目。`, { title: '全部装到本项目' })
      } else {
        await alertDialog(
          `成功 ${okN} 个，失败 ${fail} 个：\n${errors.slice(0, 6).join('\n')}${
            errors.length > 6 ? '\n…' : ''
          }`,
          { title: '部分失败', variant: 'danger' },
        )
      }
    } finally {
      setBulkBusy(null)
    }
  }

  async function onBulkUninstallFromProject(items: SkillEntry[], groupKey: string) {
    if (!projectId || items.length === 0 || bulkBusy) return
    const ok = await confirmDialog(
      `从项目卸载 "${groupKey}" 整组（${items.length} 个）？\n（链接会断开链接，复制副本会删除整个 skill 文件夹）`,
      { title: '从项目卸载整组', confirmLabel: '全部卸载', variant: 'danger' },
    )
    if (!ok) return
    setBulkBusy('project-uninstall')
    let okN = 0
    let fail = 0
    const errors: string[] = []
    try {
      for (const s of items) {
        try {
          await logAction(
            'skill-catalog',
            'remove',
            () =>
              api.removeSkillFromProject(projectId, agent, {
                skillName: s.id,
              }),
            { projectId, meta: { agent, skill: s.id, bulk: true } },
          )
          okN += 1
        } catch (e: unknown) {
          fail += 1
          errors.push(`${s.name}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
      await refreshCatalog(projectId, agent)
      if (fail === 0) {
        await alertDialog(`已从项目卸载 ${okN} 个 skill。`, { title: '全部卸载' })
      } else {
        await alertDialog(
          `成功 ${okN} 个，失败 ${fail} 个：\n${errors.slice(0, 6).join('\n')}${
            errors.length > 6 ? '\n…' : ''
          }`,
          { title: '部分失败', variant: 'danger' },
        )
      }
    } finally {
      setBulkBusy(null)
    }
  }

  async function onChangeLibraryPath() {
    const cur = library?.path ?? ''
    const input = await promptDialog(
      `当前本地库路径：\n${cur}\n\n输入新路径（会作为下次下载的落点；不会自动迁移已有内容）：`,
      {
        title: '修改本地库路径',
        placeholder: 'C:\\Users\\you\\SkillManager',
        defaultValue: cur,
      },
    )
    if (!input || !input.trim() || input.trim() === cur) return
    try {
      await logAction(
        'skill-market',
        'set-library-path',
        () => api.setSkillLibraryPath({ path: input.trim() }),
        { meta: { newPath: input.trim() } },
      )
      await refreshLibrary()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      await alertDialog(msg, { title: '修改路径失败', variant: 'danger' })
    }
  }

  async function onSearchMarket() {
    setMarketState('loading')
    setMarketError(null)
    try {
      const r = await logAction(
        'skill-market',
        'search',
        () => api.searchSkillMarket(marketQ.trim(), marketSource),
        { meta: { q: marketQ.trim(), source: marketSource } },
      )
      setMarketResult(r)
      setMarketState('ready')
    } catch (e: unknown) {
      setMarketError(e instanceof Error ? e.message : String(e))
      setMarketState('error')
    }
  }

  async function onDownload(s: MarketSkill) {
    if (downloading) return
    setDownloading(s.id)
    try {
      const r = await logAction(
        'skill-market',
        'download',
        () =>
          api.downloadSkillFromMarket({
            repoUrl: s.repoUrl,
            skillName: deriveSkillName(s),
          }),
        { meta: { repoUrl: s.repoUrl, skillName: deriveSkillName(s) } },
      )
      await alertDialog(
        `已下载到本地库：\n${r.path}\n（${formatBytes(r.sizeBytes)}, ${r.fileCount} 个文件）\n\n切回"目录视图"在"本地库"栏可以装到当前项目。`,
        { title: '下载成功' },
      )
      // Pre-warm library so it's ready when user switches mode.
      await refreshLibrary()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      await alertDialog(msg, { title: '下载失败', variant: 'danger' })
    } finally {
      setDownloading(null)
    }
  }

  if (!projectId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-sm text-muted text-center">
        <div>请先在左侧「项目」列表中选中一个项目</div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Mode switch */}
      <div className="flex items-center gap-1 px-2 pt-2 border-b border-border/40 pb-2">
        <button
          onClick={() => setMode('catalog')}
          className={`fluent-btn px-2.5 py-1 text-[12px] rounded ${
            mode === 'catalog'
              ? 'bg-white/[0.08] text-fg'
              : 'text-muted hover:text-fg hover:bg-white/[0.04]'
          }`}
        >
          目录视图
        </button>
        <button
          onClick={() => setMode('market')}
          className={`fluent-btn px-2.5 py-1 text-[12px] rounded ${
            mode === 'market'
              ? 'bg-white/[0.08] text-fg'
              : 'text-muted hover:text-fg hover:bg-white/[0.04]'
          }`}
        >
          🛒 市场搜索
        </button>
      </div>

      {mode === 'catalog' && (
        <>
          {/* Agent tabs */}
          <div className="flex items-center gap-0.5 px-2 pt-2">
            {SKILL_AGENT_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setAgent(t)}
                className={`fluent-btn px-2.5 py-1 text-[12px] rounded ${
                  agent === t
                    ? 'bg-white/[0.08] text-fg'
                    : 'text-muted hover:text-fg hover:bg-white/[0.04]'
                }`}
              >
                {SKILL_AGENT_LABELS[t]}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={() => projectId && refreshCatalog(projectId, agent)}
              className="fluent-btn px-2 py-1 text-[11px] rounded text-muted hover:text-fg hover:bg-white/[0.04]"
              title="刷新"
            >
              ⟳
            </button>
          </div>

          {/* Toolbar */}
          <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-subtle">
            <label className="inline-flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={useSymlink}
                onChange={(e) => setUseSymlink(e.target.checked)}
              />
              <span title="勾上后，安装走符号链接（symlink，类似 Windows 快捷方式）；不勾走复制。Windows 普通用户没权限做 symlink，会自动回退到复制。">
                链接模式
              </span>
            </label>
            <button
              onClick={onAddFromPath}
              className="fluent-btn ml-auto px-2 py-0.5 text-[11px] rounded border border-border hover:bg-white/[0.04]"
            >
              + 从路径添加
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            {state === 'loading' && (
              <div className="px-3 py-2 text-[12px] text-muted">扫描中…</div>
            )}
            {state === 'error' && (
              <div className="px-3 py-2 text-[12px] text-rose-300">
                扫描失败：{error}
              </div>
            )}
            {state === 'ready' && data && (
              <>
                <SkillSection
                  title="项目技能"
                  hint={`位于 ${project?.path ?? ''} 下 ${projectSubDirHint(agent)}`}
                  skills={data.project}
                  renderAction={(s) => (
                    <button
                      onClick={() => onUninstall(s)}
                      disabled={bulkBusy != null}
                      className="fluent-btn text-[11px] px-2 py-0.5 rounded border border-rose-700/40 text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
                    >
                      卸载
                    </button>
                  )}
                  renderBulkAction={(items, prefix) => (
                    <button
                      onClick={() => onBulkUninstallFromProject(items, prefix)}
                      disabled={bulkBusy != null}
                      className="fluent-btn text-[11px] px-2 py-0.5 rounded border border-rose-700/40 text-rose-200 hover:bg-rose-500/10 disabled:opacity-50 shrink-0"
                      title="把这组每个 skill 都从项目里卸载"
                    >
                      {bulkBusy === 'project-uninstall' ? '卸载中…' : '全部卸载'}
                    </button>
                  )}
                  emptyMessage='暂无（点下面"装到本项目"按钮即可）'
                />
                <SkillSection
                  title="全局技能"
                  hint={globalDirHint(agent)}
                  skills={data.global}
                  renderAction={(s) => (
                    <button
                      onClick={() => onInstall(s.path, s.id)}
                      disabled={bulkBusy != null}
                      className="fluent-btn text-[11px] px-2 py-0.5 rounded border border-emerald-700/40 text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-50"
                    >
                      装到本项目
                    </button>
                  )}
                  renderBulkAction={(items) => (
                    <button
                      onClick={() => onBulkInstallFromGlobal(items)}
                      disabled={bulkBusy != null}
                      className="fluent-btn text-[11px] px-2 py-0.5 rounded border border-emerald-700/40 text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-50 shrink-0"
                      title="把这组每个 skill 都装到本项目"
                    >
                      {bulkBusy === 'global-install' ? '安装中…' : '全部装'}
                    </button>
                  )}
                  emptyMessage="暂无"
                />
                <LibrarySection
                  library={library}
                  state={libState}
                  error={libError}
                  onInstall={(s) => onInstall(s.path, s.id)}
                  onDelete={onDeleteLibraryItem}
                  onBulkInstall={onBulkInstallLibrary}
                  onBulkDelete={onBulkDeleteLibrary}
                  bulkBusy={bulkBusy}
                  onChangePath={onChangeLibraryPath}
                  onRefresh={refreshLibrary}
                />
              </>
            )}
          </div>
        </>
      )}

      {mode === 'market' && (
        <>
          {/* Search bar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40">
            <input
              value={marketQ}
              onChange={(e) => setMarketQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSearchMarket()
              }}
              placeholder="搜索关键词（留空显示热门）"
              className="flex-1 px-2 py-1 text-[12px] rounded bg-white/[0.04] border border-border outline-none focus:border-accent"
            />
            <select
              value={marketSource}
              onChange={(e) =>
                setMarketSource(e.target.value as SkillMarketSearchSource)
              }
              className="px-1.5 py-1 text-[11px] rounded bg-white/[0.04] border border-border"
              title="来源"
            >
              <option value="all">全部</option>
              <option value="github">GitHub</option>
              <option value="skills-sh">skills.sh</option>
            </select>
            <button
              onClick={onSearchMarket}
              disabled={marketState === 'loading'}
              className="fluent-btn px-2.5 py-1 text-[12px] rounded border border-border hover:bg-white/[0.04] disabled:opacity-50"
            >
              搜索
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            {marketState === 'idle' && (
              <div className="px-3 py-3 text-[12px] text-muted">
                输入关键词后回车，或点搜索按钮。<br />
                <span className="text-[11px]">
                  会查 GitHub topic:skill 和 skills.sh 上的开源 skill；只在你点搜索时才联网。
                </span>
              </div>
            )}
            {marketState === 'loading' && (
              <div className="px-3 py-2 text-[12px] text-muted">搜索中…</div>
            )}
            {marketState === 'error' && (
              <div className="px-3 py-2 text-[12px] text-rose-300">
                搜索失败：{marketError}
              </div>
            )}
            {marketState === 'ready' && marketResult && (
              <MarketResults
                result={marketResult}
                downloading={downloading}
                onDownload={onDownload}
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function projectSubDirHint(agent: SkillAgentType): string {
  switch (agent) {
    case 'claude-code':
      return '.claude/skills/'
    case 'codex':
      return '.codex/skills/'
    case 'opencode':
      return '.opencode/skill[s]/'
  }
}

function globalDirHint(agent: SkillAgentType): string {
  switch (agent) {
    case 'claude-code':
      return '~/.claude/skills/'
    case 'codex':
      return '~/.codex/skills/'
    case 'opencode':
      return '~/.config/opencode/skill[s]/、~/.agents/skill[s]/'
  }
}

function deriveSkillName(s: MarketSkill): string {
  // GitHub repo "name" is already the rightmost segment; skills.sh uses author/name
  // pattern in repoUrl, so fall back to last URL segment.
  if (s.name) return s.name.replace(/[^A-Za-z0-9_.\-]+/g, '-').slice(0, 200)
  const last = s.repoUrl.split('/').filter(Boolean).pop() ?? 'skill'
  return last.replace(/\.git$/, '').replace(/[^A-Za-z0-9_.\-]+/g, '-')
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// Same-prefix grouping helper: split each name on first '-' and group by left
// part. Singleton groups render flat (no header); ≥2-item groups become a
// collapsible row with a bulk-action area. Used so multi-skill collections
// like "gstack" + "gstack-*" siblings collapse into one entry.
function groupByPrefix<T extends { id: string; name: string }>(
  items: T[],
): Array<{ key: string; items: T[] }> {
  const map = new Map<string, T[]>()
  for (const s of items) {
    const prefix = s.name.split('-')[0] || s.name
    const arr = map.get(prefix)
    if (arr) arr.push(s)
    else map.set(prefix, [s])
  }
  const groups: Array<{ key: string; items: T[] }> = []
  for (const [key, gItems] of map) {
    groups.push({
      key,
      items: [...gItems].sort((a, b) => a.name.localeCompare(b.name)),
    })
  }
  groups.sort((a, b) => a.key.localeCompare(b.key))
  return groups
}

interface SkillSectionProps {
  title: string
  hint: string
  skills: SkillEntry[]
  renderAction: (s: SkillEntry) => React.ReactNode
  renderBulkAction?: (items: SkillEntry[], prefix: string) => React.ReactNode
  emptyMessage: string
}

function SkillSection({
  title,
  hint,
  skills,
  renderAction,
  renderBulkAction,
  emptyMessage,
}: SkillSectionProps) {
  const groups = groupByPrefix(skills)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  return (
    <section className="border-b border-border/40">
      <div className="px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-subtle font-medium flex items-center gap-2">
        <span>{title}</span>
        <span className="text-[10px] text-muted normal-case tracking-normal font-normal truncate">
          {hint}
        </span>
      </div>
      {skills.length === 0 ? (
        <div className="px-3 py-2 text-[12px] text-muted">{emptyMessage}</div>
      ) : (
        <ul className="pb-2">
          {groups.map((g) => {
            if (g.items.length === 1) {
              return (
                <SkillItemRow
                  key={`${g.items[0].source}:${g.items[0].id}`}
                  item={g.items[0]}
                  renderAction={renderAction}
                  indent={false}
                />
              )
            }
            const open = expanded.has(g.key)
            return (
              <li key={`group:${g.key}`}>
                <div className="px-3 py-1.5 hover:bg-white/[0.03] flex items-center gap-1.5 border-t border-border/20">
                  <button
                    onClick={() => toggle(g.key)}
                    className="fluent-btn text-[10px] text-muted hover:text-fg w-3.5 text-center shrink-0"
                    title={open ? '折叠' : '展开'}
                  >
                    {open ? '▼' : '▶'}
                  </button>
                  <span
                    className="text-[12.5px] font-medium truncate cursor-pointer"
                    onClick={() => toggle(g.key)}
                    title={`${g.key} 集合（${g.items.length} 个）`}
                  >
                    {g.key}
                  </span>
                  <span className="text-[10px] text-muted shrink-0">
                    （{g.items.length} 个）
                  </span>
                  <div className="flex-1" />
                  {renderBulkAction ? renderBulkAction(g.items, g.key) : null}
                </div>
                {open && (
                  <ul>
                    {g.items.map((s) => (
                      <SkillItemRow
                        key={`${s.source}:${s.id}`}
                        item={s}
                        renderAction={renderAction}
                        indent={true}
                      />
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

interface SkillItemRowProps {
  item: SkillEntry
  renderAction: (s: SkillEntry) => React.ReactNode
  indent: boolean
}

function SkillItemRow({ item: s, renderAction, indent }: SkillItemRowProps) {
  return (
    <li
      className={`${indent ? 'pl-7 pr-3' : 'px-3'} py-1.5 hover:bg-white/[0.03] flex items-start gap-2`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] flex items-center gap-1.5">
          <span className="truncate" title={s.path}>
            {s.name}
          </span>
          {s.isSymlink && (
            <span
              className="text-[9px] px-1 rounded border border-border bg-white/[0.04] text-muted"
              title="这是个符号链接（symlink），不是真实副本"
            >
              链接
            </span>
          )}
        </div>
        {s.description && (
          <div className="text-[11px] text-subtle truncate" title={s.description}>
            {s.description}
          </div>
        )}
      </div>
      <div className="shrink-0">{renderAction(s)}</div>
    </li>
  )
}

type BulkBusy =
  | 'lib-install'
  | 'lib-delete'
  | 'global-install'
  | 'project-uninstall'
  | null

interface LibrarySectionProps {
  library: LocalLibrary | null
  state: LoadState
  error: string | null
  onInstall: (s: LibrarySkillEntry) => void
  onDelete: (s: LibrarySkillEntry) => void
  onBulkInstall: (items: LibrarySkillEntry[]) => void
  onBulkDelete: (items: LibrarySkillEntry[], groupKey: string) => void
  bulkBusy: BulkBusy
  onChangePath: () => void
  onRefresh: () => void
}

function LibrarySection({
  library,
  state,
  error,
  onInstall,
  onDelete,
  onBulkInstall,
  onBulkDelete,
  bulkBusy,
  onChangePath,
  onRefresh,
}: LibrarySectionProps) {
  const all: LibrarySkillEntry[] = library
    ? [...library.official, ...library.custom]
    : []
  const groups = groupByPrefix(all)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  return (
    <section className="border-b border-border/40">
      <div className="px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-subtle font-medium flex items-center gap-2">
        <span>本地库（已下载）</span>
        <span className="text-[10px] text-muted normal-case tracking-normal font-normal truncate">
          {library?.path ?? ''}
        </span>
        <div className="flex-1" />
        <button
          onClick={onRefresh}
          className="fluent-btn text-[10px] text-muted hover:text-fg"
          title="刷新本地库"
        >
          ⟳
        </button>
        <button
          onClick={onChangePath}
          className="fluent-btn text-[10px] text-muted hover:text-fg"
          title="修改本地库路径"
        >
          ⚙
        </button>
      </div>
      {state === 'loading' && (
        <div className="px-3 py-2 text-[12px] text-muted">扫描中…</div>
      )}
      {state === 'error' && (
        <div className="px-3 py-2 text-[12px] text-rose-300">
          扫描失败：{error}
        </div>
      )}
      {state === 'ready' && all.length === 0 && (
        <div className="px-3 py-2 text-[12px] text-muted">
          暂无（去"市场搜索"下载一个）
        </div>
      )}
      {state === 'ready' && all.length > 0 && (
        <ul className="pb-2">
          {groups.map((g) => {
            if (g.items.length === 1) {
              return (
                <LibraryItemRow
                  key={`${g.items[0].source}:${g.items[0].id}`}
                  item={g.items[0]}
                  onInstall={onInstall}
                  onDelete={onDelete}
                  indent={false}
                  disabled={bulkBusy != null}
                />
              )
            }
            const open = expanded.has(g.key)
            return (
              <li key={`group:${g.key}`}>
                <div className="px-3 py-1.5 hover:bg-white/[0.03] flex items-center gap-1.5 border-t border-border/20">
                  <button
                    onClick={() => toggle(g.key)}
                    className="fluent-btn text-[10px] text-muted hover:text-fg w-3.5 text-center shrink-0"
                    title={open ? '折叠' : '展开'}
                  >
                    {open ? '▼' : '▶'}
                  </button>
                  <span
                    className="text-[12.5px] font-medium truncate cursor-pointer"
                    onClick={() => toggle(g.key)}
                    title={`${g.key} 集合（${g.items.length} 个）`}
                  >
                    {g.key}
                  </span>
                  <span className="text-[10px] text-muted shrink-0">
                    （{g.items.length} 个）
                  </span>
                  <div className="flex-1" />
                  <button
                    onClick={() => onBulkInstall(g.items)}
                    disabled={bulkBusy != null}
                    className="fluent-btn text-[11px] px-2 py-0.5 rounded border border-emerald-700/40 text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-50 shrink-0"
                    title="把这组里每个 skill 都装到本项目"
                  >
                    {bulkBusy === 'lib-install' ? '安装中…' : '全部装'}
                  </button>
                  <button
                    onClick={() => onBulkDelete(g.items, g.key)}
                    disabled={bulkBusy != null}
                    className="fluent-btn text-[11px] px-2 py-0.5 rounded border border-rose-700/40 text-rose-200 hover:bg-rose-500/10 disabled:opacity-50 shrink-0"
                    title="从本地库删除这一整组（不影响已装到项目的副本）"
                  >
                    {bulkBusy === 'lib-delete' ? '卸载中…' : '全部卸载'}
                  </button>
                </div>
                {open && (
                  <ul>
                    {g.items.map((s) => (
                      <LibraryItemRow
                        key={`${s.source}:${s.id}`}
                        item={s}
                        onInstall={onInstall}
                        onDelete={onDelete}
                        indent={true}
                        disabled={bulkBusy != null}
                      />
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

interface LibraryItemRowProps {
  item: LibrarySkillEntry
  onInstall: (s: LibrarySkillEntry) => void
  onDelete: (s: LibrarySkillEntry) => void
  indent: boolean
  disabled: boolean
}

function LibraryItemRow({
  item: s,
  onInstall,
  onDelete,
  indent,
  disabled,
}: LibraryItemRowProps) {
  return (
    <li
      className={`${indent ? 'pl-7 pr-3' : 'px-3'} py-1.5 hover:bg-white/[0.03] flex items-start gap-2`}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] flex items-center gap-1.5">
          <span className="truncate" title={s.path}>
            {s.name}
          </span>
          <span
            className="text-[9px] px-1 rounded border border-border bg-white/[0.04] text-muted"
            title={s.source === 'official' ? '从市场下载的' : '你自己放进来的'}
          >
            {s.source === 'official' ? '官方' : '自定义'}
          </span>
        </div>
        {s.description && (
          <div className="text-[11px] text-subtle truncate" title={s.description}>
            {s.description}
          </div>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-1">
        <button
          onClick={() => onInstall(s)}
          disabled={disabled}
          className="fluent-btn text-[11px] px-2 py-0.5 rounded border border-emerald-700/40 text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-50"
        >
          装到本项目
        </button>
        <button
          onClick={() => onDelete(s)}
          disabled={disabled}
          className="fluent-btn text-[11px] px-1.5 py-0.5 rounded border border-rose-700/40 text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
          title="从本地库删除这个 skill（不影响已装到项目的副本）"
        >
          🗑
        </button>
      </div>
    </li>
  )
}

interface MarketResultsProps {
  result: MarketSearchResult
  downloading: string | null
  onDownload: (s: MarketSkill) => void
}

function MarketResults({ result, downloading, onDownload }: MarketResultsProps) {
  const githubItems = result.github?.items ?? []
  const skillsShItems = result.skillsSh?.items ?? []
  const total = githubItems.length + skillsShItems.length
  const rateLeft = result.github?.rateLimitRemaining
  return (
    <>
      {result.cached && (
        <div className="px-3 py-1 text-[10px] text-subtle border-b border-border/30">
          ⚡ 本次结果来自 60 秒内的缓存
        </div>
      )}
      {rateLeft != null && rateLeft <= 5 && (
        <div className="px-3 py-1 text-[10px] text-amber-300 border-b border-border/30">
          ⚠ GitHub 搜索剩余配额仅 {rateLeft} 次（每小时 60 次）
        </div>
      )}
      {total === 0 && (
        <div className="px-3 py-3 text-[12px] text-muted">没找到结果。</div>
      )}
      {githubItems.length > 0 && (
        <MarketGroup
          label={`GitHub (${githubItems.length})`}
          items={githubItems}
          downloading={downloading}
          onDownload={onDownload}
        />
      )}
      {skillsShItems.length > 0 && (
        <MarketGroup
          label={`skills.sh (${skillsShItems.length})`}
          items={skillsShItems}
          downloading={downloading}
          onDownload={onDownload}
        />
      )}
      {result.skillsSh && result.skillsSh.items.length === 0 &&
        (result.source === 'all' || result.source === 'skills-sh') && (
          <div className="px-3 py-1 text-[10px] text-subtle border-t border-border/30">
            skills.sh 暂无结果或暂时连不上
          </div>
        )}
    </>
  )
}

interface MarketGroupProps {
  label: string
  items: MarketSkill[]
  downloading: string | null
  onDownload: (s: MarketSkill) => void
}

function MarketGroup({ label, items, downloading, onDownload }: MarketGroupProps) {
  return (
    <section className="border-b border-border/40">
      <div className="px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-subtle font-medium">
        {label}
      </div>
      <ul className="pb-2">
        {items.map((s) => (
          <MarketResultRow
            key={`${s.source}:${s.id}`}
            skill={s}
            isDownloading={downloading === s.id}
            disabled={downloading != null && downloading !== s.id}
            onDownload={() => onDownload(s)}
          />
        ))}
      </ul>
    </section>
  )
}

interface MarketResultRowProps {
  skill: MarketSkill
  isDownloading: boolean
  disabled: boolean
  onDownload: () => void
}

function MarketResultRow({
  skill,
  isDownloading,
  disabled,
  onDownload,
}: MarketResultRowProps) {
  return (
    <li className="px-3 py-1.5 hover:bg-white/[0.03] flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] flex items-center gap-1.5">
          <a
            href={skill.repoUrl}
            target="_blank"
            rel="noreferrer"
            className="truncate hover:underline"
            title={skill.repoUrl}
          >
            {skill.author ? `${skill.author}/${skill.name}` : skill.name}
          </a>
          {skill.stars > 0 && (
            <span className="text-[10px] text-amber-300 tabular-nums">
              ★ {skill.stars}
            </span>
          )}
          <span
            className="text-[9px] px-1 rounded border border-border bg-white/[0.04] text-muted"
          >
            {skill.source === 'github' ? 'GitHub' : 'skills.sh'}
          </span>
        </div>
        {skill.description && (
          <div className="text-[11px] text-subtle line-clamp-2" title={skill.description}>
            {skill.description}
          </div>
        )}
      </div>
      <div className="shrink-0">
        <button
          onClick={onDownload}
          disabled={isDownloading || disabled}
          className="fluent-btn text-[11px] px-2 py-0.5 rounded border border-sky-700/40 text-sky-200 hover:bg-sky-500/10 disabled:opacity-50"
        >
          {isDownloading ? '下载中…' : '下载'}
        </button>
      </div>
    </li>
  )
}
