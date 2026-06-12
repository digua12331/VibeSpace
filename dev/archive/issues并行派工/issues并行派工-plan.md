# issues并行派工 · plan

## 大哥摘要

这次给你加一个"晚上派一批活、早上来收"的能力。具体就是：你在 VibeSpace 左侧的「问题」面板（看 dev/issues.md 那个 tab）里勾选几条已经标了 `[auto]` 标签的 issue → 点"批量派工"按钮 → 后端给每条 issue 单独开一个 worktree（git 的临时副本，每个并行任务互不踩脚） → 各起一个 Claude 终端跑专门的"修这条 issue" prompt → 跑完它自动跑 typecheck（前端/后端编译能不能过）+ lint + smoke（如果项目里有这些命令），全绿才点亮"待 review 队列"。**它不会自动 merge（合并代码进主分支），早上你打开 VibeSpace，待 review 队列里逐条点开 diff（看改了哪些行）—— approve 才合，reject 就丢 worktree，主仓库不会被改一行**。你的主项目和数据库都不会被这群并行 session 动到（worktree 隔离 + 独立 SQLite）。

## 目标

让大哥能：

1. 在「问题」面板批量勾选 N 条带 `[auto]` 标签的 issue → 点"批量派工"
2. 后台自动开 N 个 worktree + N 个 claude session，每个跑专门的"消化这条 issue"的 prompt
3. 跑完每个 session 自动 verify（typecheck + lint + smoke），全绿 → state=`review-ready`，任意红 → state=`failed`，错误日志贴在卡片上
4. 大哥任何时刻能在新增的「待 review 队列」tab 看到所有 worktree 的状态、点开 diff、approve & merge 或 reject & 丢

### 可验证的验收标准（必须在浏览器里能点出来）

- 浏览器打开 VibeSpace 项目，左侧 Activity 切到「问题」tab
- 看到顶部多出一个"批量派工"按钮；未选中任何 `[auto]` issue 时按钮 disabled
- 勾选 2 条 `[auto]` issue → 按钮亮起 → 点击 → 弹确认对话框列出"将开 2 个 worktree、单 session 最长 90 分钟、并发上限 3"
- 确认后跳到新增的「待 review 队列」tab，看到 2 个 job 卡片状态从 `pending → running → verifying → review-ready` 流转
- 至少 1 个 job 走到 `review-ready`，点"打开 diff"能看到这条 issue 对应的代码改动
- 在 LogsView 看到 `scope=issues action=batch-dispatch` 的起止配对日志
- 故意派一条 prompt 必然超时或必然让 tsc 红的 issue，确认状态变 `failed` 且错误日志贴在卡片上
- 故意在派工后断网/关浏览器，重连后队列仍能恢复看到（孤儿 worktree 灰色显示，状态 `unknown - server restart`）

## 非目标

- **不做"自动认领 issues"**——派工还是大哥手按按钮（roadmap s11 劝退档的核心反对点）
- **不做自动 merge**——approve / reject 都是大哥手按
- **不做 dev/active 大任务的批量执行**——颗粒度太大，跟单行 issue 不是一类
- **不做 agent 间通信 / mailbox**——roadmap s09/s10 拆出未来评估
- **不做 issue 在 UI 里加 `[auto]` 标签的编辑器**——第一版大哥直接编辑 dev/issues.md 手标，用一段时间再看要不要 UI
- **不做"已 review 过的好/坏样本回流去训练 prompt"**——先把基础跑通

## 实施步骤

### 1. issues-service 增加 `[auto]` 标签解析

- 在 `packages/server/src/issues-service.ts` 的解析逻辑里识别 `- [ ] [auto] xxx ...`（label 必须紧跟 checkbox），给每条 issue 加 `auto: boolean` 字段
- 同步 `packages/web/src/types.ts` 的 Issue 类型 + `packages/web/src/api.ts`
- **verify**：单测一条带 `[auto]`、一条不带，断言解析结果

### 2. 后端 IssueJobManager（仿 install-jobs.ts 形态）

- 新文件 `packages/server/src/issue-jobs.ts`
- 状态：`pending | running | verifying | review-ready | failed | cancelled`
- 关键字段：`jobId / projectId / issueHash / issueText / worktreePath / sessionId / state / verifyLog / startedAt / endedAt / errorReason / branch`
- EventEmitter 风格（事件 `state-changed` / `verify-log` / `done`），方便 WS 推送
- in-memory + 服务器启动时扫一次磁盘上的"孤儿 worktree"（路径前缀匹配 `issue-job-<hash>`）→ 标 `unknown - server restart`
- **verify**：单测覆盖状态机正确性 + 孤儿恢复

