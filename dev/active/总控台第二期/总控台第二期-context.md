# 总控台第二期 · context

> 给 AI 自己看的执行边界与决策依据。大哥不审。

## 关键文件（本次改动边界）

### 新增（7 个文件）

| 文件 | 角色 |
|---|---|
| `packages/server/src/hub-workspace.ts` | hub 隔离工作目录 (`data/hub-workspace/`) 管理；首次创建+写 README+生成/重写 `.mcp.json`；导出 `getHubWorkspaceDir()` |
| `packages/server/src/hub-token.ts` | 进程级随机 token；导出 `getHubToken() / regenerateHubToken()`；server 重启自动换新 |
| `packages/server/src/hub-path-guard.ts` | 路径越界 + 大小 + 二进制三重防护 helper；给 MCP server 和 hub routes 复用 |
| `packages/server/src/hub-session-runtime.ts` | hub session 独立 runtime；内存 Map<hubId, info>；复用 ptyManager；listen exit 自动清理 |
| `packages/server/src/routes/hub-session.ts` | 3 端点：POST 启动 / DELETE 停止 / GET 列表 |
| `packages/server/src/mcp-hub/index.ts` | MCP server 单文件 bin entry；shebang + @modelcontextprotocol/sdk + 6 工具 |
| `packages/web/src/components/hub/HubTerminal.tsx` | 简化版 xterm 终端组件；只 WS + 键盘透传 + 顶栏，不含 task/worktree/permission |

### 修改（7 个文件）

| 文件 | 改动内容 |
|---|---|
| `packages/server/src/index.ts` | 注册 `registerHubSessionRoutes` + 给 fastify 加 `/api/hub/*` 鉴权 hook |
| `packages/server/src/routes/hub.ts` | 加 2 端点：`GET /api/hub/projects/:id/git-log?n=10`、`GET /api/hub/projects/:id/file?path=<relPath>`（给 MCP 工具用） |
| `packages/server/package.json` | 加 `"bin": {"aimon-mcp-hub": "dist/mcp-hub/index.js"}` + 加 `@modelcontextprotocol/sdk` 依赖 |
| `packages/web/src/api.ts` | 加 `startHubSession({agent}) / stopHubSession(hubId) / listHubSessions()` 客户端 |
| `packages/web/src/types.ts` | 加 `HubSessionInfo / StartHubSessionRequest / StartHubSessionResponse` |
| `packages/web/src/store.ts` | 加 `currentHubSession: HubSessionInfo \| null` + setter；sessionStorage 持久化（不到 localStorage——浏览器关掉就清，hub session 进程也死了，state 持久化无意义） |
| `packages/web/src/components/hub/HubView.tsx` | 右半改造：未启动显示"启动 hub session"占位；已启动渲染 `<HubTerminal hubId={...} />` + 停止按钮 |

### 只读参考

- `packages/server/src/mcp-bridge.ts`（既有 browser-use MCP 注入参考——hub MCP **不**复用，但模式参考）
- `packages/server/src/pty-manager.ts`（`spawn / write / has / kill / listAlive`；本次 hub session 复用，sessionId 用 `hub:<hubId>` 形式）
- `packages/server/src/ws-hub.ts`（`subscribe sessionIds: string[]` 透明支持任意 sessionId 字符串，本次直接用）
- `packages/server/src/git-service.ts`（`listCommits` 给 git-log MCP 工具用；`getChanges` 第 1 期已用）
- `packages/server/src/cli-catalog.ts`（claude/codex agent entry 配置——本次 hub session 启动需要这个判定 agent 合法性）
- `packages/server/src/log-bus.ts`（`serverLog` 签名）
- `packages/server/src/routes/hub.ts`（第 1 期已落，本次仅追加 2 端点）
- `packages/web/src/components/terminal/SessionView.tsx`（**只读参考** xterm 接入 + WS 订阅 + 键盘透传 + 焦点管理模式，HubTerminal 简化版从这里抄关键骨架，但**不**复用本身）
- `packages/web/src/ws.ts`（`aimonWS.subscribe / sendInput`；hub:<id> 是合法 sessionId 字符串）
- `dev/ARCHITECTURE.md` §2.1 路由模板 / §2.2 WS 协议 / §3.1 操作日志 / §4 关键文件索引

### 白名单（tasks.json `write_files`，严格 14 个 = 7 新 + 7 改）

```
packages/server/src/hub-workspace.ts           ← 新
packages/server/src/hub-token.ts               ← 新
packages/server/src/hub-path-guard.ts          ← 新
packages/server/src/hub-session-runtime.ts    ← 新
packages/server/src/routes/hub-session.ts     ← 新
packages/server/src/mcp-hub/index.ts          ← 新
packages/web/src/components/hub/HubTerminal.tsx  ← 新
packages/server/src/index.ts
packages/server/src/routes/hub.ts
packages/server/package.json
packages/web/src/api.ts
packages/web/src/types.ts
packages/web/src/store.ts
packages/web/src/components/hub/HubView.tsx
```

