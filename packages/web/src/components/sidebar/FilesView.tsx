import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../../api'
import { useStore } from '../../store'
import type { ProjectFileEntry, ProjectFileGitStatus, ProjectFilesResult } from '../../types'
import { openContextMenu } from '../ContextMenu'
import { buildFileContextItems, type FileContextSession } from '../fileContextMenu'

interface ViewState {
  data: ProjectFilesResult | null
  loading: boolean
  error: string | null
}

const STATUS_META: Record<
  ProjectFileGitStatus,
  { letter: string; tone: string; label: string }
> = {
  clean:      { letter: '',  tone: 'text-subtle',       label: '未变更' },
  modified:   { letter: 'M', tone: 'text-amber-300',    label: '已修改' },
  staged:     { letter: 'S', tone: 'text-emerald-300',  label: '已暂存' },
  added:      { letter: 'A', tone: 'text-emerald-300',  label: '新增' },
  deleted:    { letter: 'D', tone: 'text-rose-300',     label: '已删除' },
  renamed:    { letter: 'R', tone: 'text-sky-300',      label: '已重命名' },
  untracked:  { letter: 'U', tone: 'text-sky-300',      label: '未跟踪' },
  conflicted: { letter: '!', tone: 'text-rose-400',     label: '冲突' },
}

function basenameOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

function matchesQuery(path: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true
  const hay = path.toLowerCase()
  for (const t of tokens) if (!hay.includes(t)) return false
  return true
}

// ---------- Tree model ----------

interface FileNode {
  kind: 'file'
  name: string
  path: string
  entry: ProjectFileEntry
}

interface DirNode {
  kind: 'dir'
  name: string
  /** Forward-slash path relative to project root. Empty string for root. */
  path: string
  children: TreeNode[]
  /** Count of descendant files whose git status isn't "clean". */
  dirtyCount: number
  /** Individual skipped dir (dim, non-clickable). */
  isHeavy?: boolean
  /** Synthetic root-level group that holds all heavy dirs; collapsible. */
  isHeavyGroup?: boolean
}

type TreeNode = FileNode | DirNode

/** Stable path for the synthetic "已跳过文件夹" root group. */
const HEAVY_GROUP_PATH = '__heavy_group__'

function buildTree(entries: ProjectFileEntry[], heavyDirs: string[]): DirNode {
  const root: DirNode = { kind: 'dir', name: '', path: '', children: [], dirtyCount: 0 }
  const dirByPath = new Map<string, DirNode>([['', root]])

  for (const entry of entries) {
    const parts = entry.path.split('/')
    const fileName = parts[parts.length - 1]
    let parent = root
    let acc = ''
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
      let dir = dirByPath.get(acc)
      if (!dir) {
        dir = { kind: 'dir', name: parts[i], path: acc, children: [], dirtyCount: 0 }
        dirByPath.set(acc, dir)
        parent.children.push(dir)
      }
      parent = dir
    }
    parent.children.push({ kind: 'file', name: fileName, path: entry.path, entry })
    if (entry.git && entry.git !== 'clean') {
      // Walk up from parent to root, bumping dirty counts.
      let node: DirNode | undefined = parent
      while (node) {
        node.dirtyCount++
        node = node.path === '' ? undefined : dirByPath.get(
          node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '',
        )
      }
    }
  }

  // Sort: folders before files, each alphabetically (case-insensitive).
  const sortChildren = (dir: DirNode) => {
    dir.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    })
    for (const c of dir.children) if (c.kind === 'dir') sortChildren(c)
  }
  sortChildren(root)

  // Prepend a collapsible group that holds all skipped heavy dirs. Keeping
  // them in one bucket at the top avoids scattering dim placeholders through
  // the tree, and leaves the group collapsed by default so node_modules &
  // friends aren't in the way until explicitly asked for.
  if (heavyDirs.length > 0) {
    const group: DirNode = {
      kind: 'dir',
      name: '已跳过文件夹',
      path: HEAVY_GROUP_PATH,
      dirtyCount: 0,
      isHeavyGroup: true,
      children: [...heavyDirs].sort().map((hd) => ({
        kind: 'dir' as const,
        // Show the full relative path so multiple node_modules (monorepo)
        // can be told apart at a glance.
        name: hd,
        path: hd,
        children: [],
        dirtyCount: 0,
        isHeavy: true,
      })),
    }
    root.children.unshift(group)
  }

  return root
}