### 3. 后端路由

- 新文件 `packages/server/src/routes/issue-jobs.ts`
- `POST /api/projects/:id/issues/batch-dispatch`
  - body: `{ issueHashes: string[], maxConcurrency?: number }`（默认并发 3，硬上限 5）
  - 每条 issue 走：先校验 hash 命中 + 没在 running、再开 worktree、再 createSession(agent='claude')、注入 prompt 模板进 pendingInput、register 进 IssueJobManager
- `GET /api/projects/:id/issue-jobs` 列出全部 job（含孤儿）
- `POST /api/projects/:id/issue-jobs/:jobId/approve` → git merge worktree → main + rm worktree（保留分支 30 天）
- `DELETE /api/projects/:id/issue-jobs/:jobId` → rm worktree（保留分支 30 天）
- 全部用 zod 校验 body / params
- **verify**：curl 各路由，看 IssueJobManager 状态正确流转 + serverLog 起止配对

### 4. Prompt 模板与触发 verify

- 新文件 `packages/server/src/issue-prompt-template.ts`，导出一个函数生成 prompt：
  ```
  我已经把 dev/issues.md 第 N 行的修复任务派给你。
  原文：
  > <issue 原文行>

  请：
  1. 按 CLAUDE.md "Issues 档案" 的小任务流程做（直接改代码 + 勾选）
  2. 遵守"外科式改动"和"破坏性变更协议"
  3. 改完后把 dev/issues.md 里这一行的 `- [ ]` 改成 `- [x]`
  4. 完成后在终端最后一行单独打印 `===ISSUE-DONE===`
  5. 任何熔断（连续失败 2-3 次）就打印 `===ISSUE-STUCK=== <一句原因>` 并停手
  ```
- 触发 verify 的信号（任一）：
  - PTY 输出里探测到 `===ISSUE-DONE===` → 进 verify
  - 探测到 `===ISSUE-STUCK===` → 直接 state=failed，errorReason=stuck 原因
  - 90 分钟硬上限 → kill session + state=failed + errorReason='timeout 90m'
- **verify**：手工跑一条最简单的 issue（如"改一个注释"），看 prompt 模板能不能让 Claude 走到 `===ISSUE-DONE===`

### 5. Verify pipeline

- 新文件 `packages/server/src/issue-verify.ts`
- 顺序跑（仿 install-jobs 用 spawn 收集 log，单步超时 5 分钟）：
  - `pnpm -C packages/web exec tsc -b`
  - `pnpm -C packages/server exec tsc -b`
  - lint（仅在项目根 package.json 有 `lint` script 时跑）
  - smoke（仅在项目根 package.json 有 `smoke` script 时跑）
- 全绿 → IssueJobManager 标 `review-ready`；任意红 → `failed`，errorReason 截取第一个失败步骤的最后 1KB 输出
- **verify**：派一条会让 tsc 红的 issue，看 verify pipeline 正确报错

### 6. 前端 Issues 面板加批量派工 UI

- 修改 `packages/web/src/components/issues/IssuesView.tsx`（或现有 issues 面板文件）
- 每行加 checkbox：`disabled` when `!issue.auto`，hover 显示 "未标 \[auto\] 不能批量派"
- 顶栏加"批量派工 (N)"按钮，N=已勾选数；为 0 时 disabled
- 点击弹现成的 ConfirmDialog，列出"将开 N 个 worktree、单 session 最长 90 分钟、并发上限 X"
- 确认走 `api.batchDispatchIssues({ issueHashes, maxConcurrency })`
- `packages/web/src/api.ts` 加 `batchDispatchIssues` / `listIssueJobs` / `approveIssueJob` / `rejectIssueJob`
- 全部 mutation 用 `logAction('issues', 'batch-dispatch'|'approve'|'reject', fn, ctx)`
- **verify**：浏览器手动操作走完全程

### 7. 前端「待 review 队列」tab

- 新组件 `packages/web/src/components/issues/IssueJobsView.tsx`，挂在 Issues 旁边新 tab
- 数据：WS 推送 `issue-job-state` 消息 + 2 秒轮询兜底
- 每卡片：issue 摘要 / state 灯 / 耗时 / [打开 diff] [approve] [reject]
- "打开 diff" 复用现有 ChangesList 组件，输入 worktreePath
- approve / reject 走对应 API
- 失败卡片展开能看 errorReason + verifyLog 末尾片段
- **verify**：完整跑一遍从派工到 approve 进主分支

