# 总控台体验对齐 · plan

## 大哥摘要

按你的 3 点要求做体验对齐：

1. **总控台入口缩小**：从现在那个跟项目卡同宽的大按钮（~180px），缩成跟左侧 ActivityBar 一样窄的 **44px 图标按钮**（只显 📊 emoji，hover 显文字）。
2. **总控台终端跟普通项目终端体验**完全一致：复用 tab 页签（一行能开多个 session）+ 悬浮输入框 + 自定义按钮 + 状态徽章。等于"hub 就是个特殊项目"。
3. **hub claude 能读其它 session 终端输出**：MCP 工具集加一个 `read_session_output(sessionId, lines)`，hub claude 派完任务能回来看那个 session 跑成啥样，形成"派 → 看结果 → 决定下一步"闭环。

为做到 #2，**第 1 期那个 D1 决策（"hub 不是项目"）需要翻转**——hub 变成一个**真项目** `__hub__`，path 指向 `data/hub-workspace/`，跟你已有的 4 个真实项目并列存在 DB 里（但在普通项目卡列表里**藏起来**）。这样所有现有 22 个按 projectId 工作的接口能**原生服务** hub，不用为它专门改逻辑。

**Codex 评审找出 13 处需要 filter / 拒绝的位置**——按重要度分两阶段交付，先做 5 处必做（不做会有 bug / 数据丢失风险），剩下 8 处建议 filter 留待第 2.5b 期或大哥真踩到再做。

**验收方式**（点完后你能看到的）：
- 项目列表顶部 📊 总控台从大按钮缩成小图标，不再占整行
- 点 📊 进去主区跟普通项目一模一样的体验——上方 tab bar、下方输入框、可以开多个 hub session tab
- ActivityBar（左侧 44px 窄条）多一个图标 📊（只在选了总控台时出现），点开侧栏展示第 1 期那个项目状态看板
- 跟 hub claude 说"先用 claude 在 ExcelCon 跑 X，跑完读一下它输出告诉我结果"→ 它先调 dispatch → 再调 read_session_output → 把结果总结给你

> 项目记忆扫描：`auto.md` 命中 3 条强相关 —— (1) "项目级 MCP 配置写项目根、幂等保留已有 server" → 直接命中本任务"MCP 注入要合并 aimon-hub + browser-use 不能覆盖"；(2) "未提交核心文件先确认归属" → 本任务会动 store/api/types/sessions.ts/projects.ts 等共享文件，每动一处先确认无冲突；(3) "Dev Docs 关键文件边界要对照 changed files" → 收尾对照白名单。`manual.md` 命中 3 条 —— (1) 大哥只关心大方向+验收（已落大哥摘要）；(2) 完成时如可浏览器验收要 AI 自派 tester（按既定不派，留手验）；(3) 小功能直接改——本任务**不是**小功能，走完整流程。第 1 期 D1 决策翻转有合理理由（用户体验需求高于工程美学），但 Codex 评审 13 处 filter 必须落实。

## 目标

### 阶段 2.5a（本期，必做核心）

1. **入口缩小**：ProjectsColumn 顶部 📊 总控台从完整按钮改成 **44px 窄图标**（emoji + hover tooltip）。
2. **hub 翻转成真项目**：
   - server 启动时 idempotent upsert `__hub__` 项目到 `projects.json` + projects 表，path = `<server-root>/data/hub-workspace/`，name = `📊 总控台`
   - **启动顺序硬要求**：`__hub__` 必须在 `syncProjectsTable` 之前 upsert，否则历史 hub session 会被级联清空（Codex 第 1 点警告）
   - `selectedView = 'hub'` 状态完全删除；点 📊 入口 = `selectProject('__hub__')`；Workbench 不再做分支渲染，hub 跟普通项目一样走 EditorArea + SessionView
3. **删除第 2 期独立 hub-session-runtime**：
   - 删 `hub-session-runtime.ts` / `routes/hub-session.ts`
   - hub session 走标准 `POST /api/sessions {projectId: '__hub__', agent}`，自然享有 worktree(下面会拒绝)/MCP 注入/skills/hook 全套流程
   - 删除 `currentHubSession` store 字段 + sessionStorage 持久化 + 启动/停止 UI（HubStartPanel）
