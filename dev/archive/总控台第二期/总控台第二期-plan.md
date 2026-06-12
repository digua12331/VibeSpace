# 总控台第二期 · plan

## 大哥摘要

第 1 期你已经能在「📊 总控台」看板上手点按钮派工。第 2 期给总控台**右半边加一个 AI 终端**（你能选 claude 或 codex 启动），它就是总控台的"AI 总指挥"——你跟它说"看下 ExcelCon 上次的提交，把它总结后让 inkos 项目的 claude 参考着写下一章"，**它自己规划、自己调工具、自己跨项目派任务**，不再需要你手点按钮。

它能做的事（**只读 + 派工**白名单，不能删 / 不能改文件）：列项目、看某项目下哪些 AI 终端在跑、读最近 N 个 commit、读项目里某个文件、**在指定项目下新建 session 并把任务文本发过去**。

它**不能**做的事（第 2 期硬性禁止）：停别人 session、改文件、写仓库——这些破坏性动作仍只能你手点。

**验收方式**：打开总控台 → 右半看到"启动 hub session"按钮 → 选 claude 点启动 → 等几秒看到 hub 终端在右半跑起来 → 跟它说一句"列一下所有项目和它们各自跑了多少 session" → 它自己调 MCP 工具（一种给 AI 用的小机器人协议）→ 几秒内你看到它回复了项目清单 + session 数 → 再说"在 ExcelCon 起一个 shell 跑 dir 命令" → 切回 ExcelCon 项目看到新 session 在跑 → 整个过程的工具调用都在 LogsView 看得到（scope=hub 系列日志）。

**特殊说明**：hub 终端的工作目录是一个**隔离目录** `data/hub-workspace/`（hub 自己的小空间，跟所有真实项目分开），所以 hub claude 在自己目录里随便写文件不会污染你任何项目的 git 状态——这是 Codex 评审的硬要求。

> 项目记忆扫描：`auto.md` 命中 4 条强相关 —— (1) "项目级 MCP 配置写项目根、幂等" → 反向应用：hub MCP **只**写 `data/hub-workspace/.mcp.json`，**不**写任何真实项目根；(2) "可选增强注入失败不阻塞主流程但要操作日志" → hub MCP 注入失败不阻塞 hub session 启动；(3) "Dev Docs 关键文件边界要对照 changed files" → 本任务 write_files 白名单严格列出；(4) "未提交核心文件先确认归属" → 本任务会动 store/types/api/Workbench 等已被前任务修过的文件，每动一处先 Read 确认无冲突。`manual.md` 命中 3 条 —— (1) 大哥只关心大方向+验收（已落大哥摘要）；(2) 完成时如可浏览器验收要 AI 自派 tester（如可用则跑，不可用则 handoff 标注）；(3) 小功能直接改——本任务**不是**小功能，走完整流程。`ARCHITECTURE.md` 命中 §2.1 路由模板、§3.1 操作日志、§4 关键文件索引——本任务全部按既有模板。第 1 期 plan/context 的 D1（hub 不是项目）、D4（dispatch 不派给已有 session）、D6（不绕过项目权限）继续生效。

## 目标

