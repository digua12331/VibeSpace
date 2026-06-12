# 提交按钮一键提交并推送 · context

## 关键文件

- `packages/web/src/components/ChangesList.tsx`
  - `onCommit` 函数体：行 268-302（commit 主逻辑）
  - `onPush` 函数体：行 173-175（仅 `withBusy('push', 'push', () => api.gitPush(projectId))`）
  - `withBusy` 包装：行 144-165（错误自动 `setErr`，成功后 `await load()`，含 logAction 起止配对）
  - 按钮 JSX：行 445-451（文案 / disabled / busy 文案切换）
  - placeholder：行 442（动态分支名）
  - detached 判断：行 341-343（`data.detached === true || data.branch == null`）
  - 错误条：行 479-481（已存在，无需新增）

- `packages/web/src/api.ts`
  - `createCommit` 行 390-398（POST `/api/projects/:id/commit`）
  - `gitPush` 行 409-414（POST `/api/projects/:id/push`，返回 `PushResult`）

后端路由 `/push` 不读不改，按 plan 非目标。本任务**写**文件白名单只有 1 个：`packages/web/src/components/ChangesList.tsx`。

## 决策记录

- **为什么不复用 `onPush`，而是在 `onCommit` 里直接调 `api.gitPush`**：复用 `onPush` 看似省一行，但 `withBusy` 失败时 `setErr` 写的是后端裸消息（"fatal: ..."）；本任务要求失败信息明示"已本地提交，但推送失败：<原因>" 让用户看懂当前状态。所以 push 阶段不走 `withBusy` 的默认 catch，而是自己 try/catch 一次（仍包 logAction 保留 git/push 起止配对）。这是个"一行 vs 三行"的取舍，三行换可读性，值。资深视角下不算过度设计。

- **为什么不把 push 失败时本地 commit 也撤销（`reset --soft HEAD~1`）**：撤销看似"原子化"，但反而是数据风险——如果撤销动作本身又失败，用户既丢 push 也丢本地状态。git 设计上 commit 和 push 就是两个独立动作，保留本地 commit 让用户重试推送是行业标准做法。

- **为什么不加"只提交不推送"的开关**：旁边 ⬆ 按钮已经是"只推送"的入口；要"只提交"就……目前没有，但本任务也不引入这个能力。如果大哥后面真有"想攒几个提交再统一推"的需求，再单开任务。当前**不为不存在的需求设计**。

- **为什么 detached HEAD 时按钮文案改而不是 disabled**：detached 状态下 commit 是 git 允许的、有意义的（历史快照里也能记一笔），只是不能 push。disable 等于变相剥夺了 detached 下提交的能力。改文案"✓ 提交（仅本地）"是更老实的表达。

- **为什么 plan 不调多模型会审**：本任务单文件单函数 + 已有 API 调用 + 大哥已显式定路径，没有架构取舍空间。空跑 codex/gemini 评审 ROI 低。

## 依赖与约束

- **现有 `withBusy` 的 logAction 起止配对**：调用 `withBusy(tag, action, fn, meta)` → 起 `git/{action}` 起，fn 抛错则记 fail，否则记 success。本任务 commit 阶段继续走 `withBusy('commit', 'commit', ...)`，push 阶段绕过 withBusy 但仍调 `logAction('git', 'push', ...)`。最终 LogsView 一次"提交并推送"看到 4 条：commit 起 / commit 终 / push 起 / push 终（操作日志规则要求起止配对，已满足）。

- **`logAction` 签名**（`packages/web/src/logs.ts`）：`logAction(scope, action, fn, ctx?)` 包装一次异步 mutation，自动起止配对 + 失败 ERROR 条目；本身会重抛错误，调用方需要 try/catch 决定后续。

- **`data.detached` 与 `data.branch`**：来自 `api.gitStatus` 返回的 `GitChangesResult`，已被 `remoteOpsDisabled` 用于 ⬆/⬇/⤵ 三个按钮的 disabled 判断，可信。

- **后端 push 路由错误格式**：未深读，假设 `api.gitPush` 抛出的 Error.message 已经是人能看懂的句子（worktree-smoke / 现有 ⬆ 按钮就这么用的）。前端原样展示。如果实际后端返回的是裸 `git push` stderr 多行字符串，错误条已经 `whitespace-pre-wrap`，能正常显示。

- **写文件白名单**：`packages/web/src/components/ChangesList.tsx`。其他文件只读不改。`git diff --name-only HEAD` 越界就回滚。

- **类型检查命令**：`pnpm --filter @aimon/web exec tsc -b`（web 包 build 是 `tsc -b && vite build`，没单独的 typecheck 脚本，跑 `tsc -b` 等价于类型检查）。
