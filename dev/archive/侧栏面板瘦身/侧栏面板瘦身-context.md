# 侧栏面板瘦身 · 上下文盘点

## 关键文件（改动边界）

### 前端（改）
- `packages/web/src/components/SettingsDialog.tsx` — imperative open 模式（`openSettings()` + module-level listeners）。在第 145 行"会话冬眠"`<section>` 之后追加"桌面通知"`<section>`。需引入 `currentPermission`/`requestPermission`（`../notify`）+ store 的 `notifyPerm`/`setNotifyPerm`。
- `packages/web/src/components/layout/ActivityBar.tsx` — `items` 数组（38-60 行）删 perf/usage/jobs/inbox 四项；底部"通知权限灯（●）"块（100-122 行）整块删；15-19 行 `logErrorCount` 保留、`notifyCount`/`notifyPerm` 删。
- `packages/web/src/components/layout/PrimarySidebar.tsx` — lazy import（7-18 行）删 4 个；`STATIC_TITLES`（20-31 行）删 4 key；switch（64-113 行）删 4 case。
- `packages/web/src/components/layout/Workbench.tsx` — footer 通知按钮（194-209 行）+ `onNotifyClick` 闭包删；mount-time `setNotifyPerm(currentPermission())`（53 行附近）保留。
- `packages/web/src/store.ts` — `Activity` 类型（49 行）删 4 字面量；`readWorkbench()` 对 localStorage activity 的 cast 加运行时校验；保留 `notifyingSessions`/`notifyPerm`/`setNotifyPerm`/`clearNotify`/`clearAllNotify`（162-347/529/771-783 行段）。
- `packages/web/src/api.ts` — 删 `getProjectPerf`/`getClaudeUsage`/`listJobs`/`cancelJob`/`deleteJob`。
- `packages/web/src/types.ts` — 删被删功能专属类型，逐个 grep 后删；不删 `AgentKind`。

### 前端（删）
- `packages/web/src/components/sidebar/{PerfView,UsageView,JobsView,InboxView}.tsx`

### 后端（改）
- `packages/server/src/index.ts` — 删 import（33/38/40 行）+ register 调用（171/176/178 行）。
- `packages/server/src/review-runner.ts` — 删 jobsService import（8 行）；`kickoffArchiveReview`（25-39 行）改回 `setImmediate` fire-and-forget 并透传 `projectId`；`runArchiveReview`（41-71 行）补 `serverLog` 起止；console.log/error 保留或一并转 serverLog。

### 后端（删）
- `packages/server/src/routes/{perf,usage,jobs}.ts`
- `packages/server/src/{perf-service,usage-service,jobs-service}.ts`

### 不动（验证用，非改动边界）
- `packages/server/src/install-jobs.ts`、`packages/server/src/routes/cli-installer.ts` — installJobs 独立通道。
- `packages/web/src/notify.ts` — 通知核心，本次只调用不改。
- `packages/web/src/components/{terminal/SessionView,editor/EditorArea}.tsx` — notifyingSessions 视觉反馈，保留。

## 决策记录

- **通知偏好不入后端/SQLite**：浏览器 `Notification.permission` 本身就是权威状态，store 的 `notifyPerm` 只是它的镜像。再造一份后端配置是重复存储 + 多一个一致性问题。资深工程师看会觉得多余 → 不做。
- **不为 jobsService 找替代 manager**：review-runner 回到它最原始的 `setImmediate` fire-and-forget 形态即可，归档评审本就是后台任务。新造一个"review job 管理器"是没人要的抽象 → 不做。
- **不补"等待输入汇总列表"**：InboxView 的 sessions 列表删掉后，session tab 上已有视觉提示 + 浏览器桌面通知两条入口。再补一个汇总组件是用户没要的功能 → 不做。
- **review-runner 用 serverLog 不用 console.log**：LogsView 可见 + 落盘是项目硬规则（操作日志规则）；归档评审是用户可感知的后台行为，必须能在 LogsView 回放。
- **执行顺序"先改消费者再删文件"**：Codex 评审指出反序会让中间态 typecheck 报红。前端 B→C、后端 D 内部"先改 review-runner/index.ts 再删 route/service"。

## 依赖与约束

- `serverLog` 签名：`serverLog(level, scope, msg, extra?)`（`packages/server/src/log-bus.ts`）。level 用 `'info'|'error'`，scope 用小写 `'docs'`。
- `logAction(scope, action, fn, ctx?)`（`packages/web/src/logs.ts`）——前端 mutation 起止配对。
- `requestPermission()` 浏览器要求在用户手势同一事件链内调用；包一层 `logAction` 的 `await` 不丢手势（promise chain 合规）。
- `HARD_TIMEOUT_MS = 120_000` 在 `review-runner.ts::runCli` 的 `setTimeout`——本次不动，超时能力随 runCli 保留。
- typecheck 命令：`pnpm -F @aimon/web typecheck`、`pnpm -F @aimon/server typecheck`；build：`pnpm -F @aimon/web build`。
- `git status` 显示 `packages/cli/` 为未跟踪目录、README/pnpm-lock 等已有未提交改动——均非本任务边界，收尾 diff 核对时需排除。
