## 大哥摘要

VibeSpace 里 AI 终端（每个标签页背后挂一个 PTY，PTY = 跑命令行的小通道）有时会"突然没了"——可能是它自己崩了、可能是后台自动休眠（hibernate = 把闲置终端先杀掉省内存，按需可以唤醒）把它收走了、也可能是关 VibeSpace 时被一起收走了。现在浏览器右下角那个「日志面板」（LogsView）里基本什么提示都没有，看上去就是"它没了，不知道为啥"。

本次做完后：**每个 AI 终端被关掉，日志面板里都会多出一条 `scope=session msg=close <原因>`**，告诉你这次是 1）CLI 自己正常退出 2）崩了 3）被你点关闭 4）被休眠 5）被 VibeSpace 整体退出收走 6）被系统级信号杀掉（如内存不足）等。**不动数据库、不动前端界面**，只是后端在已有的 `data/logs/YYYY-MM-DD.log` 和 LogsView 里加日志。

验收方式：开几个 AI 终端 → 分别用点关闭、CLI 里敲 `exit`、把 VibeSpace 退出几种方式收掉 → 浏览器日志面板和 `packages/server/data/logs/YYYY-MM-DD.log` 文件里都能看到对应的 close 条目，原因字段一眼能认出。

## 任务量级

**小档**：6 个后端文件改动，每个改动都是机械的"传一个 reason 字符串"或"加一次 serverLog 调用"，没有 UI、没有 DB schema、没有架构选择。按规则三件套照写，但不在 plan 后停等确认，直接执行。

## 目标

让用户在浏览器 LogsView 和服务端落盘日志里，对每一次 PTY 关闭都能看到带原因的条目；非正常关闭（crashed / os-signal）走 `level=error`，正常关闭走 `level=info`。

可验证的验收标准：

1. 开一个 claude 会话，在其中用 `/quit` 或 `Ctrl-D` 让 CLI 自己退出 → LogsView 出现 `scope=session msg=close (cli-exit)` `level=info`
2. 开一个 claude 会话，点页面上的关闭按钮 → LogsView 出现 `scope=session msg=close (user-stop)` `level=info`
3. 让一个会话闲置触发休眠 → LogsView 出现既有的 `hibernate-auto 成功`，**不**额外出现 close 日志（避免重复打点）
4. 关 VibeSpace（点关闭窗口或 Ctrl-C 后端进程）→ LogsView 出现 `scope=server msg=shutdown 开始`，每个被收走的会话出现 `close (server-shutdown)`
5. 启动 VibeSpace 时若数据库里有上次没清理干净的 alive 行 → LogsView 出现 `scope=session msg=close (orphan-reap)` `level=warn`
6. 手动用任务管理器 / `kill -9 <pid>` 杀掉一个 claude 子进程（模拟 OS 强杀）→ LogsView 出现 `close (os-signal-<n>)` `level=error`
7. `packages/server/data/logs/YYYY-MM-DD.log` 文件里有上述每条对应的 JSONL 行（meta 含 sessionId / agent / exitCode / signal / wasKilled / reason）
8. 后端类型检查通过：`pnpm --filter @vibespace/server typecheck`（如脚本名不同则用项目实际的命令）

## 非目标

- 不改前端：LogsView 的渲染逻辑、过滤器、UI 都不动。
- 不改 DB schema：现有 `sessions.exit_code` / `ended_at` / `status` 列足够，不新增 `close_reason` 列。
- 不改 hibernate-sweeper 的日志格式：它已经有完整的开始/成功/失败配对，不在本任务里改。
- 不引入新的"reason 枚举常量"模块——只是字符串，定义在 pty-manager 注释里即可。

## 实施步骤

1. **`pty-manager.ts` 给 kill 加一个可选 reason 参数 + 在 entry 里记一下**
   - `SessionEntry` 增加 `killReason: string | null`
   - `kill(sessionId, reason: string, signal?: string)`：把 reason 写到 entry；签名改为 `kill(id, reason: string, signal?: string)`。`killAll()` 内部传固定的 reason。
   - `proc.onExit` 回调里把 `killReason` 一并 emit：`this.emit("exit", sessionId, exitCode, signal ?? null, wasKilled, killReason)`
   - 验证：`pnpm --filter @vibespace/server typecheck` 通过；已有的 worktree-session-runner.ts 那个 `(sid: string) => void` 监听器不受影响（多余参数 JS 自动忽略）。

2. **`index.ts` 的 `ptyManager.on("exit", ...)` 里加统一 close 日志**
   - 第 5 个参数 `killReason` 接住
   - 已 hibernated（`row.hibernatedAt != null`）的早 return 路径不变——sweeper 那边已经打过日志
   - 否则按这套决策表算 `closeReason` + `level`：
     - `wasKilled && killReason` → `closeReason = killReason`，level=info（除非 killReason 是 `budget-cutoff`，那时 level=warn）
     - `!wasKilled && exitCode === 0` → `closeReason = "cli-exit"`，level=info
     - `!wasKilled && signal != null` → `closeReason = "os-signal-" + signal`，level=error
     - 其余（!wasKilled && exitCode != 0） → `closeReason = "crashed"`，level=error
   - 一行 `serverLog(level, "session", \`close (${closeReason})\`, { projectId: row.projectId, sessionId, meta: { agent: row.agent, exitCode, signal, wasKilled, reason: closeReason } })`
   - 验证：手动按上面验收标准 1 / 2 / 6 复现，浏览器 LogsView + JSONL 文件都看到。

