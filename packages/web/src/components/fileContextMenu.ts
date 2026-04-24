import * as api from '../api'
import { logAction } from '../logs'
import { aimonWS } from '../ws'
import { useStore } from '../store'
import { sendToSession } from '../sendToSession'
import type { AgentKind } from '../types'
import { alertDialog, confirmDialog } from './dialog/DialogHost'
import type { ContextMenuItem } from './ContextMenu'

export interface FileContextSession {
  id: string
  agent: AgentKind
}

export interface FileContextOpts {
  projectId: string
  /** Repo-relative POSIX path. */
  path: string
  kind: 'file' | 'dir'
  /** Alive sessions belonging to this project, used for the "send to" submenu. */
  sessions: FileContextSession[]
  /** Called after a successful delete. */
  onAfterDelete?: () => void
  /** Called after a successful gitignore write. */
  onAfterGitignore?: () => void
}

const SHELL_AGENTS: AgentKind[] = ['shell', 'cmd', 'pwsh']

/**
 * AI agents accept `@<path>` as a file reference; shells don't, so we quote
 * the path to survive spaces.
 */
export function formatForSession(agent: AgentKind, path: string, kind: 'file' | 'dir'): string {
  const tail = kind === 'dir' ? `${path}/` : path
  if (SHELL_AGENTS.includes(agent)) return `"${tail}" `
  return `@${tail} `
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Fallback for non-secure contexts or missing permission: drop a hidden
    // <textarea>, select, execCommand('copy').
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
    } finally {
      document.body.removeChild(ta)
    }
  }
}

function shortTail(id: string): string {
  return id.slice(-6)
}

export function buildFileContextItems(opts: FileContextOpts): ContextMenuItem[] {
  const { projectId, path, kind, sessions } = opts
  const kindLabel = kind === 'dir' ? '目录' : '文件'
  const isBatch = kind === 'file' && /\.(bat|cmd)$/i.test(path)
  const isHtml = kind === 'file' && /\.(html?|xhtml)$/i.test(path)

  const sendItem: ContextMenuItem =
    sessions.length === 0
      ? {
          label: '发送到对话',
          icon: '➡',
          disabled: true,
        }
      : sessions.length === 1
        ? {
            label: `发送到 ${sessions[0].agent}·${shortTail(sessions[0].id)}`,
            icon: '➡',
            onSelect: () => {
              const text = formatForSession(sessions[0].agent, path, kind)
              void sendToSession(projectId, sessions[0], text, {
                scope: 'files',
                meta: { path, kind },
              })
            },
          }
        : {
            label: '发送到对话',
            icon: '➡',
            submenu: sessions.map((s) => ({
              label: `${s.agent}·${shortTail(s.id)}`,
              onSelect: () => {
                const text = formatForSession(s.agent, path, kind)
                void sendToSession(projectId, s, text, {
                  scope: 'files',
                  meta: { path, kind },
                })
              },
            })),
          }

  const browserItem: ContextMenuItem | null = isHtml
    ? {
        label: '在浏览器打开',
        icon: '🌐',
        onSelect: async () => {
          try {
            await logAction(
              'fs',
              'open-in-browser',
              () => api.openInBrowser(projectId, path),
              { projectId, meta: { path } },
            )
          } catch (e: unknown) {
            await alertDialog(
              e instanceof Error ? e.message : String(e),
              { title: '打开失败', variant: 'danger' },
            )
          }
        },
      }
    : null

  const execItem: ContextMenuItem | null = isBatch
    ? {
        label: '执行',
        icon: '▶',
        onSelect: async () => {
          try {
            const s = await api.createSession({ projectId, agent: 'cmd' })
            const st = useStore.getState()
            st.addSession(s)
            st.setActiveSession(projectId, s.id)
            st.setActiveTabKind('session')
            aimonWS.subscribe([s.id])
            // conpty 启动早期可能吞掉前几 byte，给 120ms 兜底
            await new Promise((r) => setTimeout(r, 120))
            const winPath = path.replace(/\//g, '\\')
            const slash = winPath.lastIndexOf('\\')
            const line =
              slash >= 0
                ? `cd /d "${winPath.slice(0, slash)}" && "${winPath.slice(slash + 1)}"\r`
                : `"${winPath}"\r`
            aimonWS.sendInput(s.id, line)
          } catch (e: unknown) {
            await alertDialog(
              e instanceof Error ? e.message : String(e),
              { title: '执行失败', variant: 'danger' },
            )
          }
        },
      }
    : null

  return [
    sendItem,
    { label: '复制路径', icon: '📋', onSelect: () => void copyToClipboard(path) },
    {
      label: '打开所在文件夹',
      icon: '🗂',
      onSelect: async () => {
        try {
          await api.openInFolder(projectId, path)
        } catch (e: unknown) {
          await alertDialog(
            `打开失败: ${e instanceof Error ? e.message : String(e)}`,
            { title: '打开文件夹失败', variant: 'danger' },
          )
        }
      },
    },
    ...(browserItem ? [browserItem] : []),
    ...(execItem ? [execItem] : []),
    {
      label: '添加到 .gitignore',
      icon: '🚫',
      onSelect: async () => {
        try {
          const r = await api.gitignoreAdd(projectId, path)
          if (!r.added) {
            await alertDialog(`已经在 .gitignore 里了: ${r.line}`, {
              title: '无需添加',
            })
          }
          opts.onAfterGitignore?.()
        } catch (e: unknown) {
          await alertDialog(
            e instanceof Error ? e.message : String(e),
            { title: '添加失败', variant: 'danger' },
          )
        }
      },
    },
    { divider: true, label: '' },
    {
      label: '删除',
      icon: '🗑',
      danger: true,
      onSelect: async () => {
        const message =
          kind === 'dir'
            ? `删除${kindLabel} "${path}"? 目录下所有内容会被一并永久删除。此操作不可撤销。`
            : `删除${kindLabel} "${path}"? 此操作不可撤销。`
        const ok = await confirmDialog(message, {
          title: `删除${kindLabel}`,
          variant: 'danger',
          confirmLabel: '删除',
        })
        if (!ok) return
        try {
          await api.deleteEntry(projectId, path)
          opts.onAfterDelete?.()
        } catch (e: unknown) {
          await alertDialog(
            e instanceof Error ? e.message : String(e),
            { title: '删除失败', variant: 'danger' },
          )
        }
      },
    },
  ]
}
