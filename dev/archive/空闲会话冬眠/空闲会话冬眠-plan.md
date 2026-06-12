# 空闲会话冬眠 · plan

## 大哥摘要

你现在的 AI 终端（session）即使空着不用，后端那个 CLI 子进程（claude / codex 这种）也照样占着内存——12 个 idle session 能轻松几个 GB。这次做"冬眠"：

- **闲置一段时间**（多长由你定，下面让你挑）→ 后端自动把这个 session 的 CLI 子进程**杀掉**，session 在前端**还在**，状态变成 💤 紫色"已冬眠"。
- 你想接着用 → **点一下 tab** 就重新启动一个新的 CLI 进程接管。
- **现场（聊天上下文）会丢**——这就是"省内存"要付的代价，已经在上一轮跟你对齐过。但 claude / codex / gemini 自己都有 `/resume` 命令（在 CLI 里面打），能让你手动找回之前的对话。**v1 不替你自动 resume**（不同 CLI 行为差异大，自动容易错串会话，你手动挑更稳）。
- worktree（git 的临时副本目录，几个并行任务互不踩脚）**不动**——只杀进程不删文件，你的未提交改动安全。

**完成后你能看到**：「设置」对话框（齿轮图标打开那个）多一段"会话冬眠"，开关 + 阈值 + 是否包含纯 shell；session tab 上空着的会话渐渐变成 💤 紫色；点一下立即唤醒。

## 大哥已拍板（2026-05-13）

1. **触发方式 = 仅自动**（不做手动按钮——简化 UI，省一个易撞误按的入口）
2. **默认阈值 = 15 分钟**（写进 app-settings 默认值；用户后续可改 5–180）
3. **唤醒方式 = 点 tab 自动唤醒**（不要二级"唤醒"按钮）
4. **纯 shell session 默认不冬眠**（设置可改）

实施步骤里删掉一切"手动冬眠按钮 / hibernateSession API / 顶栏入口"相关内容；下面"关键分叉"段保留只作历史。

## 关键分叉 — ~~**需要你拍板**~~（已定，留作历史）

下面 4 项是用户感知差异，AI 自己不能定，先给你看清楚再走。其他纯实现细节（DB 加几列、用哪个定时器、配色具体哪个紫）我自决，不打扰你。

### 分叉 1：冬眠触发方式（默认开自动 + 提供手动按钮，**推荐 C**）

| 选项 | 大哥体感 |
|---|---|
| A. 仅自动 | 啥都不做就被冬眠，怕误伤长任务 |
| B. 仅手动 | 自由度高，但要记得点 |
| **C. 自动 + 手动并存（推荐）** | 默认自动开；session 顶栏加"立即冬眠"按钮；设置里能整体关掉自动 |

### 分叉 2：默认空闲多久算"该冬眠"

候选：**5 / 15 / 30 / 60 分钟**。这只是默认值，你以后能在设置里改。

我的建议：**30 分钟**——不会让你"喝杯水回来发现被回收"，但也不会让 12 个 idle session 占着内存通宵。

### 分叉 3：💤 已冬眠的 session 怎么唤醒

| 选项 | 大哥体感 |
|---|---|
| A. **点 tab 自动唤醒（推荐）** | 一键回来；启动 CLI 有 1–3 秒等待 |
| B. tab 上必须明确点"唤醒"按钮 | 防误唤醒；多一步点击 |

### 分叉 4：纯 shell session（cmd / pwsh / bash）也要冬眠吗

| 选项 | 大哥体感 |
|---|---|
| **A. 默认不冬眠（推荐）** | 纯 shell 占内存少；冬眠它收益小、还会让你打的 `cd ...` 历史命令丢掉，得不偿失 |
| B. 默认也冬眠 | 内存最大化省；但 shell 没有 `/resume` 概念，丢得彻底 |

---

## 目标 + 验收标准

