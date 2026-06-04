# 总控台第一期 · plan

## 大哥摘要

打开 VibeSpace 之后，你能在项目列表最顶部看到一个**「📊 总控台」入口**（不是项目，是个特殊页面）。点它会切到**总控台主页**——一张大看板，每个项目一张折叠卡，**一眼看完所有项目的状态**：每个项目下面跑着哪些 AI 终端、各占多少内存、最近活动时间。

每张卡片上有按钮：「**打开**」（一键跳到那个项目的工作区）、「**+ 新建 session 并派任务**」（弹个框输入指令，VibeSpace 自动在那个项目下起一个新 claude/codex/shell 跑这段指令）、「**停所有**」（杀掉该项目所有正在跑的 session，二次确认防误触）。

本期**只做"看 + 手点按钮派工"**——你做总指挥，UI 听你的。**第 2 期**才让总控台**自己**也开一个 AI 终端，让它能自动跨项目调度（这一期不做，但接口设计会留好接口）。

**验收方式**：进 VibeSpace → 项目列表第一个看到 📊 总控台 → 点它 → 看到所有 4 个项目的大看板 → 展开 ExcelCon → 看到它下面的 alive AI session → 在某个项目卡点「+ 新建 session 并派任务」 → 输入"列一下当前目录文件" + 选 shell → 那个项目下自动新建 session 在跑这条命令 → 切回该项目能看到这个新 session tab。

> 项目记忆扫描：`auto.md` 命中 5 条强相关 —— (1) "项目级 MCP 配置幂等保留已有 server" / (2) "可选增强注入失败不阻塞主流程但要操作日志记录" / (3) "Dev Docs 关键文件边界要对照 changed files" / (4) "未提交的核心文件先确认归属再决定继续/拆/暂停" / (5) "合并删除 API 前必须全仓库搜索调用点"——本任务全部遵循。`manual.md` 命中 3 条 —— (1) 小功能直接改不走流程（本任务**不是**小功能，走完整流程）/ (2) 大哥只关心大方向 + 验收，技术 AI 自决 + 术语括号翻译（已落 plan）/ (3) 完成时如有可浏览器验收项 AI 自派 tester。`ARCHITECTURE.md` 命中 §2.1 Fastify 路由模板、§3.1 操作日志、§3.4 前端 mutation 写法、§4 关键文件索引——本任务全部按既有模板编写。

## 目标

1. **前端新增"视图状态"概念**：在 store 加 `selectedView: 'project' | 'hub'`（默认 `'project'`，跟现有 `selectedProjectId` 解耦）。Workbench 渲染时 `selectedView === 'hub'` 走 HubView 分支，否则保持现有行为。
2. **ProjectsColumn 顶部固定 📊 总控台入口**（前端纯 UI，**不进 `projects.json`、不进后端项目列表**，所有 21 个现有按 projectId 查项目的路由完全不动）。
3. **新增后端 `routes/hub.ts`**，暴露 3 个接口：
   - `GET /api/hub/status`：一次性轻数据聚合——`{projects: [{id, name, path, aliveSessionCount, sessions: [{id, agent, status, startedAt, lastActivityAt, memBytes}], totalMemBytes, lastActivityAt}]}`，首屏快。
   - `GET /api/hub/projects/:id/detail`：按需重数据——`{gitDirty: {modified, added, deleted, untracked}, devActiveTask?: {name, totalSteps, doneSteps}, errorCount24h}`。只在用户展开某项目卡时拉，背景每 30-60s 慢刷一次（只刷已展开的）。
   - `POST /api/hub/dispatch`：body `{targetProjectId, agent, text}` → 在目标项目下新建 session（cwd = 该项目 path）+ 把 `text` 作为首句发给该 session → 返回 `{sessionId}`。**仅支持"新建 session 并派任务"**——不支持派给已有 session（Codex 评审：PTY 状态未知会破坏目标 session 当前 prompt，需要 session 状态机才能稳，留待第 2 期）。
4. **新增 `HubView.tsx`**：左半看板（项目折叠卡 + session 列表 + 按钮）、右半第 1 期空着（占位"第 2 期 hub session 在这里跑"）。
5. **接口签名按"未来 MCP 工具可直接调"设计**：参数明确、后端 zod 校验、操作日志完整起止配对。

### 验收标准（必须可在浏览器观察 / 命令可跑）

