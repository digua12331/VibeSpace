# 未完成任务终端恢复 · Plan

## 大哥摘要

这次要做的是：以后你**重新打开一个项目**时，如果还有任务没干完，会主动提醒你回到对应终端继续（"终端"=运行 Claude/Codex 的命令行小窗口），不用自己翻历史。

入口在两个地方：一是**任务列表**里每条未完成任务后面会有"进入终端"按钮；二是如果你打开项目时编辑区是空的（没有任何文件标签），中间还会冒出一张"未完成任务"卡片让你点。

只在你点击时才会动作——**不自动跳转、不自动开终端、不抢走焦点**。原终端还活着就直接跳进去；已经关掉的，会帮你**新开一个继续干**（worktree 隔离的任务=git 的临时副本，并行任务之间互不踩脚；新开会用一个新副本，旧副本留在磁盘上不会动）。

不会改你的任务文件、聊天历史或界面布局，只新增上面两处入口。

## 目标

解决的问题：关闭项目后再次打开时，未完成任务的继续入口不明显，用户需要手动找对应终端。

可验证的验收标准：

1. 打开一个存在未完成任务的项目后，在浏览器的文档任务列表能看到未完成任务旁边的状态 chip（小状态标记）和“进入终端”按钮；点击后进入对应终端。
2. 当编辑区没有打开文件 tab（顶部文件标签）时，浏览器中间空白区显示按更新时间倒序排列的未完成任务卡片；点击卡片能进入终端。
3. 未完成口径明确：tasks.json 里状态为 `todo`、`doing`、`blocked` 的任务都显示；`done` 不显示；`blocked` 也允许进入终端继续处理。
4. 四条主路径都能验收：
   - 任务已有活着的会话（`ended_at == null`）时，点击入口直接切到原终端标签。
   - 任务绑定的是已结束的 shared 会话（共享工作区会话）时，点击后走 restart（重启旧会话）并进入终端。
   - 任务绑定的是已结束的 worktree 会话时，点击后新建一个带同任务名的 worktree 会话并进入终端。
   - 任务名被 dead session（已结束会话）占用时，新建会话前后端会清掉旧占用，不让用户看到“任务被占用”的失败。
5. 项目切换入口 `selectProject` 会同步刷新 docs（任务摘要）和 sessions（终端会话列表），避免显示旧项目的任务或终端。
6. 所有新增用户点击动作都能在浏览器 LogsView（日志页面）看到 `scope=session action=restore` 的开始/成功/失败配对；失败分支至少人工触发一次 ERROR（错误）日志。
7. TypeScript（项目使用的静态类型语言，能提前发现类型错误）检查通过：执行 `pnpm -w typecheck` 或仓库实际等价命令成功。
8. 浏览器验收必须覆盖：打开项目后只展示入口，不自动跳转、不自动创建会话、不抢焦点。

## 非目标

1. 不做 ActivityBar（左侧活动栏）全局徽章，避免引入全局计数同步问题。
2. 不做自动跳转到某个任务终端；多个未完成任务只展示列表，不替用户选择。
3. 不清理旧 worktree 磁盘目录，也不改变任务文件本身的内容。

## 实施步骤

1. 梳理现有任务和会话数据流：确认 `GET /api/projects/:id/docs`、sessions 列表、`task_name`、`ended_at`、`isolation` 在前后端的字段口径。
   - 验证：能列出前端判断未完成任务和查找 owner session（归属会话）的数据来源，并确认 projectId（项目编号）参与匹配。
2. 把项目切换后的刷新收口到 store 层：`selectProject(id)` 后触发可重复安全的 `refreshDocs` 和 `refreshSessions`，DocsView 不再各自造成重复刷新。
   - 验证：切换项目后任务列表和会话列表都来自当前项目；同名任务不会串到另一个项目。
3. 改造任务 owner 查找逻辑：从只查 alive sessions 扩展到能识别 dead session，并按 alive、shared dead、worktree dead 三种路径分流。
   - 验证：构造三类会话后，前端按钮展示一致，但点击后的请求路径分别正确。
4. 实现 DocsView 任务行入口：未完成任务显示状态 chip 和单一“进入终端”按钮，按钮负责进入/恢复动作。
   - 验证：浏览器任务列表可见入口；chip 只展示状态，不作为第二个点击入口。
