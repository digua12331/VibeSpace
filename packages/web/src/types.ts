/**
 * Built-in shells are fixed; everything else (claude / codex / gemini / opencode
 * / qoder / kilo / future entries) comes from the server's CLI_CATALOG and is
 * exposed via /api/cli-installer/catalog. Hence string instead of a union.
 */
export type AgentKind = string
export const BUILTIN_SHELL_AGENTS = ['shell', 'cmd', 'pwsh'] as const
export type BuiltinShellAgent = (typeof BUILTIN_SHELL_AGENTS)[number]

export type CliKind = 'agent' | 'mcp-tool'

export interface CliEntry {
  id: string
  label: string
  bin: string[]
  /** Defaults to 'agent' when omitted. mcp-tool entries do not appear in the
   *  StartSessionMenu launch dropdown — they are wired into running sessions
   *  via mcp-bridge instead. */
  kind?: CliKind
  install: Partial<Record<'win32' | 'darwin' | 'linux' | 'all', string>>
  description?: string
  builtin?: boolean
  requires?: string[]
  homepage?: string
  /** Resolved install command for the current platform. */
  installCmd: string | null
}
export interface CliStatusItem {
  installed: boolean
  path: string | null
}
export interface CliStatusResponse {
  cli: Record<string, CliStatusItem>
  requires: Record<string, boolean>
  platform: string
}
export type InstallJobState = 'running' | 'done' | 'failed' | 'cancelled'
export interface InstallJob {
  id: string
  cliId: string
  cmdline: string
  state: InstallJobState
  exitCode: number | null
  log: string
  startedAt: number
  endedAt: number | null
}

export type SessionStatus =
  | 'starting'
  | 'running'
  | 'working'
  | 'waiting_input'
  | 'idle'
  | 'stopped'
  | 'crashed'
  | 'hibernated'

export interface TileLayout {
  /** sessionId */
  i: string
  x: number
  y: number
  w: number
  h: number
  minW?: number
  minH?: number
}

export interface ProjectLayout {
  cols: number
  rowHeight: number
  tiles: TileLayout[]
  /** epoch ms */
  updatedAt: number
}

export type WorkflowMode = 'dev-docs' | 'openspec' | 'spec-trio'

export interface Project {
  id: string
  name: string
  path: string
  /** epoch ms */
  createdAt: number
  layout?: ProjectLayout
  /** 项目级"开发流程"模式；null 等同未设置（侧栏既不显 Dev Docs 也不显 OpenSpec tab）。 */
  workflowMode?: WorkflowMode | null
  /** 一键启动脚本路径（相对项目根或绝对）；null/缺省=未设置，点 ▶ 时回退找根目录 start.bat。 */
  startScript?: string | null
}

export type SessionIsolation = 'shared' | 'worktree'

export interface Session {
  id: string
  projectId: string
  agent: AgentKind
  status: SessionStatus
  pid: number | null
  /** epoch ms */
  started_at: number
  /** epoch ms; null while still alive */
  ended_at: number | null
  exit_code: number | null
  /** Defaults to 'shared' when omitted (older server payloads). */
  isolation?: SessionIsolation
  /** Short branch name like `agent/12345678`; only set for isolation==='worktree'. */
  worktreeBranch?: string
  /** Absolute worktree path on the server's data dir; only set for isolation==='worktree'. */
  worktreePath?: string
  /** Bound dev/active/<task> name; absent when unbound. */
  task?: string
}

// ---------- 项目工作流统一装配（Dev Docs + Harness 合并）----------

export interface HarnessApplyShape {
  copied: string[]
  skipped: string[]
  gitignoreAppended: boolean
}

export interface HarnessUninstallShape {
  removedCount: number
  skippedCount: number
  failedFiles: string[]
}

export interface HarnessFileEntry {
  kind: 'skill' | 'agent' | 'doc' | 'customize' | 'workflow-doc'
  relPath: string
  exists: boolean
  renamed: boolean
}

