# aimon

[English](./README.md) · **简体中文**

面向 AI CLI 代理（Claude Code、Codex）的浏览器端监控面板。每个项目对应
一个目录；每个 session 是一个 `claude` 或 `codex` CLI 实例，跑在服务端托
管的 PTY 中，通过 WebSocket 流式推送到浏览器。面板展示实时终端输出、
实时状态徽章，并在代理等待用户输入时弹出浏览器通知。

## 为什么需要它

编辑器内置的终端（VS Code、Cursor 等）会把 PTY 隐藏在进程内部，外部的
监控程序无从读取代理此刻在做什么——是正在工作、空闲、还是被一个确认框
卡住了。想在一个编辑器窗口里并行盯多个代理，根本不现实。

aimon 用自己的 PTY 池把代理包起来，让真正的交互与任何具体编辑器解耦：
打开面板就能看到所有项目下所有代理的状态，有任何一个需要介入时第一时
间得到通知。

## 架构

```
   浏览器 (Vite + React + xterm.js)
        |   ^
   HTTP |   | WebSocket  (output | status | exit | replay)
        v   |
   Fastify 服务端 (Node 22)
   ├── HTTP 路由    (projects / sessions / hooks / health)
   ├── WS 中枢      (subscribe / input / resize / replay)
   ├── PTY 管理器   (node-pty-prebuilt-multiarch)
   ├── StatusManager (生命周期 + Claude hooks)
   ├── CodexStatusDetector (基于 stdout 的启发式判定)
   └── SQLite       (better-sqlite3, projects/sessions/events)
        |
        | spawn / stdin / stdout
        v
   claude.exe   |   codex.exe   (每个 session 一个 PTY)
```

Claude 的状态迁移由服务端向 `~/.claude/settings.json` 注入的官方 Claude
Code hooks 驱动。Codex 没有 hook 接口，因此它的状态是根据 stdout 模式
（提示符字符、光标控制序列、持续静默）推断出来的。

## 环境要求

- Node.js >= 22
- pnpm >= 10.20
- Windows 10+（主要目标平台）。macOS / Linux 为 *实验性支持* —— PTY 层
  应当能工作，但与 Windows 相关的退出码映射和 AttachConsole 噪声不具备可
  移植性。

需要自备的外部 CLI：

- `claude`（Claude Code CLI）在 PATH 上
- `codex`（Codex CLI）在 PATH 上 —— 可选，仅当你要跑 codex session 时才需要

## 快速开始

```sh
pnpm install
# pnpm 10 默认禁用安装脚本；需要手动触发一次原生模块的预编译二进制解压:
pnpm --filter @aimon/server rebuild @homebridge/node-pty-prebuilt-multiarch better-sqlite3
pnpm dev:all
# 然后在浏览器打开 http://127.0.0.1:8788
```

`pnpm dev:all` 通过 `pnpm -r --parallel run dev` 并行启动前后端（没有额
外的进程协调器，也不需要你盯任何子进程）。如果只想跑一端：

```sh
pnpm dev:server   # Fastify 监听 127.0.0.1:8787
pnpm dev:web      # Vite 监听 127.0.0.1:8788
```

## 首次使用

1. 启动后端。第一次启动时会把 Claude hooks 写入
   `~/.claude/settings.json`（原始文件会被备份为同目录下的
   `settings.json.aimon-backup`；之后每次启动都是幂等的）。
2. 打开面板，点击 **+ 项目** 加入一个要监控的目录。路径必须是一个已存在
   的绝对目录。
3. 在侧边栏选中项目，点 **▶ 启动**，挑 **Claude** 或 **Codex**。一个新的
   tile 会出现，自带 xterm 实时视图。
4. 头部的 **🔔** 按钮点一次，授权浏览器弹通知。仅当当前标签页失去焦点时
   才会弹 waiting_input 提醒。

## Windows 已知问题

- 用 `taskkill /F` 杀掉服务端时，node-pty 的辅助进程会在 stderr 打印
  `AttachConsole failed`。无害 —— 推荐用 Ctrl+C / SIGINT 关停，这条路径
  会干净退出。
- 用户主动停止一个 session 时，Windows 上 PTY 的退出码是 `-1073741510`
  （`STATUS_CONTROL_C_EXIT`）。服务端会把用户主动 kill 一律映射为
  `stopped`，与原始退出码无关，所以徽章显示的是 *stopped* 而不是 *crashed*。
