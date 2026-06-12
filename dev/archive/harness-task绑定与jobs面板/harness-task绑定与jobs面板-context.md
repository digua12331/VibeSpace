# harness-task绑定与jobs面板 · context

## 关键文件（改动边界）

执行阶段原则上**只动这里列的文件**。要溢出先回来补这份清单。

### Phase A · task↔session 绑定

#### 后端 — 改

| 文件 | 行号/符号 | 改什么 |
|---|---|---|
| `packages/server/src/db.ts` | `migrate()` ~L120；`Session` L242；`SessionRow` L266；`createSession` L350；`rowToSession` L283；3 处 SELECT 列表 | 加列 `task_name TEXT NULL`；CRUD 类型 + SELECT + addColumnIfMissing；新增 `setSessionTask(id, task: string \| null)` 仿现有 `setSessionWorktree` |
| `packages/server/src/routes/sessions.ts` | `CreateSessionSchema` L72；`startSession` L188；新加 `PATCH /:id/task` | schema 加 `task: z.string().min(1).max(200).optional()`；spawn 后若有 task 调 setSessionTask；`PATCH /api/sessions/:id/task` body `{ task: string \| null }`，含抢占检测（同 task 已绑别的 session 时）；`WireSession` 加 task 字段；操作日志 `serverLog('info','session','bind-task'/'unbind-task' …)` |

#### 前端 — 改

| 文件 | 行号/符号 | 改什么 |
|---|---|---|
| `packages/web/src/types.ts` | `Session` L86 | 加可选 `task?: string` |
| `packages/web/src/api.ts` | `createSession` L109；新增 `bindSessionTask` | createSession 入参加 `task?: string`；新增 `bindSessionTask(id, task: string \| null): Promise<Session>` PATCH `/api/sessions/:id/task` |
| `packages/web/src/store.ts` | `interface State` L233；新加 action | 加 `setSessionTaskLocal(id, task: string \| null)`：仅本地同步 sessions 数组里那条的 .task —— 给 PATCH 成功后立刻刷新 UI 用 |
| `packages/web/src/components/sidebar/DocsView.tsx` | `openTaskMenu` L346；任务行渲染 L520-578 | 右键菜单 items 数组中间插入 `{ label: '绑定到 session', icon: '🔗', submenu: [...活 session 列表] }`，submenu 点击 → bindSessionTask + setSessionTaskLocal + logAction；任务行右侧（StatusPill 旁）加一个 binding badge：从 store.sessions 里找 `task===t.name && status不在终态` 的那条，显示 `🤖 codex·abc123` |
| `packages/web/src/components/editor/EditorArea.tsx` | session 标签 L221（worktree 任务已动过）；`closeSessionTab` L119 | 标签前缀加 `📝 <task截断10字>` badge（emerald-color，与现有 🌿 style 同；放在 🌿 前面）；`closeSessionTab` 第一个 confirm 文案当 session 有 task 且 task 没勾完时改成 `结束当前终端会话?\n\n该 session 绑定的任务"<name>"还没做完 (<checked>/<total>)` |

#### 后端 — 读（不改）

- `packages/server/src/log-bus.ts` — `serverLog`
- `packages/server/src/pty-manager.ts` — 不动
- `packages/server/src/status.ts` — 不动

### Phase B · Jobs 面板

#### 后端 — 新建 / 改

| 文件 | 改什么 |
|---|---|
| `packages/server/src/jobs-service.ts`（**新建**） | 通用 `JobsService` class：`register({ kind, title, runner, projectId? }) → jobId`；`get(jobId)`；`list()`；`cancel(jobId)`；维护 Map<jobId, JobRecord>；done/failed 项 30 min 后自清（setTimeout.unref）；事件 `change` 给 WS（v1 不连 WS，前端走轮询） |
| `packages/server/src/review-runner.ts` | `kickoffArchiveReview` 内部从 `setImmediate(() => runArchiveReview)` 改成 `jobsService.register('review', taskName, async () => runArchiveReview(...), { projectId })`；prompt / lessons 提取逻辑**不动**（plan AS5） |
| `packages/server/src/routes/jobs.ts`（**新建**） | `GET /api/jobs` 聚合 `jobsService.list()` + `installJobs.list()` → 统一 wire shape（`{ id, kind, title, state, startedAt, endedAt? }`）；`POST /api/jobs/:id/cancel` 按 kind 路由到对应 manager；`DELETE /api/jobs/:id` 清掉一条 done/failed |
| `packages/server/src/index.ts` | 注册 jobs 路由；server shutdown 时调 `jobsService.killAll()` 比照 install-jobs 现状 |

