# 空闲会话冬眠 · context

## 关键文件

### 改

- `packages/server/src/db.ts`
  - schema：`addColumnIfMissing` 加 `last_input_at`/`last_output_at`/`hibernated_at`（INTEGER NULL）
  - 类型：`SessionStatus` 加 `'hibernated'`；`Session` interface 加三个字段；`SessionRow` 同
  - 五处 SELECT（行 205、460、491、501、510）字段顺序同步，新增三列附末尾
  - `rowToSession`（行 297）追加映射
  - CRUD：新增 `hibernateSession(id)`（UPDATE status='hibernated', hibernated_at=now, pid=NULL，**不**写 ended_at）；新增 `flushActivityTimestamps(map)`（批量 UPDATE 落盘 last_input_at / last_output_at）
- `packages/server/src/status.ts`
  - 不进状态机（hibernated 是 DB-only），但 `set()` 行 99-102 的"终态"判定要把 hibernated 也视为终态防止状态机覆盖
- `packages/server/src/pty-manager.ts`
  - `proc.onData` 里调 `lastOutputAt.set(sessionId, Date.now())`（导出该 map 给 sweeper / flush 复用）
- `packages/server/src/ws-hub.ts`
  - 收 `type: 'input'` 时调 `lastInputAt.set(sessionId, Date.now())`
- `packages/server/src/index.ts`
  - 启动 hibernate-sweeper 与 activity-flush（setInterval 各一）
  - exit 监听（行 118）：若 `getSession(id).hibernated_at != null` 走 hibernated 分支，**不**调 `endSession`
  - reap orphans（行 59）：`if (s.endedAt == null && s.status !== 'hibernated')` 才标 stopped
- `packages/server/src/routes/sessions.ts`
  - 新增 `POST /api/sessions/:id/wake`（参考现有 `/restart` 第 245 行；区别：复用旧 id，重置 hibernated_at/last_*_at 为 NULL）
- `packages/server/src/app-settings.ts`
  - `AppSettings` 加 `hibernation: { enabled, idleMinutes, includeShells }` 默认 `{ enabled: true, idleMinutes: 15, includeShells: false }`
  - clamp idleMinutes 到 [5, 180]
- `packages/server/src/routes/app-settings.ts`
  - zod 加 hibernation 字段校验
- `packages/web/src/types.ts`
  - `SessionStatus` union 加 `'hibernated'`
  - `AppSettings` 加 hibernation 段
- `packages/web/src/api.ts`
  - 加 `wakeSession(id)`
- `packages/web/src/components/StatusBadge.tsx`
  - 字典加 `hibernated: { dot: 'bg-purple-400/70', chip: 'text-purple-200 bg-purple-500/15', label: '已冬眠' }`
- `packages/web/src/components/SettingsDialog.tsx`
  - 新增"会话冬眠"段：开关 + 阈值数字输入 + 复选框"包含纯 shell"
- session tab 入口（找具体组件确认）：status='hibernated' 时 tab 点击行为变 wakeSession；视觉走 StatusBadge 字典自动渲染 💤 / 紫色

### 新建

- `packages/server/src/hibernate-sweeper.ts`
  - `startHibernateSweeper(intervalMs=30_000)`，setInterval：
    - 读 `getAppSettings().hibernation`
    - `hibernation.enabled === false` → return
    - 遍历 `ptyManager.listAlive()`
    - 跳过 status ∈ {working, waiting_input, starting}
    - shell 跳过：`BUILTIN_SHELL_AGENTS` 命中 + `!hibernation.includeShells`
    - 算 idleMs = `now - max(lastInputAt ?? session.startedAt, lastOutputAt ?? session.startedAt)`
    - 超阈值 → `hibernateSession(id)`（DB UPDATE）→ `ptyManager.kill(id)` → `serverLog('info','session','hibernate-auto 开始/成功')`
- `packages/server/src/activity-flush.ts`（或并到 hibernate-sweeper 里也行）
  - 60s 一次把 in-memory `lastInputAt` / `lastOutputAt` map 批量 UPDATE 落盘
  - 用 `db.transaction(...)` 包，避免 N 次单独 UPDATE
  - 也可以放进 hibernate-sweeper 同一个 setInterval 里（30s 顺便 flush，省一个 timer）—— **选这个简化方案**

## 决策记录

### 1. DB 只加 3 列，不加 autostart_cmd
- agent / isolation / worktree_path / worktree_branch / task 已经够拼 wake 时的 spawn 参数
- autostart_cmd 是"也对但多余"——拒了

### 2. 不用 endSession 写 ended_at 来表示冬眠
- auto.md 2026-05-01 明说"`ended_at IS NULL` = 活着"。冬眠 session 在用户视角是"还在"，不能写 ended_at
- 所以新增 hibernateSession DB 函数，专门 UPDATE 不动 ended_at

