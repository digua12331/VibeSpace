# 未完成任务终端恢复 · 任务清单

- [x] 步骤 1：StartSessionMenu 加 `defaultTask` prop → verify: tsc 编译通过；浏览器手动调用菜单时输入框确实预填
- [x] 步骤 2：store.selectProject 末尾追加 fire-and-forget refreshDocs + refreshSessions → verify: 切项目后 LogsView 立即出现 GET /api/projects/:id/docs 与 /api/sessions?projectId 两条网络请求记录；DocsView 不需点击就有数据
- [x] 步骤 3：DocsView 任务行 alive 路径——把现有 🔗 owner 徽章改成可点击按钮 → verify: 浏览器有 alive session 绑定的任务行末尾出现可点击 🔗 按钮，点击后编辑区切到该 session 标签（EditorArea 顶部 tab 高亮变为该 session）
- [x] 步骤 4：DocsView 任务行 no-alive 路径——渲染 `<StartSessionMenu>` 内联按钮 → verify: 没有 alive session 的未完成任务行末尾出现 ▶ 启动 按钮；点击展开下拉，"绑定到任务"输入框已预填该任务名
- [x] 步骤 5：EditorArea EmptyState 加未完成任务卡片区 → verify: 项目无任何 tab 时（关掉所有标签）EditorArea 中央在 📄 占位下方出现 "未完成任务" 列表，按 updatedAt 倒序前 3 条；每条卡片有 alive 跳转或启动入口
- [ ] 步骤 6：完整功能验收（GoldenPath，**待主理人手动验收**） → verify: ① 打开有未完成任务的项目，DocsView 行能看到入口；② 点击 🔗 切标签成功；③ 点击 ▶ 选 agent 后会话出现并自动切到新标签；④ LogsView 看到 `scope=session action=start 开始/成功 (Nms)` 起止配对
- [ ] 步骤 7：失败分支验收（**待主理人手动验收**） → verify: 临时把 packages/server/src/routes/sessions.ts startSession 顶部插入 `if (task) throw new Error('forced-failure');`，重启 server，点击 ▶ 启动菜单选 agent → 浏览器 LogsView 出现 ERROR 条目（`session start 失败: forced-failure`），UI 显示报错红框；测完撤回临时 throw
- [x] 步骤 8：TypeScript 类型检查 → verify: `pnpm --filter @aimon/web exec tsc -b` 退出码 0（顺带补齐 `Activity` union 缺的 'skills' 字面量——这是 issues.md 第 23 行 pre-existing 问题，也是 typecheck 阻塞，一行解封并把那条 issue 勾掉）
- [x] 步骤 9：归档清理 → verify: 没有插任何临时调试代码；三个 md 文件齐全；handoff 摘要随回复末尾给到大哥
