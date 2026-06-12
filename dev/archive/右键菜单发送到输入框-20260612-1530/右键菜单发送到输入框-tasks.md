# 右键菜单发送到输入框 · 任务清单

- [x] 1. store 加 `pendingInputBySession` + `queuePendingInput` + `consumePendingInput` → verify: `pnpm --filter @aimon/web exec tsc -b` 通过；zustand devtools / console `useStore.getState()` 能看到新字段
- [x] 2. SessionView 加 useEffect 消费 pending（拼 `inputRef.current.value + pending` → `fillInput` → `consumePendingInput`） → verify: 跟步骤 3 合并验证（此步仅过 typecheck）
- [x] 3. fileContextMenu 抽 `sendToSession` helper，替换两处 `aimonWS.sendInput`，用 `logAction('files','send-to-session',...)` 包起止；`aimonWS` import 保留（.bat 执行分支仍在用） → verify: `pnpm --filter @aimon/web exec tsc -b` 通过 ✓
- [ ] 4. 浏览器手测：启动 dev（server + web），任意项目开 ≥ 1 session；先停在一个文件编辑 tab 上，右键文件 → 发送到 XXX → 观察工作区自动切到终端、目标 session tab 激活、`<input>` 里有 `@<path> ` 且聚焦 → verify: 肉眼 ✅；LogsView 看到 `scope=files action=send-to-session` 起止配对
- [ ] 5. 浏览器手测追加语义：同一 session 连点两个不同文件的"发送到" → verify: `<input>` 里两个路径都在末尾拼接（不是后者覆盖前者），光标在末尾
- [ ] 6. 浏览器手测多 session：同一项目开 2 个 session，右键文件 → 子菜单选非当前激活的那个 → verify: tab 切到那个 session；`<input>` 填上路径；原本激活的 session `<input>` 保持原状
- [ ] 7. 失败分支日志验证：在浏览器 devtools 里手动把 `useStore.getState().queuePendingInput` 覆写成抛异常，然后右键发送 → verify: LogsView 看到 `scope=files action=send-to-session level=error`（这一条满足 CLAUDE.md 的"失败分支至少有一次 ERROR 条目被人工触发验证过"）
- [x] 8. 新建 `packages/web/src/sendToSession.ts`：`sendToSession` + `pickClaudeTarget`，迁移 logAction 逻辑；fileContextMenu.ts 删本地 helper 改 import，两处 onSelect 预先 `formatForSession` 再调 `sendToSession` → verify: `pnpm --filter @aimon/web exec tsc -b` 通过 ✓
- [x] 9. 改 DocsView.tsx `runDispatch`：`pickClaudeTarget` 找到 → `sendToSession(scope='docs')`；找不到 → 走原 `dispatchClaude` fallback → verify: typecheck 通过 ✓
- [ ] 10. 浏览器手测 Dev Docs 三个派发入口：(a) 有 claude session 时任务右键"派 Claude 继续任务"、单条问题 🤖、"派全部 (N)"三处都**不弹对话框**，切到 claude tab、input 填上 prompt；(b) 没有 claude session 时三处都**退回原行为**（新开 + 剪贴板 + 对话框） → verify: 肉眼 ✅；LogsView 看到 `scope=docs action=send-to-session` 起止配对
