# 提交图右键发送到对话 · Plan

## 大哥摘要

现在「图表」侧栏里那一条条提交记录，只能左键点开看详情。这次给每条提交加一个**右键菜单**（鼠标右键点上去弹出来的小菜单）：里面有一项「发送到对话」，点了就把这条提交的标题和编号自动填进你正在跑的 AI 会话输入框里——你只要再按回车，就能让 AI 针对这次提交干活（比如"解释下这个提交改了啥"）。

做完你能在哪验收：打开任意项目的「图表」标签 → 右键点任意一行提交 → 弹出菜单点「发送到对话」→ 自动跳到会话标签、输入框里出现这条提交的信息。

不动任何现有数据/界面，纯加一个右键入口，不喜欢随时能撤。

## 目标

- 在 `GitGraph` 的提交行上新增 `contextmenu`（右键）入口，复用既有 `ContextMenu` 组件弹出菜单。
- 菜单项「发送到对话」复用 `sendToSession`（把文本塞进目标会话输入框、自动切 tab、产生操作日志的公共路径），与文件右键菜单的「发送到对话」三态行为对称（0 个存活 AI 会话→灰掉、1 个→直发、多个→二级子菜单选哪个）。
- 注入文本格式：`提交 <shortSha> "<subject>" `（末尾留空格，与 `formatForSession` 习惯一致，方便用户接着打字）。
- 附带一项「复制提交信息」总是可用，避免没有存活会话时菜单只剩一个灰项。

### 可验收标准

1. `pnpm -F @aimon/web build` 通过（类型检查 + 构建，本仓库 web 侧无独立 typecheck，build 即类型校验——见 auto.md 2026-05-02 那条）。
2. 浏览器「图表」标签右键任意提交行 → 弹出菜单含「发送到对话」「复制提交信息」。
3. 当前项目有存活 AI 会话时点「发送到对话」→ 自动切到会话标签、该会话输入框出现 `提交 <短哈希> "<标题>" `。
4. LogsView 看到 `scope=graph action=send-to-session` 的起止配对（成功路径）。

## 非目标

- 不改提交图的渲染、布局、连线算法。
- 不新增后端路由、不动数据库、不动 `GraphCommit` 数据结构（只用已有 `subject`/`shortSha`/`sha`）。
- 不做"发送完整 commit body / diff"——`GraphCommit` 现在没有 body 字段，本轮只发标题+哈希。
- 不发给纯 shell 会话（与文件右键一致，shell 不消费这段中文描述）。

## 实施步骤

1. 在 `GitGraph.tsx` 顶部接入 `useStore` 的 `sessions` / `liveStatus`，仿 `FilesView.aliveSessions` 过滤出本项目存活、非 shell 的 AI 会话。验证：build 通过。
2. 写一个 `handleCommitContext(e, commit)`：`preventDefault` + `stopPropagation`，调 `openContextMenu` 弹「发送到对话」（三态）+「复制提交信息」。发送走 `sendToSession(projectId, target, text, { scope: 'graph', meta })`。验证：右键弹菜单、点击注入输入框。
3. 给提交行 `<li>` 挂 `onContextMenu={(e) => handleCommitContext(e, row.commit)}`。验证：浏览器右键命中。
4. 跑 `pnpm -F @aimon/web build` + 浏览器走一遍验收 1–4。

## 边界情况

- 当前项目无任何存活 AI 会话：「发送到对话」灰掉 disabled，「复制提交信息」仍可用。
- 多个存活 AI 会话：走二级子菜单逐个列出（`agent·尾6位`）。
- 右键与左键冲突：`contextmenu` 已 `preventDefault`，不会同时触发左键的"打开提交详情"。

## 风险与注意

- `sendToSession` 注入的是输入框、不是直接写 PTY（用户需自己按回车）——这是既有约定，符合预期。
- 复制用 `navigator.clipboard`，非安全上下文可能失败；GitGraph 这里走 try/catch 兜底即可，不引入额外依赖。

## 多模型 Plan 会审

跳过：小档任务（单文件 UI 改动、复用现有 `sendToSession`/`ContextMenu`、不动数据、易回滚），按 CLAUDE.md 小档规则 Claude 单独写 plan、不调外部模型。