#### 前端 — 新建 / 改

| 文件 | 改什么 |
|---|---|
| `packages/web/src/types.ts` | 加 `JobKind = 'review' \| 'install'`；`JobState = 'running' \| 'done' \| 'failed' \| 'cancelled'`；`JobItem { id, kind, title, state, startedAt, endedAt? }` |
| `packages/web/src/api.ts` | `listJobs(): Promise<JobItem[]>`、`cancelJob(id): Promise<void>`、`deleteJob(id): Promise<void>` |
| `packages/web/src/store.ts` | `Activity` 联合类型 L33 加 `'jobs'` |
| `packages/web/src/components/sidebar/JobsView.tsx`（**新建**） | 3 秒轮询 listJobs；表格行：kind icon / title / state pill / time-ago / cancel/clear button；点 install 行 → 设个全局 hint 让 ProjectsColumn 打开 CliInstallerDialog（暂作 TODO，最简：alertDialog 显示元信息）；review 行点击 → alertDialog 显示 title + state |
| `packages/web/src/components/layout/ActivityBar.tsx` | items 数组加 `{ id: 'jobs', icon: '🛠', label: '后台任务' }`；放在 logs 之前（jobs 优先级 > logs） |
| `packages/web/src/components/layout/PrimarySidebar.tsx` | TITLES 加 `jobs: '后台任务'`；switch case 加 `case 'jobs': body = <JobsView />` |

#### 测试 / 文档

| 文件 | 内容 |
|---|---|
| `README.md` | "Concepts" 节加两小段：task↔session binding + jobs 面板 |
| `dev/learnings.md` | 视情况追条经验 |

---

## 决策记录

每条都过了"资深工程师会不会觉得过度设计"。

### Phase A 决策

#### A-D1 · sessions 表加单列 `task_name`，不抽 `session_tasks` 一对一表
**理由**：v1 一对一绑定，单字段足够；抽表是"为以后多对多"留位但 v1 不需要——典型过度设计。

#### A-D2 · `task` 字段存的是 task name 而非 path/uuid
**选**：`task='harness-worktree隔离'`
**不选**：`task=<some uuid>`
**理由**：task 没 uuid 概念，name 就是标识；DocsView 渲染时按 name match 即可。**风险**：task 改名时绑定会断（变孤儿绑定），plan 边界情况已记录。

#### A-D3 · 抢占式绑定（后绑覆盖前者）
**选**：v1 一对一抢占，PATCH 时若发现该 task 已被别的 session 绑了，**返回 409 + detail，前端 confirm 后再 PATCH 一次带 `{ force: true }`**。
**不选**：UI 自动覆盖不问 / 直接 silent 抢占
**理由**：明确比静默好；用户可能不知道某个老 session 还绑着。资深视角：合理 UX。

#### A-D4 · 未完成任务关闭时融合 confirm 文案，不加新 dialog 步骤
**选**：原 confirm 的 message 字符串多塞一行任务进度 → 一次确认
**不选**：先 confirm "结束?" 再 confirm "你确定丢下任务?"
**理由**：worktree 任务已经为 isolated session 加了二段式 confirm（已经够 UX 烦了）；再加一段叠到三段式过度。一行文案够提醒用户做决定。

#### A-D5 · `setSessionTaskLocal` 不走 GET refresh
**选**：PATCH 成功后调用 `setSessionTaskLocal(id, task)` 仅改 store 那条 .task 字段
**不选**：PATCH 成功后调 `refreshSessions(projectId)` 整体拉
**理由**：本地补一字段 1ms 完成，refresh 要走网络 + WS 重订阅；store 已有同等模式（`updateSessionStatus`、`markSessionExit`）。资深视角：标准。

#### A-D6 · 标签前缀 📝 在 🌿 之前
**理由**：task 比 worktree 更"语义层"，对用户更重要（worktree 是实现细节）。📝 + 🌿 + agent 三段都存在时按"任务 → 隔离 → 进程"排序符合心智。

### Phase B 决策