1. **后端：单文件 MCP server**（`packages/server/src/mcp-hub/index.ts`，独立 bin entry，**不另起 pnpm 子包**），跟 server 一起 tsc 编译；用 `@modelcontextprotocol/sdk` 官方 SDK；暴露 6 个白名单工具（list_projects / get_project_sessions / read_git_log / read_file / dispatch_to_project / hub_status），每个工具 zod schema 严格校验、失败返回结构化错误 `{code, message, retryable, details}`。
2. **后端：hub session 独立 runtime**（新增 `packages/server/src/hub-session-runtime.ts` + `packages/server/src/routes/hub-session.ts`），**不进 sessions 表 / 不动 db.ts 21 路由**——hub session 用内存 Map<hubId, info> 跟踪、复用 ptyManager 起 PTY、独立 WS 命名空间（如 `hub:<hubId>`）。新增 3 接口：`POST /api/hub/session`（启动）/ `DELETE /api/hub/session/:id`（停止）/ `GET /api/hub/session`（当前活跃 hub session 列表）。
3. **后端：hub workspace 目录管理**（`packages/server/data/hub-workspace/`）+ **一次性 token 注入**：hub session 启动时生成 16 字节随机 token，写到 `<hub-workspace>/.mcp.json` 的 `env.HUB_TOKEN` 里 + server 端 `/api/hub/*` 路由读 header `X-Hub-Token` 校验；token 只在内存，server 重启即换。
4. **后端：HTTP 鉴权中间件**（薄薄一层，仅对 `/api/hub/*` 生效，header `X-Hub-Token` 必须匹配当前 token；浏览器 UI 直连不带 token 时也放行——因为是 loopback 同源），目的是防多 VibeSpace 实例同机时 hub MCP 误连错实例。
5. **前端：HubTerminal 简化版终端组件**（约 400-500 行，xterm + WS input/output 转发 + 顶栏派工面板入口），**不**复用 1404 行的 SessionView——SessionView 跟项目/任务/worktree/permission drawer 深耦合。
6. **前端：HubView 右半接入 HubTerminal** + "启动 hub session" 按钮（未启动时显示按钮 + agent 下拉；已启动时显示 HubTerminal + 停止按钮）。
7. **后端：MCP 工具调用进 LogsView**——dispatch_to_project / read_file 等都用 `serverLog('hub', '<tool> 开始/成功/失败')` 起止配对，meta 含工具名、参数预览、来源（hub session id）。

### 验收标准（必须可在浏览器观察 / 命令可跑）

- **浏览器可见**（大哥就靠这条）：
  - 打开总控台 → 右半看到 "启动 hub session" 占位（agent 下拉默认 claude，可选 codex；点启动按钮）。
  - 启动后 → 右半显示 hub 终端（跟普通终端外观一致但更简洁），看到 claude/codex 启动后的 prompt。
  - 跟 hub claude 说 "list_projects" → 它能自己调 MCP 工具回复 4 个项目名 + path。
  - 跟 hub claude 说 "在 VibeSpace 项目下用 shell 跑 echo hub-mcp-test" → 切回 VibeSpace 项目看到新 session tab、终端里有 `echo hub-mcp-test` 的执行回显。
  - 跟 hub claude 说 "读 ExcelCon 项目根目录的 README.md 前 20 行" → 它返回文件内容（路径越界尝试如 `../../etc/passwd` 应被拒）。
  - hub session 停止按钮：点击 → 二次确认 → PTY 被 kill，hub workspace 目录保留（下次启动可重用）。
- **操作日志**（LogsView 可见，每条都带 `hubSessionId` meta）：
  - hub session 启动：`scope=hub action=session-start 开始/成功 (Nms)/失败` 配对。
  - MCP 工具调用：每次 `dispatch_to_project / read_file / read_git_log` 都有 `scope=hub action=mcp-tool:<name> 开始/成功/失败` 配对，meta 含工具参数预览。`list_projects / get_project_sessions / hub_status` 为高频只读，**不**配对日志（只在失败时记 error）。
  - hub session 停止：`scope=hub action=session-stop 开始/成功 (Nms)/失败` 配对。
- **类型检查 + 构建**：`pnpm --filter @aimon/server build` 通过；`pnpm --filter @aimon/web build` 通过。
- **后端 curl 探针**：`curl -H "X-Hub-Token: <wrong>" /api/hub/session` 返回 401；正确 token 返回当前 hub session 列表；启动接口能正常返回 hubSessionId。
- **AI 自派 tester**：完成后**如果 tester 工具可用**则派 `vibespace-browser-tester` 跑上面浏览器清单；不可用则在 handoff 明说留大哥手验。
- **安全验收**：尝试用 MCP 工具 `read_file(projectId, '../etc/passwd')` 必须被拒（返回 `code: 'path_escape'`）；`read_file` 大文件 (>1MB) 必须被拒（`code: 'file_too_large'`）；二进制文件（首 8KB 含 \0）拒（`code: 'binary_file'`）。

