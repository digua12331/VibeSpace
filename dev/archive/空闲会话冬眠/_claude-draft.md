# 空闲会话冬眠 · Claude 草案 + 事实包（供 Gemini/Codex 评审）

## 用户原始需求

> "当前ai终端在idle状态，能不能优化他的占用内存，让其休眠"

后续对齐方向：选择"冬眠"方案——idle X 分钟后 kill 子进程，session 标为 hibernated，用户激活时重 spawn。明确**愿意丢现场换内存**。

## 项目现状要点（事实包）

### A. 数据结构（packages/server/src/db.ts:228）

```ts
export type SessionStatus =
  | "starting" | "running" | "working" | "waiting_input"
  | "idle"      // ← claude hook 'Stop' 时已会进 idle
  | "stopped" | "crashed";
```

`Session` 表字段：`status / pid / startedAt / endedAt / exitCode / isolation / worktreePath / worktreeBranch / task`。
`endedAt IS NULL` 是"运行中"的判定标准（auto.md 2026-05-01 项目列表激活分页 那条记忆）。

### B. PTY 生命周期（pty-manager.ts）

- `spawn(opts)` → 注册 `SessionEntry { proc, buffer, bufferBytes:200KB ringbuffer, killed }`
- `kill(sessionId)` → SIGTERM；3s 后 SIGKILL（行 247）
- `proc.onExit` → `sessions.delete(sessionId)` 并 emit 'exit'
- index.ts:118 监听 `ptyManager.on("exit", ...)` → `endSession(id, status, code)` 写 `ended_at=now()`
- 即：现在"被 kill" 与 "被用户 close" 在 DB 上没区分，都走 `ended_at + status='stopped'/'crashed'`

### C. WS 协议（ws-hub.ts，ARCHITECTURE.md §2.2）

- 现有 server→client 消息：`hello / output / status / exit / replay / log / error / error-pattern-alert`
- client→server：`subscribe / unsubscribe / input / resize / replay / log-from-client`
- 没有"hibernate / wake" 消息类型

### D. CLI resume 调研

| CLI | 原生 resume 能力 |
|---|---|
| claude | `-c/--continue`（cwd 最近一条）/ `-r/--resume [session-id]` |
| codex | `codex resume --last` 或 `codex resume <session-id>` |
| gemini | `-r/--resume latest|<index>` |
| opencode | `opencode session` 子命令；细节需进一步查 |
| shell / cmd / pwsh | 无概念（裸 shell 无"对话上下文") |

**关键观察**：CLI 自己的 session-id 与 VibeSpace 的 session-id **不是同一个**。VibeSpace 启动时没捕获 CLI 自己印的 session-id（也未必能拿到——多 CLI 行为不一致）。

### E. 配色字典 / 状态展示

- `SessionStatus → StyleEntry` 字典在 `packages/web/src/components/StatusBadge.tsx`（ARCHITECTURE.md §3.5）。
- 新增 status 需在字典里加颜色 + 中文 label，**不要新建组件**。

### F. 操作日志

- 后端：`serverLog('info'|'error', 'session', '<action> 开始|成功|失败', { sessionId, projectId, meta })`
- 前端：`logAction(scope, action, fn, ctx)` 包 mutation
- 起止配对 + meta 不超 2KB（auto.md 多条）

### G. 进程内存采样手段

- 后端可用 `pidusage(pid)`（package.json 已依赖 pidusage@^3）取 PTY 子进程 RSS。这是 v0 也能立即上的"看板"功能。

## 大方向分叉（用户感知差异，**得让大哥拍板**）

### 分叉 1：冬眠触发条件（**用户感知强**）

| 方案 | 用户体感 |
|---|---|
| A. 仅自动：idle 超过 X 分钟 | 用户什么都不做就会"被冬眠"，怕误伤正在做长任务的 session |
| B. 仅手动：右键菜单/session tab 上有"冬眠"按钮 | 自由度高，但用户自己要记得点 |
| C. **自动 + 手动并存**（推荐） | 默认开自动 + 提供手动按钮；自动阈值可设置；可整体关闭 |

