# issues并行派工 · context

> AI 自用 / 不停等大哥确认。记录关键文件、决策、依赖，执行阶段回头对照。

## 与 plan 的关键偏差

调研后发现 plan 里有两处描述与代码现状不符，调整记于此（不返回改 plan，因为不影响验收方向）：

1. **Issues UI 已存在**：plan 写"新组件 IssueJobsView.tsx"，实际 Issues 是 `DocsView.tsx` 里 `view='issues'` 模式，包含"派一条"和"全部派"按钮（走 dispatchClaude → 前端预填输入框）。新加 `view='queue'` 比新建文件更贴合，不新建 IssueJobsView。
2. **本任务不动 dispatchClaude**：旧的单条派工保留前端 queuePendingInput（预填等大哥按 Enter）语义。批量派工走另一条路：后端 ptyManager.write 自动发。**两条路并存**。

## 关键文件

### 后端（要读/要改）

- `packages/server/src/issues-service.ts` —— 现状：parser `/^\s*[-*+]\s+\[( |x|X)\]\s+(.+?)\s*$/`，IssueItem 字段 `line/text/done`。**要改**：parser 提取 `[auto]` 前缀，IssueItem 加 `auto: boolean` + `hash: string`（sha1 of text after auto-prefix strip）
- `packages/server/src/routes/issues.ts` —— 现状：只有只读 GET。**要改**：把新的 issue-jobs 路由从独立文件注册进 server
- `packages/server/src/routes/sessions.ts:380-454` —— spawn 时 isolation=worktree 走 addWorktree + setSessionWorktree。**只读**，IssueJobManager 复用 `POST /api/projects/:id/sessions`（不在 IssueJob 层重写 worktree 创建）
- `packages/server/src/pty-manager.ts:228` —— `ptyManager.write(sessionId, data)`。**只读复用**，IssueJobManager 用它发 prompt + 监听 PTY 输出探测 marker
- `packages/server/src/install-jobs.ts` —— EventEmitter + spawn child + log buffer + cancel 模式。**只读参照**，IssueJobManager 按这个形态写
- `packages/server/src/worktree-paths.ts` —— getWorktreePath / buildWorktreeBranch。**只读**，IssueJob worktree 路径用项目内独立前缀（见 D6）
- `packages/server/src/log-bus.ts` —— `serverLog`，**只读复用**
- `packages/server/src/db.ts` —— **不改**（见 D2，IssueJob 第一版纯 in-memory）
- `packages/server/src/index.ts` —— **要改**：注册新路由
- `packages/server/src/ws-hub.ts` —— **要改**：加 `issue-job-state` 推送消息

### 新文件（后端）

- `packages/server/src/issue-jobs.ts` —— IssueJobManager class（EventEmitter）+ 单例 export
- `packages/server/src/routes/issue-jobs.ts` —— POST batch-dispatch / GET list / POST approve / DELETE reject
- `packages/server/src/issue-verify.ts` —— Verify pipeline runner
- `packages/server/src/issue-prompt.ts` —— Prompt 模板生成函数

### 前端（要读/要改）

- `packages/web/src/components/sidebar/DocsView.tsx:13-15` —— 现状 `view: 'tasks' | 'issues' | 'memory'`。**要改**：加 `'queue'`；issues view 加多选 checkbox + 批量派按钮；新 queue view 显示 IssueJob 列表
- `packages/web/src/api.ts` —— `listIssues` 已有，**要加** `batchDispatchIssues / listIssueJobs / approveIssueJob / rejectIssueJob`
- `packages/web/src/types.ts` —— IssueItem 加 `auto: boolean` + `hash: string`；**新增** `IssueJob` 类型
- `packages/web/src/store.ts` —— **要改**：加 `issueJobsData / refreshIssueJobs` store
- `packages/web/src/logs.ts` —— `logAction`，**只读复用**
- `packages/web/src/dispatchClaude.ts` —— **不动**
- `packages/web/src/aimonWS.ts` —— **要改**：订阅新 WS 消息 `issue-job-state`

## 决策记录

### D1. 不改 dispatchClaude.ts（保留旧的单条派）
单条派工保留 queuePendingInput（"我亲自看一下再发"语义）；批量派走后端 ptyManager.write 自动发。两条路语义不同。**资深工程师过度设计检查**：✅ 不过度，强行统一才是过度。