## 非目标

- **不**实现 `stop_session / delete / write_file / git_commit` 等破坏性 MCP 工具（Codex 评审第 22 点：第 2 期默认信任 hub claude 的前提是只开读+派工白名单；破坏性留待大哥明确要求再加）。
- **不**实现"派给已有 session"的 MCP 工具——第 1 期 D4 决策延续，需要 session 状态机才能稳，仍是后续期工作。
- **不**改 `db.ts` schema、**不**动 21 个现有按 projectId 工作的路由、**不**改 sessions.ts —— hub session 走完全独立 runtime。
- **不**升级 mcp-hub 成独立 pnpm 子包——Codex 第 3 点：只有需要独立发布 / 独立测试矩阵 / 依赖冲突时才升级。
- **不**复用 SessionView 1404 行组件做 HubTerminal——Codex 第 19-20 点：会把 hub 逻辑扩散到普通 session 页。
- **不**做 hub session 跨会话持久化（hub workspace 目录保留，但 PTY 进程不持久化；浏览器刷新需重启 hub session）。第 1.5 期再考虑。
- **不**做 MCP server 常驻——CLI（claude/codex）默认 stdio 模式由 CLI spawn、CLI 退出 MCP 子进程自然退出（Codex 第 17-18 点）。
- **不**做完整登录鉴权——本地单用户场景，token 只为防多实例误连。
- **不**动当前未提交的别任务草稿文件（每改一处都先 Read 确认无冲突）。

## 实施步骤

> **细化在 tasks.md / tasks.json；这里只写粗粒度顺序与 verify 抓手。**

1. **后端：hub workspace + token 管理 + 鉴权中间件**
   - `packages/server/src/hub-workspace.ts`：创建并维护 `data/hub-workspace/` 目录；首次启动写一个 `README.md` 说明用途；提供 `getHubWorkspaceDir()` API。
   - `packages/server/src/hub-token.ts`：模块级 `let currentToken = crypto.randomBytes(16).toString('hex')`；导出 `getHubToken() / regenerateHubToken()`；server 重启自动换新。
   - 鉴权中间件：Fastify `addHook('onRequest')` 仅对 `/api/hub/*` 校验 header `X-Hub-Token`——匹配当前 token 放行；没带 token 但 origin 是 loopback（127.0.0.1 / localhost）也放行（浏览器 UI 走这条）；其它情况 401。
   - **verify**：`pnpm --filter @aimon/server build` 通过；`curl -H 'X-Hub-Token:wrong' /api/hub/status` 返回 401；`curl /api/hub/status`（无 token，localhost）仍返回 200；`curl -H 'X-Hub-Token: <real>' /api/hub/status` 返回 200。
2. **后端：hub session runtime + 路由**
   - `packages/server/src/hub-session-runtime.ts`：导出 `startHubSession(agent) → {hubId, pid, workspaceDir}` / `stopHubSession(hubId)` / `listHubSessions() → HubSessionInfo[]`；内部用 `Map<hubId, {agent, pid, workspaceDir, startedAt}>`；调 `ptyManager.spawn({sessionId: 'hub:<hubId>', agent, cwd: hub-workspace})`；listen ptyManager exit 事件清理 Map。
   - `packages/server/src/routes/hub-session.ts`：3 端点（POST 启动 / DELETE 停止 / GET 列表），zod 校验，操作日志起止配对，scope='hub'。
   - 启动时调 `injectMcpForAgent`-类逻辑生成 `<hub-workspace>/.mcp.json`（包含 mcp-hub server spawn 命令 + `env.HUB_TOKEN`）；**不**写真实项目的 .mcp.json。
   - **verify**：build 通过；`curl POST /api/hub/session -d '{"agent":"shell"}' -H 'X-Hub-Token:<real>'` 能起一个 hub shell session（用 shell 测最简）+ ws 能订阅 hub:<id> 拿到输出。
