# 大任务自拆并行 · context

> 上下文给 AI 自己看，不打扰大哥。本任务是 10 步的大任务，写完 context 直接进 tasks 不停。

## 关键文件

### 后端会读 / 会改的
- `packages/server/src/routes/issue-jobs.ts:1-520` — 现有 dispatchOne / wireSessionOutput / runVerifyPipeline 三个内部函数要抽出去（不是删，而是 issue-jobs 改成调用新 runner 的薄壳）
- `packages/server/src/issue-jobs.ts:1-316` — IssueJobManager 状态机 + EventEmitter；要照搬一份给 task-subtasks-store.ts
- `packages/server/src/issue-prompt.ts` — 看 prompt 模板写法 + DONE/STUCK marker 约定
- `packages/server/src/issue-verify.ts` — 看 verify pipeline 接口（复用，不动）
- `packages/server/src/task-budget.ts:1-531` — 复用 BudgetManager；子任务用 `<task>::<subtaskId>` 作 key
- `packages/server/src/task-status.ts:1-173` — 复用 appendStatusEntry；StatusEntry 加 subtaskId 可选字段
- `packages/server/src/pty-manager.ts` — kill / write 接口
- `packages/server/src/ws-hub.ts` — broadcast 接口
- `packages/server/src/log-bus.ts` — serverLog
- `packages/server/src/docs-service.ts` — readDocsFile / writeDocsFile 用于读 plan.md
- `packages/server/src/db.ts` — getProject / getSession
- `packages/server/src/index.ts:33-217` — 注册新路由位置

### 前端会读 / 会改的
- `packages/web/src/types.ts` — 加 SubtaskSpec / SubtaskRun / SubtaskGraph / SubtaskState 类型
- `packages/web/src/api.ts` — 加 getSubtasks / dispatchSubtasks / approveAllSubtasks / approveSubtask / rejectSubtask
- `packages/web/src/store.ts` — 加 taskSubtasks 字段 + refreshSubtasks
- `packages/web/src/components/sidebar/DocsView.tsx` — 任务行展开加 05_subtasks 入口 + 子任务列表 UI
- `packages/web/src/ws.ts` — 接收 subtask-state / subtask-remove WS 消息（如有）

### 配置 / 文档
- `scripts/task-subtasks-smoke.mjs` — 新建 smoke
- `scripts/issues-jobs-smoke.mjs` — 看 smoke 模板
- `scripts/budget-cutoff-smoke.mjs` — 看现代 smoke 模板（带 WS 断言）
- `package.json` — 加 smoke:task-subtasks
- `.aimon/templates/subtasks-syntax.example.md` — 新建子任务配置示例
- `README.zh-CN.md` — 加使用说明段
- `CLAUDE.md` — Plan 阶段加一句"AI 自己在 plan.md 末尾加 `## 自拆与依赖` 段"
- `dev/issues.md` — 顶部加注释指向新 skill

## 决策记录

### D1：用 JSON 嵌入 markdown，不用 YAML（与 plan 偏差）
plan.md 写的"YAML 嵌入代码块"是 AI 自己定的。摸代码发现项目根本没装 yaml 解析库，要么 `npm install yaml` 加新依赖，要么自己写 mini YAML 解析器。
**最务实做法：改用 JSON 代替 YAML**——LLM 生成 JSON 比 YAML 稳，零依赖，纯实现细节，大哥不读这段（manual.md 偏好"纯内部实现 AI 自决"）。
Markdown 里识别块 → ```` ```json ```` 代码块；plan.md 末尾保留 `## 自拆与依赖` 段，里面写 JSON 而不是 YAML。`.aimon/templates/subtasks-syntax.example.md` 也写 JSON 示例。

### D2：抽公共 runner 的方式 —— 增量重构，不破坏现有 issues-jobs
- 新建 `packages/server/src/worktree-session-runner.ts`，导出 `runWorktreeJob(opts)`：创建 session → wire output → 发 prompt
- `issue-jobs` 路由文件**保留**，但内部 `dispatchOne / wireSessionOutput / runVerifyPipeline` 改成调用新 runner 的薄壳
- markers 参数化：runner 接收 `{ markerDone, markerStuck }`；issue 维持 `===ISSUE-DONE===` / `===ISSUE-STUCK===`，subtask 用 `===SUBTASK-DONE===` / `===SUBTASK-STUCK===`
- verify pipeline 也参数化（接口 `(worktreePath, projectPath, onLog) => Promise<VerifyResult>`），issue 用 `runVerify`，subtask 暂时复用同样的 `runVerify`（一致就一致，避免节外生枝）
- 风险：拆完后 issues-jobs smoke 不回归 → step 1 完成后**必须**跑一次 `pnpm smoke:issues-jobs` 验证

### D3：子任务 store 完全复刻 issue-jobs.ts 的结构
- `packages/server/src/task-subtasks-store.ts` 拷一份 IssueJobManager 模式：EventEmitter + state 枚举 + 状态机 transition 校验 + in-memory Map
- 状态枚举：`pending | running | verifying | review-ready | failed | cancelled | merge-conflict | merged | unknown`（比 issue 多一个 `merged`，因为 issue approve 后直接 remove，subtask approve-all 后要保留 merged 状态用于排序）
- 元数据落盘：`.aimon/subtasks/<taskName>/<subtaskId>.json`（仿 `.aimon/issue-jobs/<jobId>.json`）
- server 启动时扫盘恢复孤儿（仿 loadOrphans）