### D2. IssueJob 第一版纯 in-memory，不入 sqlite
要持久化得加表 + 迁移。第一版用"启动时扫磁盘 issue-job-* worktree → 标 `unknown - server restart`"兜底。**过度设计检查**：✅ YAGNI——可能根本不会经常重启 server。

### D3. 后端 PTY 直发 prompt，不走前端 queuePendingInput
目标是"关浏览器也能跑"。`ptyManager.write(sessionId, prompt + "\r")` 直接发字节给 PTY，跟前端无关。**race 应对**：spawn 后等待 1500ms 再 write，避免被 claude TUI 启动初始化吞掉（参考 auto.md `fileContextMenu` 那条 120ms 等待经验，PTY 启动比单纯 send 多一点 buffer）。**过度设计检查**：✅ 必须做。

### D4. UI 复用 DocsView，不新建 IssueJobsView.tsx
Issues 是 DocsView 的子 view，新加 `view='queue'` 比新建文件更贴合。**过度设计检查**：✅ 少一个文件少一份维护。

### D5. issueHash = sha1(text after auto-prefix strip)
`[auto]` 标签会被加/去掉，hash 不能因为 toggle 标签就变。算的是 issue 描述本体，不含 `[auto]` 前缀。**过度设计检查**：✅ 必要（保 hash 稳定才能跨编辑定位）。

### D6. worktree 路径前缀 `issue-job-<hash8>-<sessionId>`
现有 session worktree 路径是 `data/worktrees/<projectId>/<sessionId>`。IssueJob 用 `data/worktrees/<projectId>/issue-job-<hash8>-<sessionId>` 前缀化便于 server 重启时识别孤儿。**实现方式**：在 `getWorktreePath` 之外另算一个 path（不改 worktree-paths.ts，因为新路径形状不通用），然后在 createSession 路由里允许传 `worktreePath` 覆盖（如不支持就 IssueJobManager 内部直接调 git worktree add 而不复用 sessions 路由）。**待执行时确认哪条路径更轻**。

### D7. Verify pipeline 在 worktreePath 跑（不是项目根）
要验 worktree 里的改动能不能编译过，spawn cwd 设为 worktreePath。

### D8. Verify 命令保持最小集
首版只跑 `pnpm -C packages/web exec tsc -b` + `pnpm -C packages/server exec tsc -b`。lint / smoke 仅在项目根 package.json 有对应 script 时跑。**过度设计检查**：✅ 不过度，能识别 80% 的"改坏了"。

## 依赖与约束

- **现有 createSession 接口**：`POST /api/projects/:id/sessions`，body 含 `agent / isolation / task`。**待确认**：是否允许传 worktreePath 覆盖（影响 D6 路径方案）
- **现有 ptyManager.write**：稳定接口，写 `\r` 等于按 Enter
- **PTY 启动 race**：spawn 后等 1500ms 再 write
- **session lifecycle 联动**：大哥手动 endSession 时对应 IssueJob 标 cancelled（监听 pty-manager exit 事件）
- **磁盘**：单 worktree 几百 MB，5 个池上限约 2-3 GB，不监控
- **issues.md 路径**：固定 `<projectPath>/dev/issues.md`，issues-service 已做 path traversal 校验，复用
- **PTY 输出订阅**：ws-hub.ts 已经订阅 PTY 输出推给前端；IssueJobManager 也要订阅相同输出流探测 `===ISSUE-DONE===` marker（**待确认 pty-manager 的输出订阅接口形态**）
- **类型链**：IssueItem 的 auto/hash 字段要在 server / web 同步（types.ts 是 web 端类型，server 端 issues-service.ts 各自定义，要保持一致）

## 待执行时确认的小开口

- D6 worktree 路径覆盖：createSession 路由是否接受 worktreePath 参数。如不接受，IssueJobManager 内部直接 git worktree add（不走 sessions 路由）—— 这会让 setSessionWorktree、状态机、subagent-runs 那些副作用都得手动同步，复杂度上升。**优先方案：扩 sessions 路由接 optional worktreePath**
- pty-manager 输出订阅 API 形态：是 EventEmitter on 还是 callback register
