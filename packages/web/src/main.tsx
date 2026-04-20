import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { aimonWS } from './ws'
import { useStore } from './store'
import './index.css'

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
    const data = e.data as { type?: string; sessionId?: string; projectId?: string } | null
    if (!data || data.type !== 'focus-session' || !data.sessionId) return
    focusSession(data.sessionId, data.projectId)
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
