# hub 派给闲置 session · context

> 给 AI 自己看的执行边界与决策依据。大哥不审。

## 关键文件（本次改动边界）

### 修改（8 个文件，无新增 / 无删除）

**后端 5 个**：
| 文件 | 改动内容 |
|---|---|
| `packages/server/src/status.ts` | StatusManager 加 `statusChangedAt: Map<sid, number>` + `dispatchLocks: Set<sid>`；新增 `claimIdle(sid, opts) / releaseIdleClaim(sid)` 同步原子方法；`set()` 内部同步更新 statusChangedAt |
| `packages/server/src/pty-manager.ts` | 模块级 `lastInputAt: Map<sid, number>`；导出 `markUserInput(sid) / markProgrammaticInput(sid) / getLastInputAt(sid)` |
| `packages/server/src/ws-hub.ts` | 收到 client `input` 消息时调 `ptyManager.markUserInput(sid)` |
| `packages/server/src/routes/hub.ts` | 新增 `POST /api/hub/dispatch-to-idle-session` 端点（6 步流程 + 结构化错误） |
| `packages/server/src/mcp-hub/index.ts` | 新增 `dispatch_to_idle_session(sessionId, text)` MCP 工具 |

**前端 3 个**：
| 文件 | 改动内容 |
|---|---|
| `packages/web/src/types.ts` | 加 `DispatchToIdleSessionRequest / DispatchToIdleSessionResponse` |
| `packages/web/src/api.ts` | 加 `dispatchToIdleSession` 客户端 |
| `packages/web/src/components/hub/HubDispatchDialog.tsx` | 改造为单选两选项 + 候选 idle session 下拉 |

### 只读参考

- `packages/server/src/db.ts`（SessionStatus 类型定义、`getSession` API）
- `packages/server/src/routes/hub.ts` 现有 dispatch_to_project 端点（参考模式）
- `packages/server/src/mcp-hub/index.ts` 现有 6 工具（参考 schema 模式）
- `packages/web/src/components/hub/HubDispatchDialog.tsx` 现有 dispatch dialog 结构

### 白名单（tasks.json write_files）严格 8 个

```
packages/server/src/status.ts
packages/server/src/pty-manager.ts
packages/server/src/ws-hub.ts
packages/server/src/routes/hub.ts
packages/server/src/mcp-hub/index.ts
packages/web/src/types.ts
packages/web/src/api.ts
packages/web/src/components/hub/HubDispatchDialog.tsx
```

每步 verify 后 `git diff --name-only HEAD` 比对；越界回滚。

## 决策记录（吸收 Codex 14 条评审）

### D1：claimIdle 必须原子抢占（不能 read-then-write）

JS 单线程同步原子保证：在 `claimIdle()` 函数体内 read status → check 条件 → 写 status='working' + 加 lock，这一段不会被打断。其它代码看到的只有 before 或 after 两个状态。
**拒绝**纯"read status → write"分两步：中间可能有别的回调把 status 改了。

### D2：idle 持续 ≥ 800ms（Codex 第 4 点）

防 Claude `Stop` hook 异步滞后——hook 真正到 server 写状态有 100-300ms 抖动。设 800ms 安全边界。`claimIdle(sid, {minIdleAgeMs: 800})`。

### D3：最近 1s 人类输入拒绝（Codex 第 5 点）

`pty-manager.getLastInputAt(sid)` 距今 < 1000ms 拒绝。`lastInputAt` 是**内存 Map**（不是 DB 字段），更新鲜——DB 字段的 `last_input_at` 有 sweeper 周期延迟。

### D4：markUserInput vs markProgrammaticInput（Codex 第 7 点）

- **markUserInput(sid)**：仅 ws-hub 收到 client `input` 消息时调（人类输入）
- **markProgrammaticInput(sid)**：hub 派工后调（防下次 hub 派工立刻又派——给 hub 自己也算一次"最近输入"）
- 两者都更新同一个 `lastInputAt` Map（统一时间戳），代码侧靠**调用点**区分语义

**不要**在 ptyManager.write 内部自动调任意一个——`write` 是底层 API，调用方知道这是人类还是程序输入。

### D5：waiting_input + shell + hibernated 全禁止

- waiting_input：claude 等用户答 yes/no/选项；派工 = 替用户回答，可能触发危险动作（Codex 第 5 边界）
- shell：无 hook 驱动状态，永远不到 idle（Codex 第 4 边界）
- hibernated：PTY 已 kill，ptyManager.has() === false，自然拒（要先 wake + 重新等 idle）

### D6：初版只支持 claude（Codex 第 9 点）

codex 的 idle 是 CodexStatusDetector heuristic（3s 静默 + prompt 检测）不准；初版禁止 `agent !== 'claude'`。等真实使用验证 codex idle 准确性后开。

### D7：工具命名 dispatch_to_idle_session（Codex 第 13 点）

