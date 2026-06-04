# hub 派给闲置 session · plan

## 大哥摘要

现在 hub claude（总控台 AI 总指挥）派任务**只能在目标项目下新建一个 claude 终端**——你跑得越多，session tab 会堆得越多。这次让 hub claude 能**派给已经在跑的、当前空闲的 claude 终端**（claude 任务跑完等你下一句的状态叫"idle"），不必每次开新窗口。

**只在严格条件下才允许复用**（防止 hub claude 干扰你正在做的事）：
1. 目标必须是 **claude 终端**（不是 codex / 不是 shell）—— codex 的"空闲判断"目前还不够准，留下期再开
2. 目标必须**真的空闲超过 800 毫秒**（claude 任务跑完 + 没在等你回答 yes/no）
3. 目标**最近 1 秒内你没手动按过键**（防你跟 hub 同时按打架）
4. 同一时刻**只允许一个 hub 派工** 派给同一个 session（防并发）
5. **不能派给**：正在跑（running/working）/ 等待你回答（waiting_input）/ 休眠状态（hibernated）/ shell 终端

不满足任何一条 → hub claude 拿到结构化错误（如 `not_idle` / `recently_typed` / `waiting_input`），它会自己换新 session 派或告诉你"那个 session 现在不能派"。

**TOCTOU 风险说明**（你能感知的）：理论上你跟 hub claude 在毫秒级同时按键 / 派工**不能 100% 避免**——但加了这一连串约束后，常见竞态都能压住。万一真的撞车，最坏结果是 claude 看到你的输入和 hub 输入混在一起一行——claude 通常会自己 ignore 异常字符，不会引发数据损坏。

**验收方式**：
- 跟 hub claude 说"在 ExcelCon 起一个 claude 跑 ls" → 它派工 → ExcelCon 出现新 claude session（这是旧功能）
- 等那个 claude 跑完 ls 进入 idle → 跟 hub claude 说"在 ExcelCon 那个空闲的 claude 上跑 cat README.md"→ 它应该调**新工具** `dispatch_to_idle_session` 派进去 → 那个 claude 收到任务跑 → 不开新终端
- 测拒绝路径：试派给一个 running 状态的 session → hub claude 收到 `not_idle` 错误自己改派新 session

> 项目记忆扫描：`auto.md` 命中 2 条强相关 —— (1) "高频事件 (键盘/PTY 输出) 不要逐次记日志"——本任务 `lastInputAt` 内存 Map 不打日志；(2) "未提交核心文件先确认归属"——本任务会改 statusManager / pty-manager / store 等共享文件，每动一处先 Read 确认无冲突。`manual.md` 命中："大哥只关心大方向+验收"已落大哥摘要+ tester 按既定不派。第 2 期 D4 决策延后的工作终于在本期落地，但严格保留 Codex 评审的所有约束。

## 目标

1. **后端 StatusManager 新增 `claimIdle(sessionId, opts): {ok, code?, currentStatus?}` 原子抢占接口**：
   - 检查 status === 'idle' 且 statusChangedAt 距今 ≥ 800ms
   - 检查目标 session 不在 dispatchLocks 里
   - 原子操作：同步加 lock + 设 status='working'（抢占给 hub）+ 返回 ok:true
   - 失败时返回 `{ok:false, code: 'not_idle' | 'idle_too_fresh' | 'locked' | 'not_found', currentStatus}`
   - 释放 lock 由调用方在 PTY 写完后调 `releaseIdleClaim(sessionId)`
2. **后端 pty-manager 内存 `lastInputAt: Map<sessionId, number>`**：
   - listen ws-hub 的 client `input` 消息：每次 setter；用作 claim 时的"最近 1 秒人类输入"检查
   - **同时给 hub 派工写入也更新它**（防止下次 hub 派工立刻又派——Codex 第 7 点）
   - 暴露 `getLastInputAt(sid): number | undefined`