export interface HarnessStatusShape {
  installed: number
  total: number
  entries: HarnessFileEntry[]
  gitignoreHasRuntime: boolean
}

export interface OpenSpecApplyShape {
  created: string[]
  skipped: string[]
}

export interface OpenSpecUninstallShape {
  removedCount: number
  preservedPaths: string[]
  failedPaths: string[]
}

export interface OpenSpecStatusShape {
  rootExists: boolean
  applied: 'none' | 'partial' | 'full'
  changesCount: number
}

export interface WorkflowApplyOptions {
  mode?: WorkflowMode
  superpowers?: boolean
}

export interface WorkflowRemoveOptions {
  mode?: WorkflowMode
  superpowers?: boolean
}

export interface WorkflowApplyResult {
  mode: WorkflowMode
  devDocs:
    | null
    | { ok: true; wrote: boolean }
    | { ok: false; error: string }
  openspec:
    | null
    | ({ ok: true } & OpenSpecApplyShape)
    | { ok: false; error: string }
  harness:
    | null
    | ({ ok: true } & HarnessApplyShape)
    | { ok: false; error: string }
  superpowers:
    | null
    | { ok: true; wrote: boolean }
    | { ok: false; error: string }
  /** gstack 装态探测；仅 mode === 'spec-trio' 时存在。`installed: false` 会导致 partial=true。 */
  gstack: null | { installed: boolean }
  partial: boolean
}

export interface WorkflowRemoveResult {
  ok?: boolean
  mode: WorkflowMode
  devDocs: null | { changed: boolean; reason?: string }
  openspec:
    | null
    | ({ ok: true } & OpenSpecUninstallShape)
    | { ok: false; error: string }
  harness: HarnessUninstallShape
  superpowers: null | { changed: boolean; reason?: string }
  /** gstack 装态探测；仅 mode === 'spec-trio' 时存在。切走 spec-trio 不卸 gstack 二进制。 */
  gstack: null | { installed: boolean }
  partial: boolean
}

export interface WorkflowStatus {
  detectedMode: WorkflowMode | null
  devDocs: {
    enabled: boolean
    claudeMdExists: boolean
    /** 'none' 未装 / 'inline-legacy' 老内联待迁移 / 'file' 已是独立文件形态。 */
    form: 'none' | 'inline-legacy' | 'file'
    /** 已装的版本号；无戳为 null。 */
    installedVersion: number | null
    /** 当前母版版本号。 */
    currentVersion: number
    /** inline-legacy 一律 true（待迁移）；file 形态戳低于当前 → true。 */
    outdated: boolean
  }
  openspec: OpenSpecStatusShape
  harness: HarnessStatusShape
  superpowers: { enabled: boolean; claudeMdExists: boolean }
  /** gstack 机器级装态（探测 ~/.claude/skills/gstack/.git 目录是否存在）。 */
  gstack: { installed: boolean }
  applied: 'none' | 'partial' | 'full'
}

// ---------- OpenSpec changes ----------

export type OpenSpecChangeFile = 'proposal' | 'design' | 'tasks'

export interface OpenSpecChangeFiles {
  proposal: boolean
  design: boolean
  tasks: boolean
}

export interface OpenSpecChange {
  name: string
  files: OpenSpecChangeFiles
  /** epoch ms */
  updatedAt: number
}

// ---------- gstack（外部工具集） ----------

export interface GstackStatus {
  installed: boolean
  location: string
  version: string | null
  bunAvailable: boolean
  gitAvailable: boolean
  repoUrl: string
}

export type GstackErrorCode =
  | 'git_unavailable'
  | 'bun_unavailable'
  | 'repo_unreachable'
  | 'git_clone_failed'
  | 'bun_setup_failed'
  | 'uninstall_failed'
  | 'internal'

export interface GstackInstallResult {
  ok: boolean
  status: GstackStatus
  errorCode?: GstackErrorCode
  errorMessage?: string
  trailingLog?: string
}