**额外**：自动判定 idle 怎么算？候选信号：
- 后端 status = `idle`（claude hook Stop 事件）→ 最准但只 claude 有
- `lastInputAt`（最后一次用户从前端发 input 的时间戳）→ 跨所有 CLI 都通用
- `lastOutputAt`（PTY 最后一次 onData 的时间戳）→ 兜底，但 TUI 静态界面会被误判

### 分叉 2：默认冬眠阈值（**用户感知强**）

- 5 分钟 / 15 分钟 / 30 分钟 / 60 分钟
- 太短：用户离开喝杯水回来就发现 session 被回收，恼火
- 太长：内存优化不明显

### 分叉 3：唤醒模型（**用户感知强**）

| 方案 | 用户体感 |
|---|---|
| A. 自动唤醒：点 session tab 自动 spawn 一个新 CLI 进程 | 一键回来，但启动有 1-3s 黑屏 |
| B. 手动唤醒：tab 上显示 "💤 已冬眠 · 点击唤醒" | 用户主动决策，避免误唤醒 |

### 分叉 4：上下文恢复（**用户感知强**）

| 方案 | 用户体感 |
|---|---|
| A. 不恢复：唤醒 = 全新 CLI，让用户自己在 TUI 里打 `/resume` | 简单老实；用户清楚"这是新的，过往对话需要手动找回" |
| B. 自动 resume：VibeSpace 尝试给唤醒命令拼上 `-c/--continue` | 看上去无缝；但 `--continue` 是"cwd 最近一条"，多 session 同 cwd 会串味；不同 CLI 实现不一致 |
| C. 半自动：唤醒后**第一帧自动键入** `/resume`（CLI 的内部命令），让 CLI 自己弹出 picker | 中间态；但很多 CLI 没有这个内部命令或名字不同 |

### 分叉 5：冬眠会话怎么"显示"（**用户感知强**）

- session tab 上加 💤 emoji + 灰色调？
- 还是降到二级列表"已冬眠的 N 个" 折叠？

### 分叉 6：worktree 隔离的 session 怎么办（**用户感知中**）

- worktree session 进冬眠不动 worktree 目录，唤醒时复用既有 worktree（安全）
- 还是冬眠时连 worktree 也回收？(会丢未提交改动，**不推荐**)

## 内部实现路径（**Claude 自决**，不打扰大哥）

以下是 AI 自己定的实施大纲——拿出来给 Codex/Gemini 评审，但**不打扰大哥**。

### 后端

1. **DB 加列**：`sessions` 表加 `last_input_at INTEGER`、`last_output_at INTEGER`、`hibernated_at INTEGER NULL`、`autostart_cmd TEXT NULL`（保存 spawn 时的 agent + isolation + worktreePath，便于唤醒重新拼）
2. **SessionStatus 加状态**：`hibernated`（落库；唤醒过渡用 `starting` 即可，不新增）
3. **活动时间戳记录**：
   - `lastInputAt`：ws-hub `input` 消息处更新（per session in-memory map → 定时 1min 落盘 SQLite，避免每次 input 写 sqlite）
   - `lastOutputAt`：pty-manager `proc.onData` 里更新（同上 in-memory + 1min 落盘）
4. **冬眠 sweeper**：`packages/server/src/hibernate-sweeper.ts`（新建）。setInterval 30s 跑一次，遍历所有活着的 session，符合条件就 `ptyManager.kill(id)` + 写 `hibernated=true, hibernated_at=now()`。
5. **判定逻辑**：`now - max(lastInputAt, lastOutputAt) > threshold` 且 status ∈ {idle, running}（不动 working / waiting_input / starting）；isolation=worktree 也要冬眠（仅杀进程不动 worktree 文件）；shell/cmd/pwsh 默认不冬眠（开关可改）
6. **唤醒路由**：`POST /api/sessions/:id/wake` → 走类似 `/restart` 的链路，但**复用旧的 session id**（不像 restart 生成 nanoid 新 id），保留 task/worktree/isolation 等元数据。日志 scope=`session` action=`wake`。
7. **设置**：`app-settings.json` 加 `hibernation: { enabled, idleMinutes, includeShells }`；现有 PUT /api/app-settings 扩字段。
8. **资源采样**：可选——给 `/api/sessions` 响应附 `rssBytes`（如果 status 是 alive）/ `hibernatedBytes:0`，用 pidusage 采。**v1 先不做**（数据库写入压力），仅在 `/api/perf` 加一个聚合端点。

