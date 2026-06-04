# 操作日志规则与全量埋点 · plan

> memory 扫过：`dev/memory/auto.md` 与 `manual.md` 均无相关条目（仅一条 hook smoke 测试条，与本任务无关）。

## 目标

让"用户在 UI 上的每个可感知操作 + 该操作的反馈结果（成功/失败/耗时）"都能在侧栏 LogsView 里看到，并把"功能完成必须配套操作日志"作为硬性规则写进 `CLAUDE.md`，使所有后续任务自动受约束。

**可验证的验收标准**（每条都能在浏览器里现场点出来）：

1. **规则验收**：`CLAUDE.md` 新增「操作日志规则」一节；用 `grep -n "操作日志" CLAUDE.md` 至少 1 条命中；规则文本明确"什么算操作 / 必须记什么字段 / 验收方式"。
2. **机制验收 - 后端→前端日志桥**：在前端浏览器 Console 执行 `window.__vibe.testBackendLog()`，LogsView 5s 内出现 `scope=server-test` 的一条 INFO 日志（`window.__vibe` 是长期保留的 dev 命名空间，仅 `import.meta.env.DEV=true` 时挂载，prod build 不带）。
3. **机制验收 - 前端 logAction helper**：`logs.ts` 新增 `logAction(scope, action, fn)` 包装器；调用时 LogsView 出现"开始 → 成功/失败 + 耗时(ms)"两条配对日志。
4. **示范埋点验收**：以下 3 条高频路径在 LogsView 能看到完整"开始 → 成功/失败"配对：
   - **创建项目**：点「新建项目」对话框确认 → 出现 `scope=project action=create` 起止两条。
   - **启动会话**：StartSessionMenu 点任一 CLI 启动 → 出现 `scope=session action=start` 起止两条（注意：现有 `pushLog` 已有起点，要补"成功/失败"终点）。
   - **归档任务**：Dev Docs 侧栏点归档按钮 → 出现 `scope=docs action=archive` 起止两条 + 后端发来的"评审任务 enqueue"一条 INFO。
5. **后端 console 桥接**：`packages/server/src/index.ts` 启动时的 `console.log("VibeSpace backend ... listening")` 也能在 LogsView 出现一条 `scope=server` INFO（验证后端任意位置都能进 LogsView，不限于路由）。
6. **熔断验收**：人为构造一个失败（如停后端、点新建项目），LogsView 出现 ERROR 级条目，且 `meta` 里能看到 HTTP 状态/错误信息。
7. **落盘验收**：执行验收 1–6 后，`packages/server/data/logs/YYYY-MM-DD.log` 存在；`wc -l` ≥ 6；`tail -1` 是合法 JSON 且包含 `level/scope/msg/ts` 字段；前端 pushLog 产生的条目（如 `scope=project action=create`）也出现在该文件中（验证前端→后端 WS 上报回灌成功）。

## 非目标 (Non-Goals)

- **不在本轮全量回填**：本轮只覆盖 4 条示范路径（项目创建、会话启动、任务归档 + 后端启动）。其余路由/组件按规则补埋点的工作，**任务完成时一次性写进 `dev/issues.md` 列出待补清单**，由用户决定何时起独立 issue 派单处理。
- **不引入新日志依赖**：不上 pino/winston。沿用现有 `pushLog()` + WS `log` 消息类型 + Node `fs.appendFile`。
- **不做日志自动清理/滚动策略**：仅按天切文件，不删旧文件、不限单文件大小。本轮在 `dev/issues.md` 留一条"考虑日志保留策略"，由用户后续决定。
- **LogsView 不读历史磁盘日志**：仍只显示内存中 500 条；要看历史去翻 `packages/server/data/logs/`。
- **不改 AIkanban-stable**：由 `sync-to-stable.bat` 同步。
- **不动 LogsView 视觉/交互**：现有过滤/清空/自动滚动够用，不做 UI 重构。
- **不为内部重构/类型修复/文档改动添加日志**：规则只约束"用户可感知的功能"。
- **不记轮询/心跳/健康检查**：避免日志风暴。

## 实施步骤

1. **写规则 → `CLAUDE.md`**
   在 Dev Docs 三段式之外新增「操作日志规则」一节（位置：紧跟「执行时的硬性规则」之后，便于发现）。规则文本必须包含：
   - 适用范围：用户可感知的功能（新增/修改 UI 操作、新增 mutation API、修复影响用户行为的 bug）
   - 起止配对要求：每个"操作"都要有"开始"和"成功/失败"两条
   - 必填字段：`level / scope / msg`，能拿到就附 `projectId / sessionId / meta(耗时, 错误)`
   - 豁免清单：纯重构 / typo / 文档 / 类型修复 / 轮询/心跳/健康检查
   - 验收方式：tasks.md 的 verify 必须包含"在 LogsView 看到对应条目"
   - **verify**：`grep -n "操作日志" CLAUDE.md` 命中 ≥1；人工读一遍语义清晰。

