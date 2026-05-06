import type {
  AgentKind,
  BranchOpResult,
  BranchRef,
  ChangesResponse,
  CliConfigSavePayload,
  CliConfigState,
  CliEntry,
  CliStatusResponse,
  CommentAnchor,
  CommentEntry,
  CommentsList,
  CommitDetail,
  CommitResult,
  CommitSummary,
  DiffResult,
  FetchResult,
  MergeResult,
  PullResult,
  PushResult,
  ResetResult,
  StashEntry,
  StashOpResult,
  ChecklistDoc,
  DocFileContent,
  DocFileKind,
  DocTaskSummary,
  IssuesPayload,
  JobItem,
  MemoryPayload,
  MemoryRollbackSelection,
  OutputListResult,
  FileContent,
  GitRef,
  GraphCommit,
  InstallJob,
  PermissionCatalog,
  ClaudeUsage,
  Project,
  ProjectFilesResult,
  ProjectPerf,
  Session,
  SessionIsolation,
  SubagentRun,
  WorkflowApplyResult,
  WorkflowRemoveResult,
  WorkflowStatus,
  SkillAgentType,
  SkillCatalogResult,
  SkillAddResult,
  SkillRemoveResult,
  MarketSearchResult,
  SkillMarketSearchSource,
  DownloadSkillResult,
  LocalLibrary,
  SetLibraryPathResult,
  DeleteLibrarySkillResult,
} from './types'

const BASE: string =
  (import.meta.env.VITE_AIMON_BACKEND as string | undefined) ?? 'http://127.0.0.1:8787'

export function backendBase(): string {
  return BASE
}

