# harness-task绑定与jobs面板 · plan

> memory 扫过：`manual.md` 有"小功能直接改不走流程"——本任务量级显著超过"小功能"，必须走完整三段式；`auto.md` 仅 hook 冒烟占位条目，与本任务无关。
>
> 上一任务 `harness-worktree隔离` 沉淀的相关经验（`dev/learnings.md`）：DialogHost 不支持复合 dialog，要"主体 + 次询问"的场景用二段式 confirm 比扩 DialogHost 更外科。Phase A 的"关闭 session 时 task 没勾完则提示"会用同样套路。

## 背景与定位

按 harness 12 层 ROI 排序，`harness-worktree隔离` 已经做完（T2-A），下两条配套小活：

- **Phase A · T1-A** task ↔ session 绑定：让你 5 个 session 同时干活时，标签上直接看到"哪个 session 在做哪个任务"，关 session 前提醒任务还没勾完。
- **Phase B · T1-B** 通用 Background Jobs 面板：把现在散在 `review-runner.ts`（归档评审）和 `install-jobs.ts`（CLI 安装）两套 fire-and-forget 收成一个 sidebar tab📋，进度/失败一处看到。

两条互不依赖（A 改 DB sessions 表 + DocsView + EditorArea；B 加新 sidebar tab + 新 server 模块），但作为同期相似量级配套并入一个任务伞下，一次确认推完。

## 目标

### Phase A — task↔session 绑定
1. session 启动 / 启动后都能"绑定到一个任务名"；绑定关系存 DB；session 标签前缀显示任务名（与 🌿 worktree badge 风格一致）
2. 关闭 session 前如果它还绑着任务且任务没勾完 → 弹提示（不阻断，只是给一个反悔机会）
3. DocsView 任务行能看到"目前哪个 session 绑在我身上"——一个小 badge

### Phase B — Background Jobs 面板
1. 新建 sidebar tab 📋 Jobs（替代 logs 现有 📋 → logs 换 icon）
2. 列出当前所有"长时间运行的 server 端后台任务"——v1 范围：归档评审（review-runner）+ CLI 安装（install-jobs）
3. running 项可取消（review 走 child_process kill；install 走现有 cancelInstall）
4. done / failed 项保留 30 分钟方便回看，之后自动清理
5. review-runner 不再 fire-and-forget 黑盒——通过 JobsService 注册，UI 能看到状态

### 验收标准（必须包含浏览器可观察项）

#### Phase A 验收
- **A-tsc**：`pnpm -C packages/server exec tsc -b` + `pnpm -C packages/web exec tsc -b` 全绿
- **A-smoke**：复用现有 `pnpm smoke:server` / `smoke:persistence`（要求加了 task 字段后老 smoke 仍过）
- **A-V1**（浏览器）：DocsView 任务行右键菜单看到"绑定到 session"二级菜单，列出当前 project 的所有活 session；选中后任务行右侧出现 session badge 例如 `🤖 codex·abc123`
- **A-V2**（浏览器）：被绑定的 session 标签前缀出现 "📝 \<任务名>"（与 🌿 同位置，可共存）；点击该 task badge 可定位到 DocsView 那一行（v1 不做联动也可，bonus）
- **A-V3**（浏览器）：关闭一个绑了未完成任务的 session（任务 checked < total）→ confirm 文案变成包含"该 session 绑定的任务 \<名>(N/M) 还没做完，确认结束?"——选取消 = 不关；继续 = 关；不在 worktree 模式下不会再二段问 worktree gc
- **A-V4**（浏览器）：未绑定任何任务的 session 关闭体验**完全不变**（仍是单 confirm）—— 验证 A 没破坏既有 UX
- **A-LOG**：操作日志 `logAction('session','bind-task', …)` 起止配对在 LogsView 看到；解绑（绑到空）走 `unbind-task`

#### Phase B 验收
- **B-tsc**：两侧 tsc 全绿
- **B-V1**（浏览器）：ActivityBar 看到 📋 Jobs tab；点开 sidebar 显示标题"后台任务"，列出"还没有任务"或当前 jobs
- **B-V2**（浏览器）：在 DocsView 归档一个任务（触发 review-runner）→ Jobs tab 立刻出现一行 `review · <任务名> · running`；2 分钟内变 done 或 failed
- **B-V3**（浏览器）：装一个 CLI（CliInstallerDialog 跑 install）→ Jobs tab 出现一行 `install · <cliId> · running`，点取消按钮 → 状态变 cancelled
- **B-V4**（浏览器）：done / failed 的行 30 分钟后自动清掉（手动验证：用浏览器 DevTools 改 `Date.now()` 不靠谱，改成"重启 server 后 done 项不再持久"——重启即清理；30 分钟自动清理留 setTimeout 但不要求严格验收）
- **B-LOG**：JobsService 注册 / 完成 / 失败都有 `serverLog('info'|'error', 'jobs', …)` 起止配对入 LogsView

