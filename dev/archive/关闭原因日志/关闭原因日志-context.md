# 关闭原因日志 · 上下文盘点

## 关键文件

- `packages/server/src/pty-manager.ts`
  - `SessionEntry` (63–68 行)：加 `killReason: string | null`
  - `kill(sessionId, signal?)` (251–271 行)：改签名为 `kill(sessionId, reason: string, signal?: string)`；早 return 路径前先尝试更新 reason
  - `killAll()` (295–299 行)：传 `"kill-all"`（理论上没人调，作为兜底）
  - `proc.onExit` 回调 (217–223 行)：把 `entry.killReason` 一并 emit；签名 `(sessionId, exitCode, signal, wasKilled, killReason)`

- `packages/server/src/index.ts`
  - orphan reap 段 (73–88 行)：把 `console.log` / 循环里每个 reaped session 改成 `serverLog("warn", "session", "close (orphan-reap)", { projectId, sessionId, meta: {...} })`
  - PTY exit 监听 (174–193 行)：接 5 个参数 `(sessionId, code, signal, wasKilled, killReason)`；hibernated 早 return 不动；其余路径按决策表算 `closeReason + level`，emit `serverLog(level, "session", \`close (${reason})\`, {...})`，再走原有 endSession
  - shutdown (268–291 行)：进入时 `serverLog("info", "server", "shutdown 开始", { meta: { sig } })`；`ptyManager.kill(s.id)` → `ptyManager.kill(s.id, "server-shutdown")`

- `packages/server/src/routes/sessions.ts`
  - DELETE `/api/sessions/:id` (208–209 行)：`ptyManager.kill(id)` → `ptyManager.kill(id, "user-stop")`
  - POST `/api/sessions/:id/restart` (277–278 行)：`ptyManager.kill(id)` → `ptyManager.kill(id, "user-restart")`

- `packages/server/src/routes/projects.ts`
  - 项目删除循环 (451–453 行)：`ptyManager.kill(s.id)` → `ptyManager.kill(s.id, "project-delete")`

- `packages/server/src/hibernate-sweeper.ts`
  - `hibernateOne` (94 行)：`ptyManager.kill(id)` → `ptyManager.kill(id, "hibernate-auto")`

- `packages/server/src/task-budget.ts`
  - `handleCutoff` 循环 (127–138 行)：`ptyManager.kill(sid)` → `ptyManager.kill(sid, "budget-cutoff")`

## 决策记录

1. **不新增 DB 列**：close reason 只用于日志展示，落到 LogsView 内存 500 条 + JSONL 文件即足；新增列会带来迁移、序列化、前端类型透传一整圈代价，与"只想看一眼为啥没了"的诉求严重不成比例。资深工程师反向看：**会觉得加列才是过度设计**。
2. **不抽 enum / 常量模块**：reason 字符串只有 8–10 个，集中在本任务的 6 个调用点；抽 enum 会让每个调用方多 import 一次，反而拉远调用点和原因的视觉关联。直接用字符串字面量，注释在 pty-manager 里列一份候选清单即可。
3. **不改 ptyManager 的 emit 事件名**：仍叫 `exit`，新加第 5 个参数。worktree-session-runner 的 `(sid: string) => void` 监听器 JS 自动忽略多余参数，不破坏现有逻辑（资深工程师常用做法：往现有事件 append 参数比起新事件更省事）。
4. **hibernated 行不重复打 close**：sweeper 已经有 `hibernate-auto 开始 / 成功 / 失败` 起止配对；exit handler 那个早 return 之前不打 close，避免日志面板里同一动作连出两条迷惑用户。
5. **级别分层**：`crashed` / `os-signal-*` → error；`orphan-reap` / `budget-cutoff` / `killed-unknown` → warn；其余 → info。让 LogsView 红/黄/灰一眼区分。
6. **shutdown 保留"先 endSession 再 kill"**：原代码先 endSession 是为了不依赖 PTY 真退就先写 `ended_at`，避免外面 SIGKILL 强杀前端读到 stale alive 行。本任务不动这个顺序；额外多一次 endSession 由 exit handler 再调一次是幂等的（UPDATE 而非 INSERT）。

## 依赖与约束

- `serverLog` 签名：`(level: LogLevel, scope: string, msg: string, extra?: { projectId?: string; sessionId?: string; meta?: unknown })`（`packages/server/src/log-bus.ts`）
- `getSession(id)` 返回完整 row（含 `projectId`、`agent`、`hibernatedAt`）——exit handler 已经在用
- `meta` 字段 JSON.stringify 后 ≤ 2KB（本任务最多 5 个字段，远低于上限）
- TypeScript 严格模式：新加 `killReason` 字段必须是 `string | null`，emit 第 5 参数同理
- 破坏性变更协议第 3 条：`ptyManager.kill` 是跨文件 import 的导出符号；本任务改签名 → 必须 grep 全部调用点（已列：6 处 + `killAll`）
- 调用点修改后 verify 必须含 `grep -rn "ptyManager.kill(" packages/server/src/` 确认无残留无 reason 版本
