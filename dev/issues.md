# Issues

记录在做主线任务时顺手发现的、跟当前任务无关的可疑问题。每条单行，按 `- [ ] / - [x]` 状态管理。

**`[auto]` 标签语法**：在 `- [ ]` 后紧跟 `[auto] ` 可以让该 issue 出现在 VibeSpace「Dev Docs → 问题」面板的批量派工选项里——勾选若干 `[auto]` 行 → 按"⚡ 批量派工"→ 后端给每条单独开 worktree 跑 Claude，跑完进「队列」tab 等你 approve & merge 或 reject & 丢。不带 `[auto]` 的 issue 只能用末尾🤖按钮单条派。例：

```
- [ ] [auto] 把某某文件里的某某 typo 改掉（文件 xx.ts:42；上下文：…）
- [ ] 改一个会牵动多模块的复杂问题（文件 …；上下文：… 不适合自动派，留人工）
```

默认 `[auto]` 列表为空——大哥手动标第一条试水。第一版没做 UI 改标签编辑器，要标 / 取消标都是直接编辑本文件。

> **大任务自拆并行**：dev/active 下的常规大任务也可以自动拆成 N 个子任务并行跑——AI 在 plan.md 末尾加 `## 自拆与依赖` JSON 段即可（语法见 `.aimon/templates/subtasks-syntax.example.md`）。本面板只管 `dev/issues.md` 单条 issue 派工，**主任务子任务面板**在 Dev Docs 任务行展开后的子任务区域。

