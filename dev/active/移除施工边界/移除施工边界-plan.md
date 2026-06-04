# 移除施工边界 · Plan

## 背景

"施工边界（SessionScope）"是给 session 配 readwrite/readonly glob、由后端 `/api/hooks/claude` 在 PreToolUse 阶段拦 Edit/Write/NotebookEdit/MultiEdit 的功能。大哥在使用中确认它的实战性价比不高（要预先列 glob、被拦后打断节奏、跟 worktree 隔离 + 看 diff 这条主路相比冗余），决定整个拆掉。

> memory 扫过：`dev/memory/auto.md` 与 `dev/memory/manual.md` 无相关条目。

## 目标

把项目里跟"施工边界"相关的**前端 UI、API 透传字段、后端校验/拦截逻辑、数据库读写函数、相关依赖**整套删掉，让 session 创建链路里彻底不再出现 `scope` 概念。

### 验收标准

1. **类型检查全过**：`pnpm -F @aimon/server build` + `pnpm -F @aimon/web build` 都成功，**无 TS 报错、无新 warning**（`SessionScope` / `getSessionScope` / `picomatch` 等被删的符号不应再被任何文件引用）。
2. **浏览器可观察 1 — UI 不再有勾选框**：启动 dev（server + web），任意项目点 ▶ 启动 → 弹出菜单里**只剩** `🌿 工作区隔离` 一行 checkbox，**不再有 🛡 启用施工边界** 那一行，也没有可写/只读 glob 的两个 textarea。
3. **浏览器可观察 2 — tab 上不再有 scope 徽标**：随便起一个 session，session tab 上**不会出现** `🛡 rw:N ro:N` 琥珀色徽标（包括从老数据库里读出来的、之前曾经配过 scope 的 session 也不应再显示）。
4. **后端不再拦截**：手动给 hooks 端点 POST 一个伪造的 `event=PreToolUse` 带 `tool_name=Edit`、`file_path` 指向任意路径，response **不应** 出现 `decision: "block"`。response 形如 `{ ok: true }` 即可。
5. **LogsView 起止配对仍正常**：起一个 session，LogsView 看到 `scope=session action=start` 的 info 起 + info 终（"成功 (Nms)"），meta 里**不再有** `scoped` 字段（只剩 `agent` 与 `isolation`）。
6. **依赖清理**：`packages/server/package.json` 不再有 `picomatch` 这条 dep；`pnpm install` 后 `pnpm-lock.yaml` 同步移除；`packages/server/src/types/picomatch.d.ts` 已删除。

## 非目标 (Non-Goals)

- **不动 worktree 隔离功能**：`isolation` 字段、`git-service.ts`、`worktree-paths.ts`、`session_worktrees`/sessions 表 worktree 列、相关 UI 都保留。这是另一条独立路径。
- **不写 DROP TABLE 的迁移**：现有数据库的 `session_scopes` 表保留为**孤儿表**，不做清理。理由：`migrate()` 历史经验里写过"别在 migrate 里 DELETE"（dev/issues 里相关记忆），DROP 的风险（误伤、回滚不可逆）大于留个空表的代价；后续如果有人觉得碍眼可以另起一个一次性脚本删，不放进本任务。
- **不动历史档案**：`dev/active/修复后端启动/main-start.log`、`dev/archive/施工边界/`、`dev/active/接入-browser-use/` 等历史 plan/context/log 里有 "施工边界" / "scope_block" 字眼属于**历史快照**，全部保留原样不修改。
- **不重写日志事件名**：`session_events` 表里历史的 `kind: "scope_block"` 行不清理（理由同上：历史数据，无副作用）。新代码只是不再写新行。
- **不顺手重构 hooks.ts、sessions.ts、StartSessionMenu.tsx**：删掉 scope 相关段落即可，相邻代码风格、命名、分块都不动。
- **不改 logs.ts / LogsView 里"scope"这个名字**：那是日志分类的 scope（如 `scope: 'session'`），跟 SessionScope 同名不同义，不要误删。

## 实施步骤

粗粒度的删除顺序，按"从外到内、先前端再后端、最后清依赖"走：

### A. 前端清理