每步 verify 后 `git diff --name-only HEAD` + `git ls-files --others --exclude-standard` 与白名单比对；越界回滚/停手。

## 决策记录（吸收 Codex 11 条评审 + plan 已写但 context 复述以便执行查阅）

### D1：MCP server = 单文件 bin（Codex 第 1-3 + 29-30）

**采纳**：`packages/server/src/mcp-hub/index.ts` shebang + 单独 bin entry（package.json `"bin"` 字段），跟 server 共用 tsc 编译到 `dist/mcp-hub/index.js`。
- **拒绝**新 pnpm 子包：维护 package.json/tsconfig/build 多一套，无独立发布/测试矩阵需求时不必要。
- 升级时机：MCP server 需独立发布 / 独立测试矩阵 / 依赖跟 server 冲突时再拆 `packages/mcp-hub-server/`。

### D2：MCP 配置只在 hub workspace（Codex 第 4-5）

**采纳**：`data/hub-workspace/.mcp.json` 唯一配置源；hub session cwd 也是这里——claude 自动从 cwd 向上找 .mcp.json，codex 用 `--mcp-config` 命令行显式传同一文件。
- **拒绝**写到任何真实项目根的 .mcp.json：会污染既有 browser-use 配置 + 让 hub 工具泄漏到普通 session。

### D3：用官方 SDK（Codex 第 6-7）

**采纳**：`npm install @modelcontextprotocol/sdk`（依赖 server 包），handshake / tools/list / tools/call 走 SDK 高层 API。
- **拒绝**手写 JSON-RPC over stdio：MCP 协议细节 + 错误处理会反复踩坑，SDK 是官方认可路径。

### D4：鉴权 = loopback + 一次性 token（Codex 第 8-10）

**采纳**：Fastify `onRequest` hook 仅对 `/api/hub/*` 校验：
- header `X-Hub-Token` 匹配当前 `getHubToken()` → 放行
- 没带 token 但 `req.ip` 是 `127.0.0.1` / `::1` → 放行（浏览器 UI 走这条）
- 其它 → 401 `{error: 'unauthorized'}`，warn 日志含 IP

**拒绝**完整登录鉴权：本地单用户场景；token 目的是防多 VibeSpace 实例同机时 MCP 误连错实例。

### D5：MCP 工具严格校验（Codex 第 11-13）

每个工具：
- 参数 zod schema（projectId / agent / n / relPath / text 等）
- 失败返回**结构化错误** `{code: snake_case, message: string, retryable: boolean, details?: object}`，让 hub claude 能判断是否重试
- read_file：`resolve(project.path, relPath)` 必须以 project.path 开头 + 拒绝绝对路径 + 拒绝 `..` 残留（再次 resolve 后比较前缀）+ size ≤ 1MB + 前 8KB 不含 `\0`（二进制判定）
- dispatch_to_project：agent 白名单 `['claude','codex']`、text 长度 ≤ 20_000

### D6：hub session 不进 sessions 表，独立 runtime（Codex 第 14-16，本期最重要的架构决策）

**采纳**：`hub-session-runtime.ts` 内存 `Map<hubId, {agent, pid, workspaceDir, startedAt}>` + 复用 `ptyManager.spawn({sessionId: 'hub:<hubId>', agent, cwd: hub-workspace})`。
- ptyManager 已经按字符串 sessionId 工作，`hub:<hubId>` 是合法 id（前缀分桶用于前端识别）
- ws-hub `subscribe sessionIds: string[]` 透明支持，**不需要**改 ws-hub
- listen ptyManager exit 事件清理 Map 条目

**拒绝**改 DB schema 让 projectId 可选 / 真插 `__hub__` 项目——会拖下 21 个按 projectId 工作的路由 + 破坏第 1 期 D1。

### D7：HubTerminal 自写不复用 SessionView（Codex 第 19-20）

**采纳**：~400-500 行新组件，只 xterm + WS + 顶栏简化 status + 停止按钮。
- 复用代码骨架（不是组件）：从 SessionView 抄 xterm 初始化 + WebGL fallback + 键盘透传 + IME 守卫的**模式**，但**不** import SessionView 本身、**不** fake 个 Session 对象进 store。
- **明确不做**：task binding / worktree / permission drawer / 评论锚点 / activeSessionIdByProject / pendingInputBySession / 通知系统 / 自定义按钮 / promptLib。

### D8：MCP 工具调用日志（Codex 第 26）

