# VibeSpace 架构地图（项目级常量）

> 给 AI 看的代码地图。每次新任务的 plan 第 1 步先扫这份找相关章节。
> **长期稳定，只在跨包契约 / 技术栈 / 核心模式发生不可逆变更时更新**；普通功能迭代不动它。
> 这份地图与代码现状不符时，优先更新这份，而不是绕过它。

## 1. Packages 拓扑

`packages/` 下三个包，**互相没有 npm 内部依赖**（每个 package.json 自闭合），跨包通讯全靠运行时 HTTP/WS：

| 包 | 职责 | 主入口 | 主要技术栈 |
|---|---|---|---|
| `@aimon/server` | Fastify 后端 + PTY + SQLite | `packages/server/src/index.ts` | Fastify 5 / better-sqlite3 / @homebridge/node-pty / simple-git / zod / nanoid |
| `@aimon/web` | React SPA + xterm 终端 UI | `packages/web/src/main.tsx`（App 在 `App.tsx`） | React 19 / Vite 8 / Zustand / @xterm/* / react-markdown / shiki / tailwindcss 3 |
| `@aimon/hook-script` | Claude Code 钩子转发桥（POST 到 server） | `packages/hook-script/aimon-hook.mjs` | Node.js stdlib，**无第三方依赖** |

启动：根 `pnpm dev` 等价 `pnpm --filter @aimon/server dev`；前端需另起 `pnpm --filter @aimon/web dev`（package.json `dev:web`）。

hook-script 的 bin 名 `aimon-hook`，由 server 的 `hook-installer.ts` 在启动时（`index.ts:71`）写进 Claude Code settings。

## 2. 跨包通讯

### 2.1 HTTP REST API（web → server）

入口聚合：`packages/server/src/index.ts:146-167` 顺序注册 21 个 `register<Feature>Routes`。每个文件位于 `packages/server/src/routes/<feature>.ts`，统一签名：

```ts
export async function register<Feature>Routes(app: FastifyInstance): Promise<void>
```

路由文件清单（功能 → 文件）：

| 功能 | 文件 |
|---|---|
| 项目 CRUD / 布局 / skills / workflow | `routes/projects.ts` |
| 会话 CRUD / worktree / task 绑定 | `routes/sessions.ts` |
| Claude Code Hook 入口（POST /api/hooks/claude） | `routes/hooks.ts` |
| dev/active /archive 三段式文档读写 | `routes/docs.ts` |
| dev/memory/{auto,manual,rejected}.md | `routes/memory.ts` |
| dev/issues.md 全局问题池 | `routes/issues.ts` |
| git 状态/diff/commit/branch/stash/worktree | `routes/git.ts` |
| 通用 fire-and-forget 作业（review/codex/gemini） | `routes/jobs.ts` |
| CLI agent（codex/claude/gemini）配置读写 | `routes/cli-configs.ts` |
| CLI 子进程安装作业 | `routes/cli-installer.ts` |
| 文件操作（gitignore/删除/在浏览器打开） | `routes/fs-ops.ts` |
| 项目内任意文件原始字节 | `routes/raw-file.ts` |
| 终端粘贴图片落地 | `routes/paste-image.ts` |
| 项目性能指标 | `routes/perf.ts` |
| Claude Task 工具卡片 | `routes/subagent-runs.ts` |
| Claude usage 统计 | `routes/usage.ts` |
| 项目 .aimon/skills 列表 | `routes/skill-catalog.ts` |
| 远端 skills 市场 | `routes/skill-market.ts` |
| MD 锚点评论 CRUD | `routes/comments.ts` |
| 健康探测 + 服务版本 | `routes/health.ts` |
| 项目 output（构建产物等） | `routes/output.ts` |

Web 端 client：`packages/web/src/api.ts`——`BASE = VITE_AIMON_BACKEND ?? http://127.0.0.1:8787`，统一 `request()` 包装器；导出 `backendBase()` 给 `ws.ts` 复用。错误格式：`{error: '<snake_case>', detail|message: '...'}`。

### 2.2 WebSocket（双向）

- 后端入口：`packages/server/src/ws-hub.ts:46 registerWsHub`，单 endpoint `/ws`
- 协议注释：`ws-hub.ts:25-45`
- Client→Server：`subscribe / unsubscribe / input / resize / replay / log-from-client`
- Server→Client：`hello / output / status / exit / replay / log / error / error-pattern-alert`
- 模块级 `broadcast()`（`ws-hub.ts:20`）供非 WS 模块（如 log-bus）调用
- 前端 client：`packages/web/src/ws.ts` 类 `AimonWS`，导出单例 `aimonWS`；自动重连延时 `[1000,2000,5000]`

### 2.3 hook-script ↔ server

- 通讯：HTTP POST。`aimon-hook.mjs` 从 stdin 收 Claude payload，POST 到 `${AIMON_BACKEND}/api/hooks/claude`，硬超时 1500ms
- 认证：环境变量 `AIMON_SESSION_ID`，未设置直接 exit 0
- 同步等待响应：仅 `PreToolUse` / `SessionStart`；其它事件 fire-and-forget

## 3. 既定模式（新任务必须遵循）

### 3.1 操作日志（起止配对）

- **后端**：`packages/server/src/log-bus.ts:84` `serverLog(level, scope, msg, extra?)`
- **前端**：`packages/web/src/logs.ts:54` `logAction(scope, action, fn, ctx?)`（包装 mutation 起止）+ `pushLog()`（裸推）
- 落盘：`packages/server/data/logs/<YYYY-MM-DD>.log`（`log-bus.ts:55 getLogFilePath`）
- 起止格式：起 `${action} 开始`（info）/ 终成功 `${action} 成功 (Nms)` / 终失败 `${action} 失败: ${msg}` + `meta.error`
- 前端 → 后端落盘通道：`aimonWS.sendClientLog` 回传 `log-from-client`，后端 `persistClientLog`（`log-bus.ts:119`）
- 实际 scope 取值：`server / project / session / docs / git / installer / fs / comments / jobs / subagent / error-monitor`
- 错误循环检测：`packages/server/src/error-pattern-monitor.ts`（订阅 log-bus）

### 3.2 SQLite db.ts 三段同步 + 五处 SELECT 同步

`packages/server/src/db.ts` 内三段必须同步改：

| 段 | 位置 | 内容 |
|---|---|---|
| Schema | `db.ts:112 addColumnIfMissing` + `db.ts:123 migrate()` | CREATE TABLE / ALTER TABLE |
| 类型 | `db.ts:218-292` | `Project / Session / SessionRow / ProjectRow` + `rowToSession`（`db.ts:297`） |
| CRUD | `db.ts:318` Project / `db.ts:365` Session / `db.ts:490 appendEvent` | 增删改查方法 |

**额外**："五处 SELECT 同步"——`db.ts:205, 433, 464, 474, 484` 五处 SELECT 字段顺序必须完全一致，加新列要同时改五处（参见 `vibespace-db-scribe` 子代理）。

特殊：projects 主存档是 `data/projects.json`（`db.ts:13`），SQLite projects 表是影子；`db.ts:79 syncProjectsTable` 用 UPSERT 而非 DELETE+INSERT 避免 CASCADE 误杀 sessions。

### 3.3 Fastify 路由模板

文件结构：`packages/server/src/routes/<feature>.ts`，导出 `register<Feature>Routes`。内部模式：

```ts
const BodySchema = z.object({...});  // 顶部
// 路由内：
const parsed = BodySchema.safeParse(req.body);
if (!parsed.success) {
  return reply.code(400).send({ error: 'invalid_body', detail: parsed.error.issues });
}
serverLog('info', '<scope>', '<action> 开始', { ... });
try {
  // 业务
  serverLog('info', '<scope>', `<action> 成功 (${ms}ms)`, { ... });
  return reply.send({...});
} catch (err) {
  serverLog('error', '<scope>', `<action> 失败: ${(err as Error).message}`, { ... });
  return reply.code(500).send({ error: 'failed', message: (err as Error).message });
}
```

范例：`projects.ts:54-80`。错误码用 snake_case；TaskName 校验复用 `TaskNameSchema`（`sessions.ts:41`）。

### 3.4 前端 mutation 写法

```ts
await logAction('<scope>', '<action>', () => api.xxx(args), { projectId, meta });
```

范例：`JobsView.tsx:87` / `UsageView.tsx:187`。

### 3.5 状态/样式字典模板（badge / chip / pill）

**没有 "IIFE 组件模板" 概念**。Status pill 范例：`packages/web/src/components/StatusBadge.tsx:4`——`STYLES: Record<SessionStatus, {dot, chip, label}>` 配色字典模式。新增 badge / chip 优先 follow 这个字典模式，不抽通用组件（参见 `vibespace-ui-decorator` 子代理）。

## 4. 关键文件索引

### 数据库
- `packages/server/src/db.ts`（schema / 迁移 / 类型 / CRUD 全在这）
- `packages/server/data/aimon.db`（运行时落盘）
- `packages/server/data/projects.json`（projects 真源）

### 路由聚合
- `packages/server/src/index.ts:146-167`（21 个 register*Routes 顺序调用）
- `packages/server/src/ws-hub.ts:46 registerWsHub`（单 /ws）
- `packages/server/src/routes/`（21 个路由文件，详见 §2.1）

### 操作日志
- `packages/server/src/log-bus.ts`（`serverLog` / `persistClientLog` / `appendJsonl` / `pruneOldLogs` / `broadcastAlert`）
- `packages/web/src/logs.ts`（`logAction` / `pushLog` / `testBackendLog`）
- `packages/server/src/error-pattern-monitor.ts`（错误循环检测，订阅 log-bus）
- `packages/server/src/types/log.ts`（`LogEntry / LogLevel / ClientLogPayload`）

### 核心服务
- `packages/server/src/docs-service.ts`（dev/active|archive 三段式 + tasks.json）
- `packages/server/src/memory-service.ts`（auto/manual/rejected.md，`formatLessonLine` 在 `memory-service.ts:132`）
- `packages/server/src/git-service.ts`（simple-git 包装）
- `packages/server/src/pty-manager.ts`（node-pty spawn/write/kill；EventEmitter output/exit）
- `packages/server/src/status.ts`（session 状态机 + Claude hook 派发）
- `packages/server/src/jobs-service.ts`（fire-and-forget 作业管理）
- `packages/server/src/review-runner.ts`（归档评审 codex/gemini 链）

### 配置 / 模板 / 安装
- `.claude/templates/settings.system.example.json` / `settings.project.example.json`
- `packages/server/src/cli-catalog.ts`（CLI agent 目录元数据）
- `packages/server/src/harness-template-service.ts` + `workflow-service.ts`（项目工作流装配）
- `packages/server/src/install-jobs.ts`（CLI 子进程安装 InstallJobManager）
- `packages/server/src/skills-service.ts`（.aimon/skills 解析）

### 前端布局 / view
- 布局：`packages/web/src/components/layout/{ActivityBar,PrimarySidebar,ProjectsColumn,Workbench}.tsx`
- 主面板：`components/editor/EditorArea.tsx`（统一 tab bar）+ `terminal/SessionView.tsx`（xterm）
- 侧栏 12 个 view：`components/sidebar/{ScmView,DocsView,PerfView,LogsView,InboxView,OutputView,MemoryView,FilesView,JobsView,UsageView,SkillsView,AppearanceView}.tsx`
- 抽屉/对话框：`PermissionsDrawer.tsx` / `dialog/DialogHost.tsx` / `CliInstallerDialog.tsx` / `NewProjectDialog.tsx` / `PromptLibraryDialog.tsx`
- 状态：`packages/web/src/store.ts`（zustand 全局）+ `theme/store.ts`（主题）

### 类型镜像（手抄，无 codegen 同步）
- `packages/server/src/types/log.ts` ↔ `packages/web/src/types.ts:192,208`（`LogEntry / ClientMsg / ServerMsg`）。改一边要手动改另一边。

### Subagent 调度（详见 CLAUDE.md "Team Agent 派工规则"）
- `vibespace-explorer`（read-only 摸代码）
- `vibespace-route-author`（新增后端路由 + zod + serverLog + 前端 api/types）
- `vibespace-db-scribe`（db.ts 三段 + 五处 SELECT 同步）
- `vibespace-ui-decorator`（badge / chip 字典扩展）
- `vibespace-smoke-author`（端到端 smoke 脚本）
- `vibespace-browser-tester`（浏览器 PASS/FAIL/SKIP）
- `vibespace-rules-auditor`（交付前规则审查）