3. **后端新端点 `POST /api/hub/dispatch-to-idle-session`**：
   - body zod `{targetSessionId, text}`，text 长度 1-20000，**剥离控制字符**（防 hub claude 注入 ANSI 序列）
   - 流程：
     1. getSession(sid) → null → 404 `session_not_found`
     2. row.agent === 'claude' 否则 400 `not_ai_session`（codex 等真验证再开）
     3. ptyManager.has(sid) 否则 400 `no_live_pty`（hibernated / 已 kill）
     4. row.status === 'waiting_input' → 400 `waiting_input`（不替用户答 yes/no）
     5. pty-manager.getLastInputAt(sid) 距今 < 1000ms → 400 `recently_typed`
     6. statusManager.claimIdle(sid, ...) → 失败按 code 返 400
     7. ptyManager.write(sid, text + '\r')
     8. write 失败 → statusManager.releaseIdleClaim 回滚 status → 500
     9. write 成功 → 不释放 claim（让 status 保持 working，等 hook 重新驱动）→ 200 返 `{sessionId, status:'working'}`
   - 每步 serverLog 起止配对 scope=hub action=dispatch-to-idle
4. **MCP server 新工具 `dispatch_to_idle_session(sessionId, text)`**：
   - 调上面端点
   - 描述明确说"前置条件：目标必须是 claude 终端 + 已 idle 至少 800ms + 最近 1s 用户没输入"
   - 失败返结构化错误 hub claude 能自我修复（如 `not_idle` → hub 自己改用 `dispatch_to_project` 新建）
5. **前端 HubDispatchDialog 加"派给已有空闲 session"选项**：
   - 单 dialog 两单选项：[ ] 新建 session [ ] 派给已有空闲 session
   - 选已有时：从 store.sessions filter (projectId === target + agent === 'claude' + liveStatus === 'idle') 显示下拉
   - 下拉每项标注 "session 短码 / 上次活动时间"
   - 提交时仍以后端判断为准（前端 idle 标注是提示不是授权）
   - 默认仍**新建**（防误派）
6. **前端 api + types 加 dispatchToIdleSession 客户端** + 复用 HubDispatchRequest 类型扩展

### 验收标准（必须可在浏览器观察 / 命令可跑）

- **浏览器可见**：
  - 在某个 hub claude 终端里给 list_projects（旧）→ 4 项目；dispatch_to_project 给 ExcelCon 起 claude 跑 echo（旧）→ ExcelCon 多一个 claude session
  - 等那个 claude 跑完进 idle → 跟 hub claude 说 "在 ExcelCon 那个空闲的 claude 上跑 cat README.md" → hub claude 调 `dispatch_to_idle_session` → ExcelCon 那个 claude **不开新终端**，直接接收任务跑
  - HubDispatchDialog 上手动操作：选"派给已有空闲 session"→ 下拉只显示 claude idle session（不显示 shell / running / waiting_input 状态的）
- **拒绝路径**（curl 直测）：
  - `curl POST /api/hub/dispatch-to-idle-session` 派给 shell session → 400 `not_ai_session`
  - 派给 running session → 400 `not_idle`
  - 派给 waiting_input session → 400 `waiting_input`
  - 你手动按键后 0.5 秒内立刻派 → 400 `recently_typed`
  - 不存在的 sid → 404 `session_not_found`
  - hibernated session → 400 `no_live_pty`
  - 并发两次派给同一 session → 第二次 400 `locked`
- **操作日志**：dispatch-to-idle 起止配对，meta 含目标 sessionId / textLen / claim 是否抢占成功
- **类型 + 构建**：server build + web build 通过
- **MCP 工具数**：`tools/list` 返 **8 工具**（原 7 + dispatch_to_idle_session）
- **AI 自派 tester**：按既定不派，留大哥手验

## 非目标