4. **后端硬拒绝 5 处**（Codex 必做）：
   - `DELETE /api/projects/__hub__` 拒绝 → `{error: 'cannot_delete_hub'}`
   - `PUT /api/projects/__hub__/workflow` apply/remove 拒绝 → `{error: 'hub_no_workflow'}`
   - `POST /api/sessions {projectId: '__hub__', isolation: 'worktree'}` 拒绝 → `{error: 'hub_no_worktree'}`（hub-workspace 不是 git 仓库）
   - `DELETE /api/fs-ops/...` 对 hub-workspace 内文件拒绝 → `{error: 'cannot_modify_hub_workspace'}`
   - `POST /api/fs-ops/gitignore-add` 对 __hub__ 拒绝（同上）
5. **MCP 注入分支**：`mcp-bridge.injectMcpForAgent` 当 `projectId === '__hub__'` 时，**只写** `hub-workspace/.mcp.json`，**不写**任何真实项目根；且 merge `aimon-hub` + 现有 `browser-use` server 条目，不覆盖（Codex 第 4 点）。同时，普通项目 session 的 .mcp.json **不再写 aimon-hub**（只 browser-use），避免普通 session 拿到 hub 工具。
6. **MCP 工具加 `read_session_output`**：
   - 后端新增 `GET /api/hub/sessions/:id/recent-output?lines=N`（默认 200 行，max 1000）——复用 `recordPtyChunk` 的 buffer（pty-manager 里现成）
   - MCP server 加 `read_session_output(sessionId, lines)` 工具调用此接口
   - 注意：此工具能读**任意 session 输出**（不限 hub）——hub claude 能读 ExcelCon 项目的 claude 在跑啥
7. **前端 ProjectsColumn 过滤**：项目卡列表 filter 掉 `__hub__`（顶部窄图标按钮单独渲染）。
8. **看板搬到 ActivityBar 一个 view**：
   - ActivityBar 新增 `'hub-dashboard'` activity，icon 📊，label '总控台看板'
   - **只在 `selectedProjectId === '__hub__'` 时出现**（Codex 第 30 点：避免用户以为看板属于当前普通项目）
   - 新增 `packages/web/src/components/sidebar/HubDashboardView.tsx`：渲染原 HubView 的看板部分（HubProjectCard 列表 + 派工 dialog），但**不再有右半 hub terminal 占位**（hub terminal 现在是主区 SessionView）
   - 选 `__hub__` 项目时默认 activity 自动切到 'hub-dashboard'
9. **删除 HubView / HubTerminal / HubStartPanel**：第 2 期那批组件全部废弃；保留 HubProjectCard / HubDispatchDialog 给新的 HubDashboardView 复用。

### 阶段 2.5b（延后，等大哥真踩到再做）

剩下 8 处 Codex 标"建议 filter"但不致命的路由不做：docs/comments/issues/memory/perf/paste-image/skill-catalog/output/cli-configs/jobs/openspec/project-docs/cli-installer 等的 __hub__ filter。理由：
- 这些都是"用户主动操作"才会接到 hub 路径（如在 hub 项目里手动新建 dev/active 任务）
- 不做不会自动产生 bug，只在大哥手动触发时返意外结果（如 hub 下 git status 报 not_a_git_repo 错）
- 等大哥真踩到再做单点修复，避免本期工程量爆炸

### 验收标准（必须可在浏览器观察 / 命令可跑）

- **浏览器可见**：
  - 项目列表顶部 📊 总控台是 44px 窄图标按钮（hover 显"总控台"tooltip），不再占整行
  - 点 📊 → 主区进 EditorArea + SessionView 体验，跟选普通项目一模一样（tab bar / 输入框 / 自定义按钮 / 状态徽章 / 多 session tab 全有）
  - 选 __hub__ 项目时，ActivityBar 上多一个 📊 图标（普通项目下没有），点开侧栏是项目状态看板（HubProjectCard 列表 + 派工按钮）
  - 在 hub 主区点 "+ 新建 session" → 选 claude → 起来一个 hub claude session（跟普通项目新建 session 流程一模一样）
  - 跟 hub claude 说 "list_projects"、"在 ExcelCon 跑 ls"、"读 ExcelCon 那个 session 最近输出" → 它分别调 list_projects / dispatch_to_project / read_session_output → 看到 ExcelCon 主区新 session + hub claude 拿到输出汇报