1. **`packages/web/src/types.ts`**：删 `SessionScope` 接口；从 `Session` 接口删 `scope?: SessionScope` 字段。
   → verify：`Grep "SessionScope"` 在 web 包应只剩使用 import 的两处仍报错（StartSessionMenu / api），下一步处理。
2. **`packages/web/src/api.ts`**：从 import 删 `SessionScope`；从 `createSession` 入参对象删 `scope?: SessionScope` 字段。
   → verify：grep `SessionScope` 在 api.ts 没有了。
3. **`packages/web/src/components/StartSessionMenu.tsx`**：
   - 删 import 里的 `SessionScope`、`SessionScope` 同行；
   - 删 `parseGlobs` 函数；
   - 删 state `scopeEnabled` / `rwText` / `roText`；
   - `start()` 里删 scope 构造、删传给 createSession 的 `scope` 实参、删 `enriched` 里 scope 兜底（直接 `addSession(s)`）；
   - `logAction` 的 meta 里删 `scoped: scopeEnabled`（保留 agent + isolation）；
   - 删 UI 区块：`🛡 启用施工边界` checkbox + 两个 textarea + 提示文本。
   → verify：`pnpm -F @aimon/web build` 通过；浏览器手测见验收 2、3、5。
4. **`packages/web/src/components/editor/EditorArea.tsx`**：删 `scopeBadge()` 函数；删 tab 渲染里调用 `scopeBadge(s)` 那个 IIFE 块。
   → verify：grep `scopeBadge` 在 web 包为空。

### B. 后端清理

5. **`packages/server/src/routes/hooks.ts`**：
   - 删 `import picomatch from "picomatch"`；
   - 删 `import { ..., getSessionScope }` 里的 `getSessionScope`（保留 `appendEvent`、`getProject`、`getSession`）；
   - 删 `relative, isAbsolute, resolve` 的 node:path import（确认这些只被 scope 路径用）；
   - 删 `WRITE_TOOLS` 常量、`ScopeDecision` 接口、`toRelPosix`、`evaluateScope`、`extractToolFilePath`、`PreToolUsePayload` 类型、`checkScopeForPreToolUse`；
   - 删 PreToolUse 分支整段（`if (event === "PreToolUse") { ... }`）；
   - 保留：SessionStart 注入 memory 的逻辑、`appendEvent({ kind: "hook", ... })`、`statusManager.handleClaudeHook`、`app.log.info({ sessionId, event }, "claude hook")`。
   → verify：`pnpm -F @aimon/server build` 通过；hooks.ts 里 grep `scope` 应为零。
6. **`packages/server/src/routes/sessions.ts`**：
   - 从 db.js import 删 `getSessionScope`、`setSessionScope`、`type SessionScope`；
   - 删 `GlobListSchema`、`ScopeSchema`、`type ScopeInput`；
   - 从 `CreateSessionSchema` 删 `scope: ScopeSchema.optional()`；
   - 从 `WireSession` 删 `scope?: SessionScope`；
   - `serialize(s, scope?)` 简化为 `serialize(s)`，函数体删 `if (scope) base.scope = scope;`；
   - 删 `attachScope` 函数；GET `/api/sessions` 的 `.map(attachScope)` 改成 `.map(serialize)`（保留 `decorateStatus`）；
   - PATCH task 的响应 `serialize(decorateStatus(updated), getSessionScope(id) ?? undefined)` → `serialize(decorateStatus(updated))`；
   - `startSession` 函数签名删 `scope?: ScopeInput` 参数；删 "Persist scope before spawn" 整段；POST 响应里的 `serialize(..., scope ? {...} : undefined)` → `serialize(...)`；
   - POST `/api/sessions` 调用 `startSession` 时不再透传 `scope`（传参少一个）。
   → verify：`pnpm -F @aimon/server build` 通过；sessions.ts 里 grep `scope|Scope` 全为零（注意保留 `serverLog` 的 `scope` 参数——日志分类用的，非本任务对象）。
7. **`packages/server/src/db.ts`**：
   - 删 `migrate()` 里 `CREATE TABLE IF NOT EXISTS session_scopes (...)` 整段；
   - 删 `SessionScope` 接口、`SessionScopeRow` 接口、`getSessionScope`、`setSessionScope` 函数。
   → verify：grep `session_scopes\|SessionScope\|getSessionScope\|setSessionScope` 在 server 包全为零。