### 8. 熔断与配额

- 单 session 90 分钟硬上限 → kill + failed
- 总并发上限默认 3，新派的进 pending 队列等空位
- worktree 池上限 5：超过拒绝派工，前端提示"先 review 现有的"
- **verify**：连派 6 条，看第 4-6 条进 pending 等待

### 9. 操作日志埋点（贯穿全步骤）

- 前端：所有 mutation 走 `logAction`
- 后端：每个 job state 变化 → `serverLog('info','issues',...)`；verify pipeline 起止 → `serverLog('info','verify',...)`；超时/失败 → `serverLog('error',...)`
- **verify**：LogsView 能看完整链路 `issues:batch-dispatch start → N 条 issues:job-create → 各 issues:state-change → verify:start → verify:done|fail → issues:approve|reject`

## 边界情况

- **issues.md 在大哥编辑期间被 AI 改写**：用 issueHash（issue 原文的 sha1）而不是行号定位；hash mismatch → state=failed，errorReason='issue-text-changed'
- **worktree 创建失败**（磁盘满、git 不可用、权限）→ job 直接 failed，不进 running，前端弹错误
- **claude session 起来后第一条命令就没回应**（CLI 没装好、PTY 异常）→ 90 分钟超时兜底；errorReason='no-output 90m'
- **verify 命令中途 server 重启** → 所有 in-memory job 丢失，worktree 留在磁盘 → 下次启动扫一次孤儿 worktree（路径前缀 `issue-job-`），列在「待 review 队列」灰色显示 `unknown - server restart`，大哥手动决定 approve / reject
- **同一条 issue 重复派工** → 检查 issueHash 是否已有 running / review-ready job，是则后端 409 拒绝
- **approve 时主分支已有冲突** → `git merge --no-ff` 失败 → state="merge-conflict"，前端提示大哥手动解（不自动 abort）
- **大哥手动改了 dev/issues.md 把 `- [ ]` 改成 `- [x]` 而 job 还在跑** → job 不感知，跑完正常 review-ready；approve 时再 merge，issues.md 那行可能有冲突 → 走 merge-conflict 路径
- **派工时 `[auto]` 标签被偷偷删了**（大哥并发改 issues.md）→ 派工接口现取 `auto: true` 校验，不通过 409 拒绝

## 风险与注意

对应 roadmap s11 劝退档列的四类风险，挨个回应"怎么规避"：

- **改坏**：worktree 内 agent 改错 → 卡在 typecheck / lint / smoke 红灯，标 failed 不进 review-ready，主仓不被污染
- **绕约束**：agent 可能跳过 `[auto]` 标签的初衷去乱改 → 靠 prompt 模板硬性约束 + 单 issue 单文件以内为主 + diff 评审。**第一版 prompt 模板必须先在 1-2 条最简单的 issue（如改注释、加 logAction、改文档）上手验，再开放给大哥批量用——这是软门槛，不在代码里强制**
- **死循环烧 token**：90 分钟硬上限 + 并发 3 + worktree 池 5 = 最坏一晚上 ≤ 单 session 几轮，Claude 每轮 token 量大哥心里有数；外加 `===ISSUE-STUCK===` 自报熔断
- **误删数据库**：worktree 内独立 SQLite（VibeSpace 已实现的隔离），主项目数据库完全不暴露

其他注意：

- **worktree 占磁盘**：每个 worktree 一份 node_modules（pnpm symlink 能省一部分但不全）；池上限 5 已经能控住，监控盘点单独留 issue 跟进
- **`[auto]` 标签靠大哥手标**：第一版不做 UI 改标签编辑器，等用一段时间看要不要
- **默认 `[auto]` 列表先空**：实施完后大哥自己挑一条最简单的标 `[auto]` 试水
- **没有经过 Gemini/Codex 评审**：两 CLI 都没装；plan 主要靠 Claude 自审 + 大哥审，万一漏角度后续在 dev/issues.md 补
- **VSCode / Cursor 的 git 监视器** 可能因为 worktree 增多而变卡；如果发现，issues.md 留一条跟进

## 多模型 Plan 会审

> 跳过：Gemini CLI 报 `spawn gemini ENOENT`（未安装），Codex CLI 报"未安装或缺运行时支持"。CLAUDE.md 规定不阻塞 plan 交付，回退到 Claude 单独写 plan。两 CLI 装好后，下个任务再启用三模型会审。