// ---------- Expanded-folders persistence ----------

const EXPANDED_LS_PREFIX = 'aimon_files_expanded_v1:'

function readExpanded(projectId: string): Set<string> {
  if (typeof localStorage === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(EXPANDED_LS_PREFIX + projectId)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

function writeExpanded(projectId: string, set: Set<string>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(EXPANDED_LS_PREFIX + projectId, JSON.stringify([...set]))
  } catch {
    // noop
  }
}

// ---------- Component ----------

export default function FilesView() {
  const projectId = useStore((s) => s.selectedProjectId)
  const projects = useStore((s) => s.projects)
  const openFile = useStore((s) => s.openFile)
  const sessions = useStore((s) => s.sessions)
  const liveStatus = useStore((s) => s.liveStatus)
  const filesRefreshTick = useStore((s) => s.filesRefreshTick)
  const bumpFilesRefresh = useStore((s) => s.bumpFilesRefresh)

  const project = projects.find((p) => p.id === projectId) ?? null

  const [state, setState] = useState<ViewState>({ data: null, loading: false, error: null })
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    if (!projectId) return
    setState({ data: null, loading: true, error: null })
    try {
      const data = await api.listProjectFiles(projectId)
      setState({ data, loading: false, error: null })
    } catch (e: unknown) {
      setState({
        data: null,
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }, [projectId])

  useEffect(() => {
    void load()
    // filesRefreshTick lets external actions (delete / gitignore-add) force a
    // re-scan without plumbing a callback chain.
  }, [load, filesRefreshTick])

  // Load persisted expanded state per project, and reset query when switching.
  useEffect(() => {
    if (!projectId) return
    setExpanded(readExpanded(projectId))
    setQuery('')
    inputRef.current?.focus()
  }, [projectId])

  const toggleDir = useCallback(
    (path: string) => {
      if (!projectId) return
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        writeExpanded(projectId, next)
        return next
      })
    },
    [projectId],
  )

  const tokens = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  )

  const aliveSessions = useCallback((): FileContextSession[] => {
    if (!projectId) return []
    return sessions
      .filter((s) => {
        if (s.projectId !== projectId) return false
        const st = liveStatus[s.id] ?? s.status
        return st !== 'stopped' && st !== 'crashed'
      })
      .map((s) => ({ id: s.id, agent: s.agent }))
  }, [sessions, liveStatus, projectId])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string, kind: 'file' | 'dir') => {
      if (!projectId) return
      e.preventDefault()
      e.stopPropagation()
      openContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: buildFileContextItems({
          projectId,
          path,
          kind,
          sessions: aliveSessions(),
          onAfterDelete: () => bumpFilesRefresh(),
          onAfterGitignore: () => bumpFilesRefresh(),
        }),
      })
    },
    [projectId, aliveSessions, bumpFilesRefresh],
  )

  const tree = useMemo(
    () => (state.data ? buildTree(state.data.files, state.data.heavyDirs) : null),
    [state.data],
  )

  const searchResults = useMemo(() => {
    if (!state.data || tokens.length === 0) return null
    return state.data.files.filter((f) => matchesQuery(f.path, tokens))
  }, [state.data, tokens])

  if (!projectId || !project) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-sm text-muted text-center">
        <div>请先在左侧「项目」列表中选中一个项目</div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        className="px-3 py-1.5 text-[11px] text-muted border-b border-border/40 truncate"
        title={project.path}
      >
        {project.name}
      </div>

      <div className="px-2 pt-2 pb-1 shrink-0">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query) {
              e.preventDefault()
              setQuery('')
            }
            if (e.key === 'Enter' && searchResults && searchResults.length > 0) {
              e.preventDefault()
              openFile({ projectId, path: searchResults[0].path })
            }
          }}
          placeholder="按路径子串过滤 — 空格分隔多个关键字"
          className="w-full px-2.5 py-1.5 bg-white/[0.04] border border-border rounded-md focus:border-accent focus:bg-white/[0.06] text-[12.5px] transition-colors"
        />
        <StatusLine
          data={state.data}
          filteredCount={searchResults?.length ?? null}
          loading={state.loading}
          onRefresh={() => void load()}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {state.error && (
          <div className="mx-2 my-2 p-2 text-xs text-rose-300 bg-rose-950/40 border border-rose-900/50 rounded">
            {state.error}
          </div>
        )}

        {!state.error && state.loading && !state.data && (
          <div className="p-4 text-xs text-muted text-center">读取中…</div>
        )}

        {!state.error && searchResults && (
          <SearchResults
            entries={searchResults}
            onOpen={(p) => openFile({ projectId, path: p })}
            onContextMenu={handleContextMenu}
          />
        )}

        {!state.error && !searchResults && tree && (
          <TreeBody
            dir={tree}
            expanded={expanded}
            onToggle={toggleDir}
            onOpen={(p) => openFile({ projectId, path: p })}
            onContextMenu={handleContextMenu}
          />
        )}
      </div>
    </div>
  )
}