2. **加 WS `log` 双向消息类型 → 前后端类型对齐**
   - 后端 `ws-hub.ts` 顶部注释补两行：
     - 上行（client→server，前端日志回灌后端落盘）`*     { type: 'log-from-client', level, scope, msg, projectId?, sessionId?, meta? }`
     - 下行（server→client，后端日志推到前端）`*     { type: 'log', level, scope, msg, projectId?, sessionId?, meta? }`
   - 前端 `web/src/types.ts::ServerMsg` 联合追加下行 `log`；`ClientMsg` 联合追加上行 `log-from-client`。
   - **verify**：`pnpm -F web tsc --noEmit` 与 `pnpm -F server tsc --noEmit` 全绿。

3. **后端日志入口 → 新增 `server/src/log-bus.ts`**
   导出三个东西：
   - `serverLog(level, scope, msg, extra?)`：服务端打日志的统一入口。内部做三件事：①`console.log/warn/error` 原样输出（保留运维可见）②通过 `wsHub.broadcast({ type: 'log', ... })` 推给所有连接的前端 ③异步追加到当日 JSONL（`fs.appendFile`，不 await，失败仅 console.warn 一次）
   - `persistClientLog(entry)`：接收前端通过 `log-from-client` 上报的条目，**只落盘、不再 broadcast**（避免循环）
   - `getLogFilePath(date?)`：返回 `packages/server/data/logs/YYYY-MM-DD.log`（沿用 `db.ts` 的 `data/` 目录约定，按 UTC 切日避免跨时区分歧）。首次写入时 `mkdirSync({ recursive: true })`。
   - **verify**：在 `index.ts` 启动后调用 `serverLog('info', 'server', 'VibeSpace backend ready')`；前端 LogsView 出现该条 + `data/logs/<today>.log` 出现一行 JSONL。

4. **前端 ws.ts 收发 `log` 消息**
   - 收 `case 'log'` → 透传 `pushLog`
   - 在 `logs.ts::pushLog` 内部追加：调用现有 ws 实例 `send({ type: 'log-from-client', ... })` 把当前条目回传后端落盘。**注意防循环**：从 ws case 'log' 进来的 pushLog 调用要打个标记跳过回传（最简实现：给 `pushLog` 加 `_fromServer?: boolean` 私参，回传时不带该参数，回灌时带）
   - **verify**：步骤 3 的启动日志能落到 LogsView；`data/logs/<today>.log` 也出现该条；前端主动 pushLog 一条（如点新建项目）后 grep 该文件命中。

5. **前端 logs.ts 新增 `logAction(scope, action, fn, ctx?)` 包装器 + dev 命名空间 `window.__vibe`**
   `logAction` 签名：`async function logAction<T>(scope: string, action: string, fn: () => Promise<T>, ctx?: { projectId?, sessionId?, meta? }): Promise<T>`
   行为：
   - 进入时 `pushLog({ level: 'info', scope, msg: \`${action} 开始\`, ...ctx })`
   - 成功 `pushLog({ level: 'info', scope, msg: \`${action} 成功 (${ms}ms)\`, ...ctx, meta: { ms, ...ctx?.meta } })`
   - 失败 `pushLog({ level: 'error', scope, msg: \`${action} 失败: ${err.message}\`, ...ctx, meta: { ms, error: { name, message, stack } } })` 然后 rethrow
   
   `window.__vibe` dev 命名空间（仅 `import.meta.env.DEV=true` 时挂载，`main.tsx` 开头一次性赋值）：
   ```ts
   window.__vibe = {
     pushLog,       // 手动塞一条日志
     logAction,     // 手动跑一次包装器
     testBackendLog, // 让后端发一条回来（通过 ws 发 { type: 'log-from-client' } 并附 'roundtrip': true 标记，后端收到后反向 broadcast 一条 server-test，仅这条特殊 case 允许 broadcast）
     clearLogs: () => useStore.getState().clearLogs(),
   }
   ```
   **prod build（`vite build`）会通过 DCE 自动去掉整段**。
   - **verify**：浏览器 Console 跑 `await window.__vibe.logAction('test', 'demo', () => new Promise(r => setTimeout(r, 200)))` 看到两条 + 耗时；prod build 后 `grep __vibe dist/assets/*.js` 无命中。

6. **示范埋点 ① 创建项目**
   - 找到 `NewProjectDialog.tsx` 提交回调，包 `logAction('project', 'create', async () => api.createProject(...), { meta: { name } })`
   - **verify**：浏览器点新建项目，LogsView 出现 `project create 开始 / 成功`。