3. **后端：MCP server 单文件 bin**
   - `packages/server/src/mcp-hub/index.ts`：node bin，shebang `#!/usr/bin/env node`；imports `@modelcontextprotocol/sdk`；连 stdio；注册 6 个工具（list_projects / get_project_sessions / read_git_log / read_file / dispatch_to_project / hub_status）；每个工具内部 `fetch('http://127.0.0.1:<port>/api/hub/...', {headers: {'X-Hub-Token': process.env.HUB_TOKEN}})`；统一错误回包 `{code, message, retryable, details}`。
   - read_file 防越界：`resolve(projectPath, relPath)` 后必须以 projectPath 开头 + 拒绝绝对路径 / `..` 残留 + 大小 ≤ 1MB + 前 8KB 不含 \0；失败返回结构化错误。
   - dispatch_to_project agent 白名单仅 `['claude','codex']`（shell 留给浏览器 UI 直派——不让 hub 在别人项目里跑任意 shell）；text 长度 ≤ 20_000。
   - `packages/server/package.json` 加 bin entry：`"bin": {"aimon-mcp-hub": "dist/mcp-hub/index.js"}`。
   - **verify**：build 通过；手动 `node packages/server/dist/mcp-hub/index.js < hello-payload.json` 能完成 MCP 握手（list tools / call hub_status）；list_projects 返回真实数据。
4. **后端：扩展现有 /api/hub/status 加 fields=fast**（如有必要）+ 新增辅助接口给 MCP 用
   - 评估：MCP 工具大多能用现有 `/api/hub/status` + `/api/hub/dispatch` + 新加 `/api/hub/projects/:id/git-log` + `/api/hub/projects/:id/read-file` 完成。
   - 新增 `GET /api/hub/projects/:id/git-log?n=10`（复用 `git-service.listCommits`）+ `GET /api/hub/projects/:id/file?path=<relPath>`（复用 git-service.readFileAtRef 或 fs.readFile，带路径校验）。
   - 路径校验 helper 抽到 `packages/server/src/hub-path-guard.ts`，给 MCP server + routes/hub.ts 复用。
   - **verify**：build 通过；curl 两个新接口都返回预期；路径越界返回 400 `{error: 'path_escape'}`。
5. **前端：HubTerminal 简化版**
   - 新增 `packages/web/src/components/hub/HubTerminal.tsx` —— xterm Terminal + WebGL/canvas 渲染 + WS 订阅 `hub:<hubId>` + 键盘透传到 PTY。
   - 关键差别：**没有** task binding / worktree / permission drawer / 评论锚点 / activeSessionIdByProject 等项目级状态；**有** 顶栏简化 status + 停止按钮。
   - 复用 ws.ts 的 `aimonWS.subscribe / sendInput` API（不需要改 ws.ts，因为它已经按 sessionId 工作，hub:<id> 是个合法 sessionId）。
   - **verify**：build 通过；前端 hub 视图启动 shell hub session（暂时跳过 MCP 注入）能看到终端正常显示 + 输入回显。
6. **前端：HubView 接入 + 启动/停止 UI**
   - `HubView.tsx` 右半改造：未启动时显示"启动 hub session"占位（agent 下拉 + 启动按钮）；已启动时渲染 `<HubTerminal hubId={...} />` + 顶栏 "停止 hub session" 按钮。
   - 启动/停止接口：`api.startHubSession({agent})` / `api.stopHubSession(hubId)`；types.ts 加相关类型；store.ts 加 `currentHubSession: HubSessionInfo | null` + setter（持久化到 sessionStorage 不到 localStorage——浏览器关掉重启就清，符合 hub session 不持久化的设计）。
   - 按钮接 `logAction('hub', 'session-start/stop', ...)`。
   - **verify**：build 通过；浏览器完整走一遍：启动 hub claude → hub 终端显示 claude TUI → 跟 hub claude 说 list_projects → hub claude 调 MCP 工具回复 → 派工到其它项目能在看板和原项目工作区看到效果。