export function projectRawUrl(projectId: string, path: string): string {
  const qs = new URLSearchParams({ path })
  return `${BASE}/api/projects/${encodeURIComponent(projectId)}/raw?${qs}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    let detail: string | undefined
    let errorCode: string | undefined
    try {
      const body = (await res.json()) as { error?: string; detail?: string; message?: string }
      errorCode = body.error
      // 后端有的路由用 detail（如 zod issues），有的用 message（如 git_failed 的原始错误）。
      // 不要让二者互相吞掉——优先 detail，缺失时回落到 message，避免具体原因被丢。
      detail = body.detail ?? body.message
    } catch {
      try {
        detail = await res.text()
      } catch {
        // ignore
      }
    }
    const err = new Error(
      `${res.status} ${res.statusText}${errorCode ? `: ${errorCode}` : ''}${detail ? ` - ${detail}` : ''}`,
    ) as Error & { status: number; code?: string; detail?: string }
    err.status = res.status
    err.code = errorCode
    err.detail = detail
    throw err
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

export function listProjects(): Promise<Project[]> {
  return request<Project[]>('/api/projects')
}

export function createProject(input: {
  name: string
  path?: string
}): Promise<Project> {
  return request<Project>('/api/projects', jsonInit('POST', input))
}

export function applyWorkflow(projectId: string): Promise<WorkflowApplyResult> {
  return request<WorkflowApplyResult>(
    `/api/projects/${encodeURIComponent(projectId)}/workflow`,
    { method: 'POST' },
  )
}

export function removeWorkflow(projectId: string): Promise<WorkflowRemoveResult> {
  return request<WorkflowRemoveResult>(
    `/api/projects/${encodeURIComponent(projectId)}/workflow`,
    { method: 'DELETE' },
  )
}

export function getWorkflowStatus(projectId: string): Promise<WorkflowStatus> {
  return request<WorkflowStatus>(
    `/api/projects/${encodeURIComponent(projectId)}/workflow-status`,
  )
}

export function deleteProject(id: string): Promise<void> {
  return request<void>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function listSessions(projectId?: string): Promise<Session[]> {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return request<Session[]>(`/api/sessions${qs}`)
}

export function createSession(input: {
  projectId: string
  agent: AgentKind
  isolation?: SessionIsolation
  task?: string
}): Promise<Session> {
  return request<Session>('/api/sessions', jsonInit('POST', input))
}

export function deleteSession(
  id: string,
  opts?: { gc?: boolean },
): Promise<void> {
  const qs = opts?.gc ? '?gc=true' : ''
  return request<void>(
    `/api/sessions/${encodeURIComponent(id)}${qs}`,
    { method: 'DELETE' },
  )
}

export function bindSessionTask(
  id: string,
  task: string | null,
  opts?: { force?: boolean },
): Promise<Session> {
  return request<Session>(
    `/api/sessions/${encodeURIComponent(id)}/task`,
    jsonInit('PATCH', { task, force: opts?.force ?? false }),
  )
}

export function listSubagentRuns(sessionId: string): Promise<SubagentRun[]> {
  return request<SubagentRun[]>(
    `/api/sessions/${encodeURIComponent(sessionId)}/subagent-runs`,
  )
}

export interface ProjectSkillSummary {
  name: string
  triggers: string[]
}

export function listProjectSkills(
  projectId: string,
): Promise<ProjectSkillSummary[]> {
  return request<ProjectSkillSummary[]>(
    `/api/projects/${encodeURIComponent(projectId)}/skills`,
  )
}

// ---------- Jobs ----------

export function listJobs(): Promise<JobItem[]> {
  return request<JobItem[]>('/api/jobs')
}

export function getClaudeUsage(): Promise<ClaudeUsage> {
  return request<ClaudeUsage>('/api/usage/claude')
}

export function cancelJob(id: string): Promise<void> {
  return request<void>(
    `/api/jobs/${encodeURIComponent(id)}/cancel`,
    { method: 'POST' },
  )
}

export function deleteJob(id: string): Promise<void> {
  return request<void>(
    `/api/jobs/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

export function restartSession(id: string): Promise<Session> {
  return request<Session>(`/api/sessions/${encodeURIComponent(id)}/restart`, { method: 'POST' })
}

export function getCliConfigCatalog(): Promise<PermissionCatalog> {
  return request<PermissionCatalog>('/api/cli-configs/catalog')
}

export function getProjectCliConfig(projectId: string): Promise<CliConfigState> {
  return request<CliConfigState>(`/api/projects/${encodeURIComponent(projectId)}/cli-configs`)
}

export function saveProjectCliConfig(
  projectId: string,
  payload: CliConfigSavePayload,
): Promise<{ ok: boolean; written: string[] }> {
  return request(
    `/api/projects/${encodeURIComponent(projectId)}/cli-configs`,
    jsonInit('PUT', payload),
  )
}

// ---------- CLI installer ----------

export function getCliInstallerCatalog(): Promise<CliEntry[]> {
  return request<CliEntry[]>('/api/cli-installer/catalog')
}

export function getCliInstallerStatus(): Promise<CliStatusResponse> {
  return request<CliStatusResponse>('/api/cli-installer/status')
}

export function startCliInstall(cliId: string): Promise<{ jobId: string; cmdline: string }> {
  return request('/api/cli-installer/install', jsonInit('POST', { cliId }))
}

export function getInstallJob(jobId: string): Promise<InstallJob> {
  return request<InstallJob>(`/api/cli-installer/jobs/${encodeURIComponent(jobId)}`)
}

export function cancelInstallJob(jobId: string): Promise<void> {
  return request<void>(`/api/cli-installer/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  })
}

export function installJobStreamUrl(jobId: string): string {
  return `${BASE}/api/cli-installer/jobs/${encodeURIComponent(jobId)}/stream`
}

// ---------- Git changes viewer ----------

export function getProjectChanges(projectId: string): Promise<ChangesResponse> {
  return request<ChangesResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/changes`,
  )
}

export function listProjectCommits(
  projectId: string,
  opts: { limit?: number; branch?: string } = {},
): Promise<CommitSummary[]> {
  const qs = new URLSearchParams()
  if (opts.limit != null) qs.set('limit', String(opts.limit))
  if (opts.branch) qs.set('branch', opts.branch)
  const suffix = qs.toString() ? `?${qs}` : ''
  return request<CommitSummary[]>(
    `/api/projects/${encodeURIComponent(projectId)}/commits${suffix}`,
  )
}

export function getProjectCommit(
  projectId: string,
  sha: string,
): Promise<CommitDetail> {
  return request<CommitDetail>(
    `/api/projects/${encodeURIComponent(projectId)}/commits/${encodeURIComponent(sha)}`,
  )
}

export function getProjectFile(
  projectId: string,
  path: string,
  ref?: GitRef,
): Promise<FileContent> {
  const qs = new URLSearchParams({ path })
  if (ref) qs.set('ref', ref)
  return request<FileContent>(
    `/api/projects/${encodeURIComponent(projectId)}/file?${qs}`,
  )
}

export function getProjectDiff(
  projectId: string,
  path: string,
  opts: { from?: GitRef; to?: GitRef } = {},
): Promise<DiffResult> {
  const qs = new URLSearchParams({ path })
  if (opts.from) qs.set('from', opts.from)
  if (opts.to) qs.set('to', opts.to)
  return request<DiffResult>(
    `/api/projects/${encodeURIComponent(projectId)}/diff?${qs}`,
  )
}

export function listProjectFiles(
  projectId: string,
  opts: { limit?: number } = {},
): Promise<ProjectFilesResult> {
  const qs = new URLSearchParams()
  if (opts.limit != null) qs.set('limit', String(opts.limit))
  const suffix = qs.toString() ? `?${qs}` : ''
  return request<ProjectFilesResult>(
    `/api/projects/${encodeURIComponent(projectId)}/files${suffix}`,
  )
}

export function getProjectBranches(projectId: string): Promise<BranchRef[]> {
  return request<BranchRef[]>(
    `/api/projects/${encodeURIComponent(projectId)}/branches`,
  )
}

export function getProjectGraph(
  projectId: string,
  opts: { limit?: number; all?: boolean } = {},
): Promise<GraphCommit[]> {
  const qs = new URLSearchParams()
  if (opts.limit != null) qs.set('limit', String(opts.limit))
  if (opts.all != null) qs.set('all', String(opts.all))
  const suffix = qs.toString() ? `?${qs}` : ''
  return request<GraphCommit[]>(
    `/api/projects/${encodeURIComponent(projectId)}/graph${suffix}`,
  )
}

export function stagePaths(
  projectId: string,
  paths: string[],
): Promise<{ staged: string[] }> {
  return request(
    `/api/projects/${encodeURIComponent(projectId)}/stage`,
    jsonInit('POST', { paths }),
  )
}

export function unstagePaths(
  projectId: string,
  paths: string[],
): Promise<{ unstaged: string[] }> {
  return request(
    `/api/projects/${encodeURIComponent(projectId)}/unstage`,
    jsonInit('POST', { paths }),
  )
}

export function discardPaths(
  projectId: string,
  input: { tracked?: string[]; untracked?: string[] },
): Promise<{ discarded: string[] }> {
  return request(
    `/api/projects/${encodeURIComponent(projectId)}/discard`,
    jsonInit('POST', input),
  )
}

export function createCommit(
  projectId: string,
  input: { message: string; amend?: boolean; allowEmpty?: boolean },
): Promise<CommitResult> {
  return request<CommitResult>(
    `/api/projects/${encodeURIComponent(projectId)}/commit`,
    jsonInit('POST', input),
  )
}

// ---------- Git: remote / branch / stash / reset ops ----------

export function gitPull(projectId: string): Promise<PullResult> {
  return request<PullResult>(
    `/api/projects/${encodeURIComponent(projectId)}/pull`,
    jsonInit('POST', {}),
  )
}

export function gitPush(projectId: string): Promise<PushResult> {
  return request<PushResult>(
    `/api/projects/${encodeURIComponent(projectId)}/push`,
    jsonInit('POST', {}),
  )
}

export function gitFetch(projectId: string): Promise<FetchResult> {
  return request<FetchResult>(
    `/api/projects/${encodeURIComponent(projectId)}/fetch`,
    jsonInit('POST', {}),
  )
}

export function gitCreateBranch(
  projectId: string,
  branch: string,
  opts: { checkout?: boolean } = {},
): Promise<BranchOpResult> {
  return request<BranchOpResult>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/create`,
    jsonInit('POST', { branch, checkout: opts.checkout === true }),
  )
}

export function gitDeleteBranch(
  projectId: string,
  branch: string,
  opts: { force?: boolean } = {},
): Promise<BranchOpResult> {
  return request<BranchOpResult>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/delete`,
    jsonInit('POST', { branch, force: opts.force === true }),
  )
}

