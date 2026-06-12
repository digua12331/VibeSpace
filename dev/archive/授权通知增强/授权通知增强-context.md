# 授权通知增强 · context

## 关键文件

- `packages/web/public/sw.js`
  - `PERMISSION_ACTIONS`（L19-22）：approve title 改文案。
  - `notificationclick`（L46-91）：approve/reject 分支当前 `for (const client of all) client.postMessage(...)` 全发 → 改为只投递一个 client（优先 focused，回退第一个）。`includeUncontrolled:true` 保留。
- `packages/web/src/main.tsx`
  - `NOTIFY_RESPONSE_KEYS`（L88-91）：approve `'\r'` → `'\x1b[B\r'`。
  - `handleNotificationResponse`（L93-）：保持，approve 语义变化仅在发的键，无需改日志逻辑。
- `packages/web/src/notify.ts`
  - `notifyWaitingInput`（L67-112）：移除内部 `isPageFocused()` 早退（L75），改成接收 caller 传入的 `suppress: boolean`。保留 `Notification` 存在性 + 权限 granted 检查。
  - `isPageFocused` 仍导出（store 要用）。
  - body 组装（L84）：`detail || agent` → 含 agent + detail。
- `packages/web/src/store.ts`
  - `updateSessionStatus`（L762-807）：waiting_input 分支计算 `suppress = isPageFocused() && get().selectedProjectId === sess.projectId`，传给 notifyWaitingInput；其余 nag 逻辑（notifyingSessions/title flash/app badge）保持。
  - `selectProject`（L615-）：选项目时清掉该项目下所有 notifying 会话。
  - 文件末尾 visibilitychange/focus 处理（L1096-1102）：`clearAllNotify()` → 只清当前选中项目的 notifying 会话（新增 `clearNotifyForProject` 或内联）。`clearAllNotify` 若无其它调用点可保留备用，不强删。
- `packages/web/src/components/layout/ProjectsColumn.tsx`
  - 由 `notifyingSessions`(store) + `sessions` 推出 `notifyingProjectIds:Set`；项目行（L279-334）加红点；"激活"分页标签（L220-234）加有提醒标记。

## 决策记录

- **抑制判断上移到 store**：notifyWaitingInput 拿不到 selectedProjectId，把"是否抑制"算好用参数传入——Codex 会审同此结论。不在通知函数里反查 store，保持 notify.ts 纯函数化。
- **项目红点由前端 session→project 聚合，不加后端字段**：Session.projectId 必填，前端现成数据够用（Codex 确认）。不碰后端/DB。
- **不抽新的全局 selector**：notifyingProjectIds 直接在 ProjectsColumn 内 useMemo 算，单处消费，避免为一次使用造抽象（防过度设计）。
- **clearAllNotify 不删**：改调用点即可，留着函数不算死代码风险（tab 真·全部已读场景未来可能用）；若最终无任何调用点，再在本次清理。
- **不加设置开关**：路 B 直接生效，不做"只这次同意"可配置项（大哥未要求）。
- **方向键序列 `\x1b[B\r`**：比发数字 `2` 更贴合 Claude 的 numbered-select 交互（数字键是否即时确认不确定）；下移一格高亮再回车，行为稳定可预期。单点常量，注释标注 Claude 改版时改此处。

## 依赖与约束

- OS 通知动作按钮上限 2 个 → 仍是 approve+reject 两个，文案变不增数量。
- `aimonWS.sendInput(sessionId, key)` 把字符串原样写入 PTY，无额外转义（Codex 确认）。
- generic 类通知（非授权）跟随同一套跨项目抑制规则；其按钮（打开会话/忽略）不变。
- 验收门槛：`pnpm -F @aimon/web build`（含 tsc）。不跑 browser-use（manual.md 2026-06-03）。
