// Browser Notification helper for waiting_input transitions.
// Routes through the Service Worker when available (so notifications stay
// alive after the tab is closed and support action buttons), and falls back
// to the legacy `new Notification(...)` path otherwise.

export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported'

export function currentPermission(): NotificationPermissionState {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission as NotificationPermissionState
}

export async function requestPermission(): Promise<NotificationPermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission !== 'default') {
    return Notification.permission as NotificationPermissionState
  }
  try {
    const r = await Notification.requestPermission()
    return r as NotificationPermissionState
  } catch {
    return Notification.permission as NotificationPermissionState
  }
}

/** Treat the page as "focused" only when the tab is visible AND has window focus. */
export function isPageFocused(): boolean {
  if (typeof document === 'undefined') return true
  if (document.visibilityState !== 'visible') return false
  if (typeof document.hasFocus === 'function') return document.hasFocus()
  return true
}

export interface NotifyResult {
  /** true when an OS notification was actually shown (or posted to the SW) */
  shown: boolean
  /** true when the page was focused and we suppressed everything */
  suppressedByFocus: boolean
}

function hasServiceWorker(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

/**
 * 区分两类 waiting_input 通知：
 *  - 'permission'：Claude 在请求授权（Notification hook 文案固定为
 *    "...needs your permission to use X"）→ 通知上给"同意/拒绝"快捷按钮。
 *  - 'generic'：单纯等输入 / 对话结束 → 保持"打开会话 / 忽略 + 点击跳转"。
 * 只靠文案关键字判定，足够稳且不引入额外结构数据。
 */
export type NotifyKind = 'permission' | 'generic'

export function classifyNotification(detail?: string): NotifyKind {
  return /permission/i.test(detail ?? '') ? 'permission' : 'generic'
}

/**
 * Fire the OS notification.
 *
 * When the Service Worker is registered, route through it so the notification
 * survives tab closure and supports action buttons; the SW posts a
 * `focus-session` message back on click which main.tsx handles.
 *
 * When no SW is available, fall back to a hardened `new Notification(...)`.
 */
export function notifyWaitingInput(
  sessionId: string,
  projectName: string,
  agent: string,
  detail?: string,
  projectId?: string,
  onClick?: () => void,
  suppress?: boolean,
): NotifyResult {
  // 是否抑制由调用方（store）决定：只有"页面聚焦 且 正看着触发通知的那个项目"
  // 才算用户已在现场。看别的项目 / 全部列表 / 窗口在后台都照常弹（跨项目提醒）。
  if (suppress) return { shown: false, suppressedByFocus: true }
  if (typeof Notification === 'undefined') return { shown: false, suppressedByFocus: false }
  if (Notification.permission !== 'granted') return { shown: false, suppressedByFocus: false }

  const kind = classifyNotification(detail)
  const title =
    kind === 'permission'
      ? `aimon: ${projectName} 请求授权`
      : `aimon: ${projectName} 等待输入`
  // 正文多带点信息：哪个 AI + Claude 给的提示文字（detail）。detail 缺失时退回只显示 agent。
  const body = detail ? `${agent} · ${detail}` : agent

  if (hasServiceWorker()) {
    // Async path; we optimistically return `shown: true` — if the SW is not
    // ready yet we fall back to the legacy Notification in the catch.
    navigator.serviceWorker.ready
      .then((reg) => {
        if (reg.active) {
          reg.active.postMessage({
            type: 'notify',
            title,
            body,
            sessionId,
            projectId,
            projectName,
            kind,
          })
        } else {
          showLegacyNotification(title, body, sessionId, projectId, onClick)
        }
      })
      .catch(() => {
        showLegacyNotification(title, body, sessionId, projectId, onClick)
      })
    return { shown: true, suppressedByFocus: false }
  }

  return showLegacyNotification(title, body, sessionId, projectId, onClick)
}

function showLegacyNotification(
  title: string,
  body: string,
  sessionId: string,
  projectId: string | undefined,
  onClick: (() => void) | undefined,
): NotifyResult {
  try {
    const n = new Notification(title, {
      body,
      tag: sessionId,
      requireInteraction: true,
      renotify: true,
      silent: false,
      icon: '/favicon.ico',
      data: { sessionId, projectId },
    } as NotificationOptions)
    if (onClick) {
      n.onclick = () => {
        try { window.focus() } catch { /* ignore */ }
        try { onClick() } catch { /* ignore */ }
        try { n.close() } catch { /* ignore */ }
      }
    }
    return { shown: true, suppressedByFocus: false }
  } catch {
    return { shown: false, suppressedByFocus: false }
  }
}