// ---------- Subagent runs (claude Task 工具调用卡片) ----------

export type SubagentRunState = 'running' | 'done'

export interface SubagentRun {
  id: string
  parentSessionId: string
  subagentType: string
  description: string
  /** Server-truncated to ~1KB; full text only on the server. */
  prompt: string
  promptTruncated: boolean
  state: SubagentRunState
  startedAt: number
  endedAt: number | null
}

export type ClientMsg =
  | { type: 'subscribe'; sessionIds: string[] }
  | { type: 'unsubscribe'; sessionIds: string[] }
  | { type: 'input'; sessionId: string; data: string }
  | { type: 'resize'; sessionId: string; cols: number; rows: number }
  | { type: 'replay'; sessionId: string }
  | {
      type: 'log-from-client'
      level: LogLevel
      scope: string
      msg: string
      projectId?: string
      sessionId?: string
      meta?: unknown
    }

export type ServerMsg =
  | { type: 'hello'; serverVersion: string }
  | { type: 'output'; sessionId: string; data: string }
  | { type: 'status'; sessionId: string; status: SessionStatus; detail?: string }
  | { type: 'exit'; sessionId: string; code: number; signal: number | null }
  | { type: 'replay'; sessionId: string; data: string }
  | {
      type: 'log'
      level: LogLevel
      scope: string
      msg: string
      projectId?: string
      sessionId?: string
      meta?: unknown
    }
  | { type: 'error-pattern-alert'; alert: ErrorPatternAlert }
  | {
      // 项目级 AI 终端内存占用（字节）。后端 process-mem-service 每 10s 推一次；
      // ProjectsColumn 渲染到每行末尾。无 alive AI 会话时 byProject 为空对象。
      type: 'mem-stats'
      byProject: Record<string, number>
      ts: number
    }

export type WSConnState = 'connecting' | 'open' | 'closed'

export interface ApiError {
  error: string
  detail?: string
}

// ---------- Project log ----------

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  id: number
  ts: number
  level: LogLevel
  scope: string
  projectId?: string
  sessionId?: string
  msg: string
  meta?: unknown
}

/**
 * Mirror of `packages/server/src/types/log.ts::ErrorPatternAlert`.
 * Surfaced when the backend ErrorPatternMonitor detects the same
 * (scope, action, projectId?) key tripping its threshold.
 */
export interface ErrorPatternAlert {
  id: string
  ts: number
  key: {
    scope: string
    action: string
    actionIsFallback: boolean
    projectId?: string
  }
  count: number
  firstAt: number
  lastAt: number
  sampleMsg: string
}

// ---------- CLI config (permissions panel) ----------

export type TriState = 'allow' | 'ask' | 'deny' | 'off'

export interface CatalogClaudeItem {
  id: string
  label: string
  value: string | string[]
  description?: string
}
export interface CatalogClaudeGroup {
  id: string
  label: string
  description?: string
  items: CatalogClaudeItem[]
}
export interface CatalogCodexFieldOption {
  value: string
  label: string
}
export interface CatalogCodexField {
  id: string
  label: string
  path: string
  kind: 'single' | 'bool' | 'stringList'
  options?: CatalogCodexFieldOption[]
  placeholder?: string
}
export interface ClaudePreset {
  id: string
  label: string
  description?: string
  /** itemId -> tristate; omitted items left as-is unless applyAllAllow is true. */
  selections: Record<string, TriState>
  /** If true, every catalog item is set to allow (danger). */
  applyAllAllow?: boolean
}
export interface CodexPreset {
  id: string
  label: string
  description?: string
  values: Record<string, string | boolean | string[]>
}
export interface PermissionCatalog {
  version: number
  claude: { presets?: ClaudePreset[]; groups: CatalogClaudeGroup[] }
  codex: { presets?: CodexPreset[]; fields: CatalogCodexField[] }
}