- 第一次调用 `codex` 可能会弹出一个版本升级确认（`1/2/3`）。随便在一个
  终端里交互式回答一次之后，后续的 session 就不会再被这个提示挡住。
- pnpm 10 对我们用到的少数原生模块设置了 `onlyBuiltDependencies`；每次
  干净 `pnpm install` 之后必须跑上面那条 `pnpm rebuild` 命令，才能真正
  完成编译 / 解压。

## HTTP API


|   方法 | 路径                           | 说明                                                                                |
| -----: | ------------------------------ | ----------------------------------------------------------------------------------- |
|    GET | `/api/health`                  | `{ ok, version, uptime }`                                                           |
|    GET | `/api/projects`                | 列表                                                                                |
|   POST | `/api/projects`                | `{ name, path }` —— `path` 必须存在且为目录                                       |
| DELETE | `/api/projects/:id`            | 同时会 kill 所有存活 session 并级联删除数据库行                                     |
|    GET | `/api/sessions[?projectId=…]` | 列表，附带实时状态                                                                  |
|   POST | `/api/sessions`                | `{ projectId, agent: 'claude'                                                       |
| DELETE | `/api/sessions/:id`            | **请求里不能带 body 或 `content-type` 头**（否则 Fastify 会 400）。成功时返回 204。 |
|   POST | `/api/sessions/:id/restart`    | 并不是在同一个 id 上 kill+respawn —— 返回一个新的 session id                      |
|   POST | `/api/hooks/claude`            | 由`aimon-hook.mjs` 调用；恒定返回 `{ ok: true }`                                    |

## WebSocket 协议

`ws://127.0.0.1:8787/ws`，每条消息一个 JSON。

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

`SessionStatus` 取值：`starting | running | working | waiting_input | idle | stopped | crashed`。

## 仓库结构

```
F:/kanban
├── package.json                  workspaces、dev:all、smoke:* 脚本
├── pnpm-workspace.yaml
├── README.md
├── LICENSE
├── packages
│   ├── server                    Fastify + node-pty + SQLite + WS
│   │   ├── src
│   │   │   ├── index.ts          启动、hook 安装、生命周期绑定
│   │   │   ├── db.ts             SQLite 模型 + CRUD
│   │   │   ├── pty-manager.ts    spawn/write/resize/kill + 环形缓冲
│   │   │   ├── status.ts         推导 session 状态
│   │   │   ├── codex-status.ts   codex stdout 的启发式探测器
│   │   │   ├── ws-hub.ts         WS 协议处理器
│   │   │   ├── hook-installer.ts 写入 ~/.claude/settings.json
│   │   │   └── routes/           health、projects、sessions、hooks
│   │   └── data/aimon.db         首次启动时创建
│   ├── web                       Vite + React + xterm.js + zustand
│   │   └── src
│   │       ├── App.tsx、main.tsx、store.ts、ws.ts、api.ts、notify.ts
│   │       └── components/       SessionTile、SessionGrid、…
│   └── hook-script
│       └── aimon-hook.mjs        被装入 Claude settings，POST /api/hooks/claude
└── scripts                       smoke 验证脚本
    ├── server-smoke.mjs
    ├── refresh-smoke.mjs
    ├── persistence-check.mjs
    ├── hooks-smoke.mjs
    ├── codex-smoke.mjs
    ├── web-smoke.mjs
    └── pty-smoke-test.mjs
```

## Smoke 验证

在服务端已经跑在 `127.0.0.1:8787` 的前提下：

```sh
pnpm smoke:server        # 完整的 HTTP+WS 创建/输出/删除循环
pnpm smoke:refresh       # 模拟浏览器刷新后重新挂回一个活 session
pnpm smoke:hooks         # POST /api/hooks/claude 的状态迁移
pnpm smoke:codex         # codex 启发式探测器
pnpm smoke:persistence   # DB 行在服务端重启后仍在，会被 reap 成 stopped
pnpm smoke:web           # 提供 dist + 校验静态资源
```

## 路线图

- 给面板加上基于 token 的 auth header，实现局域网共享（当前没有鉴权，
  绑定在 127.0.0.1）。
- 基于 SQLite `session_events` 行的单 session 历史查看器。
- 重启 session 时走 Claude 的 `claude --resume <id>`。
- 多用户账号体系 + 基于账号的项目可见性。
- 响应式布局（当前栅格默认宽度 >= 1024px）。

## 许可

MIT —— 见 [LICENSE](./LICENSE)。