function StatusLine({
  data,
  filteredCount,
  loading,
  onRefresh,
}: {
  data: ProjectFilesResult | null
  filteredCount: number | null
  loading: boolean
  onRefresh: () => void
}) {
  return (
    <div className="mt-1 px-0.5 text-[10.5px] text-subtle flex items-center justify-between gap-2">
      <span className="truncate">
        {loading && '读取中…'}
        {!loading && data && (
          <>
            {filteredCount == null
              ? `${data.files.length} 项`
              : `${filteredCount} / ${data.files.length} 项`}
            {data.truncated && (
              <span className="ml-1 text-amber-400">· 截断 @ {data.limit}</span>
            )}
            {data.heavyDirs.length > 0 && (
              <span
                className="ml-1 text-subtle"
                title={data.heavyDirs.join('\n')}
              >
                · 跳过 {data.heavyDirs.length} 个大目录
              </span>
            )}
            {!data.gitEnabled && (
              <span className="ml-1 text-subtle">· 非 git 仓库</span>
            )}
          </>
        )}
      </span>
      <button
        onClick={onRefresh}
        disabled={loading}
        title="重新扫描"
        className="shrink-0 px-1.5 py-0.5 rounded border border-border/60 hover:bg-white/[0.05] disabled:opacity-40"
      >
        ⟳
      </button>
    </div>
  )
}

// ---------- Tree rendering ----------

type RowContextHandler = (e: React.MouseEvent, path: string, kind: 'file' | 'dir') => void