### 前端

1. `SessionStatus` 类型加 `hibernated`，`StatusBadge.tsx` 字典加颜色（紫 + label "已冬眠"）
2. 设置对话框（已有 `SettingsDialog.tsx`）加"会话冬眠"段落：开关、阈值（数字输入 5-180）、是否冬眠纯 shell
3. session tab 上对 hibernated 状态加 💤 emoji + 点击直接发 wake mutation
4. 右键菜单（如有）/ session 顶栏加"立即冬眠"按钮（status=running/idle 时可见）
5. logAction scope=`session` action=`wake | hibernate-manual`

### 边界情况

- **冬眠期间 task 绑定保留** — wake 后 task 绑定还在
- **worktree 不动** — 冬眠不删 worktree，wake 复用
- **冬眠时收到 ws subscribe** — 返回 `hibernated` status，前端展示"💤 已冬眠"
- **冬眠后用户关掉 session** — 走原 DELETE 路径，hibernated_at 字段不影响清理
- **服务器重启** — 死过的 PTY 不能复活；启动期把 `hibernated_at != null` 的视为已停（auto.md "session reaper" 类逻辑），UI 显示"上次冬眠"
- **CLI 升级期间 spawn 失败** — wake 报错 → 给前端 toast，session 留在 hibernated 状态可重试

### 风险点

- **kill 之前要不要 SIGINT 先**（让 CLI 优雅退出，清理临时文件 / 写 ~/.codex/sessions/* 等持久化目录）？现在 `ptyManager.kill` 是 SIGTERM 3s 后 SIGKILL，对部分 CLI 可能没让它写完 session 文件
- **idle hook 的可达性**：claude 的 'Stop' 事件靠 hook，hook 可能没装好；不要依赖它，**主信号用 lastInputAt + lastOutputAt**
- **windows 信号语义**：node-pty `kill(sig)` 在 Windows 上 sig 参数被忽略，全是 TerminateProcess；CLI 没机会清理。这条要在 plan 风险段写清楚。
- **重叠点**：项目记忆里"项目切换卡顿优化"建议 xterm/IME 不动生命周期（auto.md 第 9 条）。冬眠会卸/重 spawn PTY 但**不**卸前端 xterm 组件——这条约定守住

## 拟定关键文件清单

- 新建：`packages/server/src/hibernate-sweeper.ts`、`packages/server/src/routes/sessions.ts` 内 `POST /:id/wake`
- 改：`packages/server/src/db.ts`（schema 三处 + SELECT 五处 + 类型 + CRUD）
- 改：`packages/server/src/pty-manager.ts`（onData 钩 lastOutputAt）
- 改：`packages/server/src/ws-hub.ts`（input 钩 lastInputAt）
- 改：`packages/server/src/index.ts`（启动 sweeper + 注册 wake route）
- 改：`packages/server/src/app-settings.ts` + `routes/app-settings.ts`（hibernation 配置）
- 改：`packages/web/src/types.ts`（SessionStatus 加 hibernated + AppSettings 加 hibernation）
- 改：`packages/web/src/api.ts`（`wakeSession(id)`）
- 改：`packages/web/src/components/StatusBadge.tsx`（字典）
- 改：`packages/web/src/components/SettingsDialog.tsx`（冬眠设置 UI）
- 改：`packages/web/src/components/editor/EditorArea.tsx` 或 SessionView（💤 icon + 点击 wake）

## 想问 Gemini / Codex 的事

- 这套"in-memory lastInputAt/lastOutputAt + 1 min 落盘"的写法在多 worker / 单进程 Fastify 下是否够用？
- worktree session 冬眠还有什么细节会爆？
- DB schema 我加了 4 列；有没有更简的路（如只加 1 列 `hibernated_at`，其余靠内存）？
- 把 `ptyManager.kill` 直接当 hibernate 是否会丢 CLI 的 session 写盘？