7. **白名单 + grep + tester**
   - `git diff --name-only HEAD` + `git ls-files --others --exclude-standard` 对照 tasks.json `write_files` 白名单，越界回滚。
   - grep `mcp-hub|hub-session-runtime|HubTerminal|HUB_TOKEN` 确认无残留旧调用。
   - **vibespace-browser-tester** 派工（如可用，跑上面 浏览器可见 验收清单 + 安全清单）；不可用则 handoff 标注留大哥手验。
   - 安全 smoke：手测路径越界、超大文件、二进制文件三个攻击向量都被拒绝。

## 边界情况

- **hub workspace 目录已存在但损坏**（被外部删了 .mcp.json）：启动时自动重新生成 .mcp.json，不报错。
- **hub session 启动时 PTY 失败**（claude 二进制不存在）：清理 Map 条目、返回 500 `{error: 'spawn_failed', detail}`，前端弹 toast。
- **MCP server bin 没编译**（用户没跑 build）：injection 时检查 dist 路径存在；不存在则降级——hub session 还能起，但 hub claude 看不到 MCP 工具，前端 hub 视图显示提示 "MCP 工具未就绪（请运行 pnpm build），hub claude 暂时只能本地执行"。
- **hub session 异常退出**（claude 崩了）：ptyManager exit 事件触发 → runtime 清理 Map → 前端 store 通过 WS exit 消息得知 → HubView 右半切回"启动 hub session"占位 + 一条 error 日志。**不自动重启**（Codex 第 26 点 of 第 1 期 / 第 17-18 点 of 第 2 期：避免循环拉起坏进程）。
- **token 不匹配**（外部进程伪装调 /api/hub/）：401，操作日志 warn 一条 `unauthorized` 含 IP。
- **MCP read_file 读 .gitignore 之外的敏感文件**（如 `.env`）：第 2 期**不**做内容过滤（YAGNI——用户配置的项目 path 是他自己的，他知道里面有什么；后续期可加），但路径校验防越界。
- **dispatch_to_project 目标项目刚被删**：复用现有 `/api/hub/dispatch` 已有的 project_not_found 处理（404），MCP 工具返回结构化错误。
- **同时启动多个 hub session**：第 2 期允许（每个 hubId 独立 Map 条目 + 独立 PTY），但前端 HubView 第 2 期**只**渲染当前会话最近启动的 1 个（多 hub session 的多 tab UI 留待后续）。
- **WebSocket 断线**：HubTerminal 复用 aimonWS 自动重连，重连后重新 subscribe；hub session 的 PTY 不受影响（PTY 跟 WS 独立）。
- **多 VibeSpace 实例同机**：token 隔离生效——hub claude 只能调起它那个 instance 的 server。

## 风险与注意