function TreeBody({
  dir,
  expanded,
  onToggle,
  onOpen,
  onContextMenu,
}: {
  dir: DirNode
  expanded: Set<string>
  onToggle: (path: string) => void
  onOpen: (path: string) => void
  onContextMenu?: RowContextHandler
}) {
  if (dir.children.length === 0) {
    return <div className="p-4 text-xs text-muted text-center">空目录</div>
  }
  return (
    <ul className="py-1">
      {dir.children.map((child) => (
        <TreeRow
          key={child.path}
          node={child}
          depth={0}
          expanded={expanded}
          onToggle={onToggle}
          onOpen={onOpen}
          onContextMenu={onContextMenu}
        />
      ))}
    </ul>
  )
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
  onOpen,
  onContextMenu,
}: {
  node: TreeNode
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
  onOpen: (path: string) => void
  onContextMenu?: RowContextHandler
}) {
  // 12px per depth level, plus a fixed 8px gutter on the left.
  const indent = { paddingLeft: `${8 + depth * 12}px` }

  if (node.kind === 'dir') {
    if (node.isHeavyGroup) {
      const isOpen = expanded.has(node.path)
      return (
        <li>
          <button
            type="button"
            onClick={() => onToggle(node.path)}
            title="这些目录因文件过多被跳过，不扫描其内容"
            style={indent}
            className="w-full flex items-center gap-1.5 pr-2 py-[3px] text-[12.5px] text-left text-subtle italic hover:bg-white/[0.05] transition-colors"
          >
            <span className="w-3 shrink-0 text-[10px] text-center">
              {isOpen ? '▾' : '▸'}
            </span>
            <span className="shrink-0 opacity-60">⋯</span>
            <span className="truncate">
              已跳过文件夹 ({node.children.length})
            </span>
          </button>
          {isOpen && (
            <ul>
              {node.children.map((c) => (
                <TreeRow
                  key={c.path}
                  node={c}
                  depth={depth + 1}
                  expanded={expanded}
                  onToggle={onToggle}
                  onOpen={onOpen}
                  onContextMenu={onContextMenu}
                />
              ))}
            </ul>
          )}
        </li>
      )
    }

    if (node.isHeavy) {
      return (
        <li>
          <div
            title={`${node.path} — 内容未加载（大文件目录已跳过）`}
            style={indent}
            aria-disabled="true"
            className="w-full flex items-center gap-1.5 pr-2 py-[3px] text-[12.5px] text-left opacity-40 cursor-not-allowed select-none"
          >
            <span className="w-3 shrink-0 text-[10px] text-muted text-center">
              ⋯
            </span>
            <span className="shrink-0">📁</span>
            <span className="truncate text-fg/70 font-mono">{node.name}</span>
            <span className="ml-auto shrink-0 text-[10px] text-subtle italic">
              已跳过
            </span>
          </div>
        </li>
      )
    }

    const isOpen = expanded.has(node.path)
    return (
      <li>
        <button
          type="button"
          onClick={() => onToggle(node.path)}
          onContextMenu={
            onContextMenu ? (e) => onContextMenu(e, node.path, 'dir') : undefined
          }
          title={node.path}
          style={indent}
          className="w-full flex items-center gap-1.5 pr-2 py-[3px] text-[12.5px] text-left hover:bg-white/[0.05] transition-colors"
        >
          <span className="w-3 shrink-0 text-[10px] text-muted text-center">
            {isOpen ? '▾' : '▸'}
          </span>
          <span className="shrink-0">{isOpen ? '📂' : '📁'}</span>
          <span className="truncate text-fg/90">{node.name}</span>
          {node.dirtyCount > 0 && (
            <span className="ml-auto shrink-0 text-[10px] tabular-nums text-amber-300">
              {node.dirtyCount}
            </span>
          )}
        </button>
        {isOpen && (
          <ul>
            {node.children.map((c) => (
              <TreeRow
                key={c.path}
                node={c}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                onOpen={onOpen}
                onContextMenu={onContextMenu}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  const meta = node.entry.git ? STATUS_META[node.entry.git] : null
  const isChanged = meta != null && node.entry.git !== 'clean'
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(node.path)}
        onContextMenu={
          onContextMenu ? (e) => onContextMenu(e, node.path, 'file') : undefined
        }
        title={node.path + (meta ? ` — ${meta.label}` : '')}
        style={indent}
        className="w-full flex items-center gap-1.5 pr-2 py-[3px] text-[12.5px] text-left hover:bg-white/[0.05] transition-colors"
      >
        {/* Align with dir chevron */}
        <span className="w-3 shrink-0" />
        <span className="shrink-0 opacity-70">📄</span>
        <span
          className={`truncate ${isChanged ? 'text-fg' : 'text-fg/85'}`}
        >
          {node.name}
        </span>
        {meta?.letter && (
          <span
            className={`ml-auto shrink-0 font-mono text-[10.5px] ${meta.tone}`}
            title={meta.label}
          >
            {meta.letter}
          </span>
        )}
      </button>
    </li>
  )
}

// ---------- Search-mode flat list ----------

function SearchResults({
  entries,
  onOpen,
  onContextMenu,
}: {
  entries: ProjectFileEntry[]
  onOpen: (path: string) => void
  onContextMenu?: RowContextHandler
}) {
  if (entries.length === 0) {
    return <div className="p-4 text-xs text-muted text-center">没有匹配的文件</div>
  }
  return (
    <ul className="py-1">
      {entries.map((f) => {
        const meta = f.git ? STATUS_META[f.git] : null
        const base = basenameOf(f.path)
        const dir = f.path.slice(0, f.path.length - base.length).replace(/\/$/, '')
        const isChanged = meta != null && f.git !== 'clean'
        return (
          <li key={f.path}>
            <button
              type="button"
              onClick={() => onOpen(f.path)}
              onContextMenu={
                onContextMenu ? (e) => onContextMenu(e, f.path, 'file') : undefined
              }
              title={f.path + (meta ? ` — ${meta.label}` : '')}
              className="w-full flex items-center gap-2 px-3 py-[3px] text-[12.5px] text-left hover:bg-white/[0.05] transition-colors"
            >
              <span className="shrink-0 opacity-70">📄</span>
              <span className={`truncate ${isChanged ? 'text-fg' : 'text-fg/85'}`}>
                {base}
              </span>
              {dir && (
                <span className="font-mono text-[11px] text-subtle truncate ml-auto pl-2">
                  {dir}
                </span>
              )}
              {meta?.letter && (
                <span
                  className={`shrink-0 font-mono text-[10.5px] ${meta.tone}`}
                  title={meta.label}
                >
                  {meta.letter}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
