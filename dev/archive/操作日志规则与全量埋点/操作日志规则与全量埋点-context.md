# 操作日志规则与全量埋点 · context

## 关键文件

> 原则：本轮改动**只出现在下面列出的文件**。溢出先回 plan/context 补，不要偷偷改。

### 规则文档（1 个）

- `CLAUDE.md` — 在「执行时的硬性规则」节之后追加「操作日志规则」整节。大约在第 110 行之后插入。

### 前端（6 个文件）

- `packages/web/src/types.ts:94-116` — `ClientMsg` 联合追加 `| { type: 'log-from-client'; level; scope; msg; projectId?; sessionId?; meta? }`；`ServerMsg` 联合追加 `| { type: 'log'; level; scope; msg; projectId?; sessionId?; meta? }`。
- `packages/web/src/logs.ts` — 当前 20 行，扩成：
  - `pushLog` 内部加 `_fromServer?: boolean` 私参，默认未传 → 通过 ws 回传 `{ type: 'log-from-client', ... }`；传了 → 跳过回传
  - 新增 `logAction<T>(scope, action, fn, ctx?)`
  - 导出 `testBackendLog()`（向 ws 发 `log-from-client` 并带 `roundtrip: true` meta 标记，让后端反向 broadcast 一条，用于验收）
- `packages/web/src/ws.ts` — 
  - `message` 分发加 `case 'log'`：调 `pushLog({ ...msg, _fromServer: true })`
  - 导出一个 `sendClientLog(entry)` 给 `logs.ts` 调（避免 `logs.ts` 直接持有 ws 实例导致循环依赖）
- `packages/web/src/main.tsx` — 文件顶部/`createRoot` 之前：
  ```ts
  if (import.meta.env.DEV) {
    const { pushLog, logAction, testBackendLog } = await import('./logs')
    ;(window as any).__vibe = { pushLog, logAction, testBackendLog, clearLogs: () => useStore.getState().clearLogs() }
  }
  ```
- `packages/web/src/components/NewProjectDialog.tsx:30` — `api.createProject(...)` 调用外包 `logAction('project', 'create', async () => { ... }, { meta: { name } })`。
- `packages/web/src/components/StartSessionMenu.tsx` — 当前已有 4 处 `pushLog`（line 91, 107, 128, 139），改造为 1 次 `logAction('session', 'start', ...)` 调用，配对覆盖"开始/成功/失败"。保留原有的用户可见报错 toast。
- `packages/web/src/components/sidebar/DocsView.tsx:232-248` — `await archiveDocsTask(projectId, task)` 外包 `logAction('docs', 'archive', ...)`。

### 后端（4 个文件）

- `packages/server/src/log-bus.ts` — **新文件**。导出：
  - `serverLog(level, scope, msg, extra?)` — 原样 `console.*` + `wsHub.broadcast({ type: 'log', ... })` + `appendJsonl(entry)`
  - `persistClientLog(entry)` — 只 `appendJsonl`，**不** broadcast
  - `handleClientLogRoundtrip(entry)` — 当 `entry.meta?.roundtrip === true` 时，反向 `wsHub.broadcast` 一条 `scope=server-test` 的 log（仅用于 `testBackendLog` 验收）
  - 内部实现：`getLogFilePath()` 返回 `data/logs/YYYY-MM-DD.log`（UTC 切日）；`appendJsonl` 做 `mkdirSync({ recursive: true })` + `fs.appendFile` + try/catch（失败仅首次 console.warn）
- `packages/server/src/ws-hub.ts` — 
  - 顶部注释追加两种消息类型
  - 导出 `broadcast(msg)` 给 `log-bus.ts` 调（当前只有内部 `safeSend` 按 sub 发，需补一个无过滤广播）
  - 收消息 switch 加 `case 'log-from-client'`：路由到 `persistClientLog` + 按需 `handleClientLogRoundtrip`
- `packages/server/src/routes/docs.ts:114-130` — 归档路由内 `kickoffArchiveReview` 调用前后加：
  - 前：`serverLog('info', 'docs', \`归档评审 enqueue: ${taskName}\`, { project: proj.id })`
  - 失败（catch 块）：`serverLog('error', 'docs', \`归档失败: ${err.message}\`, { project: proj.id, taskName })`
- `packages/server/src/index.ts:155-157` — 把 `console.log("VibeSpace backend ... listening")` 改为 `serverLog('info', 'server', 'backend listening', { url, port, version: SERVER_VERSION })`。**db/projects.json 两行路径打印保留 console.log**（启动脚本友好输出，不需要进 LogsView）。

### 收尾（1 个文件）

- `dev/issues.md` — 追加若干 `- [ ] 给 <模块> 加操作日志（文件 ...；上下文：...）` 单行条目，覆盖未在本轮埋点的用户可感知操作（至少：删项目、重命名项目、切换会话 CLI、停止会话、Dev Docs 派单、fs 写文件、paste-image、hook 安装）。

## 决策记录

### D1 · logAction 埋在 **UI 回调层**，不埋在 store action 或 api 层

- 选 UI 回调层（NewProjectDialog 的 submit、DocsView 的 handleArchive、StartSessionMenu 的启动按钮）
- 反对意见：埋在 store action 里"所有调用点免费获得日志、不会漏埋"
- 采纳的权衡：store action 有些是被动触发（hydrate、useEffect 同步、WS 回调），埋在那里会把非用户操作也记成"用户操作"，污染 LogsView；UI 层埋虽漏埋靠 review 兜底，但语义更准——规则文本已约束"新增 UI 功能必须埋"
- **资深工程师会不会觉得过度设计？** 不会。这是最接近"哪里产生的业务事件就在哪里记"的朴素做法