1. **设置入口**：齿轮图标 → SettingsDialog 多一段"会话冬眠"，开关 + 阈值（数字输入，5–180 min）+ 是否包含纯 shell。
   - 验收：浏览器能看到这一段；改完点保存，刷新页面值还在（写盘 `packages/server/data/app-settings.json`）。

2. **自动冬眠**：阈值过了的 session（status ∈ {running, idle}，且 lastInputAt 和 lastOutputAt 都老于阈值）会被后端 sweeper 杀掉 PTY 子进程；前端 session tab 渐变成 💤 紫 + label"已冬眠"。
   - 验收：手动把阈值设成 1 分钟，开个 claude session 后等 1 分钟不动，tab 自动变 💤；任务管理器看 claude.exe 进程已退；LogsView 出现 `scope=session action=hibernate-auto` 起止配对。

3. **手动冬眠**：session 顶栏（或右键菜单）有"立即冬眠"按钮，status=running/idle 时可见，点了立即触发。
   - 验收：浏览器能看到按钮；点完同上日志，差别是 `action=hibernate-manual`。

4. **唤醒**（按分叉 3 的选择）：点 💤 tab → 后端 POST /api/sessions/:id/wake → 复用旧 session id 重 spawn → tab 状态回到 starting → running。
   - 验收：点完 1–3 秒后 tab 变绿（running）；LogsView 起止配对；CLI 是全新的（输入 `/status` 或随便聊一句确认没有旧上下文）。

5. **worktree session 安全**：isolation='worktree' 的 session 冬眠时**只杀进程不删 worktree 目录**；唤醒时复用既有 worktree。
   - 验收：开一个 worktree session，在 worktree 目录里 `echo hi > test.txt`；冬眠 → 唤醒 → `cat test.txt` 还在；底层 worktree 路径同一份。

6. **服务器重启容错**：服务器关了再起来，看到 `hibernated_at IS NOT NULL` 的 session 状态保持 `hibernated`（不会被 reap orphans 误标 stopped）。
   - 验收：手动把一个 session 冬眠，重启 dev server，刷新页面，tab 还是 💤 不是 stopped。

7. **失败路径**：spawn 失败（CLI 升级中、PATH 丢了）→ 前端弹错；session 留在 hibernated 状态可再点重试。
   - 验收：把 claude 临时改名让 PATH 找不到 → 点 wake → 浏览器弹 alertDialog；LogsView 有 ERROR；再改回来再点能成功。

## 非目标

- **不自动 resume CLI 对话上下文**（用户感知差异，留给 v2；现在唤醒就是全新 CLI，靠 CLI 自己的 `/resume`）
- **不冬眠 status='working' / 'waiting_input' / 'starting'** 的 session（正在干活的肯定不能动）
- **不删 worktree 目录**（避免丢未提交改动）
- **不动 xterm 前端组件生命周期**（auto.md 已有约定）
- **不做后台进程 RSS 看板**（上一轮提到的"内存看板"思路被冬眠取代了；后续要再加可以独立任务）
- **不替 shell/cmd/pwsh 这类裸 shell 做特殊上下文恢复**（它们就没有"上下文"这一说）

## 实施步骤

### 步骤 1：DB schema 扩展（db.ts 三段 + 五处 SELECT 同步）

加 3 列到 `sessions` 表（**比草案少一列**——`autostart_cmd` 不需要，agent/isolation/worktree_* 已经够拼）：

- `last_input_at INTEGER NULL` — 用户最后一次从前端发 input 的时间戳
- `last_output_at INTEGER NULL` — PTY 最后一次 onData 的时间戳
- `hibernated_at INTEGER NULL` — 进入冬眠的时间戳；非 NULL 即"已冬眠"

`SessionStatus` 枚举加 `'hibernated'`。
db.ts 五处 SELECT 字段顺序一致（ARCHITECTURE.md §3.2）。
`Session` 类型加对应字段。

**如何验证**：`pnpm --filter @aimon/server build` 通过；启动 server 看 `addColumnIfMissing` 加列日志；旧库迁移成功。

