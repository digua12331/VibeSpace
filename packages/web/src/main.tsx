import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { aimonWS } from './ws'
import { useStore } from './store'
import { pushLog, logAction, testBackendLog } from './logs'
import './index.css'

if (import.meta.env.DEV) {
  // Long-lived dev namespace. Guarded by Vite's import.meta.env.DEV so Rollup
  // tree-shakes the whole block out of the production bundle.
  ;(window as unknown as { __vibe: unknown }).__vibe = {
    pushLog,
    logAction,
    testBackendLog,
    clearLogs: () => useStore.getState().clearLogs(),
  }
}

window.addEventListener('contextmenu', (e) => e.preventDefault())

aimonWS.onConnectionChange((s) => useStore.getState().setWsState(s))
aimonWS.onMessage((msg) => {
  const st = useStore.getState()
  switch (msg.type) {
    case 'hello':
      st.setServerVersion(msg.serverVersion)
      break
    case 'status':
      st.updateSessionStatus(msg.sessionId, msg.status, msg.detail)
      break
    case 'exit':
      st.markSessionExit(msg.sessionId, msg.code)
      break
    case 'log':
      pushLog({
        level: msg.level,
        scope: msg.scope,
        msg: msg.msg,
        projectId: msg.projectId,
        sessionId: msg.sessionId,
        meta: msg.meta,
        _fromServer: true,
      })
      break
    case 'error-pattern-alert':
      st.appendAlert(msg.alert)
      break
    case 'mem-stats':
      st.setMemByProject(msg.byProject)
      break
    default:
      break
  }
})
aimonWS.connect()

// Register the service worker for strong notifications (survives tab close,
// supports action buttons, delivers `notificationclick` to sw.js).
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => {
    // Don't crash the app — fall back to legacy new Notification() in notify.ts.
    console.warn('[aimon] service worker register failed:', err)
  })

  navigator.serviceWorker.addEventListener('message', (e) => {
    const data = e.data as {
      type?: string
      sessionId?: string
      projectId?: string
      response?: string
    } | null
    if (!data || !data.sessionId) return
    if (data.type === 'focus-session') {
      focusSession(data.sessionId, data.projectId)
      return
    }
    if (data.type === 'session-response') {
      handleNotificationResponse(data.sessionId, data.response, data.projectId)
      return
    }
  })
}

// 授权类通知上点"同意并不再问/拒绝"后，把对应按键发给该终端。
// Claude 授权弹窗是 numbered-select：默认高亮第 1 项 "Yes"，第 2 项 "Yes, and
// don't ask again"，第 3 项 "No"。
//  - approve（同意并不再问）= 下方向键把高亮移到第 2 项，再回车确认 = '\x1b[B\r'
//  - reject（拒绝）= Esc 取消 = '\x1b'
// 这些按键依赖 Claude 弹窗的现有布局，Claude 大改交互（如调整选项顺序）时改这一处常量即可。
const NOTIFY_RESPONSE_KEYS: Record<string, string> = {
  approve: '\x1b[B\r',
  reject: '\x1b',
}

function handleNotificationResponse(
  sessionId: string,
  response: string | undefined,
  projectId?: string,
) {
  const key = response ? NOTIFY_RESPONSE_KEYS[response] : undefined
  if (!key) return
  aimonWS.sendInput(sessionId, key)
  useStore.getState().clearNotify(sessionId)
  pushLog({
    level: 'info',
    scope: 'session',
    msg: `从通知${response === 'approve' ? '同意' : '拒绝'}授权`,
    projectId,
    sessionId,
    meta: { response, via: 'notification' },
  })
}

// Deeplink: ?session=<id> — when the user clicks a notification while no
// aimon tab is open, sw.js opens a new window at /?session=<id>; honor it
// once sessions are loaded.
function handleSessionDeeplink() {
  const params = new URLSearchParams(window.location.search)
  const sid = params.get('session')
  if (!sid) return
  // Wait for sessions to populate before trying to focus.
  const tryFocus = () => {
    const st = useStore.getState()
    const sess = st.sessions.find((s) => s.id === sid)
    if (!sess) return false
    focusSession(sid, sess.projectId)
    // Strip the query param so a page refresh doesn't keep re-scrolling.
    const url = new URL(window.location.href)
    url.searchParams.delete('session')
    window.history.replaceState({}, '', url.toString())
    return true
  }
  if (tryFocus()) return
  const unsub = useStore.subscribe((state, prev) => {
    if (state.sessions !== prev.sessions) {
      if (tryFocus()) unsub()
    }
  })
  // Give up after 15s so we don't leak the subscription forever.
  setTimeout(() => unsub(), 15000)
}

function focusSession(sessionId: string, projectId?: string) {
  try { window.focus() } catch { /* ignore */ }
  const st = useStore.getState()
  if (projectId) st.selectProject(projectId)
  st.clearNotify(sessionId)
  // Switch the terminal tab to the notifying session.
  st.setActiveSession(projectId ?? '__all__', sessionId)
}

handleSessionDeeplink()

const root = document.getElementById('root')
if (!root) throw new Error('root element missing')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
