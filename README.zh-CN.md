# VibeSpace

[English](./README.md) · **简体中文**

一个本地浏览器端的 **并行 AI 编码代理控制台**。同时跑多个 `claude` /
`codex` / `gemini` / `opencode` / `qoder` / `kilo` session（也能跑纯
`pwsh` / `cmd` / shell），每个 session 是服务端托管的一个 PTY 子进程，通过
WebSocket 流式推送到浏览器。面板一眼就能看出——跨所有项目——哪个代理在工
作、哪个在发呆、哪个卡在等你确认；任何一个需要介入时立刻弹浏览器通知。

## 它跟其它"AI 编码工具"到底不同在哪

市面上大多数 AI 编码界面（VS Code 扩展、Cursor、Windsurf、Claude Code 自
带终端 UI）都是把代理 **绑死在一个编辑器窗口里**。VibeSpace 的路线正相反：

|  | 编辑器内置代理 | VibeSpace |
|---|---|---|
| **并发** | 一窗口一代理，没有跨窗口视图 | 一个浏览器面板里 N 个 session，可以任意组合 |
| **生命周期感知** | "某处有个终端开着" | 每个 session 独立状态：`starting / running / working / waiting_input / idle / stopped / crashed` |
| **注意力调度** | 你自己去看 | 浏览器通知 + 任务栏角标 + 标题闪烁，**只在**页面失焦 + `waiting_input` 时才响 |
| **关闭编辑器后** | 代理也跟着死 | PTY 池留在服务端，关浏览器再开照样接上 |
| **Git 视图** | 依赖编辑器内置 | 自带 SCM 面板：stage/unstage/discard/commit + diff + commit graph，按项目独立 |
| **数据流向** | 视具体产品 | 全程 127.0.0.1，SQLite 文件库；提示词与输出不离开本机 |
| **工作流态度** | 没有 | 可选 **Dev Docs 三段式工作流**（plan → context → tasks），侧栏可查 |

一句话：它不是编辑器，更像 **控制塔**——你在这儿孵化代理、盯它们的生命
体征、在被呼叫时介入、浏览它们的规划文档。

## 亮点

- **统一工作区页签**：右侧区域把文件预览和 AI 终端 session 都渲染成
  VS Code 风格的同一条 tab 栏。从 SCM 视图点一个变更文件 → 打开文件
  tab；点 `+ 启动 AI / 终端` → 打开 session tab。
- **多代理启动器**：一个下拉列出所有已安装的 AI CLI + shell，旁边 📦
  图标打开 CLI 安装器，缺的 CLI 不用离开面板就能装。
- **实时状态徽章**：Claude 依赖服务端往 `~/.claude/settings.json` 注入的
  官方 Claude Code hooks；Codex 没 hook，用 stdout 模式启发式推断。
- **按项目的 Git SCM 面板**：staged/unstaged/untracked 列表 + stage /
  unstage / discard / commit，配 diff 预览和 commit graph。底层 `simple-git`，
  除了系统 `git` 二进制无额外依赖。
- **Dev Docs 工作流（可选启用）**：项目下 `dev/active/<任务名>/` 放三份
  markdown（`plan.md` / `context.md` / `tasks.md`）。侧栏 📘 列出进行中的
  任务，从 `tasks.md` 的 checkbox 解析 `N/M` 进度。⚙ 按钮一键把工作流
  守则写入该项目 `CLAUDE.md`，下一个 Claude session 就会按
  **plan → 确认 → context → 确认 → tasks → 执行** 的节奏推进，而不是直接
  上手改代码。
- **Karpathy 准则安装器**：同一机制，不同内容。新建项目对话框可以选
  "追加 Karpathy 通用编码准则" 到 `CLAUDE.md`。
- **按项目的性能面板**：📊 侧栏显示每个活跃 session 的 CPU 和 RSS，前端
  2 秒轮询、服务端 1 秒缓存。内存吃紧前能看出哪个代理在占。
- **权限与自定义按钮抽屉**：按项目的 Claude 权限三态矩阵 + Codex 配置，
  以及用户自定义 xterm 侧边按钮（一键粘贴预设命令到终端）。
- **内部弹窗统一**：不用原生 `alert` / `confirm`，全是页面内 modal，
  ESC / Enter / 点遮罩都行为一致。

## 架构