- **MCP SDK 学习曲线**：`@modelcontextprotocol/sdk` 是首次引入。如果 API 稳定性差 / 文档缺失 / 跟 claude CLI 的握手有兼容问题，实施步骤 3 可能卡 0.5-1 个会话。**熔断**：卡超过 2 次试探仍未通 hub_status 自检就停手，回头问大哥是否改走 "shell + curl" 简化路径（Codex 第 28 点逃生口）。
- **claude/codex CLI 对 .mcp.json 的发现行为差异**：browser-use MCP 实测有效（前任务已落地），但 codex 模式用 --mcp-config 是否需要在 hub session spawn 命令里加这个 flag、加在哪——需要执行阶段实测确认。如果 codex 不能直接发现 hub workspace 的 .mcp.json，可能需要在 ptyManager.spawn 时传额外 env。
- **未提交改动叠加**：本任务会动 `index.ts`（注册新路由）、`store.ts`（加 hub session state）、`types.ts`（加类型）、`api.ts`（加客户端）、`Workbench.tsx`（不动，HubView 内部分支即可）、`HubView.tsx`（加右半 UI）。这些文件**5 个**已被前任务草稿/已交付任务修过——每改一处先 Read 确认无冲突。auto.md 2026-05-02 "未提交核心文件先确认归属" 直接命中。
- **token 设计简单但有泄漏面**：token 在 .mcp.json 明文 + 进程 env。本地单用户场景下可接受；但**绝不**能把 token 记进操作日志（log meta 要过滤 HUB_TOKEN env）；**不**写到 git。
- **HubTerminal 是新组件**：可能错过 SessionView 的某些精细行为（如 IME 守卫、TUI 全屏态、键盘透传白名单）。auto.md 2026-05-02 "xterm/IME/TUI 复杂组件优先稳定挂载" 命中——第 2 期 HubTerminal 故意做简化版，**不**承诺跟 SessionView 等价；如果大哥实测 hub 终端体验明显劣化，第 2.5 期再迭代。
- **破坏性变更协议**：本任务**新增** hub session runtime + MCP server + HubTerminal，**修改**少数前端文件加状态/UI——不修改任何现有导出符号、不动 DB schema、不动现有路由签名。**不**触发协议。
- **熔断**：同一步骤 verify 失败 2 次仍不过停手，把错误日志、试过的方案、当前疑惑打印给大哥。

## 多模型 Plan 会审

> [Gemini 评审] 跳过：任务结构虽大但聚焦（独立 MCP server + 独立 hub runtime + 独立 HubTerminal——三个新模块互相低耦合），无跨多模块深度依赖追踪需求，Gemini 长上下文边际收益低。
> [Codex 评审] 已完成（本轮对话中执行），关键采纳 11 条 + 反对升级新 package：(1) MCP server 做成 `packages/server/src/mcp-hub/index.ts` 单文件 bin entry，不新建 pnpm 子包；(2) MCP 配置只写 `data/hub-workspace/.mcp.json` 不污染真实项目；(3) 用 `@modelcontextprotocol/sdk` 官方 SDK，不手写 JSON-RPC；(4) loopback 鉴权 + 加一次性 token 防多实例误连；(5) MCP 工具 zod 严格校验，read_file 路径越界 + 大小 + 二进制三重防护；(6) hub session **不进 sessions 表**走独立 runtime（保留 D1 不破坏 21 路由）；(7) MCP 生命周期由 CLI stdio spawn 自然绑定，不要常驻；(8) **HubTerminal 自写不复用 SessionView**（避免 hub 逻辑扩散到普通 session 页）；(9) 第 2 期只开放读+派工白名单工具，**不**开 stop/delete/write_file；(10) MCP 工具调用进 LogsView 起止配对；(11) dispatch_to_project agent 白名单仅 claude/codex 不让模型传任意命令。本期 plan 以上 11 条全部落地。
> [Codex 综合主笔] 跳过：plan 已由 Claude 草拟完整六段并吸收 Codex 11 条评审 + 大哥已通过"继续"接受修正版方案。本任务量级 + 决策清晰度下，再走综合主笔属过度流程（参 manual.md 2026-04-24 "小功能直接改"偏好精神扩展）。
> [Claude 白话化兜底] 检查项：(1) 大哥摘要 4 段白话（重点：能做什么、不能做什么、怎么验、为何隔离 cwd），术语括号翻译（MCP / cwd / stdio / token / PTY 等）；(2) 全文术语括号翻译保留；(3) manual.md 偏好对齐：浏览器可观察验收 ✓、自派 tester ✓、只在 plan 后停一次 ✓、专业术语翻译 ✓；(4) Codex 评审第 22 点（不开破坏性工具）已纳入"非目标"段并在"目标"段第 1 点的工具列表显式列出 6 个白名单；(5) 熔断点（MCP SDK 学习曲线）+ 简化路径（shell+curl）已写进"风险与注意"，避免方案被新技术依赖卡死无退路。