### D2 · 前端 `pushLog` **自动回传**所有条目到后端落盘，而不是只 logAction 回传

- 选自动回传（`pushLog` 内部默认行为）
- 理由：用户明确要"落盘持久化"；如果只 logAction 回传，任何直接调用 `pushLog` 的点都要调用方记得加标记，将来必定漏埋
- 反对：所有 pushLog 都回传会把"开始/成功/失败"三条都写盘，文件快速变大
- 采纳的权衡：三条一组、一个操作 ~300 字节 JSONL，一天就算 1000 次操作也只有 300KB；按天切文件 + issues 留"清理策略"待办，够用
- 防循环：`_fromServer` 私参方案已验证可行——ws 收到 server→client 的 log 时调 `pushLog({ ...msg, _fromServer: true })`，该条不再回传
- **资深工程师视角**：防循环是唯一需要警惕的坑，方案最小；不过度

### D3 · 日志格式 **JSONL**，不用 SQLite 表

- 选 JSONL（`{"id":..,"ts":..,"level":..,"scope":..,"msg":..,...}\n`）
- 理由：运维能直接 `tail -f` / `grep` / `jq`；append 零冲突；无依赖；出事故后捞日志不需要 sqlite CLI
- 反对：查询慢、没索引
- 采纳：LogsView 不从磁盘读历史（显式 plan 非目标），磁盘日志只为事后翻看；慢查询不是使用场景
- **过度设计？** 反向：JSONL 是最朴素形态，比 SQLite 更简

### D4 · 按 **UTC** 切日

- 选 UTC（`YYYY-MM-DD` 按 `new Date().toISOString().slice(0,10)`）
- 理由：跨时区调试/协作时文件名语义一致；服务器可能跑在任何时区
- 反对：本地用户晚上 10 点后看到的日志会在"明天"的文件里，困惑
- 采纳：AIkanban 是本地工具为主，但 `CLAUDE.md` 的规则本身是产品级的；UTC 更工程化。若用户觉得别扭，后续起 issue 改本地时区一行代码即可
- **不过度设计**

### D5 · `window.__vibe` 挂在 **main.tsx**，动态 import logs

- 选 main.tsx（应用单一入口，保证只挂一次）
- 动态 `await import('./logs')` 避免把 logs.ts 拖进 main 的同步依赖图
- prod 隔离：`import.meta.env.DEV` 条件 + Vite tree-shaking 双保险
- **不过度**：就 5 行

### D6 · 落盘路径沿用 **`packages/server/data/logs/`**

- 选 `packages/server/data/logs/YYYY-MM-DD.log`
- 理由：`db.ts` 已用 `packages/server/data/` 放 sqlite 和 projects.json；`.gitignore` 已整目录忽略 + `*.log` 也忽略（双保险）
- 反对：应该用 OS 标准位置（`~/.local/share/vibespace/logs/`）
- 采纳：现有约定就是项目内 `data/`，不为一条日志单独破坏一致性；用户要迁移到标准位置另起 issue
- **不过度**

## 依赖与约束

### TypeScript
- `web` 和 `server` 两个 workspace 都 strict；`ServerMsg` / `ClientMsg` 是 discriminated union，新增 case 必须两端同步改、两端 `tsc --noEmit` 全绿
- 每完成一个改动步骤跑 `pnpm -F web tsc --noEmit && pnpm -F server tsc --noEmit`，不要积压到最后

### WebSocket
- 后端用 `ws` 库 + Fastify；现有 `safeSend(socket, JSON.stringify(...))` 模式复用，不要引入新封装
- `wsHub.broadcast(msg)` 是本次要补的一个方法；确认要广播给所有连接，不按 sessionId 过滤（LogsView 是全局视图）
- 前端 ws.ts 的 `sendClientLog` 要容忍 ws 未连接：`readyState !== OPEN` 时静默丢弃，不要排队（避免断连后重连时日志风暴）

### 文件系统
- `fs.promises.appendFile`，换行符统一 `\n`（JSONL 规范；Windows 也用 `\n`，不用 `\r\n`）
- 日志目录首次写入前 `mkdirSync({ recursive: true })`
- 不做 fsync / fdatasync；进程崩溃最后几条丢失可接受

### 兼容性
- **AIkanban-stable 完全不动**，由用户后续用 `sync-to-stable.bat` 同步
- 现有 4 处 `pushLog` 调用（git / installer / StartSessionMenu / store）语义保持向后兼容——`pushLog` 签名只扩展，不删字段

### 性能
- 每次 `pushLog` 触发一次 WS send + 一次 fs.appendFile。单次 <1ms，不影响 UI
- LogsView 500 条内存上限不动
- 不做日志批量 / 节流 / 背压，YAGNI

### 规则边界（CLAUDE.md 新增节）
豁免清单必须写清楚，否则规则会被绕过变废纸：
- **必须埋**：新增 UI 操作、新增 mutation API、修复影响用户行为的 bug
- **豁免**：纯重构、typo、文档、类型修复、内部工具函数、轮询/心跳/健康检查、测试代码

## 不动的边界（再强调）

- 不动 LogsView 的视觉 / 过滤 / 清空逻辑
- 不动 store.ts 里现有 pushLog 调用点的语义（只在 `pushLog` 内部加自动回传）
- 不引入 pino / winston / log4js 等日志库
- 不做日志检索 UI / 日志导出按钮 / 日志清理定时器
- 不动 AIkanban-stable
