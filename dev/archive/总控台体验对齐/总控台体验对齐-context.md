# 总控台体验对齐 · context

> 给 AI 自己看的执行边界与决策依据。大哥不审。

## 关键文件（本次改动边界）

### 新增（2 个）

| 文件 | 角色 |
|---|---|
| `packages/server/src/hub-project.ts` | `ensureHubProject()` —— server 启动早期 idempotent upsert `__hub__` 进 projects.json + 同步 DB；**必须在 syncProjectsTable 之前调** |
| `packages/web/src/components/sidebar/HubDashboardView.tsx` | 看板侧栏视图（搬自原 HubView 看板部分；复用 HubProjectCard / HubDispatchDialog） |

### 修改（11 个）

**后端 7 个**：
| 文件 | 改动内容 |
|---|---|
| `packages/server/src/index.ts` | 删 `registerHubSessionRoutes` 调用；加 `ensureHubProject()` 在 startup 早期（getDb / syncProjectsTable 之前） |
| `packages/server/src/routes/projects.ts` | DELETE / PUT workflow apply/remove 加 `__hub__` 守卫拒绝 |
| `packages/server/src/routes/sessions.ts` | POST 加 `__hub__ + isolation:'worktree'` 拒绝 |
| `packages/server/src/routes/fs-ops.ts` | delete + gitignore-add 加 hub-workspace 路径守卫拒绝 |
| `packages/server/src/routes/hub.ts` | 新增 `GET /api/hub/sessions/:id/recent-output?lines=N` |
| `packages/server/src/mcp-bridge.ts` | injectMcpForAgent 分支：projectId === '__hub__' 写 hub-workspace/.mcp.json（merge aimon-hub + browser-use），普通项目**只**写 browser-use |
| `packages/server/src/hub-workspace.ts` | 简化：保留 ensureHubWorkspace；删 writeHubMcpConfig（功能挪到 mcp-bridge） |
| `packages/server/src/mcp-hub/index.ts` | 加 `read_session_output(sessionId, lines)` 工具 |

**前端 5 个**：
| 文件 | 改动内容 |
|---|---|
| `packages/web/src/store.ts` | 删 selectedView/setSelectedView/SelectedView 类型/读写 helper；删 currentHubSession + sessionStorage；Activity 联合类型加 'hub-dashboard'；selectProject('__hub__') 自动 setActivity('hub-dashboard') |
| `packages/web/src/types.ts` | 删 HubSessionInfo / StartHubSessionRequest |
| `packages/web/src/api.ts` | 删 startHubSession / stopHubSession / listHubSessions；加 getSessionRecentOutput |
| `packages/web/src/components/layout/Workbench.tsx` | 删 selectedView === 'hub' 分支渲染，恢复原版（永远 ActivityBar + PrimarySidebar + EditorArea） |
| `packages/web/src/components/layout/ProjectsColumn.tsx` | 顶部 📊 总控台缩成 44px 窄图标（CSS 跟 ActivityBar item 一致）；项目卡列表 filter 掉 __hub__；高亮逻辑用 selectedProjectId === '__hub__' |
| `packages/web/src/components/layout/ActivityBar.tsx` | 加 `'hub-dashboard'` item（icon 📊 + label '总控台看板'），**仅** selectedProjectId === '__hub__' 时出现 |
| `packages/web/src/components/layout/PrimarySidebar.tsx` | 接入 'hub-dashboard' activity → 渲染 HubDashboardView |

> 注：上面文件数算 12 修改 + 2 新增（前端实际是 6 文件改，写错），下面 tasks.json 白名单按真实列。

### 删除（4 个）

```
packages/server/src/hub-session-runtime.ts
packages/server/src/routes/hub-session.ts
packages/web/src/components/hub/HubView.tsx
packages/web/src/components/hub/HubTerminal.tsx
```

### 保留不动（5 个，给本任务复用）

- `packages/server/src/hub-token.ts`（MCP 注入仍需要）
- `packages/server/src/hub-path-guard.ts`（hub.ts 仍用）
- `packages/server/src/routes/hub-session.ts` —— wait, this is 删除列表。划掉。
- `packages/web/src/components/hub/HubProjectCard.tsx`（HubDashboardView 复用）
- `packages/web/src/components/hub/HubDispatchDialog.tsx`（HubDashboardView 复用）

### 只读参考