export interface ProbeFile {
  exists: boolean
  size?: number
  mtimeMs?: number
  error?: string
  parseError?: string
}
export interface ProbeResult {
  claudeDir: { exists: boolean }
  codexDir: { exists: boolean }
  claudeSettings: ProbeFile
  claudeLocal: ProbeFile
  codexConfig: ProbeFile
}

export interface CliConfigState {
  projectPath: string
  probe: ProbeResult
  claude: {
    selections: Record<string, TriState>
    custom: { allow: string[]; ask: string[]; deny: string[] }
    fileExists: boolean
    shared: { allow: string[]; ask: string[]; deny: string[] } | null
    sharedError: string | null
  }
  codex: {
    values: Record<string, string | boolean | string[]>
    managedPaths: string[]
    fileExists: boolean
  }
}

// ---------- Git changes viewer ----------

export type ChangeStatus = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?'

export interface ChangeEntry {
  path: string
  status: ChangeStatus
  renamedFrom?: string
}

export interface ChangesResult {
  enabled: true
  branch: string | null
  ahead: number
  behind: number
  detached: boolean
  staged: ChangeEntry[]
  unstaged: ChangeEntry[]
  untracked: ChangeEntry[]
}

export interface NotGitRepoResult {
  enabled: false
}

export type ChangesResponse = ChangesResult | NotGitRepoResult

export interface CommitSummary {
  sha: string
  shortSha: string
  author: string
  email: string
  date: string
  subject: string
  body: string
  parents: string[]
}

export interface CommitFile {
  path: string
  status: ChangeStatus
  additions: number
  deletions: number
  renamedFrom?: string
}

export interface CommitDetail extends CommitSummary {
  files: CommitFile[]
}

export type GitRef = 'HEAD' | 'WORKTREE' | 'INDEX' | string

export interface FileContent {
  path: string
  ref: GitRef
  size: number
  truncated: boolean
  encoding: 'utf8' | 'base64'
  content: string
  language: string
}

export interface DiffResult {
  path: string
  from: GitRef
  to: GitRef
  patch: string
  isBinary: boolean
}

export interface BranchRef {
  name: string
  shortName: string
  kind: 'local' | 'remote' | 'tag'
  sha: string
  isHead: boolean
}

export interface GraphCommit {
  sha: string
  shortSha: string
  subject: string
  author: string
  date: string
  parents: string[]
  refs: string[]
  isHead: boolean
}

export interface CommitResult {
  sha: string
  shortSha: string
  summary: string
}

// ---------- Git: remote / branch / stash / reset ops ----------

export interface PullResult {
  output: string
  ok: true
}
export interface PushResult {
  output: string
  ok: true
}
export interface FetchResult {
  output: string
  ok: true
}
export interface MergeResult {
  output: string
  ok: true
  branch: string
}
export interface BranchOpResult {
  branch: string
  action: 'created' | 'deleted' | 'checked-out' | 'merged'
}
export interface StashEntry {
  ref: string
  branch: string | null
  subject: string
  date: string
}
export interface StashOpResult {
  output: string
  ok: true
}
export interface ResetResult {
  head: string
  previousHead: string
}

export interface CliConfigSavePayload {
  claude?: {
    selections: Record<string, TriState>
    custom?: { allow: string[]; ask: string[]; deny: string[] }
  }
  codex?: {
    values: Record<string, string | boolean | string[]>
  }
}

// ---------- Dev Docs ----------

export type DocFileKind = 'plan' | 'context' | 'tasks'
export type DocTaskStatus = 'todo' | 'doing' | 'done' | 'blocked'

export interface DocTaskSummary {
  name: string
  status: DocTaskStatus
  checked: number
  total: number
  updatedAt: number
}

export interface DocFileContent {
  path: string
  content: string
  updatedAt: number
}

// ---------- Issues 档案 ----------

export interface IssueItem {
  /** 1-based line number in dev/issues.md. */
  line: number
  /** Text after the checkbox marker, with optional `[auto]` prefix stripped. */
  text: string
  done: boolean
  /** True when the line is tagged `- [ ] [auto] ...` and eligible for batch dispatch. */
  auto: boolean
  /** Stable id for cross-edit lookup: first 16 hex chars of sha1(text after auto strip). */
  hash: string
}