```
   浏览器 (Vite + React + zustand + xterm.js)
   ├── ActivityBar  (📂 SCM · 📘 Docs · 📊 性能 · 📋 日志 · 🔔 通知)
   ├── 工作区页签    (文件预览 + 活跃 AI / shell session)
   └── DialogHost   (confirm / alert / prompt，统一内部弹窗)
        |   ^
   HTTP |   | WebSocket  (output | status | exit | replay)
        v   |
   Fastify 服务端 (Node 22)
   ├── HTTP 路由
   │   ├── projects           — 可追加 Karpathy / Dev Docs 守则
   │   ├── sessions           — 启动 / 重启 / 关闭 / hooks 收件
   │   ├── git                — changes / diff / graph / commit
   │   ├── docs               — 列出 / 读取 / 创建 / 归档任务
   │   ├── perf               — 按项目聚合的 CPU / RSS 快照
   │   ├── cli-configs        — 按项目的 Claude / Codex 配置
   │   ├── cli-installer      — 发现并安装缺失的 AI CLI
   │   ├── hooks              — aimon-hook.mjs 的接收端
   │   └── health
   ├── WS 中枢                — subscribe / input / resize / replay
   ├── PtyManager             — node-pty-prebuilt-multiarch
   ├── StatusManager          — 生命周期 + Claude hooks
   ├── CodexStatusDetector    — 基于 stdout 的启发式判定
   ├── DocsService            — dev/active 树 + tasks.md checkbox 统计
   ├── PerfService            — pidusage，懒采样 + 缓存
   └── SQLite                 — better-sqlite3，projects/sessions/events
        |
        | spawn / stdin / stdout
        v
   claude.exe  |  codex.exe  |  gemini  |  opencode  |  pwsh  |  …
```

## 环境要求

- Node.js >= 22
- pnpm >= 10.20
- Windows 10+（主要目标平台）。macOS / Linux 为 *实验性支持*——PTY 层
  应当能工作，但与 Windows 相关的退出码映射和 AttachConsole 噪声不具备
  可移植性。

你自己准备的外部 CLI，`PATH` 上有哪一个就启用哪一个：

- `claude`（Claude Code CLI）——一等公民，通过官方 hook 驱动状态
- `codex`——一等公民（基于 stdout 启发式判定）
- `gemini`、`opencode`、`qoder`、`kilo`——作为普通 PTY 启动，状态退化为通
  用 running / idle

📦 CLI 安装器能按平台执行对应安装命令，还没装的可以现装。

## 快速开始

```sh
pnpm install
# pnpm 10 默认禁用 install 脚本；预编译二进制需手动一次 rebuild：
pnpm --filter @aimon/server rebuild @homebridge/node-pty-prebuilt-multiarch better-sqlite3
pnpm dev:all
# 打开 http://127.0.0.1:8788
```

`pnpm dev:all` 并发跑前后端。只跑一边：

```sh
pnpm dev:server   # Fastify on 127.0.0.1:8787
pnpm dev:web      # Vite on 127.0.0.1:8788
```

## 第一次使用

1. **启动后端**。启动时自动往 `~/.claude/settings.json` 写入 hooks（首次
   启动会把原文件另存成 `settings.json.aimon-backup`；后续启动是幂等的）。
2. **添加项目**。点 `+ 新建项目`。路径必须是已存在的绝对路径。对话框里
   有两个可选勾选：
   - *追加 Karpathy 通用编码准则*——把通用的 LLM 行为准则塞进
     `CLAUDE.md`。
   - *启用 Dev Docs 三段式工作流*——把 plan→context→tasks 的守则
     追加进去，新的 AI session 会按该流程做事，任务在 📘 侧栏可见。
     后续也可以用 📘 侧栏的 ⚙ 按钮手动应用。
3. **启动 session**。右上 `+ 启动 AI / 终端`，从下拉里选一个已安装 CLI 或
   shell。新的 tab 就会带一个活的 xterm。
4. **开启通知**。点底部 🔔 一次，授权浏览器通知。`waiting_input` 只在
   标签页失焦时响。

## 核心概念

- **项目（Project）**：目录 + 别名，存在 SQLite。所有后续东西（session、
  docs 任务、perf 采样、git 变更、CLI 配置）都按项目归属。
- **会话（Session）**：一个 PTY 子进程跑一个代理或 shell，cwd 落在项目目
  录。session 有稳定 id 和状态机。
- **工作区页签**：右侧面板。文件 tab（Markdown 预览 / 源码 / 统一 diff）
  和 session tab（xterm + 状态徽章）在同一条 tab 栏。
- **Dev Docs 任务**：`<项目>/dev/active/<任务名>/` 目录下三份 md。**AI
  创建**，不是用户手动建；用户只做审阅和归档。
- **Perf 采样**：每个活着的 session pid 对应 `{ cpu, memRss }`，`pidusage`
  批量采样 + 1 秒缓存。仅 PTY 直接子进程；AI 自己派生的孙进程暂不计。

## HTTP API

