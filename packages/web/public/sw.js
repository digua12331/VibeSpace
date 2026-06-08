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

// 授权类通知（Claude 请求授权）给"同意/拒绝"快捷按钮，点了直接替大哥回答；
// 其余通知保持"打开会话/忽略"。系统通知动作按钮通常上限 2 个，正好放满。
const PERMISSION_ACTIONS = [
  { action: 'approve', title: '✅ 同意并不再问' },
  { action: 'reject', title: '❌ 拒绝' },
]
const GENERIC_ACTIONS = [
  { action: 'open', title: '打开会话' },
  { action: 'dismiss', title: '忽略' },
]

self.addEventListener('message', (event) => {
  const msg = event.data
  if (!msg || msg.type !== 'notify') return
  const { title, body, sessionId, projectId, projectName, kind } = msg
  const url = `/?session=${encodeURIComponent(sessionId)}`
  self.registration.showNotification(title, {
    body,
    tag: sessionId,
    renotify: true,
    requireInteraction: true,
    silent: false,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: { sessionId, projectId, projectName, url, kind },
    actions: kind === 'permission' ? PERMISSION_ACTIONS : GENERIC_ACTIONS,
  })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  if (event.action === 'dismiss') return
  const data = event.notification.data || {}
  const { sessionId, projectId, url } = data
  // 授权快捷按钮：把决定回传给已打开的页面，由页面经 WS 发给终端。不抢焦点——
  // 大哥可能正在别的应用里，点完同意应留在原处。没有任何已开页面（标签整个
  // 关了）才退化为开窗让其手动处理。
  if (event.action === 'approve' || event.action === 'reject') {
    event.waitUntil((async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      if (all.length > 0) {
        // 只投递给一个页面（优先聚焦的那个，否则取第一个）。开多个标签页时全发
        // 会让同一终端收到多组按键，授权框会乱跳——只发一次。
        const target = all.find((c) => c.focused) ?? all[0]
        try {
          target.postMessage({ type: 'session-response', sessionId, projectId, response: event.action })
        } catch {
          // ignore
        }
        return
      }
      return self.clients.openWindow(url || '/')
    })())
    return
  }
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