export interface IssuesPayload {
  /** Project-relative POSIX path, e.g. "dev/issues.md". */
  path: string
  content: string
  items: IssueItem[]
  updatedAt: number
}

// ---------- Task Budget（执行不打扰最小闭环） ----------

export interface BudgetLimits {
  maxRounds: number
  maxElapsedMinutes: number
  maxStallMinutes: number
  maxVerifyFails: number
}

export type BudgetCutoffReason =
  | 'rounds-exceeded'
  | 'elapsed-exceeded'
  | 'stall-exceeded'
  | 'verify-failed-too-many'

export interface BudgetCutoff {
  reason: BudgetCutoffReason
  at: number
  message: string
  nextStep: string
}

export interface BudgetStateSnapshot {
  taskName: string
  projectId: string
  startedAt: number
  lastActivityAt: number
  rounds: number
  tokensApprox: number
  verifyFailCount: number
  sessionIds: string[]
  cutoff: BudgetCutoff | null
  limits: BudgetLimits
  elapsedMinutes: number
  stallMinutes: number
}

// ---------- Issue Jobs（批量派工） ----------

export type IssueJobState =
  | 'pending'
  | 'running'
  | 'verifying'
  | 'review-ready'
  | 'failed'
  | 'cancelled'
  | 'merge-conflict'
  | 'unknown'

export interface IssueJob {
  /** Server-minted nanoid; stable across reconnects until server restart. */
  jobId: string
  projectId: string
  /** sha1 hash of the issue text (matches IssueItem.hash). */
  issueHash: string
  /** Issue text snapshot at dispatch time (without [auto] prefix). */
  issueText: string
  /** Filesystem path of the worktree dedicated to this job. */
  worktreePath: string
  /** Git branch backing the worktree. Persists after worktree deletion. */
  branch: string
  /** PTY session id running claude inside the worktree (null after end / cancellation). */
  sessionId: string | null
  state: IssueJobState
  /** Last verify-pipeline log slice (tail-truncated). Empty until verify starts. */
  verifyLog: string
  startedAt: number
  endedAt: number | null
  /** Free-form reason for failed / merge-conflict / unknown / cancelled states. */
  errorReason: string | null
}

// ---------- Task Subtasks（大任务自拆并行） ----------

export type SubtaskRunState =
  | 'pending'
  | 'running'
  | 'verifying'
  | 'review-ready'
  | 'failed'
  | 'cancelled'
  | 'merge-conflict'
  | 'merged'
  | 'unknown'

export interface SubtaskSpec {
  id: number
  title: string
  write_files: string[]
  depends_on: number[]
}

export interface SubtaskGraph {
  schema_version: number
  subtasks: SubtaskSpec[]
  order: number[]
  auto_edges: Array<{ from: number; to: number; reason: string }>
}

export interface SubtaskRun {
  runId: string
  projectId: string
  taskName: string
  subtaskId: number
  title: string
  worktreePath: string
  branch: string
  sessionId: string | null
  state: SubtaskRunState
  verifyLog: string
  startedAt: number
  endedAt: number | null
  mergedAt: number | null
  errorReason: string | null
}

export interface SubtaskOverview {
  parsed: boolean
  graph: SubtaskGraph | null
  runs: SubtaskRun[]
  /** Set when parsed=false; explains why parse failed. */
  parseReason?: string
  parseDetail?: string | null
}

// ---------- Comments（md 文件 tab 评论） ----------

export interface CommentAnchor {
  anchorId: string
  blockType: string
  index: number
  contentHash: string
  textPreview: string
}

export interface CommentEntry {
  id: string
  anchor: CommentAnchor
  body: string
  createdAt: number
  updatedAt: number
}

export interface CommentsList {
  path: string
  comments: CommentEntry[]
}

