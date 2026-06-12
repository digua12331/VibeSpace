# 侧栏面板瘦身 · 方案

## 大哥摘要

简单说，VibeSpace 左边那一长条工具栏现在有 11 个图标，里面有 4 个你说"没卵用还耗性能"——📊 性能、📈 使用量、🛠 后台任务、🔔 通知。这次的活就是：

- **彻底删掉**：📊 性能、📈 使用量、🛠 后台任务 三个面板（前端按钮 + 后端服务代码全清，不留死代码）。
- **挪个家**：🔔 通知图标从工具栏移除，开关挪到右上角"⚙ 设置"对话框里。**通知功能本身保留**——AI 等你输入时浏览器仍会弹桌面通知（第一次会弹窗问你要不要授权，授权过就一直有效）。
- **不动**：📝 文档（你和 AI 协作的 plan/context/tasks 入口，项目核心）。

做完之后你打开 VibeSpace 能看到的变化：工具栏从 11 个图标变成 7 个，少了 4 个；点右上角 ⚙ 设置，对话框里多一节"桌面通知"，能看到当前是不是已经授权、能点按钮申请授权。其他所有功能不变，不会动到你任何现有项目数据。

性能上：你不打开后台任务面板时本来就不太耗 CPU，但**点过一次后浏览器就会每 3 秒偷偷拉一次后端**直到你刷新页面——删完这条偷偷拉就彻底没了。

## 目标

把 4 个 sidebar 面板（perf / usage / jobs / inbox）从前后端代码里彻底清掉，把通知权限的开关迁移到现有 `SettingsDialog`（设置对话框），**保留**两样东西：(1) AI 等输入时弹浏览器桌面通知的核心行为；(2) `dev/memory/auto.md` 归档评审自动沉淀机制。

### 可验证的验收标准

1. **浏览器可观察（UI 验收项）**：打开 http://127.0.0.1:8787，左边工具栏不再出现 📊 📈 🛠 🔔 四个图标（从 11 个减到 7 个）；点右上角 ⚙ 设置，对话框里能看到"桌面通知"小节，状态文案随浏览器权限变化（"已启用 / 未启用 / 被拒绝 / 不支持"），未授权时可点"请求授权"触发原生权限弹窗。
2. **通知行为还在**：在设置里授权后，起一个 Claude session 让它等输入，切到别的浏览器标签页，仍能收到桌面通知。
3. **归档评审还跑**：在 Dev Docs 面板归档一个任务，30 秒内查 LogsView 能看到 `scope=docs` 的归档评审起止日志（成功 `dev/memory/auto.md` 会追加一条；失败 `dev/memory/rejected.md` 追加一条）。
4. **CLI 安装器不坏**：走一次 CLI 安装流程能正常出进度（证明 `installJobs` 这套独立通道没被误删）。
5. **构建/类型通过**：`pnpm -F @aimon/web typecheck`、`pnpm -F @aimon/server typecheck` 全绿；`pnpm -F @aimon/web build` 成功。
6. **引用图扫干净**：删完后按"实施步骤 阶段 E"的完整 grep 清单在整个 repo 扫，业务代码里**零命中**（白名单：本任务 plan/context/tasks 文档自身允许出现）。

## 非目标 (Non-Goals)

- 不动 `installJobs`（`packages/server/src/install-jobs.ts`，cli-installer 的内部进度通道，跟"后台任务"sidebar 用的 `jobsService` 是两套完全独立的 manager）。
- 不动 `review-runner.ts` 的归档评审核心逻辑——它仍在归档时被 `docs.ts::kickoffArchiveReview` 触发；只解除它对 `jobsService` 的依赖。
- 不动 `dev/memory/` 三件套（auto/manual/rejected）的写盘机制和 MemoryView 的展示。
- 不动 EditorArea/SessionView 里对 `notifyingSessions` 的视觉反馈（session tab 上的红点提示保留）。
- 不动 `AgentKind` 类型——它被会话创建/启动 API 用，跟本次删除无关。
- **不**做更大范围的 sidebar 重排或图标重设计——这次只删 4 个、加一个设置项。

## 实施步骤

> 顺序经 Codex 评审调整：**先加新入口 → 再改所有消费者 → 最后删文件**。这样任何一个阶段做完，仓库都不会处于"类型/构建半坏"状态。

### 阶段 A · 在 SettingsDialog 里加"桌面通知"小节