### 3. 活动时间戳 in-memory + 节流落盘
- 每次 input/onData 都 UPDATE SQLite 会被高频按键拖垮
- 内存 Map → 30s 跟 sweeper 同一拍 flush 一次，足够 sweeper 准确判断 idle
- 重启场景：内存 map 丢失，session 刚被 reap orphans 标 stopped（除非已冬眠），不构成问题

### 4. sweeper 用 setInterval 而非事件驱动
- 事件驱动需要在每次 input / onData 设/重置 timer × N session，复杂；
- setInterval 30s 一拍简单可靠；最大延迟 30s 进冬眠，可接受
- "资深工程师会不会觉得过度设计？"——不会，30 行内的 setInterval 是最朴素答案

### 5. hibernated 是 DB-only 状态，不进 status.ts 状态机
- status.ts 是 PTY + hook 驱动的状态机；冬眠是外部决定（sweeper / 用户）
- 让 status.ts 知道太多 hibernated 会污染它的状态机入口
- 唤醒走正常 statusManager.onSpawn → starting → running

### 6. 只做"点 tab 自动唤醒"，无二级按钮
- 大哥拍板分叉 3 = A
- 实现：前端 status='hibernated' 时 tab 的 onClick 改成发 wakeSession 而不是激活 tab

### 7. 不做手动冬眠按钮
- 大哥拍板分叉 1 = 仅自动
- 实现：去掉所有"立即冬眠"按钮 + `POST /:id/hibernate` 路由

### 8. v1 不做 CLI 上下文自动 resume
- plan 非目标已写
- 实现：wake 时 spawn 命令同 startSession 第一次启动，CLI 自带 `/resume` 让用户找回

### 9. worktree session 冬眠只杀进程不删 worktree
- worktree 文件可能含未提交改动，删了就没了
- 实现：hibernate 只调 ptyManager.kill；worktree 字段不动；wake 时 cwd 用 worktreePath

### 10. CLI 写盘没机会的限制（Windows）
- node-pty Windows 全是 TerminateProcess
- 在 SettingsDialog hint 文案里写明"冬眠会强制结束 CLI 进程，最近 1–2 条未保存的对话可能在 CLI 的 /resume 列表里找不到"
- 不为这条做额外补救逻辑（v2 可以考虑 kill 前先 PTY write 一段"/save" 命令，但跨 CLI 不通用，先不做）

## 依赖与约束

- `ARCHITECTURE.md §3.2`：db.ts 三段 + 五处 SELECT 同步——本次加 3 列必须全部对齐
- `auto.md 2026-05-01 / 项目列表激活分页`：`ended_at IS NULL` = 活着——冬眠不写 ended_at
- `auto.md 2026-05-02 / 项目切换卡顿优化`第 9 条：xterm/IME/TUI 组件不轻易动生命周期——本任务不卸前端 xterm
- `manual.md 2026-04-30`：大哥只在 plan 阶段确认一次——已用完，context/tasks 不停
- `manual.md 2026-05-06`：交付前自派 vibespace-browser-tester——必跑
- CLAUDE.md 操作日志规则：mutation API 必须起止 serverLog；scope=`session` action=`hibernate-auto` / `wake`
- CLAUDE.md 破坏性变更协议：本次涉及 DB schema 变更（加 3 列 + 改 SessionStatus union），需走 grep 引用图核对——SessionStatus 引用在前端 types.ts 和 StatusBadge.tsx，已都列入 write_files；DB 列名不会被前端直接 import，安全

## 读写白名单

写入文件（write_files）：
- packages/server/src/db.ts
- packages/server/src/pty-manager.ts
- packages/server/src/ws-hub.ts
- packages/server/src/index.ts
- packages/server/src/routes/sessions.ts
- packages/server/src/app-settings.ts
- packages/server/src/routes/app-settings.ts
- packages/server/src/hibernate-sweeper.ts（新建）
- packages/server/src/status.ts（可能只读不改，先列入）
- packages/web/src/types.ts
- packages/web/src/api.ts
- packages/web/src/components/StatusBadge.tsx
- packages/web/src/components/SettingsDialog.tsx
- packages/web/src/components/editor/EditorArea.tsx 或 terminal/SessionView.tsx（找具体 session tab onClick 落点，二选一或两者）

读取文件（read_files，含上面 + 索引）：
- 上面所有 write_files
- packages/server/src/cli-catalog.ts（BUILTIN_SHELL_AGENTS）
- packages/server/src/status.ts
- packages/web/src/store.ts（确认 session 状态怎么读）