// ---------- 记忆（auto / manual / rejected） ----------

export type MemoryFileKind = 'auto' | 'manual' | 'rejected'

export type LessonSeverity = 'info' | 'warn' | 'error'

export interface MemoryEntry {
  /** `lesson` = 按 LINE_RE 解析出的结构化条目；`raw` = 标题 / 空行 / 自由文本 */
  kind: 'lesson' | 'raw'
  /** 1-based line number inside the source file */
  line: number
  text: string
  date?: string
  task?: string
  /** Lesson body with the trailing `[k=v;...]` tag segment stripped. Falls
   *  back to the raw match when no valid tag segment is present. */
  body?: string
  /** Optional structured tag fields parsed from a trailing `[category=...;
   *  severity=...; files=...]` segment. Absent when the line has no tag, or
   *  when the tag could not be interpreted (no recognised keys). */
  category?: string
  severity?: LessonSeverity
  files?: string[]
}

export interface MemoryPayload {
  auto: MemoryEntry[]
  manual: MemoryEntry[]
  rejected: MemoryEntry[]
  updatedAt: number
}

export interface MemoryRollbackSelection {
  kind: 'auto' | 'manual'
  line: number
}

// ---------- Project files ----------

export type ProjectFileGitStatus =
  | 'clean'
  | 'modified'
  | 'staged'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted'

export interface ProjectFileEntry {
  path: string
  git: ProjectFileGitStatus | null
  dirty: boolean
  staged: boolean
}

export interface ProjectFilesResult {
  gitEnabled: boolean
  files: ProjectFileEntry[]
  /**
   * Directories whose contents were intentionally skipped by the server
   * (node_modules, .pnpm, …). The UI renders them as dim, non-clickable
   * placeholder nodes so the user knows they exist.
   */
  heavyDirs: string[]
  total: number
  truncated: boolean
  limit: number
}

// ---------- Project Docs (项目 docs/ 下的 md 列表) ----------

export interface ProjectDocFile {
  name: string
}

export interface ProjectDocsListResult {
  docs: ProjectDocFile[]
}

// ---------- Skill catalog (.claude|.codex|.opencode/skills/) ----------

export type SkillAgentType = 'claude-code' | 'codex' | 'opencode'
export const SKILL_AGENT_TYPES: readonly SkillAgentType[] = [
  'claude-code',
  'codex',
  'opencode',
]
export const SKILL_AGENT_LABELS: Record<SkillAgentType, string> = {
  'claude-code': 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
}

export interface SkillEntry {
  id: string
  name: string
  description: string
  path: string
  source: 'project' | 'global'
  isSymlink: boolean
}

export interface SkillCatalogResult {
  project: SkillEntry[]
  global: SkillEntry[]
}

export interface SkillAddResult {
  mode: 'copy' | 'symlink'
  targetPath: string
  fellBackToCopy: boolean
}

export interface SkillRemoveResult {
  removedPath: string
  wasSymlink: boolean
}

// ---------- Skill market (二期：联网搜索 + 下载 + 本地库) ----------

export type SkillMarketSource = 'github' | 'skills-sh'
export type SkillMarketSearchSource = 'github' | 'skills-sh' | 'all'

export interface MarketSkill {
  id: string
  name: string
  description: string
  source: SkillMarketSource
  author: string
  stars: number
  repoUrl: string
  updatedAt?: string
}

export interface GitHubSearchOk {
  items: MarketSkill[]
  total: number
  rateLimitRemaining: number | null
}

export interface SkillsShSearchOk {
  items: MarketSkill[]
  total: number
}

export interface MarketSearchResult {
  source: SkillMarketSearchSource
  github: GitHubSearchOk | null
  skillsSh: SkillsShSearchOk | null
  cached: boolean
}

export interface LibrarySkillEntry {
  id: string
  name: string
  description: string
  path: string
  source: 'official' | 'custom'
}

export interface LocalLibrary {
  path: string
  official: LibrarySkillEntry[]
  custom: LibrarySkillEntry[]
}

