# 提交图右键发送到对话 · 任务清单

- [x] 步骤 1：GitGraph 接入 sessions/liveStatus，派生本项目存活、非 shell 的 AI 会话列表 → verify: `pnpm -F @aimon/web build` 通过
- [x] 步骤 2：写 handleCommitContext，弹「发送到对话」(三态) +「复制提交信息」，发送走 sendToSession(scope='graph') → verify: 浏览器右键提交行弹出菜单，点「发送到对话」后切到会话标签且输入框出现 `提交 <短哈希> "<标题>"`
- [x] 步骤 3：提交行 `<li>` 挂 onContextMenu → verify: 右键命中该行、不误触发左键打开详情
- [x] 步骤 4：终验 → verify: `pnpm -F @aimon/web build` 通过 + LogsView 看到 `scope=graph action=send-to-session` 起止配对 + `git diff --name-only HEAD` 只含 GitGraph.tsx（dev/ 文档除外）