- **安全验收**：
  - `curl DELETE /api/projects/__hub__` → 400 `cannot_delete_hub`
  - `curl POST /api/sessions -d '{"projectId":"__hub__", "agent":"shell", "isolation":"worktree"}'` → 400 `hub_no_worktree`
  - `curl DELETE /api/fs-ops/...` 删 hub-workspace 内文件 → 400 `cannot_modify_hub_workspace`
- **操作日志**：所有新拒绝都 serverLog warn 一条，方便排查"为什么这个操作失败了"
- **类型 + 构建**：`pnpm --filter @aimon/server build` + `pnpm --filter @aimon/web build` 都通过
- **手验**：tester 按既定不派，留大哥手验上面浏览器清单

## 非目标

- **不做** 8 处"建议 filter"路由（见阶段 2.5b 段；YAGNI 原则）
- **不做** hub 项目重命名 / 改 path UI（hub 是系统项目，固定）
- **不动** 别任务草稿文件（每改一处先 Read 确认无冲突）
- **不复活** 第 2 期那个独立 hub-session-runtime（D6 决策完全废弃）
- **不向前**：第 2 期 currentHubSession 状态 + sessionStorage 都清掉，**不**做迁移代码（让浏览器 sessionStorage 自然失效即可——本来 hub session 也不跨浏览器存活）
- **不做** 看板放主区顶栏折叠面板的备选方案（按你 ok 接受的推荐方向：放 ActivityBar）

## 实施步骤

> 细化在 tasks.md / tasks.json；这里只写粗粒度顺序与各步 verify 抓手。

1. **后端：__hub__ 项目 idempotent upsert + 启动顺序**
   - 新增 `packages/server/src/hub-project.ts`：`ensureHubProject()` upsert `__hub__` 进 projects.json + 同步写 projects 表
   - 在 `index.ts` server 启动序列里：**必须在 `syncProjectsTable` / `getDb` 调用之前**调 ensureHubProject（Codex 警告点）
   - `__hub__` 项目 path = `<server-root>/data/hub-workspace/`，name = `📊 总控台`
   - **verify**：build 通过；server 重启后 cat projects.json 看到 __hub__ 条目；删 projects.json 手动重启能自动复活 __hub__；删 __hub__ 条目后重启也自动复活
2. **后端：5 处硬拒绝 guard**
   - routes/projects.ts DELETE / PUT workflow apply/remove 加 if `req.params.id === '__hub__'` → 400
   - routes/sessions.ts POST 加 if `projectId === '__hub__' && isolation === 'worktree'` → 400
   - routes/fs-ops.ts delete + gitignore-add 加路径 startsWith hub-workspace 检查 → 400
   - 每处 serverLog warn 记一条
   - **verify**：build 通过；curl 五个攻击路径全部返预期 400 错误码
3. **后端：MCP 注入分支 + 取消普通项目注入 aimon-hub**
   - `mcp-bridge.injectMcpForAgent` 当 projectId === '__hub__' 时，写 hub-workspace/.mcp.json，**合并** aimon-hub + browser-use（不覆盖）
   - 当 projectId !== '__hub__' 时，**只写** browser-use（不写 aimon-hub）
   - 删除 hub-workspace.ts 里的 writeHubMcpConfig（功能挪到 mcp-bridge）
   - **verify**：build 通过；起一个 __hub__ session 后 cat hub-workspace/.mcp.json 看到 aimon-hub + browser-use 两个 server；起一个 ExcelCon session 后 cat ExcelCon/.mcp.json 只有 browser-use
4. **后端：删除 hub-session-runtime + routes/hub-session.ts**
   - 删两个文件；在 index.ts 删除 `registerHubSessionRoutes` 调用
   - hub-workspace.ts 简化：只保留 ensureHubWorkspace（创建 hub-workspace 目录 + README），删 writeHubMcpConfig
   - hub-token.ts 保留（MCP 注入仍需要）
   - **verify**：build 通过；server 重启正常；旧 `/api/hub/session` 路径返 404（确认删干净）
