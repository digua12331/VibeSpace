# Windows 强通知 + 后台不间断 + 点击跳转回话 · 中文方案

> 面向 aimon（浏览器版 AI CLI 监控面板）当前项目的落地方案。
> 目标：在 Windows 上即使浏览器切后台 / 最小化 / 任务栏隐藏，也能收到强通知；
> 点击通知能**精确跳转到对应 session 窗口**继续编辑；整套机制不打断用户正在做的其他事。

---

## 1. 现状与问题

当前实现（[packages/web/src/notify.ts](../packages/web/src/notify.ts)，在 [store.ts:127](../packages/web/src/store.ts#L127) 被调用）：

- 使用浏览器 `new Notification(...)`。
- 仅当 `waiting_input` 状态翻转且页面未聚焦时弹出；以 `sessionId` 作为 `tag` 合并。
- 点击通知只调 `window.focus()` 和 `selectProject(projectId)`。
- 附带标题栏闪烁提醒。

**硬伤：**
| 问题 | 根因 |
|---|---|
| 通知自动 4~6 秒消失 | 未设置 `requireInteraction` |
| 浏览器被最小化 / Chrome 后台节流时可能丢通知 | 通知来自前台 Tab JS，而非 Service Worker |
| 关闭标签页后完全收不到 | 没有 Service Worker，没有 Push |
| 点击只能聚焦“某个浏览器窗口”，无法定位到某个 session 的 tile | 没有携带 session 路由参数 |
| 与 Windows 焦点助手 / 免打扰集成弱 | 浏览器非 UWP/MSIX，不进入操作中心（Action Center） |
| 没有按钮（确认 / 忽略） | 原生 Notification 不支持 actions |

---

## 2. 方案总览（按改造成本递增）

| 方案 | 改造量 | 强度 | 是否进操作中心 | 后台存活 | 可精确跳转 session |
|---|---|---|---|---|---|
| **A. 现有通知加固** | 30 行 | 低 | 否 | 前台 tab 存活 | 中（只能聚焦 tab） |
| **B. Service Worker + 通知** | 1 个 sw.js + 路由改造 | 中 | 部分（Chrome/Edge 会） | 关闭 tab 仍能收到（浏览器进程在） | 强 |
| **C. PWA 安装为桌面应用** | B 的基础上加 manifest | 中 | **是，进入操作中心** | 装成独立应用、开机自启 | 强 |
| **D. 后端调用 Windows 原生 Toast** | 加 powershell / node 库 | 中 | **是，原生 WinRT Toast** | 与浏览器无关 | 强（URI 协议深链） |
| **E. Electron/Tauri 壳** | 新建一个包 | 高 | 是 | 系统托盘常驻 | 最强 |

**推荐组合（最优性价比）：B + C + D**
- B/C 让面板本身变成带徽章、带强通知的 PWA；
- D 在“非常需要用户介入”时再加一层后端原生 Toast 兜底。

下面给出完整的落地步骤与代码样板。

---

## 3. 方案 A：现有通知加固（先做这个，10 分钟）

直接改 [packages/web/src/notify.ts](../packages/web/src/notify.ts)。

```ts
// notify.ts
const n = new Notification(`aimon: ${projectName} 等待输入`, {
  body: detail || agent,
  tag: sessionId,
  requireInteraction: true,   // ✅ 不自动消失，直到用户点击或关闭
  renotify: true,             // ✅ 同一个 tag 再次响铃，不静默合并
  silent: false,              // ✅ 播放系统提示音
  icon: '/favicon.ico',       // 任务栏/通知中心图标
  data: { sessionId, projectId: sess.projectId }, // 点击时能读到
})
```

并在用户浏览器首次授权时，请他把系统 **设置 → 系统 → 通知 → 浏览器** 打开“允许”，关闭“焦点助手”屏蔽，否则再强都会被 Windows 吞掉。

局限：**关闭 Tab 页或 Chrome 被后台彻底挂起仍收不到**。

---

## 4. 方案 B：Service Worker + `showNotification`（核心）

Service Worker 在浏览器进程存活期间、即使 tab 关闭也能后台运行，而且 `ServiceWorkerRegistration.showNotification()` 支持 `actions` 按钮，点击行为走 `notificationclick` 事件，能精确路由到指定 session。

### 4.1 新增 `packages/web/public/sw.js`

```js
// packages/web/public/sw.js
self.addEventListener('install', (e) => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

// 前台页面 postMessage 过来的通知请求
self.addEventListener('message', (event) => {
  const msg = event.data
  if (msg?.type !== 'notify') return
  const { title, body, sessionId, projectId, projectName } = msg
  self.registration.showNotification(title, {
    body,
    tag: sessionId,
    renotify: true,
    requireInteraction: true,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: { sessionId, projectId, url: `/?session=${sessionId}` },
    actions: [
      { action: 'open', title: '打开会话' },
      { action: 'dismiss', title: '忽略' },
    ],
  })
})

// 点击通知 → 聚焦已有窗口 / 打开新窗口 → 告诉前端跳转到该 session
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  if (event.action === 'dismiss') return
  const { sessionId, projectId, url } = event.notification.data || {}
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of all) {
      // 已有 aimon 窗口 → 聚焦并 postMessage 路由
      if (c.url.includes('/') && 'focus' in c) {
        c.postMessage({ type: 'focus-session', sessionId, projectId })
        return c.focus()
      }
    }
    // 没有就开一个新窗口，URL 带上 session 参数
    return self.clients.openWindow(url || '/')
  })())
})
```

### 4.2 在前端注册 SW 并转发消息

在 `packages/web/src/main.tsx` 顶部：

```ts
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(console.error)
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'focus-session') {
      window.focus()
      // 走 zustand：选中项目 + 高亮该 session tile
      const { selectProject, clearNotify } = (window as any).__aimonStore?.getState?.() ?? {}
      selectProject?.(e.data.projectId)
      clearNotify?.(e.data.sessionId)
      document.getElementById(`tile-${e.data.sessionId}`)?.scrollIntoView({ behavior: 'smooth' })
    }
  })
}
```

在 `packages/web/src/store.ts` 暴露 store 给 SW 消息通道用（仅开发可调）：
```ts
if (typeof window !== 'undefined') (window as any).__aimonStore = useStore
```

### 4.3 改造 `notifyWaitingInput` 走 SW

```ts
export function notifyWaitingInput(sessionId, projectName, agent, detail, projectId) {
  if (isPageFocused()) return { shown: false, suppressedByFocus: true }
  if (Notification.permission !== 'granted') return { shown: false, suppressedByFocus: false }
  navigator.serviceWorker.ready.then((reg) => {
    reg.active?.postMessage({
      type: 'notify',
      title: `aimon: ${projectName} 等待输入`,
      body: detail || agent,
      sessionId, projectId, projectName,
    })
  })
  return { shown: true, suppressedByFocus: false }
}
```

### 4.4 给 `SessionTile` 加 `id="tile-${sessionId}"`，便于 scroll 定位

定位到 [packages/web/src/components/SessionTile.tsx](../packages/web/src/components/SessionTile.tsx) 最外层 `div` 加 `id`。

**效果**：
- 浏览器后台 / 最小化 / tab 被换掉时，通知依然弹出；
- 通知不自动消失，带“打开会话 / 忽略”按钮；
- 点击后：若 aimon 窗口已开 → 直接聚焦并滚到对应 tile；若没开 → 新窗口带 `?session=xxx`，前端自动定位。

---

## 5. 方案 C：安装为 PWA，进入 Windows 操作中心

方案 B 的 SW 做完后，补一个 `manifest.webmanifest`，面板就能以“安装到桌面”的形式变成独立 Windows 应用。安装后：
- 有独立任务栏图标 & 开始菜单入口；
- 通知会**进入 Windows 操作中心**（右下角抽屉），即使 Edge/Chrome 关掉，只要 PWA 进程在也能收到；
- 支持 `Badging API`（任务栏图标红点数字）；
- 可以配置开机自启。

### 5.1 新增 `packages/web/public/manifest.webmanifest`

```json
{
  "name": "aimon — AI CLI 监控",
  "short_name": "aimon",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#0b0b0c",
  "theme_color": "#0b0b0c",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

在 [packages/web/index.html](../packages/web/index.html) `<head>` 加：
```html
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#0b0b0c" />
```

### 5.2 Badging API —— 等待中的 session 数反映到任务栏图标

在 `store.ts` 里的 `notifyingSessions` 变化时：
```ts
if ('setAppBadge' in navigator) {
  const n = get().notifyingSessions.size
  if (n > 0) (navigator as any).setAppBadge(n)
  else (navigator as any).clearAppBadge?.()
}
```

### 5.3 安装路径
用户首次打开面板后，Edge/Chrome 地址栏会出现“安装”按钮；或命令行：
```
msedge --app=http://127.0.0.1:8788
```

### 5.4 开机自启
安装后 `Win+R → shell:startup`，把开始菜单里 “aimon” 的快捷方式复制进去。或系统托盘方式由方案 E 提供。

---

## 6. 方案 D：服务端调用 Windows 原生 Toast（最强兜底）

完全不依赖浏览器。在服务端检测到 `waiting_input` 状态时，从后端直接发 WinRT Toast，点击 Toast 通过自定义 URI 协议唤起浏览器并跳到对应 session。适合“必须不丢通知”的场景。

### 6.1 在 [packages/server/src/status.ts](../packages/server/src/status.ts) 新增 `notify-win.ts`

```ts
// packages/server/src/notify-win.ts
import { spawn } from 'node:child_process'

export function toastWaitingInput(opts: {
  sessionId: string
  projectName: string
  detail?: string
  // aimon 自定义 URI：aimon://session/<id>
  deeplink?: string
}) {
  const xml = `
<toast launch="${opts.deeplink ?? `aimon://session/${opts.sessionId}`}" activationType="protocol">
  <visual><binding template="ToastGeneric">
    <text>aimon: ${opts.projectName} 等待输入</text>
    <text>${opts.detail ?? ''}</text>
  </binding></visual>
  <actions>
    <action content="打开会话" arguments="open" activationType="protocol"
            protocol="${opts.deeplink ?? `aimon://session/${opts.sessionId}`}" />
    <action content="忽略" arguments="dismiss" />
  </actions>
  <audio src="ms-winsoundevent:Notification.IM" />
</toast>`
  const ps = `
$ErrorActionPreference='Stop'
[Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml(@'${xml}'@)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('aimon').Show($toast)
`
  spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore' })
    .on('error', () => {})
}
```

在 [status.ts](../packages/server/src/status.ts) 状态翻转到 `waiting_input` 时调用。`activationType="protocol"` + `launch="aimon://..."` 是关键：Windows 会用 URI 协议启动关联程序。

### 6.2 注册自定义协议 `aimon://`

一次性写注册表（打包成 `.reg` 或安装脚本 scripts/register-protocol.reg）：

```
Windows Registry Editor Version 5.00

[HKEY_CURRENT_USER\Software\Classes\aimon]
@="URL:aimon Protocol"
"URL Protocol"=""

[HKEY_CURRENT_USER\Software\Classes\aimon\shell\open\command]
@="\"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\" \"http://127.0.0.1:8788/?session=%1\""
```

把 `%1` 中 `aimon://session/<id>` 的 `<id>` 直接拼到 URL，前端读 `?session=` 做精确定位（方案 B 已支持）。

### 6.3 更稳的替代：`@fabianlars/tauri-plugin-windows-toast` / node `node-notifier`

不想自己写 XML 的话：
```sh
pnpm --filter @aimon/server add node-notifier
```
```ts
import notifier from 'node-notifier'
notifier.notify({
  appID: 'aimon',          // 必须，否则 Windows 不进操作中心
  title: 'aimon 等待输入',
  message: detail,
  actions: ['打开会话'],
  wait: true,
}, (err, res, meta) => {
  if (res === 'activate') openBrowser(`http://127.0.0.1:8788/?session=${id}`)
})
```

注意：`appID` 需要先用 `node-notifier` 附带的 `snoretoast` 注册一次，否则 Windows 10/11 会把通知当“未识别来源”丢掉。

---

## 7. 方案 E：Electron / Tauri 壳（最终形态）

若希望：
- 开机自启；
- 系统托盘常驻（关闭窗口不等于退出）；
- 通知 100% 使用 Windows 原生 Toast，带完整 actions；
- 精确 `BrowserWindow.focus()` + IPC 跳转到指定 tile；

最小 Electron 骨架（新包 `packages/shell`）：

```ts
// packages/shell/main.ts
import { app, BrowserWindow, Notification, Tray } from 'electron'

app.setAppUserModelId('com.aimon.panel') // 决定 Toast 是否进入操作中心，必填
const win = new BrowserWindow({ width: 1440, height: 900 })
win.loadURL('http://127.0.0.1:8788')

// 后端通过 IPC / WS 告诉壳哪个 session 需要 waiting_input
function notify(sessionId: string, projectName: string, detail: string) {
  const n = new Notification({
    title: `aimon: ${projectName} 等待输入`,
    body: detail,
    silent: false,
    urgency: 'critical',
  })
  n.on('click', () => {
    win.show(); win.focus()
    win.webContents.send('focus-session', { sessionId })
  })
  n.show()
}
```

Tauri 同理更轻，但写法换为 `tauri-plugin-notification`。

---

## 8. 后台不间断工作的保障

即便通知机制到位，**浏览器后台节流**仍可能让 WebSocket 重连变慢。建议在 [packages/web/src/ws.ts](../packages/web/src/ws.ts) 基础上：

1. **Wake Lock** —— 面板聚焦并至少有一个 `working` session 时：
   ```ts
   const lock = await (navigator as any).wakeLock?.request('screen')
   ```
   防止系统待机期间状态漏收。
2. **心跳 + 指数退避重连** —— 已有 WebSocket 要加 `ping`（15s）+ `pong` 超时（30s）强制 `ws.close()` 重连；PWA/Electron 环境下这是后台可靠的唯一办法。
3. **SW 中转 WebSocket（可选）** —— 复杂，仅当 tab 常关时才值得。一般 PWA 场景靠 Browser Push（VAPID）即可。
4. **关闭 Chrome 的“内存节省程序”** —— 用户侧一次性设置：`chrome://settings/performance` 关掉 Memory Saver 对 `127.0.0.1:8788` 的冻结。

---

## 9. 推荐落地顺序

> 建议按下面顺序合并，每一步都可独立上线：

| # | 步骤 | 预计工作量 | 文件 |
|---|---|---|---|
| 1 | **方案 A** 立即加固现有通知（`requireInteraction`/`renotify`/`silent:false`/`data`） | 10 分钟 | [notify.ts](../packages/web/src/notify.ts) |
| 2 | **方案 B** 引入 `public/sw.js` + `notificationclick` 精确路由 + `?session=` URL | 1 小时 | 新增 sw.js、改 main.tsx/notify.ts/store.ts/SessionTile.tsx |
| 3 | **方案 C** 加 `manifest.webmanifest` 和 `setAppBadge`，安装为 PWA | 30 分钟 | public/manifest.webmanifest, index.html, store.ts |
| 4 | **方案 D** 服务端 `notify-win.ts` + `aimon://` 协议注册，作为强通知兜底 | 2 小时 | 新增 notify-win.ts、scripts/register-protocol.reg |
| 5 | **方案 E**（可选）Electron/Tauri 壳，带系统托盘与开机自启 | 1 天 | 新增 `packages/shell` |

---

## 10. 验收清单

- [ ] Edge/Chrome 全屏看视频，aimon 窗口被遮挡 —— 进入 `waiting_input` 能收到不消失的通知；
- [ ] 关掉 aimon tab（Chrome 仍在运行）—— 通知仍弹，点击能重新打开 tab 并定位到该 session；
- [ ] PWA 安装后，关闭 Edge 主浏览器 —— aimon PWA 进程仍在，通知正常；
- [ ] 方案 D 开启后，彻底关浏览器 —— 依然能弹 Windows Toast，点击通过 `aimon://` 深链拉起浏览器并滚到对应 tile；
- [ ] 焦点助手（勿扰模式）开启时，方案 D 的 Toast 会在操作中心堆积，解除勿扰后能批量看到；
- [ ] 多个 session 同时等待 —— 任务栏图标徽章显示数量（方案 C）。

---

## 11. 参考

- [MDN · Notification API](https://developer.mozilla.org/zh-CN/docs/Web/API/Notification)
- [MDN · ServiceWorkerRegistration.showNotification](https://developer.mozilla.org/zh-CN/docs/Web/API/ServiceWorkerRegistration/showNotification)
- [MDN · Badging API](https://developer.mozilla.org/zh-CN/docs/Web/API/Badging_API)
- [Microsoft · Toast content XML schema](https://learn.microsoft.com/zh-cn/windows/apps/design/shell/tiles-and-notifications/toast-xml-schema)
- [Electron Notification · urgency / actions](https://www.electronjs.org/docs/latest/api/notification)
- [node-notifier](https://github.com/mikaelbr/node-notifier)
