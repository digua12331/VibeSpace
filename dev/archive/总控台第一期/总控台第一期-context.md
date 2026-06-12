# 总控台第一期 · context

> 给 AI 自己看的执行边界与决策依据。大哥不审。

## 关键文件（本次改动边界）

### 新增（4 个文件）

| 文件 | 角色 |
|---|---|
| `packages/server/src/routes/hub.ts` | 后端 3 个端点（GET status / GET projects/:id/detail / POST dispatch） |
| `packages/web/src/components/hub/HubView.tsx` | 主视图（左看板 + 右占位） |
| `packages/web/src/components/hub/HubProjectCard.tsx` | 单项目折叠卡 + session 列表 + 按钮区 |
| `packages/web/src/components/hub/HubDispatchDialog.tsx` | 派工弹框（agent 下拉 + 文本框） |

### 修改（7 个文件，全部小改）

| 文件 | 改动内容 |
|---|---|
| `packages/server/src/index.ts` | 加 `await registerHubRoutes(app)` 一行（与现有 21 个 register* 并列） |
| `packages/web/src/api.ts` | 加 `getHubStatus()` / `getHubProjectDetail(id)` / `hubDispatch(...)` |
| `packages/web/src/types.ts` | 加 `HubStatus / HubProject / HubSession / HubProjectDetail / HubDispatchRequest / HubDispatchResponse` 类型 |
| `packages/web/src/store.ts` | 加 `selectedView: 'project' \| 'hub'` 字段 + setter + localStorage 持久化（key `aimon_selected_view_v1`） |
| `packages/web/src/components/layout/ProjectsColumn.tsx` | 列表顶部固定 📊 总控台入口（特殊样式 + 不响应右键） |
| `packages/web/src/components/layout/Workbench.tsx` | `selectedView === 'hub'` 走 `<HubView />`，否则走现有主区 |
| `packages/web/src/main.tsx` | 若 WS 消息需要触发 HubView 增量重渲染，必要时这里桥接（评估后可能不动） |

### 只读参考

- `packages/server/src/db.ts`（`listProjects` / `getSession` / `Project` / `Session` 类型）
- `packages/server/src/pty-manager.ts`（`listAlive` / `getPid` / `createSession` / `writeInput`）
- `packages/server/src/process-mem-service.ts`（per-project 内存数据来源；前面任务草稿，已带 `byProject` map）
- `packages/server/src/git-service.ts`（`getStatus` 等用于 dirty 字段）
- `packages/server/src/docs-service.ts`（dev/active 任务进度）
- `packages/server/src/log-bus.ts`（`serverLog` 签名）
- `packages/server/src/routes/sessions.ts`（参考既有 createSession route 模板）
- `packages/web/src/components/layout/ProjectsColumn.tsx`（既有项目卡渲染模式）
- `packages/web/src/components/layout/Workbench.tsx`（主区组装方式）
- `packages/web/src/store.ts`（`selectedProjectId` 持久化模式参考）
- `packages/web/src/api.ts`（`request()` 包装器、错误格式）
- `packages/web/src/logs.ts`（`logAction` / `pushLog`）
- `packages/web/src/ws.ts`（`aimonWS.subscribe` 监听模式）
- `dev/ARCHITECTURE.md` §2.1 Fastify 路由模板 / §3.1 操作日志 / §3.3 路由模板 / §3.4 前端 mutation / §4 关键文件索引

### 白名单（tasks.json `write_files` 严格 4+7 共 11 个）

```
packages/server/src/index.ts
packages/server/src/routes/hub.ts          ← 新
packages/web/src/api.ts
packages/web/src/types.ts
packages/web/src/store.ts
packages/web/src/components/layout/ProjectsColumn.tsx
packages/web/src/components/layout/Workbench.tsx
packages/web/src/components/hub/HubView.tsx            ← 新
packages/web/src/components/hub/HubProjectCard.tsx     ← 新
packages/web/src/components/hub/HubDispatchDialog.tsx  ← 新
packages/web/src/main.tsx                              ← 仅当必要时
```

**未提交改动叠加风险（auto.md 2026-05-02 命中）**：当前 git status 里 `index.ts` / `store.ts` / `types.ts` / `ProjectsColumn.tsx` / `main.tsx` 等已被别任务草稿改过。每改一个，第一步必须**先 Read 全文**确认既有改动是否跟本任务无关——无关保留共存、相关合并、冲突停手回 plan。

执行阶段每步 verify 后 `git diff --name-only HEAD` 比对，本任务新增/修改集合应该被白名单覆盖；如果出现白名单外文件，立即回滚或暂停。

## 决策记录（吸收 Codex 评审 + 大哥偏好）

### D1：hub 是"视图状态"，不是"虚拟项目"（Codex 第 1-4 点）

**采纳**：store 加 `selectedView: 'project' | 'hub'` 字段，跟 `selectedProjectId` 完全解耦。
- **拒绝方案 A**（真插一条 `kind: 'hub'` 进 projects.json）：会污染 21 个按 projectId 查询的后端路由，需要到处加 if 跳过。
- **拒绝方案 B**（后端 list 接口注入）：所有消费 projects 的前端代码都被迫认识虚拟项目。
- **拒绝方案 C**（前端硬拼 unshift 进 projects 数组）：跟 B 同样的问题，且 store 数据不一致。
- **方案 D（采纳）**：selectedView 是顶层视图路由状态，跟 selectedProjectId 平级；Workbench 分支渲染；projects 数据完全不动；后端零项目模型变更。

### D2：聚合接口分级（Codex 第 5-9 点）

