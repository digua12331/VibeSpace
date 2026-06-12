# 通知内同意拒绝授权 · 任务清单

- [x] 1. notify.ts 判定 kind（permission/generic）并传入 SW postMessage → verify: 类型检查过
- [x] 2. sw.js 授权类渲染 同意/拒绝 动作 + notificationclick approve/reject 分支（postMessage + 无 client 开窗兜底）→ verify: 授权通知显示两按钮
- [x] 3. main.tsx 监听 session-response → 映射按键发 WS + clearNotify + pushLog → verify: 点同意/拒绝终端有反应，日志面板见 `从通知同意/拒绝授权`
- [x] 4. `pnpm -F @aimon/web build` → verify: 构建/类型检查成功
