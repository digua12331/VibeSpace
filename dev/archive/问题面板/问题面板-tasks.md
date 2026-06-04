# 问题面板 · 任务清单

> 仅由 AI 在推进过程中维护；人类读，不改。

## 服务端

- [x] T01 在 `packages/server/src/dev-docs-guidelines.ts` 末尾新增并导出 `ISSUES_ARCHIVE_SECTION`，内容为 `## Issues 档案` 章节（说明追加位置/单行格式/不改代码/派单处理后打勾）；同时把该段**嵌入** `DEV_DOCS_GUIDELINES` 主守则字符串（在"执行时的硬性规则"之后、`## 规则与边界` 之前）→ verify: `grep "Issues 档案" packages/server/src/dev-docs-guidelines.ts` 至少 2 处命中；ts 模板字符串闭合，`pnpm --filter @ai-kanban/server typecheck` 通过
- [x] T02 修改 `packages/server/src/routes/projects.ts` 的 `appendDevDocsGuidelines`：支持"缺章节就补"—— 无主 anchor 时整段追加；有主 anchor 但缺 `## Issues 档案` 时，插入到主守则段末尾（下一个顶级 `---` 前 / 或 EOF）；两者都有时 no-op → verify: 写三个本地 fixture（无主 anchor / 老版守则 / 已含新章节）在 node REPL 跑一次 appendDevDocsGuidelines，三种路径行为符合预期且**幂等**
- [x] T03 新建 `packages/server/src/issues-service.ts`：导出 `IssueItem / IssuesPayload / readIssues(projectPath)`，正则 `^\s*[-*+]\s+\[( |x|X)\]\s+(.+)$`，文件不存在返回空 payload → verify: node REPL 读一份 fixture issues.md（3 条 `- [ ]` + 1 条 `- [x]`）返回 4 个 items、done 字段正确；读不存在的路径返回空
- [x] T04 新建 `packages/server/src/routes/issues.ts`：`GET /api/projects/:id/issues`，错误处理风格仿 `routes/docs.ts` → verify: `pnpm --filter @ai-kanban/server typecheck` 通过
- [x] T05 在 `packages/server/src/index.ts` 注册 `registerIssuesRoutes(app)`（放在 `registerDocsRoutes` 之后）→ verify: 启动 server，curl `GET /api/projects/<real-id>/issues` 返回 200 JSON；curl 不存在的 id 返回 404

## 仓库根 CLAUDE.md

- [x] T06 把 `## Issues 档案` 章节同步到 `f:\KB\AIkanban-main\CLAUDE.md` 对应位置（"执行时的硬性规则"之后、`## 规则与边界` 之前）→ verify: `diff` CLAUDE.md 与 `dev-docs-guidelines.ts` 的该章节文字一致

## 前端

- [x] T07 `packages/web/src/types.ts` 追加 `IssueItem / IssuesPayload` → verify: `pnpm --filter @ai-kanban/web typecheck` 通过
- [x] T08 `packages/web/src/api.ts` 追加 `listIssues(projectId)` → verify: typecheck 通过
- [x] T09 `packages/web/src/store.ts` 追加 `issuesData / issuesLoading / issuesError / refreshIssues(projectId)`，仿照现有 `docsTasks / docsLoading / docsError / refreshDocs` 的结构 → verify: typecheck 通过；浏览器切到问题 tab 时 DevTools Network 看到一次 GET
- [ ] T10 `DocsView.tsx` 顶部按钮行新增 2 段 segmented 按钮「任务 / 问题」；本地 `view` state 默认 `'tasks'`；搜索框只在 `view==='tasks'` 出现 → verify: 浏览器点击可切换，任务 tab 行为不变 _（代码已完成，tsc -b + vite build 全绿；待用户浏览器手测）_
- [ ] T11 `DocsView.tsx` 问题视图渲染：二值 pill + 单行文本 + hover 按钮「打开 issues.md」（done 项也显示）「派 Claude」（仅未处理）；空态文案按 plan → verify: 手写 `dev/issues.md` 含 3 条 `- [ ]` + 1 条 `- [x]`，UI 显示 4 条，pill 颜色区分，按钮位置正确；删掉 issues.md 显示空态文案 _（代码已完成；待用户浏览器手测）_
- [ ] T12 `DocsView.tsx` 实现派单 S1 行为：创建 claude session → addSession → setActiveSession → `navigator.clipboard.writeText(prompt)` → `alertDialog` 提示 Ctrl+V 回车；失败捕获时 `alertDialog` 直接展示 prompt 文本 → verify: 点单条"派 Claude"，左侧 session 列表出现新 claude session 并被聚焦；右侧终端粘贴的内容符合 prompt 模板（含条目文本 + "处理完把 [ ] 改 [x]" 指令） _（代码已完成；待用户浏览器手测）_
- [ ] T13 `DocsView.tsx` 顶部按钮行新增「派全部」按钮（仅 `view==='issues'` 且存在未处理条目时显示）；多条 prompt 是编号列表 → verify: 手测点一下，剪贴板拿到编号列表 _（代码已完成；待用户浏览器手测）_
- [ ] T14 浏览器回归：任务 tab 的展开、归档、搜索、⚙应用守则全部手测一遍 → verify: 行为与改动前一致；`pnpm --filter @ai-kanban/web typecheck` 全绿 _（typecheck + build 已通过；其余待用户浏览器手测）_

## 升级场景验收

- [ ] T15 手测 CLAUDE.md 升级机制：a) 新项目点 ⚙ → 整段写入；b) 构造老版 CLAUDE.md（有主 anchor、没 `## Issues 档案`），点 ⚙ → 章节补丁追加到主段尾部；c) 再点一次 → no-op → verify: 三种场景手测通过 _（已在 node REPL 跑完 3 场景 + 幂等，T02 smoke 全绿；浏览器端点击路径待用户手测以确认 UI 文案）_