**采纳**：`/api/hub/status` 只聚合**轻数据**（projects + alive sessions + 内存 + lastActivity），首屏快。
- **重数据**（git dirty / dev task 进度 / 错误数）→ `/api/hub/projects/:id/detail` 按需，仅在用户**展开**某项目卡时拉，背景每 30-60s 慢刷一次（且只刷已展开的，节流）。
- **拒绝 streaming**：现有 WS + 小接口足够，引入 streaming 是过度工程。

### D3：实时刷新走现有 WS（Codex 第 8 点）

**采纳**：HubView 订阅现有 store.sessions + store.memByProject 变化（已通过 ws.ts 推送），增量重渲染。不再发额外轮询请求。
- 慢变数据靠"展开时拉一次 + 30-60s 慢刷"。
- HubView **切走**时清掉所有 detail 轮询 interval。

### D4：第 1 期 dispatch **不**支持派给已有 session（Codex 第 17-19 点）

**采纳**：`POST /api/hub/dispatch` body `{targetProjectId, agent, text}` —— 永远新建 session。
- **拒绝"派给指定 sessionId"参数**：PTY 状态未知（idle / running / TUI 全屏 / 等用户输入），直接 sendInput 会破坏目标 session 当前 prompt。
- **session 状态机**留待第 2 期；那时再允许 `targetSessionId` 参数且仅在 idle 时放行。
- 看板 UI 上 session 行**没有「派任务」按钮**，避免用户期望落空。

### D5：第 2 期 MCP 不要跟 server 同进程反向 stdio（Codex 第 10-14 点）

**本期不实现**，但 plan 第 2 期路线确认走"独立 mcp-hub-server 进程 + HTTP 调 VibeSpace server"。本期接口设计为此预留：
- 参数明确、自完备（不依赖前端会话状态）
- zod 严格校验、错误码 snake_case
- 操作日志完整起止配对
- 返回字段足够 MCP 工具直接消费

### D6：hub 不绕过 per-project 权限（Codex 第 21 点）

**采纳**：dispatch 调用既有 `createSession()` 流程（不绕过、不简化），自然继承目标项目的所有 hook、MCP 注入、权限配置。
- **拒绝"超级管理员模式"**：未来真要 hub 全权限再单独做显式开关 + 操作日志（plan 非目标段已列）。

### D7：操作日志最小集

- `GET /api/hub/status` / `GET /api/hub/projects/:id/detail` → **不打日志**（高频读取，CLAUDE.md 操作日志规则豁免类）
- `POST /api/hub/dispatch` → 起止配对（scope=hub）
- 前端「停所有」/「停」批量 → `logAction('hub', 'stop-sessions', ...)`
- 前端展开/折叠卡片 / 切 selectedView → **不打日志**（UI 状态变化豁免）

### D8：HubView 文件拆分（不抽通用组件）

- `HubView.tsx` 顶层布局，约 80 行
- `HubProjectCard.tsx` 单项目卡（含 session 列表 + 按钮区），约 150 行
- `HubDispatchDialog.tsx` 弹框，约 80 行
- **拒绝**抽 `usePollingDetail` / `useCollapseState` 等 hook：只 1 处用、过度抽象。

### D9：localStorage 持久化 `selectedView`（小细节）

- key `aimon_selected_view_v1`
- 跟 `selectedProjectId` 持久化模式一致（`store.ts:367` 读 / `366` 附近写）
- 默认 `'project'`，防止首次访问意外落到 hub 视图

## 依赖与约束

- **后端路由模板**：严格按 `ARCHITECTURE.md` §3.3 写——zod safeParse 校验 + serverLog 起止配对 + try/catch + snake_case 错误码。
- **前端 mutation 写法**：`logAction('hub', 'dispatch', () => api.hubDispatch(args), { meta })`（ARCHITECTURE §3.4）。
- **session 创建复用**：dispatch 内部走 `createSession({projectId, agent, cwd: project.path, initialInput: text})` 或最接近的现有签名——查 routes/sessions.ts 当前实际 API 再决定。
- **没有前端单测框架**：本任务靠 build + tester（如可用）+ 后端 curl 探针。
- **跨 tab 共享 selectedView**：localStorage `storage` 事件订阅可以做但**第 1 期不做**（YAGNI）；多 tab 各自独立 selectedView。
- **macOS / Linux 兼容**：process-mem-service 是 Windows-only（powershell + CIM）；其它平台 byProject 永远空。第 1 期看板上"内存"列在非 Windows 显"—"占位，不报错。

## "过度设计自检"清单

- [x] 不做用户没要的功能：没有"按内存排序"、"按 agent 过滤"、"批量派工"等花活。
- [x] 不做只用一次的抽象：没有抽 `useHubPolling` / `usePerProjectExpand` 等 hook。
- [x] 不做没要求的灵活性：派工没"延迟执行"、没"模板"、没"历史记录"。
- [x] 不写不可能场景的错误处理：dispatch 不防"agent 是 emoji"等无意义输入；zod 校验+合法枚举值列表足够。
- [x] 行数估算：后端 hub.ts ~250 行（3 接口 + zod + 日志）；前端 HubView 顶层 ~80 / Card ~150 / Dialog ~80；store 增量 ~20；types 增量 ~50；api 增量 ~20；ProjectsColumn 增量 ~30；Workbench 增量 ~10；index.ts 增量 1 行。总计 ~700 行新增、~80 行修改，**对照 plan 估算（600+ 新增）符合**。
- [x] 项目级 MCP 配置不动：本期不动 .mcp.json 项目根任何文件。
- [x] 没有破坏性变更：新增字段不破坏既有 selectedProjectId 行为；新增路由不动既有 21 个；新增视图组件不改既有 EditorArea / SessionView。