5. **后端：新增 GET /api/hub/sessions/:id/recent-output**
   - 复用 pty-manager 现有 recordPtyChunk 的 buffer（如果暴露），或新增 ring buffer Map<sid, string[]>，listen ptyManager output 事件追加
   - zod 校验 lines 1-1000，默认 200
   - **verify**：build 通过；起一个 session 跑 echo → curl recent-output 返回那段输出文本
6. **后端：MCP server 加 read_session_output 工具**
   - mcp-hub/index.ts 注册新工具，调上面新端点
   - 失败结构化错误（session_not_found 等）
   - **verify**：build 通过；stdio JSON-RPC tools/list 返 7 工具；tools/call read_session_output 真能拿到输出
7. **前端：清除第 2 期 hub 视图遗物**
   - store.ts 删 selectedView / setSelectedView / readSelectedView / writeSelectedView 全套；删 currentHubSession + setter + readCurrentHubSession + writeCurrentHubSession + sessionStorage 常量
   - types.ts 删 HubSessionInfo / StartHubSessionRequest（保留 HubStatus 系列给看板用）
   - api.ts 删 startHubSession / stopHubSession / listHubSessions
   - **删** packages/web/src/components/hub/HubView.tsx / HubTerminal.tsx
   - **保留** HubProjectCard / HubDispatchDialog（给 HubDashboardView 复用）
   - **verify**：build 通过
8. **前端：Workbench 简化 + ProjectsColumn 入口缩窄**
   - Workbench.tsx 删除 selectedView === 'hub' 分支渲染，恢复原版（永远 ActivityBar + PrimarySidebar + EditorArea）
   - ProjectsColumn.tsx 顶部 📊 总控台按钮缩成 44px 窄图标（CSS 跟 ActivityBar item 一致），点击 selectProject('__hub__')；项目卡列表 filter 掉 __hub__；高亮逻辑用 selectedProjectId === '__hub__' 判定
   - **verify**：build 通过；UI 上 📊 按钮窄了；点它切到 hub 项目主区是普通 EditorArea
9. **前端：ActivityBar 加 hub-dashboard view + HubDashboardView 组件**
   - ActivityBar.tsx 加 item `{ id: 'hub-dashboard', icon: '📊', label: '总控台看板' }`，**只在 selectedProjectId === '__hub__' 时出现**
   - store.ts Activity 联合类型加 'hub-dashboard'
   - 新增 `packages/web/src/components/sidebar/HubDashboardView.tsx`：原 HubView 看板部分内容（HubProjectCard 列表 + 派工 dialog + 5s 轮询 status）
   - PrimarySidebar 接入 hub-dashboard activity 路由到 HubDashboardView
   - 选 __hub__ 项目时 selectProject 自动 setActivity('hub-dashboard')
   - **verify**：build 通过；进 hub 项目 ActivityBar 多出📊图标且 sidebar 默认是看板；切其它项目📊图标消失；侧栏显示原项目对应 view
10. **白名单 + grep + tester**
    - git diff 对照白名单；grep `selectedView|currentHubSession|hub-session-runtime|registerHubSessionRoutes` 确认全清干净（应该 0 命中或只剩 dev docs 文件）
    - 派 tester（按既定不派，handoff 标注）

## 边界情况

- **__hub__ 在 projects.json 但 path 不存在**：ensureHubProject 会自动 mkdir hub-workspace（复用 ensureHubWorkspace）
- **__hub__ projectId 被用户在 UI 拖到别处 / 重命名**：项目列表展示 filter 掉，UI 上接触不到；后端 PUT 项目元信息也加守卫拒绝（同 DELETE）
- **hub session 异常退出**：跟普通 session 一样，session row 标 stopped/crashed；用户在 hub 项目主区看到 tab 标停止状态；可以点删除或新建
- **首次启动尚无 hub-workspace 目录**：ensureHubProject 调 ensureHubWorkspace 创建
- **多 VibeSpace 实例同机**：__hub__ projectId 字符串相同没问题（每个实例有自己的 DB + projects.json + hub-workspace）；MCP token 隔离仍然生效
- **第 2 期 sessionStorage 里有遗留 currentHubSession**：新版本 store 不再读这个 key，浏览器刷新一次自然忽略
- **read_session_output 读到不存在的 sessionId**：返 404 `session_not_found`
- **read_session_output 读到 hibernated session**：返最后一次 PTY buffer（如果还在 ring buffer 里），否则空字符串
- **hub-workspace 路径里有空格**：mcp-bridge 写 .mcp.json 的 args 数组天然支持，shell 不解析