- **不支持 codex**——Codex 评审第 9 点：codex 的 idle 判断是 3 秒静默 + prompt heuristic 弱，不准；初版只 claude；等大哥真用 codex 看到准确性后再开（独立小期）
- **不开放派给 waiting_input session**——claude 等用户答 yes/no 时派工会被当成回答，可能误激发危险动作
- **不开放派给 shell**——shell 没有 hook 驱动状态，永远不到 idle
- **不做 hub session 跨刷新存活**（B5 候选）/ **不做跨项目流水线**（B3 候选）/ **不做派工历史持久化**（B4 候选）
- **不开放破坏性 MCP 工具**（B6 候选）
- **不动**当前未提交别任务草稿文件（pyy-manager / status.ts / store.ts 等改动只动本任务相关行）

## 实施步骤

> 细化在 tasks.md / tasks.json。

1. **后端 statusManager 加 claimIdle / releaseIdleClaim + statusChangedAt 跟踪**
   - status.ts 内部 Map 加 `statusChangedAt: Map<sid, number>`，每次 `set()` 更新
   - 新增 `claimIdle(sid, opts: {minIdleAgeMs})` 同步方法：检查 status === 'idle' + age + lock 三条件，全过则 set status='working' + lock；返 {ok, code?, currentStatus, idleAge?}
   - 新增 `releaseIdleClaim(sid)` 同步方法：从 dispatchLocks 移除（不改 status——让 hook 重新驱动）
   - 模块级 `dispatchLocks: Set<string>`
   - **verify**：server build 通过；写一个 smoke 单测（如果项目允许）或后续步骤 4 的 curl 端到端测
2. **后端 pty-manager 加 lastInputAt 内存 Map + getter**
   - pty-manager.ts 新增 `const lastInputAt = new Map<sid, number>()`
   - 修改既有 `write(sid, data)` 暴露一个 `markUserInput(sid)` 给 ws-hub 收到 client input 时调（不要在 pty-manager.write 内部自动调，因为 hub 派工也走 write 会污染）
   - 顺便添加 `markProgrammaticInput(sid)` 给 hub 派工后调（更新 lastInputAt，防下次 hub 派工立刻又派）
   - 暴露 `getLastInputAt(sid): number | undefined`
   - ws-hub.ts 收到 client `input` 消息时调 markUserInput
   - **verify**：server build 通过；前端发 PTY input 后 server console 能看到 lastInputAt 更新（临时 log 调试，最后删）
3. **后端新端点 POST /api/hub/dispatch-to-idle-session**
   - routes/hub.ts 加端点，6 步流程严格按上面"目标 3"执行
   - 文本剥离控制字符：`text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')` 保留 \r\n\t 之外的控制字符
   - **verify**：build 通过；6 个 curl 拒绝路径全 400/404 + 1 个成功路径 200
4. **MCP server 加 dispatch_to_idle_session 工具**
   - mcp-hub/index.ts 注册新工具
   - 描述写明前置条件 + 失败时建议 hub claude 自己改用 dispatch_to_project
   - **verify**：build 通过；stdio JSON-RPC tools/list 返 8 工具
5. **前端 types + api + HubDispatchDialog 支持"派给已有 session"**
   - types.ts 加 `DispatchToIdleSessionRequest / Response`
   - api.ts 加 `dispatchToIdleSession`
   - HubDispatchDialog 改造：单选模式 + 候选 session 下拉
   - **verify**：build 通过；浏览器手测两条路径都能走通
6. **白名单 + grep + tester**
   - git diff 对照白名单
   - grep `dispatch_to_idle_session|claimIdle|markUserInput|markProgrammaticInput` 确认新增散布合理
   - tester 按既定不派，handoff 标手验

## 边界情况