| 方法 | 路径 | 说明 |
| --: | --- | --- |
| GET  | `/api/health` | `{ ok, version, uptime }` |
| GET  | `/api/projects` | 列出 |
| POST | `/api/projects` | `{ name, path, applyKarpathyGuidelines?, applyDevDocsGuidelines? }` |
| DELETE | `/api/projects/:id` | 同时关掉该项目下所有活 session |
| POST | `/api/projects/:id/apply-dev-docs` | 把 Dev Docs 守则追加到 `CLAUDE.md` |
| GET  | `/api/projects/:id/layout` | 布局（遗留） |
| PUT  | `/api/projects/:id/layout` | 保存布局 |
| GET  | `/api/sessions[?projectId=…]` | 带实时状态 |
| POST | `/api/sessions` | `{ projectId, agent }` |
| DELETE | `/api/sessions/:id` | **请求不能带 body 和 content-type**（Fastify 会 400）。成功 204 |
| POST | `/api/sessions/:id/restart` | 杀掉再启，返回新 id |
| POST | `/api/hooks/claude` | `aimon-hook.mjs` 的接收端，总是 `{ ok: true }` |
| GET  | `/api/projects/:id/changes` | git 状态快照 |
| GET  | `/api/projects/:id/commits[?limit&branch]` | 最近 commit |
| GET  | `/api/projects/:id/commits/:sha` | commit + 变更文件 |
| GET  | `/api/projects/:id/file?path=&ref=` | 在 HEAD / WORKTREE / INDEX / sha 下的文件 |
| GET  | `/api/projects/:id/diff?path=&from=&to=` | 统一 diff |
| GET  | `/api/projects/:id/branches` | 本地 + 远端 + tag |
| GET  | `/api/projects/:id/graph[?limit&all]` | 带父子边的 commit 图 |
| POST | `/api/projects/:id/stage` | `{ paths: string[] }` |
| POST | `/api/projects/:id/unstage` | `{ paths: string[] }` |
| POST | `/api/projects/:id/discard` | `{ tracked?, untracked? }` |
| POST | `/api/projects/:id/commit` | `{ message, amend?, allowEmpty? }` |
| GET  | `/api/projects/:id/docs` | `dev/active/` 下所有任务 + checkbox 进度 |
| GET  | `/api/projects/:id/docs/:task/file?kind=plan\|context\|tasks` | 一份 md |
| POST | `/api/projects/:id/docs` | `{ name }`，创建三份模板 |
| POST | `/api/projects/:id/docs/:task/archive` | 移到 `dev/archive/` |
| GET  | `/api/projects/:id/metrics` | `{ sessions: [{cpu, memRss}], totalCpu, totalRssBytes }` |
| GET  | `/api/projects/:id/cli-configs` | 该项目的 Claude / Codex 配置 |
| PUT  | `/api/projects/:id/cli-configs` | 保存 Claude 选择 + Codex 值 |
| POST | `/api/projects/:id/cli-configs/init` | 缺 `.claude/` / Codex 目录时脚手架 |
| GET  | `/api/cli-configs/catalog` | 权限目录与预设 |
| GET  | `/api/cli-installer/catalog` | 已知 AI CLI 与安装命令 |
| GET  | `/api/cli-installer/status` | 当前 `PATH` 上实际有哪些 |
| POST | `/api/cli-installer/install` | `{ cliId }`，返回流式 job id |
| GET  | `/api/cli-installer/jobs/:jobId` | 任务状态 + 日志 |
| GET  | `/api/cli-installer/jobs/:jobId/stream` | SSE 流式日志 |

## WebSocket 协议

`ws://127.0.0.1:8787/ws`，JSON 每帧一条。

客户端 → 服务端：

```ts
{ type: 'subscribe',   sessionIds: string[] }
{ type: 'unsubscribe', sessionIds: string[] }
{ type: 'input',       sessionId: string, data: string }
{ type: 'resize',      sessionId: string, cols: number, rows: number }
{ type: 'replay',      sessionId: string }
```

服务端 → 客户端：

```ts
{ type: 'hello',  serverVersion: string }
{ type: 'output', sessionId: string, data: string }
{ type: 'status', sessionId: string, status: SessionStatus, detail?: string }
{ type: 'exit',   sessionId: string, code: number, signal: number | null }
{ type: 'replay', sessionId: string, data: string }
{ type: 'error',  message: string }
```

`SessionStatus ∈ { starting, running, working, waiting_input, idle, stopped, crashed }`。

## Windows 已知问题

- 用 `taskkill /F` 杀服务端会触发 node-pty 辅助进程输出
  `AttachConsole failed`。无影响——`Ctrl+C` / SIGINT 是推荐的关闭路径，
  正常退出。
- 用户主动停止会导致 Windows 退出码 `-1073741510`（`STATUS_CONTROL_C_EXIT`）。
  服务端会把"用户发起的 kill"统一映射为 `stopped`，徽章显示 *stopped*
  而不是 *crashed*。