## 风险与注意

- **启动顺序硬要求**（Codex 第 1 点最严重）：`ensureHubProject` 必须在 `syncProjectsTable`（projects.json → DB）之前调；否则 DB 先同步发现 __hub__ 不在 JSON 里 → 级联 CASCADE 删 hub sessions。**执行步骤 1 的 verify 必须显式测"删 projects.json 重启能复活 __hub__"**。
- **MCP 注入合并逻辑要幂等**：参 auto.md 2026-05-02 "项目级 MCP 配置幂等保留已有 server"——多次启动 / 多 session 启动同一项目都不能后写覆盖前写。
- **删除 hub-session-runtime 后第 2 期 currentHubSession 类型残留**：types.ts / store.ts 必须**彻底删干净**（不留死代码），否则未来再加 hub 相关功能会误用旧类型。
- **未提交别任务草稿叠加**：当前 git status 有大量 modified（store / types / api / index.ts / Workbench / ProjectsColumn 等被上一期改过）—— 本任务会**再改**这些文件，每动一处先 Read 全文确认这次改动跟上期未提交内容不冲突；冲突就停手对齐。
- **破坏性变更协议触发**：本任务**修改导出符号**（store 删 selectedView / currentHubSession 字段、api 删 3 个函数、types 删 2 个类型）→ 全 grep `selectedView|currentHubSession|startHubSession|stopHubSession|listHubSessions|HubSessionInfo|StartHubSessionRequest` 确认调用方都改完；TS 编译会捕获大部分残留。
- **熔断**：同一步骤 verify 失败 2 次仍不过停手，把错误日志、试过的方案打印给大哥。
- **延后的 8 处 filter 风险**：用户在 hub 项目主区点 git/docs/issues/memory 等侧栏 tab 时会接到 404 或 not_a_git_repo 错误。**这是已知 trade-off**——大哥真踩到就开 2.5b 期；不踩到就这么放着。handoff 摘要要明说这条。

## 多模型 Plan 会审

> [Gemini 评审] 跳过：任务结构虽涉及多文件但聚焦（D1 翻转 + filter 集中 + MCP 工具增加），无跨多模块深度依赖追踪需求，Gemini 长上下文边际收益低。
> [Codex 评审] 已完成（本轮对话中执行），关键采纳 11 条：(1) 启动顺序 ensureHubProject 必须在 syncProjectsTable 之前；(2) DELETE /api/projects/__hub__ 后端硬拒绝（不能只前端 filter）；(3) hub session 拒绝 isolation=worktree；(4) MCP 注入只写 hub-workspace 不写真实项目根，合并 aimon-hub + browser-use 不覆盖；(5) 普通项目不再注入 aimon-hub（避免普通 session 拿到 hub 工具）；(6) 删 hub-session-runtime + routes/hub-session.ts 没影响（mcp-hub 工具调的是别的端点）；(7) 多 hub tab 不需要特殊状态——activeSessionIdByProject['__hub__'] 原生成立，但 refreshProjects 不能因列表不含 hub 把选中清掉；(8) hub-dashboard view 只在选 __hub__ 时出现避免用户混淆；(9) fs-ops delete/gitignore-add 必做拒绝（防误删 hub 配置）；(10) routes/projects PUT workflow apply/remove 拒绝（hub 没工作流概念）；(11) 22 处路由分级—— 5 处必做、8 处建议、9 处无需 filter；本期只做必做 5 处，建议 8 处延后。
> [Codex 综合主笔] 跳过：plan 已由 Claude 草拟完整六段并吸收 Codex 11 条评审。大哥已通过"ok"接受推荐方向后，再走综合主笔属过度流程。
> [Claude 白话化兜底] 检查项：(1) 大哥摘要白话 + 解释 D1 翻转的原因（保留你之前选择的体验优先）；(2) 工程量诚实告知"分阶段，本期只做必做 5 处 filter"；(3) 明说延后 8 处的 trade-off + handoff 要点出来；(4) 术语括号翻译（CASCADE 级联删 / MCP 注入 / sessionStorage / filter / worktree 隔离）。