export interface DownloadSkillResult {
  success: true
  path: string
  skillName: string
  sizeBytes: number
  fileCount: number
}

export interface SetLibraryPathResult {
  path: string
  migrated: { from: string; to: string; fileCount: number } | null
}

export interface DeleteLibrarySkillResult {
  deleted: true
  name: string
  source: 'official' | 'custom'
  path: string
}

/**
 * App-level settings persisted to `packages/server/data/app-settings.json`.
 * `pasteImageRetentionDays`: 0 = no auto prune; otherwise pasted images older
 * than N days are removed at next server start.
 */
export interface HibernationSettings {
  enabled: boolean
  idleMinutes: number
  includeShells: boolean
}

/**
 * A physical key combination, mirrored from `KeyboardEvent`. `key` is the raw
 * `KeyboardEvent.key` value (e.g. "F8"). Modifier flags default to false.
 */
export interface KeyCombo {
  key: string
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  meta?: boolean
}

/**
 * User-recorded *alternate* keys for the two terminal abort actions. Additive
 * on top of the built-in Esc (`\x1b`) / Ctrl+C (`\x03`), which always stay
 * live. `null` means no alternate key is set.
 */
export interface TerminalKeybindings {
  abortAltKey: KeyCombo | null
  interruptAltKey: KeyCombo | null
}

export interface AppSettings {
  pasteImageRetentionDays: number
  hibernation: HibernationSettings
  terminalKeybindings: TerminalKeybindings
}

/**
 * Projection of `~/.claude/settings.json` exposed to the UI. Only the two
 * fields the skill/plugin toggle panel cares about — the rest of the file
 * is preserved on the server side during read+merge+write but never sent
 * to the browser.
 *
 * `skillOverrides[name] === 'off'` means that skill's description is
 * stripped from Claude Code's system prompt at session start. Absence of
 * a key means the skill is enabled (default).
 *
 * `enabledPlugins[key]` (key shape `<name>@<marketplace>`) is the plugin
 * master switch.
 */
export interface ClaudeGlobalSettings {
  skillOverrides: Record<string, 'off'>
  enabledPlugins: Record<string, boolean>
  path: string
  exists: boolean
  parseError?: string
}

/**
 * Patch body for `PUT /api/claude-settings`.
 * `skillOverrides[name] = 'off'` → write entry; `= null` → delete entry.
 * `enabledPlugins[key] = boolean` → set value; `= null` → delete entry
 * (used by project-scoped "follow global" state — at the global route only
 * `boolean` is accepted via zod, but the shared type allows null because
 * the project-scoped route reuses the same patch contract).
 * At least one of the two maps must be provided.
 */
export interface ClaudeSettingsPatch {
  skillOverrides?: Record<string, 'off' | null>
  enabledPlugins?: Record<string, boolean | null>
}

/**
 * Per-project `<projectPath>/.claude/settings.json` projection.
 * Claude Code's settings hierarchy lets these override `~/.claude/settings.json`
 * on a per-key basis (Managed > Local > **Project** > User).
 */
export interface ProjectClaudeSettings {
  skillOverrides: Record<string, 'off'>
  enabledPlugins: Record<string, boolean>
  path: string
  exists: boolean
  parseError?: string
}

/** Patch body for `PUT /api/project-claude-settings`. */
export interface ProjectClaudeSettingsPatch extends ClaudeSettingsPatch {
  projectId: string
}

/** Three-state UI for plugin/skill overrides:
 *  - `inherit`: follow global (delete the project-scope entry)
 *  - `force-on`: project-scope = true / no `off`
 *  - `force-off`: project-scope = false / `off` */
export type PluginOverrideState = 'inherit' | 'force-on' | 'force-off'

/** One MCP server entry, scoped to a given project context. */
export interface McpServerEntry {
  name: string
  scope: 'global' | 'project'
  enabled: boolean
  command?: string
  args?: string[]
}