7. **示范埋点 ② 启动会话**
   - `StartSessionMenu.tsx` 现有 `pushLog` 调用改造成 `logAction` 配对（成功路径补终点）。
   - **verify**：点启动 CLI，LogsView 出现 `session start 开始 / 成功(ms)`，失败时 `session start 失败: <错误>`。

8. **示范埋点 ③ 归档任务**
   - 找到 `DocsView.tsx` 归档按钮回调，包 `logAction('docs', 'archive', ...)`
   - 后端 `routes/docs.ts` 归档路由里调 `serverLog('info', 'docs', '归档评审 enqueue: <任务名>')`，让评审 enqueue 也可见
   - **verify**：点归档，LogsView 出现前端起止 + 后端 enqueue 三条。

9. **后端启动日志接入**
   - `index.ts` 启动完成处把 `console.log("VibeSpace backend ... listening")` 改为 `serverLog('info', 'server', 'backend listening', { url, port, version })`（保留 console 输出由 serverLog 内部承担）。
   - **verify**：刷新前端，LogsView 在初始连接后出现该条。

10. **类型检查 + 全链路冒烟**
    - 跑 `pnpm -F web tsc --noEmit && pnpm -F server tsc --noEmit`，全绿。
    - 启动后端 + 前端，依次执行验收 1–6。
    - **verify**：6 条验收全过。

11. **写"待补清单" → `dev/issues.md`**
    把"剩余应补操作日志的路径"逐条单行追加（每条 `- [ ] 给 X 加操作日志（文件 ...；上下文：...）`）。这是非目标的兑现：本轮不全量回填，但要把待办落到 issues 池里，避免遗忘。
    - **verify**：`dev/issues.md` 至少新增 5 条相关 `- [ ]` 行。

12. **handoff 摘要**
    最后一条任务勾选时，按 CLAUDE.md 第 144 行要求输出 ≤10 行交付摘要。

## 边界情况

- **WS 未连接时**：前端发起的操作日志走本地 `pushLog` 仍能进 LogsView；只是后端那一侧的反馈拿不到。`logAction` 不依赖 WS，纯本地调用，所以前端起止配对永远不丢。
- **后端 `serverLog` 在 wsHub 还没初始化时调用**（启动早期）：实现里要做 null 检查，没初始化就只走 console，不抛异常。
- **日志风暴**：`logAction` 是用户主动触发的 mutation 才用；轮询/订阅类操作由约定（规则文本）禁止用，机制层不强制阻挡——一旦发现某处误用，按 issues 修。
- **meta 含循环引用 / 超大对象**：`pushLog` 现状不做 sanitize，`JSON.stringify(meta)` 会抛；落盘也会抛。`log-bus.ts` 里 `fs.appendFile` 要 `try/catch`，失败 `console.warn` 一次（同一错误 code 限流，避免刷屏）。规则里写明"meta 必须可 JSON 序列化、≤2KB"作为调用方约束。
- **日志文件无限增长**：本轮不做清理；issues 留一条"考虑日志保留策略（按天切已做，缺清理）"。
- **跨日切换**：`getLogFilePath()` 每次调用都重新计算当日文件名，不缓存 handle，避免跨日写进昨天的文件。性能足够（appendFile 本身是一次 open+write+close）。
- **同一操作被并发触发**（用户连点）：每次 `logAction` 都是独立的起止对，会在 LogsView 看到多组——这是期望行为，不是 bug。
- **错误对象的序列化**：`Error` 实例 `JSON.stringify` 后丢 message/stack。`logAction` 失败分支要手动展开 `{ name, message, stack? }`。

## 风险与注意

- **规则一旦写进 CLAUDE.md 就约束所有后续任务**：要把"豁免清单"写得足够清楚，否则以后改个 typo 都得加日志，规则会被绕过变废纸。豁免清单已在步骤 1 列出。
- **后端 `serverLog` 等于给所有路由埋了广播能力**：被滥用会刷屏。靠规则文本约束 + code review，机制不做硬限。
- **`window.__vibe` 是长期 dev 工具**：生命周期与项目一致，不删。prod 隔离靠 `import.meta.env.DEV` 守卫 + Vite tree-shaking，验收 5 最后一步会 `grep dist` 确认。
- **示范埋点选的 3 条路径假设**：`NewProjectDialog`、`StartSessionMenu`、`DocsView` 归档按钮——前两个已确认存在（`grep` 见过），第三个需要进 context 阶段时确认归档按钮在 `DocsView` 里。如果不在，换成等价路径。
- **AIkanban-stable**：本轮完全不动；同步策略由用户用 `sync-to-stable.bat` 自行决定时机。
- **PR 边界**：本轮 diff 应该集中在 `CLAUDE.md` + `web/src/{types,logs,ws}.ts` + `server/src/{log-bus,index,ws-hub,routes/docs}.ts` + 3 个示范组件 + `dev/issues.md`。任何溢出都要回 plan/context 补。