export function gitCheckoutBranch(
  projectId: string,
  branch: string,
): Promise<BranchOpResult> {
  return request<BranchOpResult>(
    `/api/projects/${encodeURIComponent(projectId)}/branches/checkout`,
    jsonInit('POST', { branch }),
  )
}

export function gitMergeBranch(
  projectId: string,
  branch: string,
): Promise<MergeResult> {
  return request<MergeResult>(
    `/api/projects/${encodeURIComponent(projectId)}/merge`,
    jsonInit('POST', { branch }),
  )
}

export function gitListStashes(projectId: string): Promise<StashEntry[]> {
  return request<StashEntry[]>(
    `/api/projects/${encodeURIComponent(projectId)}/stashes`,
  )
}

export function gitCreateStash(
  projectId: string,
  message?: string,
): Promise<StashOpResult> {
  return request<StashOpResult>(
    `/api/projects/${encodeURIComponent(projectId)}/stash`,
    jsonInit('POST', message ? { message } : {}),
  )
}

export function gitPopStash(projectId: string): Promise<StashOpResult> {
  return request<StashOpResult>(
    `/api/projects/${encodeURIComponent(projectId)}/stash/pop`,
    jsonInit('POST', {}),
  )
}

export function gitResetSoftLastCommit(projectId: string): Promise<ResetResult> {
  return request<ResetResult>(
    `/api/projects/${encodeURIComponent(projectId)}/reset-soft`,
    jsonInit('POST', {}),
  )
}

