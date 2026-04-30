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

export interface Project {
  id: string
  name: string
  path: string
  /** epoch ms */
  createdAt: number
  layout?: ProjectLayout
}

export interface SessionScope {
  enabled: boolean
  readwrite: string[]
  readonly: string[]
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
  /** Omitted when no scope was configured at session start. */
  scope?: SessionScope
  /** Defaults to 'shared' when omitted (older server payloads). */
  isolation?: SessionIsolation
  /** Short branch name like `agent/12345678`; only set for isolation==='worktree'. */
  worktreeBranch?: string
  /** Absolute worktree path on the server's data dir; only set for isolation==='worktree'. */
  worktreePath?: string
  /** Bound dev/active/<task> name; absent when unbound. */
  task?: string
}

// ---------- Harness team install 状态 ----------

export interface HarnessApplyResult {
  copied: string[]
  skipped: string[]
  gitignoreAppended: boolean
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

// ---------- Jobs (后台任务面板) ----------

export type JobKind = 'review' | 'install'
export type JobState = 'running' | 'done' | 'failed' | 'cancelled'

export interface JobItem {
  id: string
  kind: JobKind
  title: string
  state: JobState
  startedAt: number
  endedAt: number | null
  projectId?: string
  error?: string
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

export interface DevDocsStatus {
  enabled: boolean
  claudeMdExists: boolean
}

export interface HarnessApplied {
  enabled: boolean
}

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
  text: string
  done: boolean
}

export interface IssuesPayload {
  /** Project-relative POSIX path, e.g. "dev/issues.md". */
  path: string
  content: string
  items: IssueItem[]
  updatedAt: number
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

export interface MemoryEntry {
  /** `lesson` = 按 LINE_RE 解析出的结构化条目；`raw` = 标题 / 空行 / 自由文本 */
  kind: 'lesson' | 'raw'
  /** 1-based line number inside the source file */
  line: number
  text: string
  date?: string
  task?: string
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

// ---------- Output (策划方案清单) ----------

export type ChecklistStatus = 'pending' | 'locked' | 'modified'

export interface ChecklistItem {
  id: string
  title?: string
  /** decision 类 item */
  recommend?: string
  alternatives?: string[]
  reason?: string
  /** risk 类 item */
  risk?: string
  mitigation?: string
  /** 共有 */
  status?: ChecklistStatus
  /** UI 写入的用户选择：'recommend' | `alt:${index}` | 'custom'（仅 decision 类） */
  userChoice?: string
  /** 自定义答案文本（仅当 userChoice==='custom' 时有效） */
  userAnswer?: string
  [key: string]: unknown
}

export interface ChecklistSection {
  id: string
  title?: string
  /** 'decision' | 'risk' 为已知值，其它走兜底块 */
  type?: string
  items: ChecklistItem[]
}

export interface ChecklistDoc {
  feature: string
  version?: number
  createdAt?: string
  status?: string
  guide?: Record<string, unknown>
  statusLegend?: Record<string, string>
  sections: ChecklistSection[]
  [key: string]: unknown
}

export interface OutputFeature {
  name: string
  files: string[]
  hasChecklist: boolean
}

export interface OutputListResult {
  features: OutputFeature[]
}

// ---------- Perf ----------

export interface SessionPerfSample {
  sessionId: string
  agent: AgentKind
  pid: number | null
  /** Percentage, 0-100+ (multi-core can exceed 100). */
  cpu: number
  /** Resident set size in bytes. */
  memRss: number
  sampledAt: number
  /** If set, the sample failed — UI should show "—" rather than 0. */
  error?: string
}

export interface ProjectPerf {
  projectId: string
  sessions: SessionPerfSample[]
  totalCpu: number
  totalRssBytes: number
  sampledAt: number
}

export type ModelFamily = 'opus' | 'sonnet' | 'haiku' | 'other'

export interface UsageByModel {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
}

export interface UsageBucket {
  total: UsageByModel
  byModel: Record<ModelFamily, UsageByModel>
}

export interface UsageDayPoint {
  date: string
  totalTokens: number
}

export interface ClaudeUsage {
  today: UsageBucket
  last5h: UsageBucket & { windowStartMs: number; windowEndMs: number }
  last7days: UsageDayPoint[]
  skipped: number
  filesScanned: number
  entriesScanned: number
  asOf: number
  note?: string
}
