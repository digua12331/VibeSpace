// aimon service worker
// Responsibilities:
//   1. Receive `notify` messages from the page and call showNotification so
//      the OS toast survives tab closure and supports action buttons.
//   2. Handle notificationclick: focus an existing aimon window if one is
//      open (and post back a `focus-session` message so the page can scroll
//      to the right tile), otherwise open a new window at `/?session=<id>`.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('message', (event) => {
  const msg = event.data
  if (!msg || msg.type !== 'notify') return
  const { title, body, sessionId, projectId, projectName } = msg
  const url = `/?session=${encodeURIComponent(sessionId)}`
  self.registration.showNotification(title, {
    body,
    tag: sessionId,
    renotify: true,
    requireInteraction: true,
    silent: false,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: { sessionId, projectId, projectName, url },
    actions: [
      { action: 'open', title: '打开会话' },
      { action: 'dismiss', title: '忽略' },
    ],
  })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  if (event.action === 'dismiss') return
  const data = event.notification.data || {}
  const { sessionId, projectId, url } = data
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of all) {
      // Any same-origin aimon window counts — focus it and tell the page
      // which session the user wanted to jump to.
      if ('focus' in client) {
        try {
          client.postMessage({ type: 'focus-session', sessionId, projectId })
        } catch {
          // ignore
        }
        try {
          return await client.focus()
        } catch {
          // fall through to openWindow
        }
      }
    }
    return self.clients.openWindow(url || '/')
  })())
})