export function initProjectCliConfig(
  projectId: string,
  variants: Array<'claude' | 'codex'>,
  force = false,
): Promise<{ ok: boolean; changed: string[] }> {
  return request(
    `/api/projects/${encodeURIComponent(projectId)}/cli-configs/init`,
    jsonInit('POST', { variants, force }),
  )
}

// ---------- Dev Docs ----------

export function listDocsTasks(projectId: string): Promise<DocTaskSummary[]> {
  return request<DocTaskSummary[]>(
    `/api/projects/${encodeURIComponent(projectId)}/docs`,
  )
}

export function getDocsFile(
  projectId: string,
  task: string,
  kind: DocFileKind,
): Promise<DocFileContent> {
  const qs = new URLSearchParams({ kind })
  return request<DocFileContent>(
    `/api/projects/${encodeURIComponent(projectId)}/docs/${encodeURIComponent(task)}/file?${qs}`,
  )
}

export function createDocsTask(
  projectId: string,
  name: string,
): Promise<DocTaskSummary> {
  return request<DocTaskSummary>(
    `/api/projects/${encodeURIComponent(projectId)}/docs`,
    jsonInit('POST', { name }),
  )
}

export function archiveDocsTask(
  projectId: string,
  name: string,
): Promise<{ archivedAs: string }> {
  return request(
    `/api/projects/${encodeURIComponent(projectId)}/docs/${encodeURIComponent(name)}/archive`,
    { method: 'POST' },
  )
}

// ---------- Comments（md 文件 tab 评论） ----------

export function listComments(
  projectId: string,
  path: string,
): Promise<CommentsList> {
  const qs = new URLSearchParams({ path })
  return request<CommentsList>(
    `/api/projects/${encodeURIComponent(projectId)}/comments?${qs}`,
  )
}