### C. 依赖与类型声明清理

8. **`packages/server/src/types/picomatch.d.ts`**：整文件删除。
   → verify：文件不存在。
9. **`packages/server/package.json`**：dependencies 删 `"picomatch": "^4.0.0"`。
10. **根目录 `pnpm install`**：让 `pnpm-lock.yaml` 同步去掉 picomatch 节点。
    → verify：`grep -n "picomatch" pnpm-lock.yaml` 仅剩可能由其他 transitive deps 引入的条目（如果完全没有也 OK），原本作为 server 直接依赖的那条没了。

### D. 全量回归

11. **类型检查 + 浏览器手测**：
    - `pnpm -F @aimon/server build` ✅
    - `pnpm -F @aimon/web build` ✅
    - 起 dev（`init-stable.bat` 或 `pnpm dev`），浏览器走验收 2/3/4/5。
12. **操作日志埋点**：本任务**不新增** UI 操作或 mutation API（属于"删功能"而非"加功能"），不需要新埋点。`session start` 路径已有的起止配对会自动覆盖（meta 里少一个 `scoped` 字段，不影响配对本身）。

## 边界情况

- **老数据库残留**：现存 dev 环境的 sqlite 里可能还有：
  - `session_scopes` 表里的旧行 → 删了 `getSessionScope` 后没有读路径，等于死数据，不影响。
  - `session_events` 里 `kind="scope_block"` 的旧行 → 同上，没有读它的代码。
  - sessions 表的 `scope` 字段？**不存在** —— scope 一直是单独表 `session_scopes`，sessions 表本身没受污染。
- **客户端旧 store / WS 推送**：删 `Session.scope` 字段后，store 里如果有遗留的 `s.scope` 读法会被 TS 抓到（验收 1）；WS 推送的 session 对象后端不会再带 `scope`，前端读不到也无副作用。
- **PATCH /sessions/:id（绑定 task）路径**：原本会 `getSessionScope(id) ?? undefined` 拼回去，删除后响应里就不再有 `scope`——前端拿到没这字段也正常（types.ts 已删）。
- **POST /api/hooks/claude 旧客户端**：如果有遗留的 hook 客户端发 PreToolUse 进来，新代码不再判 scope，但 `appendEvent({kind:"hook"})` 仍写——行为退化为"只记录、不拦"，不报错。
- **picomatch transitive 引入**：可能 fastify / better-sqlite3 / 其他依赖间接拉了 picomatch 进来，那是它们的事，本任务只删 server 自己声明的 direct dep。

## 风险与注意

1. **删 hooks.ts 的 `relative/isAbsolute/resolve` 三个 import 前要确认**没有被别的代码块用（PreToolUse 之外）。从我读过的代码看仅 scope 路径用，但实际删时再 grep 一遍稳妥。
2. **`serialize(s, scope?)` 简化签名时**：sessions.ts 里有 4 处调用点（GET 列表、POST 响应、PATCH 响应、startSession 内部），逐个改干净，不要漏。TS 编译会兜底。
3. **`StartSessionMenu.tsx` 删 UI 区块时**：那个 `<div className="px-3 pt-2 pb-1.5 border-b border-white/[0.06]">` 容器**不要整个删**——它还包着 `🌿 工作区隔离` 那个 checkbox。只删施工边界 label + textarea 区块。
4. **EditorArea.tsx 删 scopeBadge 渲染**：那个 IIFE 在 worktreeBranch 徽标和 `nagging` 红点之间，删的时候注意保持周围 JSX 结构和 className 不变。
5. **历史档案约定**：`dev/active/修复后端启动/main-start.log`、`dev/archive/施工边界/` 以及任何 `dev/archive/*` 下的 .md / .log 文件**不要碰**。它们是历史归档。
6. **熔断**：如果某一步 `pnpm build` 反复报奇怪错误（比如残留了某个 SessionScope 引用一直找不到），同一处连改 2 次还过不了就停下来贴日志，不要为了"凑过编译"去改更深的代码或测试。