- `packages/server/src/db.ts`（listProjects / syncProjectsTable / upsertProject 模式）
- `packages/server/src/routes/sessions.ts`（startSession 流程参考）
- `packages/server/src/pty-manager.ts`（recordPtyChunk 输出 buffer 实现，给 recent-output 用）
- `packages/web/src/components/layout/ActivityBar.tsx`（item 样式参考）
- `packages/web/src/components/layout/PrimarySidebar.tsx`（activity 路由模式）
- `dev/ARCHITECTURE.md` §2.1 路由 / §3.1 操作日志 / §4 关键文件索引

### 白名单（tasks.json write_files）严格 2 新 + 12 改 = 14

```
[新]
packages/server/src/hub-project.ts
packages/web/src/components/sidebar/HubDashboardView.tsx

[改]
packages/server/src/index.ts
packages/server/src/routes/projects.ts
packages/server/src/routes/sessions.ts
packages/server/src/routes/fs-ops.ts
packages/server/src/routes/hub.ts
packages/server/src/mcp-bridge.ts
packages/server/src/hub-workspace.ts
packages/server/src/mcp-hub/index.ts
packages/web/src/store.ts
packages/web/src/types.ts
packages/web/src/api.ts
packages/web/src/components/layout/Workbench.tsx
packages/web/src/components/layout/ProjectsColumn.tsx
packages/web/src/components/layout/ActivityBar.tsx
packages/web/src/components/layout/PrimarySidebar.tsx

[删]
packages/server/src/hub-session-runtime.ts
packages/server/src/routes/hub-session.ts
packages/web/src/components/hub/HubView.tsx
packages/web/src/components/hub/HubTerminal.tsx
```

实际 14 → 重新核对：2 新 + 15 改 + 4 删 = 21 个动作文件。**白名单清单总数 19**（修改 + 新 + 删都算）。tasks.json 按这个详列。

## 决策记录（吸收 Codex 11 条评审）

### D1：D1 翻转——hub 是真项目（本期唯一最重决策）

**原 D1**（第 1 期）：hub 不是项目，selectedView='hub' 视图状态。
**新 D1**（本期）：hub 是 projectId='__hub__' 真项目，所有 22 路由原生服务它。

**理由**：大哥明确要求"hub 终端跟正常终端显示一致，复用页签跟输入框"。Codex 评审认为方案 A 可行，但需要 13 处 filter。本期做 5 处必做，延后 8 处。

### D2：启动顺序硬要求（Codex 第 1 点最严重）

`ensureHubProject` 必须在 `syncProjectsTable / getDb` 之前调，否则 DB 同步发现 __hub__ 不在 projects.json 里会 CASCADE 删 hub sessions。

实现位置：index.ts startup 序列，跟既有 `chcp 65001 >nul`、cors register 一样早。

### D3：必做 5 处 filter（Codex 必做清单）

1. `DELETE /api/projects/__hub__` → 400 `cannot_delete_hub`
2. `PUT /api/projects/__hub__/workflow apply/remove` → 400 `hub_no_workflow`
3. `POST /api/sessions {projectId:'__hub__', isolation:'worktree'}` → 400 `hub_no_worktree`
4. `DELETE /api/fs-ops/...` 路径在 hub-workspace 内 → 400 `cannot_modify_hub_workspace`
5. `POST /api/fs-ops/gitignore-add` 同上

每处 serverLog warn 记一条，方便排查"为什么这个操作失败了"。

### D4：MCP 注入分流（Codex 第 4-5 点）

- `projectId === '__hub__'`：写 `hub-workspace/.mcp.json`，**merge** aimon-hub + browser-use（不覆盖既有 browser-use；如果新版 aimon-hub 配置变化要 deepEqual 后才覆盖）
- `projectId !== '__hub__'`：**只**写 browser-use，**不**注入 aimon-hub（普通 session 拿到 hub 工具就乱了）

实现位置：`mcp-bridge.ts` injectMcpForAgent 分支判断 + 合并逻辑。第 2 期 `hub-workspace.ts::writeHubMcpConfig` 删除（功能挪到这里）。

### D5：删除第 2 期独立 runtime（Codex 第 5 点确认安全）

- 删 `hub-session-runtime.ts` / `routes/hub-session.ts`
- mcp-hub 工具调的是 `/api/hub/status|dispatch|file|git-log`（第 1 期接口），**不**调 `/api/hub/session`（第 2 期独立 runtime 接口），删 runtime 不影响 MCP 工具
- 前端 currentHubSession + sessionStorage + 启动/停止 UI 全删