## 非目标（Non-Goals）

明确**本轮不做**：

1. **不做"自动派 agent 给空任务"**（T3-C autonomous claim 留以后做）
2. **不做"绑定状态联动 worktree"**（绑了任务的 session 不会自动跑 worktree 模式；用户自己勾）
3. **不做"任务可绑多个 session"**——v1 一对一绑定，多个 session 想做同一任务的话，绑定会"抢占"前一个绑定。后续若有需求再扩
4. **不做 JobsService 跨重启持久化**——server 重启后 jobs 内存清零（与现 install-jobs 行为一致）
5. **不做"DocsView 点 task badge 跳到 session 标签"**（A-V2 bonus 那条）；前端跳转留以后
6. **不做"Jobs UI 显示 detailed log tail"**——install-jobs 已经有自己的 SSE stream UI（CliInstallerDialog）；Jobs tab 只展示元信息（state / startedAt / 标题），点击行能跳转到对应详细面板（v1 仅 install 跳 CliInstallerDialog；review 没详细面板就显示 modal 文本）
7. **不做"绑定历史 audit"**——session row 只记当前绑定；解绑就改字段值，不留时间线

## 实施步骤（粗粒度）

### Phase A 步骤

A-1. **DB schema**：sessions 加列 `task_name TEXT NULL`（绑定的任务名；NULL = 未绑定）；类型 + CRUD + serialize 同步；新增 `setSessionTask(sessionId, taskName | null)` → verify: server tsc + 跑 smoke:server / smoke:persistence 仍过

A-2. **routes/sessions.ts**：CreateSessionSchema 加可选 `task: z.string().optional()`；startSession 创建后若有 task 调 setSessionTask；新增 `PATCH /api/sessions/:id/task`（body: `{ task: string | null }`）；序列化加 task 字段 → verify: curl PATCH 改绑定后 GET 拿到新值；操作日志 `serverLog('info','session','bind-task', …)`

A-3. **前端 types/api**：Session 加 `task?: string`；`createSession` 入参加 task 可选；新增 `bindSessionTask(id, task | null)` → verify: web tsc

A-4. **DocsView 行右键菜单加"绑定到 session"**：二级子菜单列出当前 project 的活 session（agent · last6id），选中调 bindSessionTask；任务行右侧加一个绑定 session 的 badge（取 sessions[].task === t.name 的那条 → 显示 `🤖 codex·abc123`） → verify: A-V1

A-5. **EditorArea session 标签**：`s.task` 存在时前缀加 `📝 <task截断16字>`（与 🌿 共存，task 在前 worktree 在后） → verify: A-V2

A-6. **closeSessionTab 增强**：若 `s.task` 不为空且对应 task 没勾完（要查 docsTasks store 里的 checked/total）→ 改 confirm 文案；`s.isolation==='worktree'` 的二段式仍保留（task 提示融合进第一步 confirm 文案，**不**再加第三步） → verify: A-V3 / A-V4

### Phase B 步骤

B-1. **新建 `packages/server/src/jobs-service.ts`**：`JobsService` class，方法 `register(kind, title, runner): jobId`、`get(jobId)`、`list()`、`cancel(jobId)`、`pruneOldEntries()`；事件 `change`；done/failed 项保留 30 min 后清；内部维护 Map<jobId, JobRecord> → verify: server tsc

B-2. **review-runner 改造**：`kickoffArchiveReview` 不直接 setImmediate，改成 `jobsService.register('review', taskName, async () => runArchiveReview(...))`；保留向后兼容（仍叫 kickoffArchiveReview 由 docs route 调） → verify: 跑一次归档触发，server log 看到"job registered" + "job done/failed"

B-3. **新建 `routes/jobs.ts`**：GET /api/jobs（聚合 jobsService.list() + installJobs.list() → 统一 wire shape）；POST /api/jobs/:id/cancel；index.ts 注册 → verify: curl GET /api/jobs 在归档 / 装 CLI 时各有一条

B-4. **前端 api**：listJobs / cancelJob → verify: web tsc

B-5. **新建 `sidebar/JobsView.tsx`**：3 秒轮询 listJobs（与 MemoryView 类似的轮询）；表格三列（kind icon / title / state pill / time / cancel button）；点 install kind 的行打开 CliInstallerDialog；点 review kind 的行 alertDialog 显示 title + state → verify: B-V1 / B-V2 / B-V3