### 步骤 2：活动时间戳钩子（ws-hub + pty-manager）

`ws-hub.ts` 收 `input` 消息时维护 in-memory `Map<sessionId, ts>` 更新 lastInputAt。
`pty-manager.ts` 的 `proc.onData` 里更新 in-memory lastOutputAt。

**节流落盘**：每 60s 一次 setInterval 把内存 map 批量 flush 到 SQLite（不是每次 input 都 UPDATE，否则 SQLite 写入会被高频按键拖垮）。

**如何验证**：开一个 session 打几个字 → 等一分钟 → `sqlite3 data/aimon.db "SELECT last_input_at FROM sessions WHERE id=...";` 看到非 NULL 时间戳。

### 步骤 3：冬眠 sweeper（新建 hibernate-sweeper.ts）

`packages/server/src/hibernate-sweeper.ts`，setInterval 30s：

- 读 app-settings.hibernation，关闭则直接 return
- 遍历 `ptyManager.listAlive()` 的 session
- 对每个：算 `idleMs = now - max(lastInputAt ?? startedAt, lastOutputAt ?? startedAt)`，超阈值且 status ∈ {running, idle} → 触发冬眠
- 跳过 status ∈ {working, waiting_input, starting}
- 跳过纯 shell agent（按分叉 4 默认；可设置覆盖）
- 触发逻辑：写 `hibernated_at=now()` + `endSession(id, 'hibernated', null)`（**注意**：endSession 现在写 ended_at，得改成 hibernated 路径不写 ended_at——这是 step 4 的事）

事件驱动还是 setInterval？setInterval 简单——30s 一拍，最大延迟 30s 进冬眠，可接受。

**如何验证**：阈值设 1 min，开 session 等 1 min 不动 → LogsView 自动出现 `hibernate-auto 开始/成功`；DB `hibernated_at IS NOT NULL`；任务管理器看 PTY 子进程已退。

### 步骤 4：endSession 路径区分（关键修改）

现状：`endSession(id, status, code)` 一律写 `ended_at = Date.now()`。冬眠不该写 ended_at（auto.md 2026-05-01：`ended_at IS NULL` = 活着）。

改法：新增 `hibernateSession(id)` DB 函数——`UPDATE sessions SET status='hibernated', hibernated_at=?, pid=NULL WHERE id=?`，**不**写 ended_at。

ptyManager 的 `'exit'` 监听（index.ts:118）要分流：如果 `hibernated_at != null`（刚被 sweeper 标了），调 `hibernateSession` 而不是 `endSession`。怎么传递这个信号？最简：在 sweeper 触发前先写 `hibernated_at`，然后再 `ptyManager.kill`；exit 监听里读 `getSession(id).hibernated_at` 判断分流。

**如何验证**：冬眠后查 DB，`ended_at IS NULL AND hibernated_at IS NOT NULL AND status='hibernated'`。

### 步骤 5：唤醒路由（POST /api/sessions/:id/wake）

`packages/server/src/routes/sessions.ts` 加 wake handler：

- 找 session（`getSession`），不存在 404
- 不是 hibernated 状态 → 400
- 读元数据：agent / isolation / worktreePath / worktreeBranch / task
- spawn 新 PTY（agent 已知，isolation=worktree 时 cwd 用 worktreePath 否则 project.path）
- 复用旧 session id（关键：不调 `createSession`，直接 `UPDATE`）：`UPDATE sessions SET pid=?, status='starting', hibernated_at=NULL, last_input_at=NULL, last_output_at=NULL WHERE id=?`
- statusManager.onSpawn(id)，wire 同 startSession 一样
- 起止 serverLog scope=session action=wake

**如何验证**：手动冬眠 → 点 wake → tab 回到 running；CLI 是新的；id 不变。

### 步骤 6：设置入口（app-settings 扩展）