- **浏览器可见**（大哥就靠这条）：
  - 项目列表最顶部有 📊 总控台入口（带特殊图标区分，不是普通项目卡的样式）。
  - 点它 → 主区切到 HubView（不是终端 / 文件编辑器），看板列出所有 4 个真实项目。
  - 每张项目卡顶栏显示：项目名 + 路径 + alive AI session 数（如 `🟢 2/2`） + 总内存（如 `1.5 GB`） + 最近活动（如 `5 分钟前`）。
  - 点项目卡展开 → 看到该项目下每个 session 一行：session id 短码 + agent + 状态 + 内存 + 启动时间。
  - 项目卡按钮区：「打开」「+ 新建 session 并派任务」「停所有」；session 行按钮：「打开」「停」。
  - 「打开」=切换到 selectedView='project' + selectedProjectId=该项目 → 主区切回常规工作区。
  - 「+ 新建 session 并派任务」点击 → 弹对话框（agent 下拉默认 claude / 文本输入框）→ 提交 → 该项目下出现新 session tab，首句已发送 → LogsView 看到 `scope=hub action=dispatch 成功` 日志。
  - 「停所有」「停」二次确认后 kill session（复用现有 `/api/sessions/:id` DELETE）。
  - HubView 实时数据：session 状态/内存变化自动反映（复用现有 WS 推送），不需要刷新页面。
  - 展开某项目卡 → 30-60s 内重数据（git dirty / dev active 任务进度）出现；折叠后不再刷新。
  - 项目被删除（外部 git rm 或在常规界面删项目）→ 看板自动移除该卡。
- **操作日志**（LogsView 可见）：
  - `GET /api/hub/status` 不打日志（高频读豁免）。
  - `GET /api/hub/projects/:id/detail` 不打日志（同上）。
  - `POST /api/hub/dispatch` → 起止配对：`scope=hub action=dispatch 开始` / `成功 (Nms) meta:{targetProjectId, agent, sessionId}` / 失败 `失败: <reason>`。
  - 前端「停所有」/「停」批量操作 → 用 `logAction('hub', 'stop-sessions', ...)` 包，meta 含 sessionIds。
- **类型检查 + 构建**：`pnpm --filter @aimon/web build` 通过；`pnpm --filter @aimon/server build`（如有该脚本）通过；否则跑现有 smoke `pnpm smoke:server` 通过。
- **AI 自派 tester**：完成后自派 `vibespace-browser-tester` 跑上述浏览器验收清单（如果 browser-use MCP 这次可用），有问题汇总；不可用则在 handoff 明说留大哥手验（同上次任务的处理）。

## 非目标

- **不做"派任务给已有 session"**——按 Codex 评审，PTY 状态未知（idle / running / TUI 全屏 / 等输入）会破坏目标 session 当前 prompt，需要 session 状态机才能稳，留待第 2 期。本期只支持"新建 session 并派任务"。
- **不做第 2 期 hub session（hub 自己跑 claude 调度别人）**——本期 HubView 右半留占位，第 2 期再做 MCP server + 内嵌 SessionView。
- **不动 `projects.json` / SQLite projects 表 / 任何现有项目级 API**——hub 不是项目，纯前端视图状态。
- **不做"hub 设置"**——hub 没有可配置项；hub 不能删 / 不能改 path（前端无相关按钮、后端无对应路由，物理上做不到）。
- **不做跨项目权限模型**——hub 不绕过 per-project 权限；调度时复用既有 `createSession` 流程，自然继承目标项目的权限配置。
- **不引入新的状态管理库 / 新的数据查询库**——HubView 用现有 zustand store + REST API + WS 订阅，跟项目内现有数据模式一致。
- **不动当前 git status 里的别任务草稿**：`packages/server/src/index.ts` / `process-mem-service.ts` / `main.tsx` / `store.ts` / `types.ts` / `ProjectsColumn.tsx` 等 5+ 个未提交文件**已含别任务改动**。本任务会改 store / types / ProjectsColumn / index.ts，**叠加在现有改动之上**——执行阶段每改一处都用 grep + git diff 单文件对照确认只动了本任务相关行。

## 实施步骤

> **细化在 tasks.md / tasks.json；这里只写粗粒度顺序与各步骤的 verify 抓手。**

1. **后端：新增 `packages/server/src/routes/hub.ts`**
   - 3 个端点：`GET /api/hub/status` / `GET /api/hub/projects/:id/detail` / `POST /api/hub/dispatch`
   - 数据来源都现成：`db.listProjects()` / `ptyManager.listAlive()` / `db.getSession(sid)` / `ptyManager.getPid(sid)` / `process-mem-service` 暴露的 `byProject` 缓存 / `git-service` / `docs-service`
   - dispatch 调用既有 `createSession()` + 内部 `writeInput(sid, text + '\r')`，**不绕过现有 session 创建逻辑**
   - zod 校验所有 POST body；操作日志 `serverLog('info', 'hub', '<action> 开始/成功/失败', {...})`
   - **verify**：`packages/server/src/index.ts` 注册 `registerHubRoutes` 后启动 server，`curl http://127.0.0.1:9787/api/hub/status` 返回非空 projects 数组，每个项目带 sessions 字段。