B-6. **ActivityBar / PrimarySidebar 注册 jobs tab**：在 store 的 Activity 联合类型加 `'jobs'`；ActivityBar items 数组加一行 jobs（icon 🛠，logs 现有 📋 留给 logs 不动；jobs 用 🛠 / 🧰 / ⚒——选 🛠 单工具最直观）；PrimarySidebar TITLES + switch 加 jobs 分支 → verify: B-V1

B-7. **JobsService 操作日志**：register / done / failed / cancel 全走 serverLog('info'|'error','jobs', …) → verify: B-LOG

### 共享步骤
- README 更新（Concepts 加 task binding + jobs 段）
- dev/learnings.md 增条经验（如适用）
- 全量验收（tsc + smoke:server + smoke:persistence + smoke:worktree 全过）

## 边界情况

### Phase A 相关
- **task 在 dev/active/ 不存在了**（被归档 / 改名）→ session.task 字段还指着旧名 → DocsView 找不到对应行就不显示 badge；session 标签仍显示旧 task 名（用户能看到孤儿绑定，自己解绑）
- **同一 task 被先后绑定到两个 session**（v1 一对一）→ 后绑定的覆盖前者；前 session 的 .task 字段被清空（PATCH 时检测："已绑到别的 session 上，是否抢占？" 弹 confirm）
- **session 已死（stopped/crashed）但还绑着任务** → DocsView 不该显示 badge；前端过滤 `liveStatus !== stopped/crashed` 才显示
- **关闭 session 时任务恰好刚勾完**（check === total）→ 不弹增强 confirm，走原 confirm

### Phase B 相关
- **review-runner 的进程是当前 server 的 child？**——它实际上是直接调 codex/gemini CLI 的 spawn，子进程；register 进 JobsService 时记下 ChildProcess 引用以便 cancel 时 kill
- **JobsService 重启清零**：用户归档触发 review，3 秒后重启 server，UI 不再看到那条 review job——可接受（v1 非目标 4）
- **install-job 和 review-job ID 冲突**：install 用 nanoid(12)，review 也 nanoid；理论冲突概率近似 0；但聚合时按 `kind+id` 复合键避免
- **30 分钟自动清理**：用 setTimeout 在 jobs-service 里 unref；server 重启后 timer 没了无所谓（重启就全清了）

## 风险与注意

1. **store 同步绑定状态**：sessions 数据从 GET /api/sessions 拿；当前 store 已有 sessions 列表；PATCH /api/sessions/:id/task 后必须**手动同步 store** 那条 session 的 .task 字段，不然 UI 显示不更新（写一个 store action `setSessionTaskLocal`）
2. **EditorArea 标签宽度**：再加一个 📝 badge 标签宽度可能爆——已经有 🌿+agent_name+id+scope_badge，加 📝 + 任务名（截断16字）后超长，建议任务名再缩到 8-10 字 + ellipsis
3. **DocsView 的 sessions list**：要从 store 拿 + 按 projectId 过滤 + 仅 alive；3 个 session 时要展示 3 个选项；右键菜单要支持二级
4. **ContextMenu 是否支持子菜单**：看下现有 `ContextMenu.tsx` 的 ContextMenuItem 接口；不支持就用 prompt + 输入 sessionId（差体验）或扩 ContextMenu。**风险点**：扩 ContextMenu 可能比想象的工作量大，到 context 阶段先核实
5. **JobsView 轮询节奏**：3 秒一次，跟 MemoryView 一致，不要更快（review job 本来要跑 30s+，1s 轮询过密）
6. **Jobs tab icon**：`logs` 已用 📋；可选项 🛠/🧰/⚒/🤖；选 🛠 (锤子)——区分度高，单字符
7. **熔断点**：步骤 A-4 的 ContextMenu 子菜单如果不好做，**降级为**任务行 hover 出现一个"绑定 session ▾"按钮 + 标准 dropdown，不动 ContextMenu

## 假设（请用户确认）

- AS1：v1 一个 session 只能绑一个 task，一个 task 只能被一个 session 绑——抢占式（后绑者覆盖前者）。要双向多对多再说？
- AS2：解绑（task→null）支持，UI 入口走 DocsView 任务行右键菜单"解绑"——同一菜单
- AS3：B 阶段 jobs tab icon 用 🛠（锤子）——你不喜欢的话告诉我换什么（备选 🧰 / ⚒ / ⚙）
- AS4：JobsService 重启不持久，跟 install-jobs 现状一致；如果想要重启可见就要落 SQLite，那是 v1.x 的事
- AS5：B-2 改 review-runner 时**不动它的 prompt 构造和 lessons 提取逻辑**，只把 setImmediate 包装层换成 jobsService.register —— 行为不变