- 高频读类（`list_projects / get_project_sessions / hub_status`）→ **不**配对日志（只在失败时记 error）
- 派工/读文件类（`dispatch_to_project / read_file / read_git_log`）→ 起止配对，scope='hub'，action=`mcp-tool:<name>`
- meta 含工具名、参数预览（read_file 的 relPath / dispatch 的 textPreview ≤80 字符）、来源 hubId
- **绝不**把 HUB_TOKEN env 记进 meta

### D9：第 2 期不开破坏性工具（Codex 第 21-22）

白名单 6 个工具全部只读 + 派工：
- list_projects / get_project_sessions / read_git_log / read_file / hub_status：读
- dispatch_to_project：写（但只是创建 session，不删除/不改文件）

**禁用**：stop_session / delete_session / write_file / git_commit / kill_pty 等破坏性。

后续期想加，单独走 plan + Codex 评审。

### D10：MCP server 生命周期 = CLI 拉起（Codex 第 17-18）

**采纳**：stdio 模式，CLI（claude/codex）按 .mcp.json 的 spawn 命令拉起 MCP server 子进程；CLI 退出 → 子进程自然退出。
- **拒绝** server 启动时常驻 MCP：引入端口/状态/重启管理复杂度，stdio 模式天然就是被客户端拉起。

### D11：HubTerminal 状态持久化 = sessionStorage（小决策）

- `currentHubSession` 在 store 里用 sessionStorage 持久化（不到 localStorage）
- 浏览器关掉就清；hub PTY 进程也没法跨浏览器会话存活；语义对齐
- 多 tab 共享 sessionStorage 是 false（sessionStorage 天然按 tab 隔离），所以多 tab 各自独立 hub 视图，跟 plan 边界一致

### D12：hub session UI 数量限制（小决策）

- 第 2 期前端只渲染 1 个 hub session（最近启动的）
- 后端 `hub-session-runtime` 不限制数量（Map 可以装多个，给 API 留扩展空间）
- 多 hub session UI 留待后续期

## 依赖与约束

- **后端路由模板**：严格按 `ARCHITECTURE.md` §3.3—— zod safeParse + serverLog 起止 + try/catch + snake_case 错误码。
- **MCP SDK**：`@modelcontextprotocol/sdk`，预计版本 ^1.x（执行步骤 3 时锁定版本）。运行时大小估算 < 500KB，作为 server 子进程加载，**不**影响前端 bundle。
- **hub-workspace 文件结构**：
  ```
  packages/server/data/hub-workspace/
    .mcp.json           ← 由 hub-workspace.ts 写
    README.md           ← 首次启动写说明
    (hub claude/codex 运行时产物自由发挥)
  ```
- **bin entry shebang**：`#!/usr/bin/env node` ——Windows 下 node 启动 .js 不依赖 shebang，但加上保留跨平台。
- **MCP server 启动命令**（写入 .mcp.json `command/args`）：`node` + `<repoRoot>/packages/server/dist/mcp-hub/index.js`，env 含 `HUB_TOKEN` 和 `AIMON_BACKEND_PORT`。
- **未提交别任务草稿**：当前 git status 有 `packages/web/src/main.tsx` 等 modified 文件，本任务**只**改白名单 14 个文件，其它一概不动。

## "过度设计自检"清单

- [x] 不做用户没要的功能：没有"hub session 历史"、"MCP 工具调用录像回放"、"hub session 跨实例同步"等。
- [x] 不做只用一次的抽象：path-guard helper 是因为 MCP server + routes/hub.ts 两处用，hub-token / hub-workspace 都是单 module 多调用点，**不**抽 `useHubState` hook 之类。
- [x] 不做没要求的灵活性：MCP 工具签名直接 hardcode 6 个，不做插件机制；hub session 不做 worktree 隔离选项；token 不做 TTL 轮转（server 重启即换够用）。
- [x] 不写不可能场景的错误处理：MCP server 不防 SDK 自己抛 OOM、不防 fastify 端口被抢占（启动时已有处理）、不防 `process.kill` 被拦截。
- [x] 行数估算：hub-workspace.ts ~80 / hub-token.ts ~30 / hub-path-guard.ts ~120 / hub-session-runtime.ts ~180 / routes/hub-session.ts ~150 / mcp-hub/index.ts ~400 / HubTerminal.tsx ~450 + 7 个改动文件平均 ~30 行 = 总计 ~1620 行新增。plan 估 1100-1200 行偏低；实际跑下来 1400-1700 行更现实，**仍属可控的"中等工程量"**。如果中途某个模块涨到 plan 2 倍以上停手回顾过度设计。
- [x] 项目级 MCP 配置不动：本期不动 .mcp.json 项目根任何文件、不动 mcp-bridge.ts。
- [x] 没有破坏性变更：新增模块、不修改既有导出符号、不动 DB schema、不动 21 现有路由。