### D6：read_session_output 工具（新增）

- 后端 `GET /api/hub/sessions/:id/recent-output?lines=N`
- 来源：复用 pty-manager 现有 `recordPtyChunk` —— 看一下它现在的实现，是否暴露 / 还是要新增 ring buffer
- 默认 lines=200，max 1000
- MCP server 加同名工具
- 工具范围：能读**任意 session**（不限 hub）—— hub claude 派完任务能读那个 session 输出

### D7：看板搬侧栏（Codex 第 30 点）

- ActivityBar 加 `'hub-dashboard'` activity
- **只在 selectedProjectId === '__hub__' 时出现**（避免普通项目看到这个 icon 以为是项目级看板）
- HubDashboardView 渲染原 HubView 看板部分（HubProjectCard 列表 + 派工 dialog + 5s 轮询）
- 选 __hub__ 项目时自动 setActivity('hub-dashboard')

### D8：多 hub session = 普通 session（Codex 第 6 点）

- activeSessionIdByProject['__hub__'] 原生成立，不需要特殊处理
- 唯一注意：refreshProjects 不能因项目列表展示侧 filter 掉 __hub__ 把 selectedProjectId 重置（store 内部要保留 __hub__ 知识）

### D9：延后 8 处 filter（YAGNI 原则 + Codex 同意）

延后路由：docs / comments / issues / memory / perf / paste-image / skill-catalog / output / cli-configs / jobs / openspec / project-docs。

**用户感知 trade-off**：在 hub 项目下点这些侧栏 tab 会返意外结果（如 hub 下 git status 报 not_a_git_repo）。handoff 摘要明说这条。

## 依赖与约束

- **db.ts upsertProject 行为**：本任务 ensureHubProject 复用既有 upsert 模式（避免重写 SQL），同时确保 projects.json 写入幂等（已有 __hub__ 条目就 no-op）
- **mcp-bridge.ts 既有 injectClaude / injectCodex**：本任务在 injectMcpForAgent 顶层加分支，**不**改 injectClaude/injectCodex 内部（它们写项目根 .mcp.json 的行为仍然存在但只对非 hub 项目）
- **删除文件的检查**：删 hub-session-runtime / routes/hub-session.ts 前 grep 整个 server 包确认无 import 残留
- **前端 store 字段删除会触发 TS 编译报错**：所有调用方都会暴露，逐个修
- **未提交别任务草稿**：当前 git status 显示 store/types/api/index.ts/Workbench/ProjectsColumn 等已被前任务草稿改过。本任务**会再改**这些文件——每改一处先 Read 全文确认无冲突。manual.md 2026-05-02 "未提交核心文件先确认归属" 命中。
- **第 2 期 untracked 文件状态**：本任务删 HubView.tsx / HubTerminal.tsx（第 2 期 untracked，本任务删除）；HubProjectCard.tsx / HubDispatchDialog.tsx 保留不动。

## "过度设计自检"清单

- [x] 不做用户没要的功能：没有 hub 项目改名 / 改 path / 升降级 UI；没有"派工历史"独立面板。
- [x] 不做只用一次的抽象：HubDashboardView 直接复用 HubProjectCard 不再抽通用。
- [x] 不做没要求的灵活性：read_session_output 工具只读最近 N 行，没"从某行开始读 / 监听新输出"等高级。
- [x] 不写不可能场景的错误处理：__hub__ 项目重命名 UI 接触不到所以不防。
- [x] 行数估算：hub-project.ts ~60 / HubDashboardView.tsx ~120（HubProjectCard 复用） / mcp-bridge.ts +50 分支 / 5 处 filter guard 共 ~100 / read_session_output 后端 + MCP ~100 / index.ts +5 / 删除 ~600 行（hub-session-runtime + routes/hub-session + HubView + HubTerminal）/ 前端 store 删 50 加 20 / types -20 / api +10 -20 / Workbench -15 / ProjectsColumn 调整 ~30 / ActivityBar +10 / PrimarySidebar +5 = 约 **新增 410 行 + 删除 700 行 = 净 -290 行**，整体 codebase 变小是好事。
- [x] 项目级 MCP 配置不动：browser-use MCP 注入逻辑保留（只是去掉 aimon-hub 普通项目注入分支）
- [x] 破坏性变更协议触发，但 TS 编译会捕获绝大多数残留；grep 双保险。