export function createComment(
  projectId: string,
  path: string,
  anchor: CommentAnchor,
  body: string,
): Promise<CommentEntry> {
  return request<CommentEntry>(
    `/api/projects/${encodeURIComponent(projectId)}/comments`,
    jsonInit('POST', { path, anchor, body }),
  )
}

export function updateComment(
  projectId: string,
  commentId: string,
  path: string,
  body: string,
): Promise<CommentEntry> {
  return request<CommentEntry>(
    `/api/projects/${encodeURIComponent(projectId)}/comments/${encodeURIComponent(commentId)}`,
    jsonInit('PATCH', { path, body }),
  )
}

export function deleteComment(
  projectId: string,
  commentId: string,
  path: string,
): Promise<void> {
  const qs = new URLSearchParams({ path })
  return request<void>(
    `/api/projects/${encodeURIComponent(projectId)}/comments/${encodeURIComponent(commentId)}?${qs}`,
    { method: 'DELETE' },
  )
}

// ---------- Issues 档案 ----------

export function listIssues(projectId: string): Promise<IssuesPayload> {
  return request<IssuesPayload>(
    `/api/projects/${encodeURIComponent(projectId)}/issues`,
  )
}

// ---------- 记忆 ----------

export function getMemory(projectId: string): Promise<MemoryPayload> {
  return request<MemoryPayload>(
    `/api/projects/${encodeURIComponent(projectId)}/memory`,
  )
}

export function rollbackMemory(
  projectId: string,
  items: MemoryRollbackSelection[],
): Promise<MemoryPayload> {
  return request<MemoryPayload>(
    `/api/projects/${encodeURIComponent(projectId)}/memory/rollback`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items }),
    },
  )
}

// ---------- Output (策划方案清单) ----------

export function listOutput(projectId: string): Promise<OutputListResult> {
  return request<OutputListResult>(
    `/api/projects/${encodeURIComponent(projectId)}/output`,
  )
}

export function getChecklist(
  projectId: string,
  feature: string,
): Promise<ChecklistDoc> {
  return request<ChecklistDoc>(
    `/api/projects/${encodeURIComponent(projectId)}/output/${encodeURIComponent(feature)}/checklist`,
  )
}

export function patchChecklistItem(
  projectId: string,
  feature: string,
  sectionId: string,
  itemId: string,
  patch: Record<string, unknown>,
): Promise<ChecklistDoc> {
  return request<ChecklistDoc>(
    `/api/projects/${encodeURIComponent(projectId)}/output/${encodeURIComponent(feature)}/checklist`,
    jsonInit('PATCH', { sectionId, itemId, patch }),
  )
}

// ---------- Perf ----------

export function getProjectPerf(projectId: string): Promise<ProjectPerf> {
  return request<ProjectPerf>(
    `/api/projects/${encodeURIComponent(projectId)}/metrics`,
  )
}

// ---------- FS operations (context menu) ----------

export function openInFolder(
  projectId: string,
  path: string,
): Promise<{ ok: boolean }> {
  return request(
    `/api/projects/${encodeURIComponent(projectId)}/fs/open-folder`,
    jsonInit('POST', { path }),
  )
}

export function gitignoreAdd(
  projectId: string,
  path: string,
): Promise<{ added: boolean; line: string }> {
  return request(
    `/api/projects/${encodeURIComponent(projectId)}/fs/gitignore-add`,
    jsonInit('POST', { path }),
  )
}

export function deleteEntry(projectId: string, path: string): Promise<void> {
  const qs = new URLSearchParams({ path })
  return request<void>(
    `/api/projects/${encodeURIComponent(projectId)}/fs/entry?${qs}`,
    { method: 'DELETE' },
  )
}

export function openInVscode(projectId: string): Promise<{ ok: boolean }> {
  return request(
    `/api/projects/${encodeURIComponent(projectId)}/fs/open-vscode`,
    { method: 'POST' },
  )
}

export function openInBrowser(
  projectId: string,
  path: string,
): Promise<{ ok: boolean }> {
  return request(
    `/api/projects/${encodeURIComponent(projectId)}/fs/open-in-browser`,
    jsonInit('POST', { path }),
  )
}