- [x] 中文 IME composition 进行中按 Enter 会立即上屏并发送给 AI，导致中文打到一半就被误发（文件 packages/web/src/components/terminal/SessionView.tsx:320-326；上下文：onInputKey 仅判断 e.key === 'Enter'，未检查 e.nativeEvent.isComposing）
- [x] migrate() 里 syncProjectsTable 每次都 DELETE FROM projects 触发 sessions 表 ON DELETE CASCADE 清空，导致 tsx-watch 重载一次就丢掉所有 sessions 行（文件 packages/server/src/db.ts:79-88；上下文：projects.json 存在时每次 migrate 都执行一次，stable 用 dist 不命中、dev tsx watch 命中。建议改成 UPSERT 避免级联）
- [x] .codex/config.toml 看起来是每台机器各自的 codex CLI 本地配置（注释managed by aimon UI），不建议入库，建议加到 .gitignore（文件 .codex/config.toml；上下文：2026-04-23 打 tag 时顺手发现，当前未在 .gitignore 中）
- [x] DocsView.tsx:372 存在预先的类型错误 TS2322：pushLog 调用里 projectId 是 string | null，与期望的 string | undefined 不兼容（文件 packages/web/src/components/sidebar/DocsView.tsx:372；上下文：2026-04-24 跑 pnpm -C packages/web exec tsc -b 时发现，与终端输入抖动 v3 改动无关，是独立的类型定义问题，建议在 pushLog 调用处将 null 归一成 undefined 或在 pushLog 签名里允许 null）
- [x] 给「删除项目」加操作日志（文件 packages/web/src/store.ts / ProjectsColumn.tsx；上下文：2026-04-24 操作日志规则落地，删项目是用户可感知的 mutation 必须 logAction('project','delete',...)）
- [ ] 给「重命名项目」加操作日志（文件 packages/web/src/store.ts / ProjectsColumn.tsx；上下文：同上，需 logAction('project','rename', fn, { projectId, meta: { newName } })）—— 2026-06-03 核实：当前代码里**没有重命名项目这个功能**（store / projects 路由 / ProjectsColumn 均无 rename，ProjectsColumn 右键菜单只有「代码更改」和「删除」），无操作可埋；待该功能真正实现时再补 logAction
- [x] 给「停止/结束会话」加操作日志（文件 packages/web/src/store.ts 的 endSession / 前端关标签按钮；上下文：同上，logAction('session','stop', fn, { sessionId })）
- [x] 给「Dev Docs 右键派 Claude」加操作日志（文件 packages/web/src/components/sidebar/DocsView.tsx 右键菜单 onSelect；上下文：logAction('docs','dispatch', fn, { meta: { task, target: 'claude' } })）
- [x] 给「fs-ops 写文件」加操作日志（文件 packages/server/src/routes/fs-ops.ts；上下文：写盘类 mutation 必须 serverLog('info','fs',...)，失败路径配 error）
- [x] 给「paste-image 上传」加操作日志（文件 packages/server/src/routes/paste-image.ts + 前端粘贴触发处；上下文：用户粘贴截图到终端是可感知操作，要埋 logAction + serverLog）
- [x] 改造 CliInstallerDialog 现有 pushLog 为 logAction 配对（文件 packages/web/src/components/CliInstallerDialog.tsx；上下文：目前只有 success/error 两条单发、缺「开始」那一条，不符合「操作日志规则」的起止配对约束）
- [x] 改造 ChangesList 里的 git 相关 pushLog 为 logAction 配对（文件 packages/web/src/components/ChangesList.tsx；上下文：同上，起止配对 + 耗时）
- [x] 考虑日志保留策略（文件 packages/server/src/log-bus.ts；上下文：当前按天切 JSONL 无限增长、无清理、无单文件大小限制。建议加一个启动时扫描 data/logs/ 删除 30 天前文件的小任务，或改用 pino-roll 之类的滚动库）
- [ ] codex 斜杠命令表只有 /help /clear /model 三条占位，待用户在 codex session 里跑 /help 截图后补齐（文件 packages/web/src/components/terminal/slashCommands.ts；上下文：2026-04-24 浮动输入框命令增强任务落地时用户仅提供了 claude/gemini 的 /help 输出，codex 占位待补）
- [x] README.md "Highlights" 段还在写"Karpathy 守则安装器"+"NewProjectDialog 两个复选框"，但代码里 Karpathy 路径已删（grep 全 packages 0 命中），当前只有 1 个 Dev Docs 复选框（文件 README.md 第 33-65 行；上下文：2026-04-29 harness-一键装配与团队面板 任务里发现，README 描述过时；本次任务又加了第 2 个 🤝 复选框，README 这段需要按当前实际重写，跟 Karpathy 完全无关）
- [x] vibespace-browser-tester subagent 没有 browser-use MCP 工具可用（文件 .claude/agents/vibespace-browser-tester.md；上下文：frontmatter 用 mcp__browser-use__* 通配符，claude code 不展开；导致浏览器侧自动验收全部 SKIP，需展开成具体工具名清单）
- [ ] 为 removeDevDocs anchor 切片逻辑加 1–2 个单测（文件 packages/server/src/routes/projects.ts；上下文：DELETE /api/projects/:id/dev-docs 用 indexOf+slice，目前无测试覆盖）
- [x] 清理后端死路由 GET /api/projects/:id/harness-status + service 函数 getHarnessStatus（文件 packages/server/src/routes/projects.ts、harness-template-service.ts；上下文：前端 HarnessTeamDrawer 已删除，该路由无消费方）—— 2026-06-03 核实：路由已不在代码中（全仓 grep harness-status 0 命中），getHarnessStatus 仍被 workflow-service.ts:451 getWorkflowStatus 消费，非死代码，无需删除
- [x] web 包 build 失败：'skills' 不在 Activity 联合类型里（文件 packages/web/src/components/layout/ActivityBar.tsx:31 + PrimarySidebar.tsx:63；上下文：2026-05-02 在做"记忆结构化"任务时发现，session 起始就存在的 pre-existing 错误，应该是新加 SkillsView.tsx 的 work-in-progress 缺了 Activity 类型扩展，需要在 Activity union 里加 'skills'）
- [x] AGENTS.md "Codex 配置分层" 段 Claude→Codex 替换不彻底，引用了不存在的 docs/Codex-config-tiers.md（文件 AGENTS.md:316-322；上下文：本仓 AGENTS.md 是 CLAUDE.md 的 Codex 副本，但配置分层段把 "Claude Code" 机械替换成 "Codex"，含混了 Claude Code 与 Codex CLI 两个不同工具；文档路径也被替换成不存在的文件名。建议这一段恢复成"Claude Code"原文，并加一句"AGENTS.md 中其它 Claude→Codex 替换照旧；本节例外"）
- [x] SessionView 轮询间隔注释提到已删除的 JobsView（文件 packages/web/src/components/terminal/SessionView.tsx:323；上下文：2026-05-22 侧栏面板瘦身任务删了 JobsView，该注释举例仍引用它，失准但不影响功能，建议改注释）
- [x] subagent-runs 注释提到已删除的 jobs-service（文件 packages/server/src/subagent-runs.ts:33；上下文：2026-05-22 侧栏面板瘦身任务删了 jobs-service.ts，注释 "matches jobs-service" 已失准，建议改注释）
- [x] web 的 tsconfig.app.tsbuildinfo 被 git 跟踪、server 的 tsconfig.tsbuildinfo 没有（文件 packages/web/tsconfig.app.tsbuildinfo；上下文：2026-05-22 跑 tsc -b 发现 web tsbuildinfo 进 diff、server 的被 gitignore，构建缓存不应入库，建议把 web 的也加进 .gitignore）
- [ ] WebSocket 输出缺少 backpressure，输出洪峰会拖垮浏览器或后端（文件 packages/server/src/ws-hub.ts:68,292；上下文：2026-05-22 终端卡顿排查时 Codex 指出，ws-hub 只做 16ms 合并、队列无字节上限，safeSend 不看 bufferedAmount、无慢客户端保护，AI/命令疯狂刷屏时会卡；建议每 client 设 bufferedAmount 上限 + 每 session 队列设最大字节数）
- [ ] refreshSessions 默认 subscribe 全部 alive 会话，与 TerminalHost 保活预算不一致（文件 packages/web/src/store.ts:668-669；上下文：2026-05-22 终端保活预算上线后，被预算剔除、未挂 SessionView 的会话仍被 refreshSessions 重新订阅 WS，订阅与渲染不同步；收益小未在本轮处理，建议让订阅跟随保活集合或做引用计数）
- [ ] db.ts isWorkflowMode 只认 dev-docs|openspec，漏 spec-trio，会把 spec-trio 项目读 projects.json 时降级成 null（文件 packages/server/src/db.ts:47；上下文：types.ts 的 WorkflowMode 含 spec-trio，但 db 校验未同步）
- [ ] VibeSpace 自身 CLAUDE.md 迁到独立文件需专门处理：通用"剥离版"母版缺「代码学习指引」等项目专属硬规则，直接套自动迁移会吞掉它们；应另生成一份"非剥离版/含VibeSpace专属段"的工作流文件再引用（文件 CLAUDE.md:288 与 packages/server/src/dev-docs-guidelines.ts；上下文：工作流改独立文件引用任务发现，自动迁移只对普通目标项目安全）