1. 编辑 `packages/web/src/components/SettingsDialog.tsx`：
   - 引入 `currentPermission` / `requestPermission`（from `../notify`），引入 store 的 `notifyPerm` / `setNotifyPerm`。
   - 在"会话冬眠"小节下追加一节 `<section>`：权限状态徽章（沿用 InboxView 的色调：granted=绿 / denied|unsupported=红 / default=灰）+ "请求授权"按钮。
   - 按钮点击走 `await requestPermission()` → `setNotifyPerm(next)`，用 `logAction('settings', 'request-notify-permission', fn, ctx)` 包起止配对（注：`requestPermission` 必须在用户点击的同一事件里调，包一层 `logAction` 的 await 不会丢用户手势）。
   - 不新增任何后端 API；通知偏好纯浏览器层，不入 SQLite。

→ verify: 浏览器打开 ⚙ 设置看到"桌面通知"小节、状态徽章正确、点按钮触发原生权限弹窗；LogsView 出现 `scope=settings action=request-notify-permission` 起止配对；失败分支（如浏览器不支持）人工验证一次走 error 路径。

### 阶段 B · 移除 4 个面板的所有"消费者"引用（先于删文件）

2. `packages/web/src/components/layout/ActivityBar.tsx`：从 `items` 删 `perf`/`usage`/`jobs`/`inbox` 四项；删底部"通知权限指示灯（●）"那块；清掉文件里不再用的 `notifyCount`/`notifyPerm` 读取。
3. `packages/web/src/components/layout/PrimarySidebar.tsx`：删 `PerfView`/`JobsView`/`UsageView`/`InboxView` 四个 lazy import；删 `STATIC_TITLES` 里 `perf`/`inbox`/`jobs`/`usage` 四个 key；删 switch 里对应四个 case。
4. `packages/web/src/components/layout/Workbench.tsx`：删 footer 那个 `🔔 {notifyPerm}` 按钮及其 `onNotifyClick` 闭包；保留 mount-time 的 `setNotifyPerm(currentPermission())` 同步（SettingsDialog 共用同一字段）。
5. `packages/web/src/store.ts`：
   - `Activity` 联合类型删 `'perf' | 'inbox' | 'jobs' | 'usage'` 四个字面量。
   - **保留** `notifyingSessions` / `notifyPerm` / `setNotifyPerm` / `clearNotify` / `clearAllNotify`（SessionView/EditorArea/SettingsDialog 还在用）。
   - **运行时兜底**（Codex 重点提示）：`readWorkbench()` 直接把 localStorage 值 `cast` 成 `Activity`，TypeScript 类型检查抓不到老用户残留的 `'perf'`/`'jobs'` 等失效值。必须加一段运行时校验——读出的 activity 不在有效集合内就回落到 `'files'`，否则老用户刷新后会卡在空白 sidebar。

→ verify: `pnpm -F @aimon/web typecheck` 全绿；浏览器侧栏只剩 7 个图标；手动把 localStorage 里的 activity 改成 `"perf"` 再刷新，sidebar 应回落到"文件"而非空白。

### 阶段 C · 删前端 view 文件 + API 函数 + 类型（一个原子步骤一起验证）

> Codex 提示：删 view、删 API 函数、删类型 import 必须**捆在一起验证**——只删 API 不删 view，web typecheck 会红。

6. 删除文件：`packages/web/src/components/sidebar/{PerfView,UsageView,JobsView,InboxView}.tsx`。
7. `packages/web/src/api.ts`：删 `getProjectPerf` / `getClaudeUsage` / `listJobs` / `cancelJob` / `deleteJob` 五个导出函数（Codex 已核对：这五个的调用点确实只在被删的那 4 个 view 里）。
8. `packages/web/src/types.ts`：删被删功能专属的类型——按实际命名核对 `JobItem` / `JobKind` / `JobState` / `ProjectPerf` / `SessionPerfSample` / `ClaudeUsage` 等；逐个 grep 确认无其他文件 import 后再删。**不删 `AgentKind`**。

→ verify: `pnpm -F @aimon/web typecheck` 全绿；`pnpm -F @aimon/web build` 通过。

### 阶段 D · 后端：先摘消费者引用，再删 route/service 文件

> Codex 提示：必须先改 `review-runner.ts` + `index.ts` 去掉 import/usage，**再**删 route/service 文件；反过来会让 server typecheck 在中间态报红。