#### B-D1 · JobsService 与 InstallJobManager 并存，UI 聚合
**选**：JobsService 处理 review 类轻量 fire-and-forget；InstallJobManager 现状不动；jobs 路由把两套合并展示
**不选**：把 InstallJobManager 重写进 JobsService
**理由**：InstallJobManager 已经成熟（child_process 管理、日志缓冲、cancel），改动 ROI 低；UI 层聚合就够。资深视角：合理（接口统一 vs 实现统一，前者足够）。

#### B-D2 · 重启清零，不持久化
**选**：内存 Map，server 重启清掉
**不选**：落 SQLite jobs 表
**理由**：与 install-jobs 现状一致；jobs 是"过程信息"不是"业务数据"，重启丢失可接受。要看历史去 LogsView 的 jsonl 文件。资深视角：合理。

#### B-D3 · 30 min 自清 + 重启清零，**不**做手动清空 UI
**选**：done/failed 项 30 min 后 setTimeout.unref 自动从 Map 删；UI 不暴露"清空"按钮
**不选**：UI 给"清空已完成"按钮
**理由**：v1 简洁；30 min 已经足够回看；要清空就重启 server。

#### B-D4 · 前端轮询 3 秒，不接 WS
**选**：JobsView 自己 setInterval listJobs 每 3 秒
**不选**：JobsService 通过 WS 主动推
**理由**：与 MemoryView 现有节奏一致；jobs 数量少（多则 5-10 条），轮询开销忽略；接 WS 要扩 ws-hub 协议——典型 v1 过度。

#### B-D5 · ActivityBar 的 jobs icon 用 🛠
**选**：🛠 锤子（plan AS3 已确认）
**位置**：放在 logs 之前——jobs 比 logs 优先级高（人更常关心"现在跑什么"而不是"过去 log"）

#### B-D6 · v1 不做"点击 install 行跳 CliInstallerDialog"
**选**：v1 简化为 alertDialog 显示元信息；后续 v1.1 再做联动跳转
**不选**：v1 就做联动
**理由**：跳转要新增 store hint state + ProjectsColumn 监听，工作量超预期；info dialog 已让用户知道 job 状态。

---

## 依赖与约束

### 上游 / 兼容性

- **现有 createSession**：调用方（routes/sessions.ts startSession）现状只接受 isolation/scope；我们追加可选 task —— 向后兼容。
- **现有 DELETE /api/sessions/:id**：worktree 任务已加 `?gc=true`；本任务**不动 DELETE 路由**——只动 closeSessionTab 的 confirm 文案。
- **现有 install-jobs API**：`/api/cli-installer/jobs/:jobId` 等保持不动；jobs 聚合路由是**新增**的并行入口，不替代现有 SSE stream。
- **dev:alt / stable 双实例**：JobsService 是单进程内存，互不干扰。

### 数据结构

- 新加 `task_name TEXT NULL`：NULLABLE 老行迁移走 NULL；ALTER TABLE 用 addColumnIfMissing helper（worktree 任务已加进 db.ts）。
- `JobItem` wire shape 在前后端 types 都要镜像（与 InstallJob 重叠但简化字段，不带 log）。

### 操作日志

- Phase A：`logAction('session','bind-task',fn,{ projectId, sessionId, meta:{ task }})` 起止配对；解绑同 action 名 meta.task=null
- Phase B：JobsService 内部 `serverLog('info','jobs','register/done/failed/cancel')` 起止配对——register 起、done/failed/cancel 终
- 验收必须在 LogsView 看到一次 ERROR 入账（验 review-runner 失败路径或绑定到不存在的 task → 后端的某个失败分支）

### 性能

- jobs 列表数量级 5-20 条；3 秒轮询可接受
- jobs 聚合 GET 是 O(N) Map 遍历 + O(M) install 列表，无 IO，<1ms

### 熔断点（按 CLAUDE.md）

- 实现 PATCH 抢占检测时，如果"老 session 已被绑"逻辑写复杂了（多次 if 嵌套）→ 停手简化：v1 直接覆盖（不带 force），UI 不弹 confirm；让用户在 LogsView 看到 unbind 日志即可。
- JobsView 轮询如果出现死循环 / fetch 风暴：3 秒间隔的实现要确保 setInterval 在 component unmount / projectId 切换时清掉，否则 leak。
