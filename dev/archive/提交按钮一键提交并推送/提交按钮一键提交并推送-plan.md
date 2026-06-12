# 提交按钮一键提交并推送 · plan

## 大哥摘要

现在你点蓝色「✓ 提交」按钮，只是把代码记到本地仓库历史里（git 的 commit 是本地动作，按设计就不联网）。要发到 GitHub 还得点旁边那个不起眼的 ⬆ 箭头按钮（push，把本地提交推到远端）。这次改完之后：你点「✓ 提交并推送」按钮 → 系统先做本地提交、紧接着自动推送到 GitHub，一键搞定。

不会动到你已有的提交记录、不会动你已经写好的代码；按钮文案会变（"✓ 提交" → "✓ 提交并推送"），旁边的 ⬆ 按钮保留不动（你想单独推送已有提交时还能用）。

如果当前不在分支上（git 里叫 detached HEAD，可以理解为"卡在某次历史快照里没归属任何分支"，这是 git 自己的特殊状态），按钮会自动降级成"✓ 提交（仅本地）"——因为 detached 状态本身就推不上去，git 限制，不是软件 bug。

## 目标

把 `packages/web/src/components/ChangesList.tsx` 里 `onCommit`（行 268-302）改成：commit 成功后，若当前在分支上则自动调一次 `api.gitPush(projectId)`；同时按钮文案、placeholder、tooltip 同步更新，让"会推送"这件事在界面上一眼可见。

**验收标准（浏览器可观察）**：

1. 项目仓库已配置远端、且本地分支已 track 远端时，输入提交信息 → 点「✓ 提交并推送」→ LogsView 能看到 `scope=git action=commit` 起止配对 + `scope=git action=push` 起止配对（一次操作 4 条日志），GitHub 端能看到这次提交。
2. 故意制造推送失败场景（如临时断网、或把 origin 改成无效 URL）→ 点提交并推送 → 错误条出现"已本地提交，但推送失败：<原因>"，且 `git log` 里这次本地 commit **保留**（不回滚）；用户可手动点 ⬆ 重试。
3. 进入 detached HEAD（`git checkout <某个 sha>`）→ 提交按钮文案变为「✓ 提交（仅本地）」；点击后只 commit 不 push，LogsView 只看到 commit 起止配对（无 push）。
4. 按钮 busy 状态：commit 阶段显示"提交中…"，push 阶段显示"推送中…"，期间整行禁用。
5. 类型检查：`pnpm --filter @aimon/web exec tsc -b` 通过（web 包用 `tsc -b && vite build` 作为 build，类型检查直接跑 `tsc -b`）。

## 非目标

- **不**新增「只提交不推送」的开关或第二个按钮——保留旁边 ⬆ 按钮已经能满足"只想推已有 commit"的诉求；再加开关会让按钮区拥挤，且违反"小功能保持外科式改动"原则。
- **不**改任何后端路由（`/api/projects/:id/commit` 与 `/push` 都不动）。
- **不**改 `onUndoCommit` / `onStash` / `onPull` / `onFetch` 的行为。
- **不**碰 Ctrl+Enter 快捷键的 keymap，只改它对应触发的函数行为（onCommitKey 仍然调 onCommit，自然继承一键推送）。
- **不**做 push 失败的自动重试或回退本地 commit（git 标准做法是保留本地 commit、让用户手动决定下一步）。

## 实施步骤

1. **改 onCommit 函数体（ChangesList.tsx:268-302）**：commit 成功后，若 `data.detached !== true && data.branch != null`，再调一次 `withBusy('push', 'push', () => api.gitPush(projectId), { afterCommit: true })`。push 失败时 `setErr` 已由 `withBusy` 自动写入；但要把错误前缀改写为"已本地提交，但推送失败：" 让用户明白本地状态。具体写法：捕获 push 阶段的失败（`withBusy` 返回 `null` 即失败），手动 `setErr('已本地提交，但推送失败：' + (errMsgFromWithBusy ?? '未知错误'))` 覆盖。最简写法是不复用 withBusy 的 catch、自己 try/catch 一次 push。
2. **按钮文案与 placeholder**：
   - 按钮：默认 `✓ 提交并推送 (N)`；detached 时 `✓ 提交（仅本地, N）`；busy='commit' 时 `提交中…`；busy='push' 时 `推送中…`。
   - placeholder：默认 `消息 (Ctrl+Enter 提交并推送到 "<branch>")`；detached 时 `消息 (Ctrl+Enter 提交到 HEAD)`。
   - tooltip：在按钮上加 `title="提交本地，并推送到远程；推送失败本地提交保留"`（detached 时改为 `当前不在分支上，仅做本地提交`）。
3. **类型检查与人工验收清单**：`pnpm --filter @aikanban/web typecheck` 跑一遍；启动 dev server，浏览器里走一遍验收 1/2/3/4。
4. **派 vibespace-browser-tester 做交付前自测**：按 `manual.md 2026-05-06` 偏好，AI 自己派 agent 跑一遍验收 1/3/4（无网络故障也能验证主路径 + detached 降级 + busy 状态切换）；验收 2 因为要故意断网，留给大哥手动触发，但要在 handoff 里明示步骤。

## 边界情况

- **后端 push 路由当前如何报错**：未读 `packages/server/src/routes/git*.ts`，但 `api.gitPush` 抛出的 Error.message 会被 `withBusy` 接住。前端只需把这条信息以"已本地提交，但推送失败：<msg>" 的样式给到用户，不需要解析具体 msg 内容。
- **首次推送（远端无对应分支）**：依赖 `gitPush` 后端实现；若后端用 `git push -u origin <branch>` 形式则首次推送会自动 set-upstream，前端无需特殊处理。若后端只 `git push`、依赖已有 upstream，则首次推送会失败——这种情况下错误条提示"未设置上游分支"，用户回去用终端或 ⬆ 按钮（如果它已支持）解决。本任务**不**扩到 set-upstream，记到 `dev/issues.md` 让后续单独评估。
- **凭证（HTTPS 的用户名密码 / SSH key）未配置**：push 在后端 spawn 出 `git push` 子进程，凭证由系统层（OS keychain / ssh-agent / git credential helper）处理，前端无能为力。错误条原样展示后端 stderr 即可。
- **Ctrl+Enter 快捷键**：onCommitKey 调 onCommit，自然继承新行为，无需改。
- **busy 期间禁用整行**：现有 `disabled={busy != null || !message.trim()}` 已在第一次 commit 时禁用按钮；push 阶段 busy='push'，按钮仍 disabled——OK，无需改 disabled 表达式。

## 风险与注意

- **行为变化用户可见**：之前点提交是离线动作、现在变成会联网。如果用户网络不稳定，每次提交都会等 push 超时，体感比原来慢。这是一键化的固有代价；大哥已选择这条路，记在此供未来需要回滚时参考。
- **LogsView 一次操作 4 条日志**（之前 2 条）：审日志时不要把"成对的 commit + push"误判为重复。归档评审注意这点。
- **依赖 `data.branch` 与 `data.detached` 的可靠性**：现有代码已经依赖这两个字段（`remoteOpsDisabled` 用了），可信。
- **本任务范围**：只改 1 个文件（`packages/web/src/components/ChangesList.tsx`）。`tasks.json` 的 `write_files` 限定到这个文件；越界就停下来扩 plan。

## 多模型 Plan 会审

> 跳过：判定为小档（单文件单函数追加一次已有 API 调用，无架构取舍，大哥已显式选择路径 A）。按 CLAUDE.md "小档" 跳过条件兜底——Claude 单独写 plan，不调 Gemini / Codex，节省外部调用。
