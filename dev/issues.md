# Issues

记录在做主线任务时顺手发现的、跟当前任务无关的可疑问题。每条单行，按 `- [ ] / - [x]` 状态管理。

- [x] 中文 IME composition 进行中按 Enter 会立即上屏并发送给 AI，导致中文打到一半就被误发（文件 packages/web/src/components/terminal/SessionView.tsx:320-326；上下文：onInputKey 仅判断 e.key === 'Enter'，未检查 e.nativeEvent.isComposing）
- [x] migrate() 里 syncProjectsTable 每次都 DELETE FROM projects 触发 sessions 表 ON DELETE CASCADE 清空，导致 tsx-watch 重载一次就丢掉所有 sessions 行（文件 packages/server/src/db.ts:79-88；上下文：projects.json 存在时每次 migrate 都执行一次，stable 用 dist 不命中、dev tsx watch 命中。建议改成 UPSERT 避免级联）
- [x] .codex/config.toml 看起来是每台机器各自的 codex CLI 本地配置（注释managed by aimon UI），不建议入库，建议加到 .gitignore（文件 .codex/config.toml；上下文：2026-04-23 打 tag 时顺手发现，当前未在 .gitignore 中）
- [x] DocsView.tsx:372 存在预先的类型错误 TS2322：pushLog 调用里 projectId 是 string | null，与期望的 string | undefined 不兼容（文件 packages/web/src/components/sidebar/DocsView.tsx:372；上下文：2026-04-24 跑 pnpm -C packages/web exec tsc -b 时发现，与终端输入抖动 v3 改动无关，是独立的类型定义问题，建议在 pushLog 调用处将 null 归一成 undefined 或在 pushLog 签名里允许 null）
- [x] 给「删除项目」加操作日志（文件 packages/web/src/store.ts / ProjectsColumn.tsx；上下文：2026-04-24 操作日志规则落地，删项目是用户可感知的 mutation 必须 logAction('project','delete',...)）
- [ ] 给「重命名项目」加操作日志（文件 packages/web/src/store.ts / ProjectsColumn.tsx；上下文：同上，需 logAction('project','rename', fn, { projectId, meta: { newName } })）
- [x] 给「停止/结束会话」加操作日志（文件 packages/web/src/store.ts 的 endSession / 前端关标签按钮；上下文：同上，logAction('session','stop', fn, { sessionId })）
- [x] 给「Dev Docs 右键派 Claude」加操作日志（文件 packages/web/src/components/sidebar/DocsView.tsx 右键菜单 onSelect；上下文：logAction('docs','dispatch', fn, { meta: { task, target: 'claude' } })）
- [x] 给「fs-ops 写文件」加操作日志（文件 packages/server/src/routes/fs-ops.ts；上下文：写盘类 mutation 必须 serverLog('info','fs',...)，失败路径配 error）
- [x] 给「paste-image 上传」加操作日志（文件 packages/server/src/routes/paste-image.ts + 前端粘贴触发处；上下文：用户粘贴截图到终端是可感知操作，要埋 logAction + serverLog）
- [x] 改造 CliInstallerDialog 现有 pushLog 为 logAction 配对（文件 packages/web/src/components/CliInstallerDialog.tsx；上下文：目前只有 success/error 两条单发、缺「开始」那一条，不符合「操作日志规则」的起止配对约束）
- [x] 改造 ChangesList 里的 git 相关 pushLog 为 logAction 配对（文件 packages/web/src/components/ChangesList.tsx；上下文：同上，起止配对 + 耗时）
- [x] 考虑日志保留策略（文件 packages/server/src/log-bus.ts；上下文：当前按天切 JSONL 无限增长、无清理、无单文件大小限制。建议加一个启动时扫描 data/logs/ 删除 30 天前文件的小任务，或改用 pino-roll 之类的滚动库）
- [ ] codex 斜杠命令表只有 /help /clear /model 三条占位，待用户在 codex session 里跑 /help 截图后补齐（文件 packages/web/src/components/terminal/slashCommands.ts；上下文：2026-04-24 浮动输入框命令增强任务落地时用户仅提供了 claude/gemini 的 /help 输出，codex 占位待补）
- [ ] README.md "Highlights" 段还在写"Karpathy 守则安装器"+"NewProjectDialog 两个复选框"，但代码里 Karpathy 路径已删（grep 全 packages 0 命中），当前只有 1 个 Dev Docs 复选框（文件 README.md 第 33-65 行；上下文：2026-04-29 harness-一键装配与团队面板 任务里发现，README 描述过时；本次任务又加了第 2 个 🤝 复选框，README 这段需要按当前实际重写，跟 Karpathy 完全无关）
- [ ] vibespace-browser-tester subagent 没有 browser-use MCP 工具可用（文件 .claude/agents/vibespace-browser-tester.md；上下文：frontmatter 用 mcp__browser-use__* 通配符，claude code 不展开；导致浏览器侧自动验收全部 SKIP，需展开成具体工具名清单）
- [ ] 为 removeDevDocs anchor 切片逻辑加 1–2 个单测（文件 packages/server/src/routes/projects.ts；上下文：DELETE /api/projects/:id/dev-docs 用 indexOf+slice，目前无测试覆盖）
- [ ] 清理后端死路由 GET /api/projects/:id/harness-status + service 函数 getHarnessStatus（文件 packages/server/src/routes/projects.ts、harness-template-service.ts；上下文：前端 HarnessTeamDrawer 已删除，该路由无消费方）