5. 实现 EditorArea EmptyState 兜底入口：无打开文件 tab 时显示未完成任务卡片，按 `updatedAt` 倒序展示前 N 条，不自动选中。
   - 验证：关闭所有文件标签后能看到卡片；有文件标签时不挤占编辑区；切项目后不会显示旧项目卡片。
6. 补后端 createSession 绑定任务时的 dead session 占用清理：如果目标 `task_name` 只被已结束会话占用，先清空旧占用再绑定新会话。
   - 验证：worktree dead 新建带 `task` 的会话不会因为旧 dead session 的 `task_name` 返回 409。
7. 补操作日志：前端点击 DocsView 按钮和 EmptyState 卡片都用 `logAction(scope, action, fn)` 包住；后端 create/restart/task 绑定路径确认有 `serverLog(level, scope, msg, extra)` 的开始、成功、失败。
   - 验证：LogsView 里看到 `scope=session action=restore` 起止配对；人工触发一次失败，看到 ERROR 日志；force 抢占绑定日志 meta（附加信息）包含 `taskName`、`oldSessionId`、`newSessionId`。
8. 跑类型检查和必要测试。
   - 验证：`pnpm -w typecheck` 或等价命令通过；如已有相关测试命令，也同步通过。

## 边界情况

1. 多个未完成任务：按 `updatedAt` 倒序展示，不自动进入任何一个。
2. `tasks.json` 损坏或缺失：沿用服务端 `summarizeFromJson` 兜底，不让页面崩溃。
3. 同名任务跨项目存在：所有 join（把任务和会话对应起来）必须带 projectId，避免串项目。
4. `blocked` 任务：算未完成，也允许进入终端，因为它通常表示需要继续排查。
5. worktree dead 会话：不能调用 restart；新建会话继续，旧 worktree 磁盘目录保留。
6. shared dead 会话：优先 restart 同一个 session id，保留历史连续性。
7. dead session 仍挂 `task_name`：后端创建新会话绑定任务时要先清旧占用，避免 409。
8. 切项目时仍有跨项目 openFiles（已打开文件标签）：需要确认标签过滤逻辑；如果空白区不出现，要避免因为旧项目标签导致 EmptyState 永远不显示。
9. 用户快速连续点击进入：恢复动作应避免重复创建会话；日志里能看出第二次点击的结果。
10. 项目无未完成任务：不展示卡片，不影响原有空白区和文档列表体验。

## 风险与注意

1. 最大风险是数据刷新时机：`selectProject` 以前只是纯前端切换，不刷新 docs/sessions；这次要把刷新做成可重复安全，避免 DocsView 自己刷新和 store 刷新打架。
2. `findOwnerOfTask(name)` 现状只查 alive sessions，会漏 dead session；如果不改，会误判任务没人占用，导致错误新建或 409。
3. shared dead 和 worktree dead 的恢复路径不同：shared 可以 restart，worktree restart 会 400 `restart_not_supported`，必须分流。
4. 创建会话时直接带 `task`，减少先创建再 PATCH 绑定的抢占窗口。
5. force 抢占绑定只在确实需要时使用，并且日志 meta 要能看出旧会话和新会话是谁。
6. 本任务涉及用户可见入口和会话 mutation（会改变会话状态的操作），必须补起止配对日志，并人工验收失败分支。
7. 假设现有 `POST /api/sessions`、`POST /api/sessions/:id/restart`、`PATCH /api/sessions/:id/task` 的日志基础已存在；如果实现时发现缺失，只补本任务路径需要的最小日志。
8. 假设 `GET /api/projects/:id/docs` 的 `DocTaskSummary.updatedAt` 足够用于排序；如果字段为空，使用稳定兜底排序，不能影响页面可用。

## 多模型 Plan 会审

> [Gemini 评审] 跳过：Gemini CLI spawn ENOENT（Windows MCP 不识别 .cmd 扩展，第二次仍失败）
> [Codex 评审] 砍掉 ActivityBar 徽章；shared dead 走 restart；worktree dead 走新建带 task；dead session 的 task_name 占用要后端清；不自动跳转只展示入口
> [Codex 综合主笔] 采纳 Codex 全部关键修订，把方案定为 DocsView 入口 + EmptyState 兜底两个 UI 落点，放弃 ActivityBar 徽章和自动跳转，因为它们会增加同步风险或改变用户操作习惯。
