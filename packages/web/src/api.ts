import type {
  AgentKind,
  BranchRef,
  ChangesResponse,
  CliConfigSavePayload,
  CliConfigState,
  CliEntry,
  CliStatusResponse,
  CommitDetail,
  CommitResult,
  CommitSummary,
  DiffResult,
  DocFileContent,
  DocFileKind,
  DocTaskSummary,
  FileContent,
  GitRef,
  GraphCommit,
  InstallJob,
  PermissionCatalog,
  Project,
  ProjectFilesResult,
  ProjectPerf,
  Session,
} from './types'

const BASE: string =
  (import.meta.env.VITE_AIMON_BACKEND as string | undefined) ?? 'http://127.0.0.1:8787'

export function backendBase(): string {
  return BASE
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    let detail: string | undefined
    let errorCode: string | undefined
    try {
      const body = (await res.json()) as { error?: string; detail?: string; message?: string }
      errorCode = body.error ?? body.message
      detail = body.detail
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
  path: string
  applyDevDocsGuidelines?: boolean
}): Promise<Project> {
  return request<Project>('/api/projects', jsonInit('POST', input))
}

export function applyDevDocsGuidelines(
  projectId: string,
): Promise<{ ok: boolean; wrote: boolean; target: string }> {
  return request(
    `/api/projects/${encodeURIComponent(projectId)}/apply-dev-docs`,
    { method: 'POST' },
  )
}

export function deleteProject(id: string): Promise<void> {
  return request<void>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function listSessions(projectId?: string): Promise<Session[]> {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return request<Session[]>(`/api/sessions${qs}`)
}

export function createSession(input: { projectId: string; agent: AgentKind }): Promise<Session> {
  return request<Session>('/api/sessions', jsonInit('POST', input))
}

export function deleteSession(id: string): Promise<void> {
  return request<void>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
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