- **不**复用 `dispatch_to_project` 加 targetSessionId 可选参数（语义变模糊）
- **不**用 `send_to_session`（名字不暴露"必须 idle"前置条件）
- 用 `dispatch_to_idle_session`：名字本身告诉 hub claude"前置条件 = idle"

### D8：错误码体系（Codex 第 12 点）

| 触发条件 | HTTP code | error code |
|---|---|---|
| session 不存在 | 404 | `session_not_found` |
| agent !== 'claude' | 400 | `not_ai_session` |
| ptyManager.has === false | 400 | `no_live_pty` |
| status === 'waiting_input' | 400 | `waiting_input` |
| getLastInputAt 距今 < 1000ms | 400 | `recently_typed` |
| claimIdle 失败 status !== idle | 400 | `not_idle` |
| claimIdle 失败 idle 不够 800ms | 400 | `idle_too_fresh` |
| 已被别 claim 锁住 | 400 | `locked` |
| zod 校验失败 | 400 | `invalid_body` |
| PTY write 失败 | 500 | `pty_write_failed` |

MCP 工具失败把 HTTP 错误透传给 hub claude（结构化 `{code, message, retryable, details}`），让它能自我修复（如 `not_idle` → 改用 `dispatch_to_project` 新建）。

### D9：UI 默认仍新建（Codex 第 14 点）

HubDispatchDialog 单 dialog 两单选项 [○ 新建 session  ○ 派给已有空闲 session]，**默认新建**——降低误派概率。选已有时下拉只显示符合条件的 idle claude session（前端 idle 判断仅作提示，后端再做权威判断）。

### D10：文本剥控制字符（Codex 第 18 点）

```ts
const cleaned = text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')  // 保留 \t(\x09) \n(\x0a) \r(\x0d) 之外的 C0 控制字符 + DEL
```
末尾**只**追加单个 `\r`（不要多个，不要 \r\n 之类）。防 hub claude 自己注入终端控制序列搞鬼。

### D11：claim 不主动 timeout

`releaseIdleClaim` 仅在 PTY write 失败 / dispatch 流程主动调；正常成功路径**不释放 lock**——让 status 保持 'working'，等 Claude hook 重新驱动回 idle 自然解锁（hook 重新调 set 会清 statusChangedAt 但 lock 是独立 Set，需要在 hook 路径里也清）。

**实现**：statusManager 的 `set()` 内部检测如果新 status === 'idle' 自动从 dispatchLocks 移除（hook 驱动回 idle 时同步清 lock）。

## 依赖与约束

- **statusManager 现有 5 处 set 调用**：onSpawn / onData / onExit / handleClaudeHook (5 case) / handleCodexInternal。所有这些路径都要走 set，set 内部统一更新 statusChangedAt。改 set 不破坏既有调用。
- **ws-hub 现有 client `input` 处理**：在 case 'input' 分支末尾调 markUserInput；不影响既有 ptyManager.write 调用。
- **pty-manager.ts 既有 write API 不动**：markUserInput / markProgrammaticInput 是新独立函数，调用方自行决定时机。
- **MCP server SDK 已加载**（@modelcontextprotocol/sdk v1.29.0）——直接复用 registerTool 模式。
- **HubDispatchDialog 当前 props**：`{project: HubProject, onClose, onSuccess}` —— 不动签名，内部加单选 state + idle session 下拉。
- **store.sessions 包含 liveStatus**：前端可以 filter `s.projectId === target.id && s.agent === 'claude' && liveStatus[s.id] === 'idle'`。**但**：前端不知道 statusChangedAt + lastInputAt，所以前端只能近似展示——最终判断在后端。
- **未提交别任务草稿**：当前 git status 有 store / types / api 等已被前任务修过。本任务**再改**这些文件——每动一处先 Read 确认无冲突。

## "过度设计自检"清单

- [x] 不做用户没要的功能：没有"派工 timeout 自动 retry"、"hub 派工队列"等花活。
- [x] 不做只用一次的抽象：markUserInput / markProgrammaticInput 是 2 个调用点 1 个 Map，不抽 hook。
- [x] 不做没要求的灵活性：minIdleAgeMs 硬编码 800ms（plan 已说明依据 Codex 评审），不暴露配置。
- [x] 不写不可能场景的错误处理：JS 单线程不防多 server 进程并发（本仓库 server 是单进程）。
- [x] 行数估算：status.ts +50 / pty-manager.ts +20 / ws-hub.ts +5 / routes/hub.ts +80 / mcp-hub/index.ts +30 / types.ts +10 / api.ts +10 / HubDispatchDialog.tsx +60 = **~265 行新增**，对照 plan 估算合理。
- [x] 项目级 MCP 配置不动；hub-workspace .mcp.json 不动（mcp-bridge.injectHubMcps 已经覆盖）
- [x] 破坏性变更协议触发：新增 `dispatch_to_idle_session` 工具（MCP 工具变化对接现有 mcp-hub server）+ statusManager 加内部状态。但**没修改既有导出符号** —— 全 grep 确认无残留旧调用即可。