9. `packages/server/src/review-runner.ts`：
   - 删 `import { jobsService } from "./jobs-service.js"`。
   - `kickoffArchiveReview` 改回原始 `setImmediate(() => void runArchiveReview(...))` fire-and-forget，不再 `jobsService.register`；继续把 `projectId` 透传进 `runArchiveReview`（serverLog 要带项目关联）。
   - 在 `runArchiveReview` 内补操作日志：开始 `serverLog("info", "docs", "归档评审 开始", {...})`、成功 `serverLog("info", "docs", "归档评审 成功 (Nms)", {...})`、失败 `serverLog("error", "docs", "归档评审 失败: ...", { meta:{error} })`（注意 `serverLog` 真实签名是 `serverLog(level, scope, msg, extra?)`）。失败分支里**不要**让新加的 serverLog 吞掉原有"写 rejected.md"的 try/catch。
   - 确认：`HARD_TIMEOUT_MS=120_000` 的硬超时在 `review-runner.ts::runCli` 自己的 `setTimeout` 里，不在 jobsService——所以摘掉 jobsService **不需要**额外加 `Promise.race` 兜底，超时不会丢。
10. `packages/server/src/index.ts`：删 `registerPerfRoutes`/`registerJobsRoutes`/`registerUsageRoutes` 三处 import + 三处 `await register*Routes(app)` 调用。
11. 删除文件：`packages/server/src/routes/{perf,usage,jobs}.ts`、`packages/server/src/{perf-service,usage-service,jobs-service}.ts`。
12. 不动 `install-jobs.ts`、`routes/cli-installer.ts`。

→ verify: `pnpm -F @aimon/server typecheck` 全绿；起后端做一次归档，LogsView 看到 `scope=docs` 归档评审起止；CLI 安装走 installer 进度正常。

### 阶段 E · 引用图扫底 + 白名单核对

13. 在仓库根跑完整 grep（Codex 补全后的清单），业务代码里应零命中：
    - 前端符号：`PerfView|UsageView|JobsView|InboxView|getProjectPerf|getClaudeUsage|listJobs|cancelJob|deleteJob`
    - 类型名：`JobItem|JobKind|JobState|ProjectPerf|SessionPerfSample|ClaudeUsage`
    - 后端符号：`registerPerfRoutes|registerUsageRoutes|registerJobsRoutes|JobsService|JobRecord|sampleProject|computeClaudeUsage|jobsService`
    - 文件路径：`perf-service|usage-service|jobs-service`
    - 路由路径（精确，避免误伤 cli-installer）：`/api/jobs`（**不要**用宽的 `/jobs`，会命中 `/api/cli-installer/jobs`）、`/api/usage/claude`、`/api/projects/.*metrics`、字符串模板里的 `/metrics`
14. `git diff --name-only HEAD` 与 tasks.json 的 `write_files` 白名单比对，零越界。

→ verify: 上面两个命令的真实输出附进 tasks.md / handoff。

## 边界情况

- **老用户 localStorage 残留**：之前 activity 停在 perf/usage/jobs/inbox 的用户刷新后会读到失效值——阶段 B 第 5 步的运行时兜底专门处理这个（回落到 `'files'`）。
- **归档评审可见性下降**：JobsView 删后，归档评审进度只能在 LogsView 看（成功会在记忆 tab 出条目、失败进 rejected.md）。这是可接受降级——评审本就是后台 fire-and-forget。会在 handoff 里告知。
- **"等待输入"汇总列表丢失**：InboxView 的 sessions 汇总入口和 ActivityBar 红点 badge 都没了。降级为：session tab 上 SessionView/EditorArea 内置的视觉提示 + 浏览器桌面通知。本方案倾向不另补汇总入口（保持简洁，桌面通知是主入口）。
- **多 tab**：通知权限是浏览器全局状态，多 tab 一致；store 的 `notifyPerm` 各 tab mount 时各自 `currentPermission()` 同步，无需跨 tab 广播。
- **PWA / Service Worker 缓存**：`notify.ts` 用到 service worker 发通知；本次只删 UI 不动 SW 注册逻辑，SW 不缓存 sidebar 组件代码（Vite 产物按 hash 更新），用户硬刷新即拿到新版工具栏。

## 风险与注意