// ---------- Paste image ----------

export interface PastedImageResult {
  relPath: string
  absPath: string
  bytes: number
  mime: string
}

/**
 * Upload a pasted image blob to the project. Uses multipart/form-data directly
 * (not the JSON-centric `request` helper) so the browser can generate the
 * boundary automatically. Throws a decorated Error on non-2xx like `request`.
 */
export async function uploadPastedImage(
  projectId: string,
  sessionId: string,
  blob: Blob,
  mime: string,
): Promise<PastedImageResult> {
  const form = new FormData()
  // @fastify/multipart uses the field name `file` by convention when there's
  // only one file; we give the part a deterministic name so the server sees a
  // predictable filename during debugging.
  const ext = mime.split('/')[1] ?? 'bin'
  form.append('file', blob, `paste.${ext}`)
  form.append('sessionId', sessionId)

  const res = await fetch(
    `${BASE}/api/projects/${encodeURIComponent(projectId)}/paste-image`,
    { method: 'POST', body: form },
  )
  if (!res.ok) {
    let detail: string | undefined
    let errorCode: string | undefined
    try {
      const body = (await res.json()) as { error?: string; message?: string }
      errorCode = body.error ?? body.message
    } catch {
      try { detail = await res.text() } catch { /* ignore */ }
    }
    const err = new Error(
      `${res.status} ${res.statusText}${errorCode ? `: ${errorCode}` : ''}${detail ? ` - ${detail}` : ''}`,
    ) as Error & { status: number; code?: string }
    err.status = res.status
    err.code = errorCode
    throw err
  }
  return (await res.json()) as PastedImageResult
}

// ---------- Skill catalog ----------

export async function scanSkillCatalog(
  projectId: string,
  agentType: SkillAgentType,
): Promise<SkillCatalogResult> {
  return request<SkillCatalogResult>(
    `/api/projects/${encodeURIComponent(projectId)}/skill-catalog/${encodeURIComponent(agentType)}`,
  )
}

export async function addSkillToProject(
  projectId: string,
  agentType: SkillAgentType,
  body: { srcPath: string; useSymlink?: boolean },
): Promise<SkillAddResult> {
  return request<SkillAddResult>(
    `/api/projects/${encodeURIComponent(projectId)}/skill-catalog/${encodeURIComponent(agentType)}/add`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

export async function removeSkillFromProject(
  projectId: string,
  agentType: SkillAgentType,
  body: { skillName: string },
): Promise<SkillRemoveResult> {
  return request<SkillRemoveResult>(
    `/api/projects/${encodeURIComponent(projectId)}/skill-catalog/${encodeURIComponent(agentType)}/remove`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
}

// ---------- Skill market (二期) ----------

export async function searchSkillMarket(
  q: string,
  source: SkillMarketSearchSource = 'all',
  page = 1,
  limit = 20,
): Promise<MarketSearchResult> {
  const qs = new URLSearchParams({
    q,
    source,
    page: String(page),
    limit: String(limit),
  })
  return request<MarketSearchResult>(`/api/skill-market/search?${qs}`)
}

export async function downloadSkillFromMarket(body: {
  repoUrl: string
  skillName: string
}): Promise<DownloadSkillResult> {
  return request<DownloadSkillResult>(`/api/skill-market/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function getSkillLibrary(): Promise<LocalLibrary> {
  return request<LocalLibrary>(`/api/skill-market/library`)
}

export async function getSkillLibraryPath(): Promise<{ path: string }> {
  return request<{ path: string }>(`/api/skill-market/library/path`)
}

export async function setSkillLibraryPath(body: {
  path: string
  migrate?: boolean
}): Promise<SetLibraryPathResult> {
  return request<SetLibraryPathResult>(`/api/skill-market/library/path`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function deleteLibrarySkill(body: {
  name: string
  source: 'official' | 'custom'
}): Promise<DeleteLibrarySkillResult> {
  return request<DeleteLibrarySkillResult>(`/api/skill-market/library/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