- **claim 后 PTY write 失败**：必须 releaseIdleClaim 回滚 status（设 idle）+ 返 500，让 hub claude 知道重试
- **claim 后 PTY 真跑了但没写成功**：理论上不会（write 是同步 boolean），但若发生跟上面同样回滚
- **多 hub claude session 并发派给同一 session**：dispatchLocks 挡第二个
- **claim 持续时间**：claim 不主动 timeout——靠 PTY 写完后 hook 驱动 status 回 working/idle 自然解锁；如果 claude 永远没回应（卡死）—— lock 留着；用户可手动 stop session 解决
- **hub 自己派给 hub session**（递归）：理论可能但语义诡异；不做特殊处理（hub session 也是 claude，hub claude 可以派给自己的兄弟 hub session）
- **session 在 claim 抢占后被外部 kill**：claim 状态保留在 statusChangedAt 但 ptyManager.has() 已 false；下次 claim 会失败因为前面 has() 检查（流程第 3 步）
- **lastInputAt 跨 server 重启**：内存 Map 丢失；server 重启后立刻接到派工请求 lastInputAt 永远 undefined → 视为"很久没输入" → 允许。可接受（重启场景罕见）
- **text 含 \r\n 多行**：剥离控制字符函数保留 \r\n，多行能正常派工；末尾追加单个 \r 触发 readline submit

## 风险与注意

- **TOCTOU 数学上不能 100% 安全**（Codex 第 16 点）：claimIdle 是 JS 单线程同步原子，但用户敲 PTY 跟 hub 派工的相对时序在毫秒级仍可能撞车——只是常见竞态被锁挡住。**handoff 必须明说**这一条。
- **statusManager 现有结构改造**：加 statusChangedAt + dispatchLocks 是新内部状态，要确保 `set()` 路径覆盖到所有状态变化（onSpawn / onData / onExit / hook 系列都走 set）
- **markUserInput 触发点**：ws-hub.ts 收 client `input` 消息时调；但其它"用户输入"路径（如自定义按钮发 sendInput）也会经过 ws.sendInput → server → ptyManager.write，所以ws-hub 那个点能 cover 所有 client 来的输入
- **textPreview 不含 HUB_TOKEN**：操作日志 meta 只放 text.slice(0,80) 预览，绝不放 env / 系统变量
- **熔断**：同一步骤 verify 失败 2 次仍不过停手，把错误日志打印给大哥
- **未提交别任务草稿**：当前 git status 有大量 modified（store/types/api/index.ts/Workbench/ProjectsColumn 等被前任务修过）——本任务**会再改** store / types / api ——每改一处先 Read 全文确认无冲突

## 多模型 Plan 会审

> [Gemini 评审] 跳过：任务结构聚焦（PTY 状态机抢占 + 1 个端点 + 1 个 MCP 工具 + 1 个前端 dialog 改造），无跨多模块深度依赖追踪需求。
> [Codex 评审] 已完成（本轮对话中执行），关键采纳 14 条：(1) 必须 claimIdle 原子抢占不能 read-then-write；(2) idle 持续 ≥ 800ms 防 hook 抖动；(3) 拒绝最近 1s 人类输入；(4) hub 派工要更新 lastInputAt（用 markProgrammaticInput）；(5) waiting_input 必须禁止防"替用户答 yes/no"；(6) shell 禁止；(7) 初版只 claude（codex 状态判断弱留下期）；(8) 写失败回滚状态不能静默；(9) dispatchLocks 挡同 session 并发派工；(10) 错误返结构化（not_idle/waiting_input/recently_typed/not_ai_session/no_live_pty/locked/session_not_found）；(11) 工具名 dispatch_to_idle_session 暴露前置条件；(12) 不把 dispatch_to_project 加 targetSessionId 可选参数（语义变模糊）；(13) UI 单 dialog 两选项默认新建；(14) 文本剥控制字符 + 只追加单个 \r。本期方案全部 14 条落地。
> [Codex 综合主笔] 跳过：plan 已由 Claude 草拟完整六段并吸收 Codex 14 条评审 + 用户已通过"继续"接受 B1 方向。
> [Claude 白话化兜底] 检查项：(1) 大哥摘要 4 段白话 + 5 条严格约束清单（你能感知的）；(2) 全文术语括号翻译（idle / waiting_input / TOCTOU / claimIdle / lastInputAt / dispatchLocks 等）；(3) manual.md 偏好对齐：浏览器可观察验收 ✓、自派 tester（按既定不派）✓、只在 plan 后停一次 ✓；(4) 风险段明说 TOCTOU 不能 100% 安全 + 最坏结果是字符混合不损坏数据。