/** Response of `GET /api/mcp-servers?projectId=X`. */
export interface McpServerListResult {
  servers: McpServerEntry[]
  disabled: string[]
  projectPath: string
}

/** Response of `PUT /api/mcp-servers/toggle` — same shape plus a hint about
 *  whether a stale auto-injected `.mcp.json` entry got cleaned up. */
export interface McpServerToggleResult extends McpServerListResult {
  staleRemoved?: boolean
}

// ---------- Hub (总控台) ----------

/** Mirrors the shape returned by `GET /api/hub/status`. See routes/hub.ts. */
export interface HubSession {
  id: string
  agent: string
  status: SessionStatus
  pid: number | null
  startedAt: number
  lastInputAt: number | null
  lastOutputAt: number | null
}

export interface HubProject {
  id: string
  name: string
  path: string
  /** Count of alive AI sessions (shell sessions excluded — matches mem-service口径). */
  aliveSessionCount: number
  sessions: HubSession[]
  /** Sum of WorkingSet across all alive AI sessions' process trees; 0 when
   *  process-mem-service can't sample (non-Windows or no recent tick). */
  totalMemBytes: number
  lastActivityAt: number | null
}

export interface HubStatusResponse {
  projects: HubProject[]
  ts: number
}

/** Mirrors `GET /api/hub/projects/:id/detail`. */
export interface HubProjectDetail {
  gitDirty: {
    enabled: boolean
    branch: string | null
    ahead: number
    behind: number
    staged: number
    unstaged: number
    untracked: number
  } | null
  devTasks: Array<{
    name: string
    status: string
    checked: number
    total: number
    updatedAt: number
  }>
  /** Reserved for Phase 2 wiring; always null in Phase 1. */
  errorCount24h: number | null
}

export interface HubDispatchRequest {
  targetProjectId: string
  agent: string
  text: string
}

export interface HubDispatchResponse {
  sessionId: string
  /** false when PTY died between spawn and the first write (rare). */
  firstInputWritten: boolean
}

// ---------- Recent PTY output (用于 hub read_session_output 等) ----------

export interface SessionRecentOutput {
  sessionId: string
  agent: string
  status: SessionStatus
  linesRequested: number
  linesReturned: number
  bufferAlive: boolean
  content: string
}

// ---------- Hub dispatch to existing IDLE session (第 3 期 B1) ----------

export interface DispatchToIdleSessionRequest {
  targetSessionId: string
  text: string
}

export interface DispatchToIdleSessionResponse {
  sessionId: string
  status: SessionStatus
  idleAge?: number
}

// ---------- 飞书双向任务桥 ----------

/** Masked feishu config the browser sees — secret never leaves the server. */
export interface FeishuConfigMasked {
  enabled: boolean
  appId: string
  domain: 'feishu' | 'lark'
  allowOpenIds: string[]
  allowChatIds: string[]
  ownerOpenId: string
  hubAgent: string
  hasSecret: boolean
  appSecretMask: string
}

export interface FeishuConfigPatch {
  enabled?: boolean
  appId?: string
  /** Omit / empty / unchanged mask keeps the stored secret. */
  appSecret?: string
  domain?: 'feishu' | 'lark'
  allowOpenIds?: string[]
  allowChatIds?: string[]
  ownerOpenId?: string
  hubAgent?: string
}

export type FeishuConnState =
  | 'off'
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed'

export interface FeishuStatus {
  running: boolean
  state: FeishuConnState
  configured: boolean
  appId: string
  lastError: string | null
}

export interface FeishuTestResult {
  ok: boolean
  message: string
}

// ---------- Local AI (Ollama / LM Studio) ----------

export type LocalAiProviderId = 'ollama' | 'lmstudio'

export interface LocalAiProvider {
  id: LocalAiProviderId
  label: string
  reachable: boolean
}

export interface LocalAiModelsResult {
  models: string[]
}

export interface CommitMessageResult {
  message: string
  truncated: boolean
}
