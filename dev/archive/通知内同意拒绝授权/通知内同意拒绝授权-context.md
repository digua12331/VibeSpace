# 通知内同意拒绝授权 · context

## 关键文件
- `packages/web/src/notify.ts` —— `notifyWaitingInput`（L54）已收 detail/agent/sessionId/projectId，在此判定 kind 并塞进 SW postMessage（L75-82）。legacy 路径不支持 actions，授权类降级为跳转。
- `packages/web/public/sw.js` —— message handler（L17-36）渲染 actions；notificationclick（L38-63）处理 action。新增 approve/reject 分支。
- `packages/web/src/main.tsx` —— SW message 监听（L66-70）现仅处理 `focus-session`；新增 `session-response` 分支 + `handleNotificationResponse`。已 import `aimonWS`/`useStore`/`pushLog`。`focusSession`（L102）可复用。
- 触发源（不改，仅理解）：`status.ts::handleClaudeHook` 的 `Notification` 事件 → `waiting_input` + detail=message；store.ts L778 `updateSessionStatus` 调 `notifyWaitingInput`。
- 输入通道（不改）：`aimonWS.sendInput(id,data)` → WS `{type:'input',sessionId,data}`（ws.ts L134）。

## 决策记录
- **按键用 Enter/Esc 而非数字 1/3**：Claude 授权弹窗默认高亮第一项 Yes，Enter 直接确认最稳；Esc 是通用取消=No。避免猜"1/2/3 哪个是同意"——抽成 `NOTIFY_RESPONSE_KEYS` 常量集中一处，改版只改这里。资深视角不算过度。
- **SW→页面→WS 发送，不做后端兜底**：复用现有 WS 输入通道，零后端改动、易回滚。标签页关闭（无 client）这一罕见情形退化为开窗，不值得为它新增/改 hub 端点。
- **permission 判定用文案关键字**：detail 含 `permission`。Claude Notification hook 的 message 对授权固定是 "...needs your permission to use X"，对纯等待是 "...waiting for your input"，关键字足够区分，不引入额外结构。
- 不抢焦点：approve/reject 只 postMessage，不 `client.focus()`——大哥在别的应用里点同意后应留在原处。

## 依赖与约束
- 仅 SW 路径支持动作按钮（`registration.showNotification` 的 actions）；legacy `new Notification` 无 actions。
- 浏览器系统通知动作按钮上限通常 2 个 → 授权类正好放满（同意/拒绝），主体点击仍可跳转。
- 操作日志：从通知发输入属用户可感知 mutation，但 sendInput 是 fire-and-forget 无异步可等，按规则用单条 pushLog（info）记录即可，scope=session。
- 验收命令：`pnpm -F @aimon/web build`（兼类型检查）。