2. **后端注册 + 前端 API client**
   - `index.ts` 加 `await registerHubRoutes(app)` 一行（与现有 21 个 register* 并列）
   - `packages/web/src/api.ts` 加 `getHubStatus()` / `getHubProjectDetail(id)` / `hubDispatch({targetProjectId, agent, text})`
   - `packages/web/src/types.ts` 加 `HubStatus / HubProject / HubSession / HubProjectDetail / HubDispatchRequest / HubDispatchResponse` 类型
   - **verify**：build 通过。
3. **前端 store 加 `selectedView` 状态**
   - `store.ts` 新字段 `selectedView: 'project' | 'hub'`（默认 `'project'`，从 localStorage 恢复——key `aimon_selected_view_v1`）
   - setter `setSelectedView(view)`；选项目时（既有 `selectProject` action）顺便 reset 到 `'project'`
   - **verify**：build 通过；浏览器手测刷新页面后 selectedView 恢复。
4. **前端 ProjectsColumn 顶部加 📊 总控台入口**
   - 渲染在项目列表 `<div>` 第一个，独立样式（圆角徽章 + 不同图标）
   - 点击 → `setSelectedView('hub')`（不动 selectedProjectId）
   - 高亮逻辑：`selectedView === 'hub'` 时高亮总控台入口；否则按现有 `selectedProjectId === p.id` 高亮项目
   - **不**响应右键菜单（项目级的右键管理操作如重命名/删除）—— 总控台不是项目
   - **verify**：build 通过；浏览器看到入口在第一位、点击能切到 HubView（第 5 步做完后）。
5. **前端 Workbench 分支渲染**
   - `Workbench.tsx` 现状是固定渲染主区组件；改为 `selectedView === 'hub' ? <HubView /> : <现有主区>`
   - **verify**：build 通过；点总控台入口主区切到 HubView 占位；切回项目主区恢复。
6. **HubView 主组件 + 项目卡 + 派工对话框**
   - 新增目录 `packages/web/src/components/hub/`
   - 文件：`HubView.tsx`（顶层布局：左看板 + 右占位）、`HubProjectCard.tsx`（折叠卡 + session 列表 + 按钮区）、`HubDispatchDialog.tsx`（弹框：agent 下拉 + 文本框 + 提交）
   - HubView mount 时 `getHubStatus()` 拉一次；订阅 store.sessions + store.memByProject 变化 → 增量重渲染（不再拉接口）
   - 展开项目卡时 `getHubProjectDetail(id)`，30s setInterval 慢刷；折叠时清 interval
   - 按钮接 `logAction('hub', '...', ...)`
   - **verify**：build 通过；浏览器走一遍完整流程（打开 hub → 看板 → 展开项目 → 新建 session 并派任务 → 切回该项目看到新 session）。
7. **白名单 + grep + tester**
   - `git diff --name-only HEAD` 列出本任务实际改动文件，跟本 plan 写下的 write_files 白名单对照——多/少都要解释
   - 派 `vibespace-browser-tester`（如可用）；不可用则在 handoff 标"留大哥手验"
   - **verify**：白名单一致 + tester PASS（或 tester SKIP + handoff 标注）

## 边界情况

- **`selectedView === 'hub'` 且无任何真实项目**（首次启动）：看板显示"还没有项目，点左下角「+ 新建项目」开始"占位。
- **某项目所有 session 都 dead**（aliveSessionCount=0）：项目卡仍显示但内存=0、状态徽章显灰，展开后 session 列表为空 + 提示"该项目暂无 alive AI 终端"。
- **dispatch 时目标项目刚被删**：后端 `getProject(targetProjectId)` 返回 null → 400 `{error: 'project_not_found'}`，前端弹 toast 提示。
- **dispatch agent 不在合法值列表**：zod 校验拦截，400 `{error: 'invalid_agent'}`。
- **dispatch text 为空字符串**：zod 校验拦截（min length 1），400 `{error: 'invalid_text'}`。
- **前端 HubView 切走时（用户点别的项目）**：清掉所有项目卡的 detail 轮询 interval，避免后台浪费。
- **WS 断线**：HubView 复用现有 store ws 重连逻辑，断线时显示"实时数据可能不是最新"提示，重连后自动刷新。
- **多 tab 同时开 hub**：所有 tab 独立拉数据 + 独立订阅 WS，互不干扰（hub 第 1 期无写入式跨 tab 状态）。
- **重数据接口失败**（git 命令超时 / docs 文件损坏）：detail 接口返回部分字段为 null，前端容错渲染"暂无数据"，不影响轻数据看板主体。
- **项目卡展开/折叠状态**：仅前端 React state，刷新页面后回到全部折叠（不持久化——第 1 期 YAGNI）。

