/**
 * Built-in shells are fixed; everything else (claude / codex / gemini / opencode
 * / qoder / kilo / future entries) comes from the server's CLI_CATALOG and is
 * exposed via /api/cli-installer/catalog. Hence string instead of a union.
 */
export type AgentKind = string
export const BUILTIN_SHELL_AGENTS = ['shell', 'cmd', 'pwsh'] as const
export type BuiltinShellAgent = (typeof BUILTIN_SHELL_AGENTS)[number]

export interface CliEntry {
  id: string
  label: string
  bin: string[]
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
}

export type ClientMsg =
  | { type: 'subscribe'; sessionIds: string[] }
  | { type: 'unsubscribe'; sessionIds: string[] }
  | { type: 'input'; sessionId: string; data: string }
  | { type: 'resize'; sessionId: string; cols: number; rows: number }
  | { type: 'replay'; sessionId: string }

export type ServerMsg =
  | { type: 'hello'; serverVersion: string }
  | { type: 'output'; sessionId: string; data: string }
  | { type: 'status'; sessionId: string; status: SessionStatus; detail?: string }
  | { type: 'exit'; sessionId: string; code: number; signal: number | null }
  | { type: 'replay'; sessionId: string; data: string }

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

export type DocFileKind = 'plan' | 'context' | 'tasks'
export type DocTaskStatus = 'todo' | 'doing' | 'done'

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