`app-settings.ts`：`AppSettings` 加 `hibernation: { enabled: boolean, idleMinutes: number, includeShells: boolean }`。
`routes/app-settings.ts` 的 zod 加新字段（idleMinutes 5-180）。
前端 `SettingsDialog.tsx` 加"会话冬眠"段：开关 + 数字输入 + 复选框"包含纯 shell"。
`types.ts` 镜像。

**如何验证**：UI 改完后 settings.json 落盘；改完不重启刷新页面值还在。

### 步骤 7：前端 UI

- `types.ts` `SessionStatus` 加 `'hibernated'`
- `StatusBadge.tsx` 字典加 hibernated 项：`{ dot: 'bg-purple-400/70', chip: 'text-purple-200 bg-purple-500/15', label: '已冬眠' }`
- `api.ts` 加 `wakeSession(id)` `hibernateSession(id)`
- session tab（找具体组件——可能在 `EditorArea.tsx` 或 `SessionView.tsx` 顶栏）：
  - status='hibernated' 时显示 💤 emoji + 紫色调；点击触发 wakeSession（按分叉 3 选项 A）
  - status='running'/'idle' 时顶栏右侧加"💤 冬眠"按钮触发 hibernateSession
- 都用 `logAction('session', 'wake'|'hibernate-manual', ...)` 包装

**如何验证**：浏览器看到 💤 + 紫色样式；点击改写状态；LogsView 起止配对。

### 步骤 8：启动期 reap orphans 改造

index.ts:59 当前把 `ended_at IS NULL` 的全标 stopped。要排除 hibernated：

```ts
if (s.endedAt == null && s.status !== 'hibernated') {
  endSession(s.id, 'stopped', null);
}
```

**如何验证**：手动冬眠一个 session 后重启 server，刷新前端，tab 仍 💤。

### 步骤 9：浏览器验收派 vibespace-browser-tester

按 manual.md 2026-05-06 偏好，交付前自己跑一遍：
- 验收项 1-7 全跑
- 失败路径（spawn 失败）单独验

## 边界情况

- **冬眠期间用户从其他途径给 session 发 input（e.g. 文件右键发送到 session）** → input 失败（PTY 已死）；现有 `ptyManager.write` 在 session 不存在时返 false，调用方 toast 提示"session 已冬眠，请先唤醒"
- **多 session 同 cwd** → 都各自冬眠 / 唤醒，互不影响（spawn 是按 sessionId 隔离的）
- **status='starting' 时被 sweeper 误判** → 步骤 3 已排除 starting；保险起见 lastOutputAt 为 NULL 时 fallback 用 startedAt
- **PTY ring buffer 200KB 在 kill 时会丢未发的最后一帧** → 现状 onData 是同步 broadcast，buffer 是给 replay 用的；冬眠前最后一帧已经被前端 xterm 收到，不丢；replay buffer 在 kill 后随 SessionEntry delete 一起清，这是可接受的（已冬眠 session 本来就要重建）
- **sweeper 跑的时候用户正在打字（lastInputAt 在 50ms 前）** → 通过 in-memory 时间戳避免（lastInputAt 是即时更新的，60s 落盘只影响重启场景）
- **服务器重启的边界**：重启时所有 PTY 都死了；步骤 8 已让冬眠 session 保住状态；非冬眠的活 session 会被标 stopped（现有行为）
- **app-settings 关掉"冬眠开关"时已经冬眠的 session 怎么办** → 不动；用户自己点唤醒；关开关只影响"以后还会不会自动冬眠新的"
- **task 绑定 session 冬眠期间 docs 端发 dispatch** → 现有 `sendToSession` 会先看 PTY alive，否则 fallback 到 dispatchClaude 起新 session。冬眠会落到 fallback，**会绕过冬眠状态**——不是本任务理想行为。**这条暂作已知问题**，写到 issues.md。

## 风险与注意