## 风险与注意

- **未提交改动叠加风险**：当前 git status 显示 `packages/server/src/index.ts` / `packages/web/src/store.ts` / `types.ts` / `ProjectsColumn.tsx` / `main.tsx` 等已被别任务草稿改过。**本任务也会改这几个**，需要在执行阶段每改一处都用 grep 检查既有改动是不是跟本任务无关——无关就保留、有关就合并、冲突就停下来回 plan 拆任务。auto.md 2026-05-02 / 项目切换卡顿优化那条经验直接命中。
- **dispatch 副作用大**：会创建真实 PTY 进程 + 写入 SQLite + 触发现有 createSession 的所有 hook（包括项目级 MCP 注入等）。要复用既有 `createSession` 完整流程，**不**自己实现简化版——auto.md 2026-05-01 "合并删除 API 前必须全仓库搜索调用点"反向也成立。
- **MCP 接口前瞻性**：第 2 期 MCP server 会通过 HTTP 调这 3 个端点。本期接口参数/返回必须**自完备**（不依赖前端会话状态、所有必要信息进 body）——这是 Codex 评审第 24 点。
- **总控台入口不能被误当项目**：右键菜单 / 删除 / 重命名 / settings drawer 这些项目级动作必须**对总控台入口无效**——前端 onContextMenu 跳过、设置抽屉触发器隐藏。
- **看板首屏性能**：项目数 ≥ 20 时一次性聚合可能慢。第 1 期暂不优化（manual.md "不做没要求的灵活性"），但接口要支持后续加 `?fields=light|heavy` 参数（本期不实现，但 schema 留空间）。
- **破坏性变更协议**：本任务**新增** `selectedView` store 字段（不破坏既有 `selectedProjectId`），**新增** 3 个后端路由（不改既有），**修改** `Workbench.tsx` 主区分支（但保留默认走 project 分支）。**不**触发 CLAUDE.md "破坏性变更协议"。
- **熔断**：同一步骤 verify 失败 2 次仍不过停手，把错误日志、试过的方案、当前疑惑打印给大哥。

## 多模型 Plan 会审

> [Gemini 评审] 跳过：任务结构聚焦（新增独立路由 + 新增独立视图组件 + 单一 store 字段），无跨多模块深度依赖追踪需求，Gemini 长上下文边际收益低。
> [Codex 评审] 已完成（本次方案对话中执行），关键采纳 11 条：(1) hub 不是项目，做成 `selectedView='hub'` 视图状态而非 `selectedProjectId='__hub__'`，避免污染 21 个现有 projectId 查询路由；(2) 不进 projects.json、不进后端项目列表；(3) `/api/hub/status` 只聚合轻数据，重数据按需 + 慢刷；(4) 实时刷新走现有 WS（sessions/mem-stats），不要 streaming；(5) 第 1 期**不**做派任务给已有 session（PTY 状态未知会破坏目标），只支持新建 session 并派任务；(6) 接口签名按"未来 MCP 工具可直接调"设计；(7) 跨项目权限不绕过 per-project 权限（复用 createSession 自然继承）；(8) 项目被删时自动移除看板卡；(9) hub session 崩溃不自动重启（第 2 期）；(10) 多 tab 看板独立无冲突；(11) 第 1 期不写 MCP server 但接口前瞻设计。本期方案以上 11 条全部落 plan。
> [Codex 综合主笔] 跳过：plan 已由 Claude 草拟完整六段并吸收 Codex 11 条评审。本任务量级 + 大哥已通过"继续"接受修正方案的信号下，再走综合主笔属于过度流程（参见 manual.md 2026-04-24 "小功能直接改"偏好的扩展精神）。
> [Claude 白话化兜底] 检查项：(1) 大哥摘要 3-5 行白话、术语括号翻译保留（PTY / MCP / cwd / 派工 / 看板 / 视图状态）；(2) 全文术语括号翻译保留（zod 校验 / setInterval 慢刷 / 起止配对）；(3) manual.md 偏好对齐：浏览器可观察验收已落、AI 自派 tester 已落、只在 plan 后停一次已落、专业术语翻译已落；(4) Codex 评审第 22 点（hub 不应有"超级管理员模式"）已纳入"非目标"段。