3. **`index.ts` 的孤儿清理段（orphan reap）改用 serverLog**
   - 原来 `console.log` 升级为 `serverLog("warn", "session", \`close (orphan-reap)\` ...)`，对每个被 reap 的行单独打一条；最后总数用现有 console.log 留一行也行。
   - 验证：标准 5。

4. **`index.ts` 的 shutdown 改用 serverLog**
   - 进入 shutdown 时先 `serverLog("info", "server", "shutdown 开始", { meta: { sig } })`
   - 循环里 `ptyManager.kill(s.id, "server-shutdown")` 传 reason；不再手动 `endSession` —— 让统一 exit handler 处理（注意：原代码先 endSession 再 kill，目的是不依赖 PTY 退出快，要保留这个先后；endSession 不会阻塞 exit 监听打日志）。
   - 验证：标准 4。

5. **`routes/sessions.ts` 两处 kill 传 reason**
   - DELETE `/api/sessions/:id` 的 `ptyManager.kill(id)` → `ptyManager.kill(id, "user-stop")`
   - POST `/api/sessions/:id/restart` 的 `ptyManager.kill(id)` → `ptyManager.kill(id, "user-restart")`
   - 验证：标准 2 和 restart 操作各跑一次，LogsView 出现对应原因。

6. **`routes/projects.ts` 项目删除路径传 reason**
   - `ptyManager.kill(s.id)` → `ptyManager.kill(s.id, "project-delete")`
   - 验证：删一个有活会话的项目，LogsView 看到 `close (project-delete)`。

7. **`hibernate-sweeper.ts` 传 reason 但不打额外日志**
   - `ptyManager.kill(id)` → `ptyManager.kill(id, "hibernate-auto")`
   - 与 index.ts 的"已 hibernated 早 return"叠加，保证不重复打 close 日志
   - 验证：标准 3。

8. **`task-budget.ts` 预算截断路径传 reason**
   - `ptyManager.kill(sid)` → `ptyManager.kill(sid, "budget-cutoff")`
   - exit handler 那边把 `budget-cutoff` 视作 level=warn
   - 验证：跑一次预算截断（或手动 trigger），LogsView 看到 `close (budget-cutoff)` level=warn。

9. **类型检查 + 跑后端 dev 起一次确认无回归**
   - `pnpm --filter @vibespace/server typecheck`（或项目实际命令）
   - `pnpm dev` 起来，前端连得上，开一个 claude 会话点关闭，看到 close 日志即可。

## 边界情况

- **kill 之后 PTY 没立刻 exit**（`setTimeout 3s SIGKILL`）：reason 已经记在 entry 里，exit 真正触发时还在；3s 内再次调 kill 会被 `e.killed` 早 return，但 reason 不会被覆盖。本任务保留这个语义（不重写 kill 的早 return）。
- **同一 session 在 hibernate 后又被 wake，再次关闭**：wake 是新建 PTY，新的 entry 一开始 `killReason=null`，不会污染。
- **worktree-session-runner 的 onExit 监听器**：签名 `(sid: string) => void`，多收一个参数会被忽略，行为不变；但若以后想把 reason 也透传给它，留个 TODO 即可（本任务不做）。
- **shutdown 路径里 endSession + kill 顺序**：保留原先"先 endSession 再 kill"——因为 endSession 写 `ended_at` 不依赖 PTY 真退；kill 后 exit handler 会再调一次 endSession，幂等（endSession 是 UPDATE，重复写没问题）。
- **meta size**：`exitCode + signal + wasKilled + reason + agent` 全是基础类型，加起来远小于 2KB 上限。

## 风险与注意

- **wasKilled 但 killReason=null**：说明有调用方还没传 reason（或外部直接 `entry.proc.kill()`，理论上没人这么干）。fallback 到 `"killed-unknown"`，level=warn，便于以后排查漏改的 kill 调用点。
- **改完 `ptyManager.kill` 签名后所有现有调用点必须全改**：必须 grep 全部 `ptyManager.kill(` 调用点确认没漏（破坏性变更协议第 3 条——修改跨文件 import 的导出符号签名）。本次列了 6 处，已逐个对应到上面的步骤。
- **hibernated 行的退出**：index.ts 已有早 return 跳过 endSession；本任务在那个早 return 之前**不**额外打日志（避免和 sweeper 的 `hibernate-auto 成功` 重复）。
- **不要在 hot path（ptyManager.on output / status change）额外打日志**：本任务只在 close（一个 session 全生命周期一次）打日志，不引入日志风暴。

## 跳过外部模型会审的说明

按 CLAUDE.md：**小档**任务不调外部模型，由 Claude 单独写 plan。本任务定为小档，理由：
- 改动机械（加一个 reason 字符串参数 + 一处统一日志点 + 6 处 kill 调用补 reason）
- 无 UI / DB / 架构决策
- 无需在 A/B 路径间权衡

后续若执行中发现复杂度超预期，再回头调外部模型会审。

## 多模型 Plan 会审

跳过：本任务属于小档（6 处机械改动 + 无 UI/DB/架构决策），按 CLAUDE.md 规则不调外部模型。
