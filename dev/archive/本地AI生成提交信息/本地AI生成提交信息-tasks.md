# 本地AI生成提交信息 · 任务清单

- [x] 步骤1 后端服务：local-ai-service.ts 加 runCommitMessage、删 runCommitCheck 及体检专用辅助 → verify: 后端 build 通过，无 runCommitCheck/scanDiff 残留 ✓
- [x] 步骤2 后端路由：routes/local-ai.ts commit-check→commit-message，serverLog 起止配对 → verify: grep "commit-check" 在 packages/ 无残留（仅 git-service 注释，已顺手改正）✓
- [x] 步骤3 前端 api/types：localAiCommitMessage + CommitMessageResult → verify: 前端 build 过类型 ✓
- [x] 步骤4 设置弹窗：通用页签加「本地 AI（提交信息）」provider+model 下拉，localStorage 持久化 → verify: pnpm -F @aimon/web build 通过 ✓（浏览器持久化待大哥手验）
- [x] 步骤5 提交面板：删体检 UI、加「✨ 生成」按钮调接口填 message → verify: pnpm -F @aimon/web build 通过 ✓（LogsView 起止配对 + error 分支待大哥浏览器手验）
- [x] 步骤6 文档对齐：更新 docs/local-ai-commit-message.md → verify: 已与实现一致 ✓