### D4：拓扑排序 + 循环检测
- Kahn 算法：构造入度表 + 出边表 → 找入度 0 节点入队 → 弹一个减边 → 直到全部弹完或剩余 cycle
- 检测到 cycle 返回 null，路由层接到 null 返回 400 "依赖图有环"
- write_files 重叠自动加边：扫所有 (a, b) 对，spec.write_files 交集非空 → 给 b 加 `depends_on: a`（按 spec 顺序，id 小的先）
- validateGraph 返回 `{ ok: true, order: number[] }` 或 `{ ok: false, reason: 'cycle' | 'duplicate-id' | 'missing-dep' }`

### D5：dispatch 按拓扑序，不强制串行
- 拿到拓扑序后，按层级（同入度子集）**并行**派工，等本层全部进入 `review-ready` 再派下一层
- 这样 step1.write_files 跟 step2.write_files 不重叠时，两个并行跑；只有真正依赖才串行
- 并发上限默认 3（同 issues 批量派工 BATCH_DEFAULT_CONCURRENCY），不超过 5

### D6：approve-all 拓扑序 merge
- 接收按拓扑序的 subtaskId 列表，依次 `git merge --no-ff <branch>`
- 冲突立即停下 → markMergeConflict + serverLog + 不 revert 已 merge 的（用户手动 resolve）
- 成功 merge 后清 worktree、删 meta、状态变 merged（保留 entry，方便前端看历史；归档主任务时再清）

### D7：subtask prompt 模板
- 复用 `issue-prompt.ts` 的拼接思路，但 prompt 内容是「主任务上下文 + 当前 subtask spec + plan.md 局部段」
- prompt 末尾必须包含 `===SUBTASK-DONE===` / `===SUBTASK-STUCK===` 输出约定
- 注入 STATUS.md 末尾（如有）让 subtask session 能看到主任务进度

### D8：BudgetManager 复用 + 主任务停记
- 子任务派工后，每个 subtask 在 BudgetManager 注册一个 task：taskName = `<主任务名>::<subtaskId>`
- 主任务的 BudgetManager state 派工后**不再 recordRound**，但不 remove（保留供前端显示"已派工调度中"）
- 实现方式：dispatch-subtasks 接口里给主任务调用 `budgetManager.markScheduled(taskName)` —— 新增一个标记位 `scheduledAt: number | null`，hooks.ts 收到 PreToolUse 时判断 if scheduledAt != null 则不计数
- **风险**：这是对 task-budget.ts 的扩展（D8 的"主任务停记"机制），需要新增字段 + hooks.ts 入口判断
- **替代方案**：不动 task-budget.ts，让主任务 budget 继续计数（双重计数），UI 上写明"主任务计数包含子任务调度"——更简单。**先选简单方案，必要时再升级**

### D9：STATUS.md 共享 + subtaskId 字段
- 子任务的 checkpoint 写到主任务 `dev/active/<task>/STATUS.md`
- `task-status.ts` 的 StatusEntry 接口加 `subtaskId?: string` 可选字段
- formatEntry 输出格式追加一行 `- subtask: <subtaskId>`（如有）
- 不破坏现有 entry 兼容性

### D10：前端 UI 范围
- 不做拖拽 DAG 可视化（plan 非目标）
- 05_subtasks 是 FileRow 形态，点开二级展开列出子任务（不弹 modal）
- 每行：子任务 id / 标题 / 状态 chip / 依赖谁 / 跑哪个 worktree
- 顶部按钮：「一键派工」/「approve 全部」/「reject 全部 STUCK」
- 主任务行加"子任务统计"pill：`3/5 done`，颜色按完成度（绿 ≥80%、橙 30-80%、灰 <30%、红有 failed）
- plan UI "📐 编辑自拆"按钮第一版**不做**——大哥直接改 plan.md 也行；如果有时间再加（step 7 弹性放后面）

### D11：实施分批
**plan 写了 10 step 但实际不必一口气干完**——按风险拆 3 批，每批验证：

- **批 1（后端基建）**：step 1, 2, 3, 4, 8 — 共用 runner、subtasks 结构、store、HTTP 路由、STATUS.md 共享
  - 验证：`pnpm -C packages/server exec tsc -b --force` 通过 + `pnpm smoke:issues-jobs` 不回归
- **批 2（前端 UI）**：step 5, 6 — types/api/store + DocsView 05_subtasks 入口
  - 验证：`pnpm -C packages/web exec tsc -b --force` 通过
- **批 3（收尾）**：step 7（plan UI 自拆编辑器，简版或跳过）+ step 9（smoke）+ step 10（文档）
  - 验证：`pnpm smoke:task-subtasks` 全过 + 自派 vibespace-browser-tester

## 依赖与约束

- 上游 API：`POST /api/sessions`（带 isolation: 'worktree' 创建临时副本）；`POST /api/projects/:id/issues/batch-dispatch` 现成模式可抄
- 不动 SQLite schema（plan 已定）
- 不动 `installClaudeHooks` / `hub-token` / `hub-workspace`（无关）
- BudgetManager 现成基建：`budgetManager.registerTask({ taskName, projectId, projectPath, limits })` —— 子任务直接用
- `appendStatusEntry(projectPath, taskName, entry)` 现成接口，加 subtaskId 字段不破坏现有调用
- subtask session 创建后用 `setSessionTask(sessionId, taskName)` 绑 task（参考 issue-jobs 没用这个但 task-budget 自己 attachSession，subtask 派工后**手动**调用 `budgetManager.attachSession(taskName, sessionId)`）

## 跨任务知识沉淀候选

执行完后写进 `dev/learnings.md`（如果适用）：
- "拆共用 runner 模式：保持原路由作薄壳，避免一次性大重构 + 必跑原 smoke 防回归"
- "拓扑序 dispatch 按层并发，不要强制串行——空间换时间"
- "JSON > YAML for AI-generated config blocks: 零解析依赖、LLM 生成更稳"