- **Windows kill 信号被忽略**：node-pty 在 Windows 上 `kill(sig)` 全部走 TerminateProcess。CLI（claude/codex/gemini）没机会写自己的 session 持久化文件（`~/.claude/projects/.../sessions/*.jsonl`、`~/.codex/sessions/*` 等）。**实测影响**：用户在 CLI 里手动 `/resume` 时可能看不到冬眠前最后一段对话。**对策**：把这条作为 v1 已知限制写在 SettingsDialog 的 hint 文案里——"冬眠会强制结束 CLI 进程，最近 1–2 条未保存的对话可能在 CLI 的 /resume 列表里找不到"
- **CLI 自己的资源没清干净**：node child process 一死 OS 自然清；但 CLI 内部如果有 .lock 文件或 socket，可能残留。**对策**：v1 不主动清理；如果用户反馈"唤醒报 lock"再加。
- **SQLite 单进程 + sweeper 并发**：better-sqlite3 是同步的，并发只是事件循环里串行 UPDATE。30s 一拍，最多 N 个 session × 1 UPDATE = 不会成为瓶颈
- **状态机的 hibernated 进入路径**：status.ts 的 `set` 不允许从 stopped/crashed 恢复（行 99-102 注释）。新增 hibernated 走的不是 status.ts 而是直接 DB UPDATE + WS 广播。状态机本身可以不知道 hibernated 的存在（hibernated 是"DB-only 状态"），唤醒时回到 starting 走正常状态机入口
- **三方会审跳过**：本次 plan 是 Claude 单写，未走 Gemini + Codex 评审（外部模型 API 失败）

## 关键文件

- 改：`packages/server/src/db.ts`（schema 3 列 + 5 处 SELECT + 类型 + CRUD `hibernateSession` / 修订 `endSession`）
- 改：`packages/server/src/pty-manager.ts`（onData 钩 lastOutputAt）
- 改：`packages/server/src/ws-hub.ts`（input 钩 lastInputAt）
- 新建：`packages/server/src/hibernate-sweeper.ts`（setInterval 30s）
- 改：`packages/server/src/index.ts`（启动 sweeper、reap orphans 排除 hibernated、exit 监听分流）
- 改：`packages/server/src/routes/sessions.ts`（POST /:id/wake、POST /:id/hibernate 或合并到 PATCH）
- 改：`packages/server/src/app-settings.ts` + `routes/app-settings.ts`（hibernation 配置）
- 改：`packages/web/src/types.ts`（SessionStatus + AppSettings）
- 改：`packages/web/src/api.ts`（wakeSession / hibernateSession）
- 改：`packages/web/src/components/StatusBadge.tsx`（紫色字典项）
- 改：`packages/web/src/components/SettingsDialog.tsx`（冬眠段）
- 改：`packages/web/src/components/editor/EditorArea.tsx` 或 `terminal/SessionView.tsx`（💤 状态 + 顶栏按钮）

## 多模型 Plan 会审

> [Gemini 评审] 跳过：本机 `gemini` CLI 缺 `GEMINI_API_KEY`，MCP `mcp__gemini-cli__ask-gemini` 也 spawn ENOENT。两次失败后回退（CLAUDE.md "重试一次仍失败则回退 Claude 单写"）。
> [Codex 评审] 跳过：`codex:codex-rescue` subagent 返回 OpenAI 401（API key 未配置）。两次失败后回退。
> [Codex 综合主笔] 跳过：外部模型全失败，由 Claude 单写 plan.md。
> [Claude 白话化兜底] 大哥摘要全段白话；术语括号翻译：worktree（git 临时副本）/ PTY（伪终端子进程）/ ring buffer（环形缓冲区）/ in-memory map / sweeper（定时清扫器）；分叉项压成"用户体感差异"语言，技术细节藏在实施步骤里；对照 manual.md 2026-04-30（只在大方向 + 用户感知差异处停）、2026-05-06（交付前自派 tester）、2026-04-24（小功能不停的偏好——本任务不小，走完整流程）已嵌进实施步骤和验收。