- 第一次调用 `codex` 可能弹出升级选择（`1/2/3`）。手动答一次，之后就干净
  启动。
- pnpm 10 开启了 `onlyBuiltDependencies`；`pnpm install` 之后必须跑上面
  那行 `pnpm rebuild` 才能真正编译出原生模块。
- `pidusage` 在较旧 Windows 走 `wmic`；Win11 24H2 可能已删 wmic，此时
  `pidusage v3+` 会回退到 PowerShell。若 perf 行出现 `—`，检查这两者至
  少有一个可用。

## 仓库结构

```
VibeSpace/
├── package.json                    workspaces, dev:all, smoke:* scripts
├── pnpm-workspace.yaml
├── CLAUDE.md                       给 AI session 看的 Dev Docs 工作流守则
├── README.md / README.zh-CN.md
├── LICENSE
├── dev/active/<task>/              Dev Docs 产物（AI 维护）
├── packages
│   ├── server                      Fastify + node-pty + SQLite + WS
│   │   └── src
│   │       ├── index.ts            启动 + 路由注册
│   │       ├── db.ts               SQLite schema + CRUD
│   │       ├── pty-manager.ts      spawn / write / resize / kill / 环形缓冲
│   │       ├── status.ts           session 生命周期状态机
│   │       ├── codex-status.ts     codex stdout 启发式判定
│   │       ├── ws-hub.ts           WS 协议处理
│   │       ├── git-service.ts      changes / diff / commit / graph
│   │       ├── docs-service.ts     dev/active 目录扫描 + checkbox 统计
│   │       ├── perf-service.ts     pidusage，懒采样 + 缓存
│   │       ├── hook-installer.ts   往 ~/.claude/settings.json 写 hooks
│   │       ├── karpathy-guidelines.ts   来自 andrej-karpathy-skills 的文本
│   │       ├── dev-docs-guidelines.ts   Dev Docs 工作流守则
│   │       ├── cli-catalog.ts      AI CLI 描述 + 探测
│   │       └── routes/
│   │           health · projects · sessions · hooks · git · docs
│   │           · perf · cli-configs · cli-installer
│   ├── web                         Vite + React + zustand + xterm.js
│   │   └── src
│   │       ├── App.tsx, main.tsx, store.ts, ws.ts, api.ts, types.ts
│   │       └── components/
│   │           ├── layout/         Workbench · ActivityBar · PrimarySidebar · ProjectsColumn
│   │           ├── sidebar/        ScmView · DocsView · PerfView · LogsView · InboxView
│   │           ├── editor/         EditorArea（统一 tab 栏）
│   │           ├── terminal/       SessionView (xterm)
│   │           ├── dialog/         DialogHost（内部 modal 队列）
│   │           ├── FilePreview · CodeView · DiffView · MarkdownView · GitGraph · ChangesList
│   │           └── StartSessionMenu · CliInstallerDialog · PermissionsDrawer · NewProjectDialog
│   └── hook-script
│       └── aimon-hook.mjs          装到 Claude 设置里，回调 /api/hooks/claude
└── scripts                         smoke 测试
    ├── server-smoke.mjs
    ├── refresh-smoke.mjs
    ├── persistence-check.mjs
    ├── hooks-smoke.mjs
    ├── codex-smoke.mjs
    ├── web-smoke.mjs
    └── git-smoke.mjs
```

## Smoke 测试

服务端已跑在 `127.0.0.1:8787` 时：

```sh
pnpm smoke:server        # 完整的 HTTP+WS 创建/输出/删除闭环
pnpm smoke:refresh       # 模拟浏览器刷新后重连活 session
pnpm smoke:hooks         # POST /api/hooks/claude 状态迁移
pnpm smoke:codex         # codex 启发式判定器
pnpm smoke:persistence   # DB 行跨重启存活，重启后被收编成 stopped
pnpm smoke:web           # 静态资源 serve + 验证
pnpm smoke:git           # changes / diff / stage / unstage / commit
```

## 路线图

- 给面板加 token 认证，支持局域网共享（当前只绑 127.0.0.1）。
- 📘 侧栏里可直接勾选 `tasks.md` 的 checkbox（v1 只读）。
- `dev/active/` 文件系统 watcher，不用手动点 ⟳ 也能实时刷新。
- Session 历史查看器，基于 SQLite 的 `session_events`。
- Perf 面板递归计算进程树（当前只测 PTY 直接子进程）。
- Claude session 重启时用 `claude --resume <id>` 接上历史。
- Perf 面板加 sparkline / 历史曲线。
- 移动端响应式布局。

## 许可

MIT — 见 [LICENSE](./LICENSE)。
