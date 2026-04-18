import type {
  AgentKind,
  CliConfigSavePayload,
  CliConfigState,
  CliEntry,
  CliStatusResponse,
  InstallJob,
  PermissionCatalog,
  Project,
  ProjectLayout,
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

export function createProject(input: { name: string; path: string }): Promise<Project> {
  return request<Project>('/api/projects', jsonInit('POST', input))
}

export function deleteProject(id: string): Promise<void> {
  return request<void>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function getProjectLayout(projectId: string): Promise<ProjectLayout | null> {
  return request<ProjectLayout | null>(
    `/api/projects/${encodeURIComponent(projectId)}/layout`,
  )
}

export function saveProjectLayout(
  projectId: string,
  layout: Omit<ProjectLayout, 'updatedAt'>,
): Promise<{ ok: boolean }> {
  return request(
    `/api/projects/${encodeURIComponent(projectId)}/layout`,
    jsonInit('PUT', layout),
  )
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