- **风险 1（破坏性变更协议触发）**：本任务删 ≥1 源码文件、删跨文件导出符号、删 3 个 HTTP 路由（`/api/projects/:id/metrics`、`/api/usage/claude`、`/api/jobs` 系列）。按 CLAUDE.md 破坏性变更协议，每个删除步骤后必须按阶段 E 的完整清单 grep 确认无残留。
- **风险 2（review-runner 解耦，已被 Codex 澄清）**：原草案担心"删 jobsService 丢掉 120s 硬超时"——Codex 实查确认超时在 `review-runner.ts::runCli` 自己的 setTimeout，**不在 jobsService**，因此不丢、不需要 `Promise.race`。真实风险是 jobsService 原本提供的 start/done/failed **可见日志**会丢——阶段 D 第 9 步用 `serverLog` 补回起止日志解决。
- **风险 3（store.ts Activity 修复范围）**：删联合类型字面量后 TypeScript 会在所有引用处报错，要逐处修干净；但 `readWorkbench()` 的 localStorage cast 是类型检查抓不到的盲区，必须加运行时校验（阶段 B 第 5 步）。
- **风险 4（types.ts 删类型前必须逐个 grep）**：被删功能的类型可能被意料外的文件 import，删之前每个类型单独 grep 确认，不要凭命名猜。
- **manual.md / auto.md 偏好核对**：扫过 `dev/memory/manual.md` 与 `auto.md` 最近条目，未见与"sidebar 形态 / 通知 / 性能监控面板"直接冲突或相关的长期偏好；`dev/ARCHITECTURE.md` 若存在相关章节本任务也无需依赖。

## 关键文件（改动白名单）

**改**：
- `packages/web/src/components/SettingsDialog.tsx`
- `packages/web/src/components/layout/ActivityBar.tsx`
- `packages/web/src/components/layout/PrimarySidebar.tsx`
- `packages/web/src/components/layout/Workbench.tsx`
- `packages/web/src/store.ts`
- `packages/web/src/api.ts`
- `packages/web/src/types.ts`
- `packages/server/src/index.ts`
- `packages/server/src/review-runner.ts`

**删**：
- `packages/web/src/components/sidebar/PerfView.tsx`
- `packages/web/src/components/sidebar/UsageView.tsx`
- `packages/web/src/components/sidebar/JobsView.tsx`
- `packages/web/src/components/sidebar/InboxView.tsx`
- `packages/server/src/routes/perf.ts`
- `packages/server/src/routes/usage.ts`
- `packages/server/src/routes/jobs.ts`
- `packages/server/src/perf-service.ts`
- `packages/server/src/usage-service.ts`
- `packages/server/src/jobs-service.ts`

## 多模型 Plan 会审

> [Codex 评审] grep 清单要补类型名（`JobItem|JobKind|JobState|ProjectPerf|SessionPerfSample|ClaudeUsage`）、后端符号（`JobsService|JobRecord|sampleProject|computeClaudeUsage`）和精确路由路径（`/api/jobs` 而非宽 `/jobs`，否则误伤 cli-installer）；`AgentKind` 不能删。
> [Codex 评审] 执行顺序须"先改消费者再删文件"——D 阶段先改 `review-runner.ts`+`index.ts` 再删 route/service，否则 server typecheck 中间态报红；C 阶段删 view+API+types 要捆成一个原子验证。
> [Codex 评审] `HARD_TIMEOUT_MS=120000` 在 `review-runner.ts::runCli`，不在 jobsService——摘掉 jobsService 不需要 `Promise.race`，超时不丢；真实风险是可见日志丢失，用 `serverLog(level, scope, msg, extra?)` 补起止。`store.ts::readWorkbench()` 的 localStorage cast 是类型盲区，需运行时校验。
> [Codex 综合] 采纳 Codex 全部评审点（顺序、grep 清单、serverLog 形态、运行时兜底）；放弃原草案"先删文件再改消费者"的顺序；本任务由 Claude 整合定稿（Codex 评审本身已是清单形态，无需再派一次 Codex 重写）。
> [Gemini 评审] 跳过：本机未安装 gemini CLI（`spawn gemini ENOENT`），重试一次仍失败；经大哥确认后续只用 Claude + Codex 两方。
> [Claude 白话化兜底] 核对大哥摘要为 5 行白话、术语（worktree/mutation 等本文未用，桌面通知/授权已是白话）已翻译；核对 manual.md/auto.md 无冲突偏好；实施步骤、风险列表、Codex 决策记录保持原样未改。
