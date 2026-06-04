# 移除施工边界 · Context

## 关键文件

执行阶段原则上只动以下 9 个源码文件 + 1 个删除文件 + 1 个 package.json + 1 个 lockfile。任何溢出先回来补 context。

### 前端（4 处）

1. **`packages/web/src/types.ts`**
   - `L86`：`export interface SessionScope { ... }` 整段删除。
   - `L105-106`：`Session` 接口里 `/** Omitted when ... */` 注释 + `scope?: SessionScope` 字段删除。
   - **保留**：`L167 / L183 / L205` 三处 `scope: string`（日志条目分类字段，与 SessionScope 同名不同义）。

2. **`packages/web/src/api.ts`**
   - `L39`：import 列表里 `SessionScope,` 删除。
   - `L165`：`createSession` 入参 `scope?: SessionScope` 字段删除。

3. **`packages/web/src/components/StartSessionMenu.tsx`**
   - `L6`：import 里去掉 `SessionScope`。
   - `parseGlobs` 函数（plan 里点名）整段删。
   - state：`scopeEnabled` / `rwText` / `roText` 三个 useState 删除。
   - `start()` 里 `L151` 起的 `const scope: SessionScope | undefined = scopeEnabled ? ... : undefined`、传 `createSession` 的 `scope` 实参、`enriched` 兜底、`logAction` meta 里的 `scoped: scopeEnabled` —— 全部删，`logAction` meta 只保留 `agent` 与 `isolation`。
   - JSX：`L259-298` 那段 `🛡 启用施工边界` checkbox + 两个 textarea + 提示文本删除。**注意 plan 风险点 3**：外层 `<div className="px-3 pt-2 pb-1.5 border-b border-white/[0.06]">` 容器还包着 `🌿 工作区隔离`，不要整删，只删施工边界这一层 label/textarea。

4. **`packages/web/src/components/editor/EditorArea.tsx`**
   - `L33-?`：`scopeBadge(session)` 函数整段删。
   - `L285`：渲染 tab 时 `const b = scopeBadge(s)` 那个 IIFE 整段删，注意保持周围 JSX 结构。

### 后端（3 处）

5. **`packages/server/src/routes/hooks.ts`**
   - `L4`：`import picomatch from "picomatch"` 删。
   - `L5`：`import { ..., getSessionScope }` 里去掉 `getSessionScope`，保留 `appendEvent` / `getProject` / `getSession`。
   - `L3`：`relative / isAbsolute / resolve` 三个 `node:path` import —— grep 确认仅 `toRelPosix` 用，可一并删。
   - `WRITE_TOOLS` 常量、`ScopeDecision` interface（`L61`）、`toRelPosix`、`evaluateScope`（`L74`）、`extractToolFilePath`、`PreToolUsePayload` 类型、`checkScopeForPreToolUse`（`L195`）—— 全删。
   - **PreToolUse 分支不能整段删！** 该分支里有两块逻辑：(a) scope 检查（`L252-273`，`checkScopeForPreToolUse` 与 `kind:"scope_block"` 事件），(b) Task 工具的 subagent 注册（`L274-295`，`extractTaskInvocation` + `subagentRuns.registerStart`）。**只删 (a)**，保留 (b)；PostToolUse 分支（`L298-312`，subagent `markDone`）也保留。
   - **保留**：SessionStart 注入 memory 逻辑、`appendEvent({ kind: "hook", ... })`、`statusManager.handleClaudeHook`、`app.log.info({ sessionId, event }, "claude hook")`、`extractTaskInvocation`、`subagentRuns.registerStart` / `markDone`、PostToolUse 分支整段。

6. **`packages/server/src/routes/sessions.ts`**
   - `L11 / L14 / L21`：db.js import 里去掉 `getSessionScope` / `setSessionScope` / `type SessionScope`。
   - `L44-84`：`GlobListSchema` / `ScopeSchema` / `type ScopeInput` 整段删。
   - `L102`：`CreateSessionSchema` 里 `scope: ScopeSchema.optional()` 删。
   - `L131`：`WireSession.scope?: SessionScope` 删。
   - `L137-149`：`serialize(s, scope?)` 简化为 `serialize(s)`，函数体删 `if (scope) base.scope = scope;`。
   - `L156-158`：`attachScope` 整函数删；`L169` 的 `.map(decorateStatus).map(attachScope)` 改成 `.map(decorateStatus).map(serialize)`。
   - `L181`：`startSession` 调用点删 `scope` 实参。
   - `L237`：PATCH task 响应 `serialize(decorateStatus(updated), getSessionScope(id) ?? undefined)` → `serialize(decorateStatus(updated))`。
   - `L329`：`startSession` 函数签名删 `scope?: ScopeInput`。
   - `L367-374`：`// Persist scope before spawn` 整段删。
   - `L490-494`：POST 响应里 `serialize(..., scope ? {...} : undefined)` → `serialize(...)`。

7. **`packages/server/src/db.ts`**
   - `L153`：`migrate()` 里 `CREATE TABLE IF NOT EXISTS session_scopes (...)` 整段删。
   - `L279`：`SessionScope` interface 删。
   - `L514-?`：`// ---------- Session scope CRUD ----------` 注释 + `SessionScopeRow` interface（`L516`）+ `getSessionScope`（`L534`）+ `setSessionScope`（`L549`）整段删。
   - **保留**：`session_scopes` 表本身（孤儿表，不写 DROP）。

### 依赖与类型声明

8. **`packages/server/src/types/picomatch.d.ts`**：整文件删除。
9. **`packages/server/package.json`** `L21`：`"picomatch": "^4.0.0",` 删除。
10. **根目录 `pnpm-lock.yaml`**：`pnpm install` 同步。

### 不动清单（防误伤）

- `packages/web/src/store.ts` 里的 `scope: 'ws' / 'session'` —— 日志分类。
- `packages/web/src/logs.ts`、`main.tsx`、`sendToSession.ts`、`LogsView.tsx` 里的 `scope` —— 日志分类。
- `dev/active/修复后端启动/main-start.log` / `dev/archive/施工边界/` / `dev/active/接入-browser-use/` 等历史档案 —— 全部保留原样。
- `session_events` 表里历史 `kind="scope_block"` 行 —— 死数据，不清。
- `session_scopes` 表本身 —— 孤儿表，不写迁移 DROP。

## 决策记录

### D1. 留孤儿表 vs 写 DROP 迁移

**选**：留孤儿表 `session_scopes`，不写 DROP。
**为什么不**：`migrate()` 历史经验里有"别在 migrate 里 DELETE / DROP"的教训（误伤、回滚不可逆）。本次 DROP 价值低（一个空表占不到几 KB），代价可控但有风险，不划算。
**资深工程师视角自检**：会不会过度保守？不会 —— 删一个不再被读的孤儿表属于"环境清洁"，不属于"删功能"。如果未来真有人觉得碍眼，另起一次性脚本删，比放进本任务安全。

### D2. 历史日志事件不清理（`kind="scope_block"`）

**选**：不删 `session_events` 里 `scope_block` 的旧行，新代码不再写新行即可。
**为什么不**：清历史日志属于追加任务，跟"删功能"是两回事。LogsView 只显示内存 500 条，磁盘上的历史 `.log` 也是档案，无副作用。

### D3. 不重命名 / 不重构相邻代码

**选**：删 scope 相关段落即可，hooks.ts / sessions.ts / StartSessionMenu.tsx 里相邻代码风格、命名、分块、留下来的 import 顺序都不动。
**为什么不顺手重构**：本次是外科切除，不是重写。删完后这几个文件结构上会比之前"瘦"一截，看起来可能不够整齐 —— 但保持现状的成本是 0，重构的成本是引入与本任务无关的 diff 和审阅噪声。
**资深工程师视角自检**：会不会被认为过度设计？反而是反过来 —— 本任务是减少抽象，把 ScopeDecision / evaluateScope / WRITE_TOOLS 这些只服务于一个被废弃功能的"灵活性"全部摘掉，符合 CLAUDE.md 里"不做没人要求的灵活性"。

### D4. picomatch 直接依赖删除，不管 transitive

**选**：只删 `packages/server/package.json` 里 server 自己声明的 direct dep。如果 fastify / better-sqlite3 / 其他间接拉了 picomatch，那是它们的事。
**为什么**：`pnpm-lock.yaml` 里 picomatch 节点如果还在，是 transitive 引入，不是污染。不应该为了"lock 里完全没有 picomatch"去拆别人的依赖树。

### D5. 类型文件 `picomatch.d.ts` 整删 vs 保留

**选**：整文件删。
**为什么**：是为了 picomatch 这个 dep 写的 ambient 声明，dep 删了它也就没有引用对象。保留属于死代码。

### D6. 不新增操作日志埋点

**选**：本任务不新增埋点。
**为什么**：CLAUDE.md 操作日志规则里明确"纯重构、纯样式、纯类型修复（行为没变）"豁免，但本任务是"删功能"——表面上 UI 行为是变了（菜单少了一行 checkbox），但用户可主动触发的"操作"反而少了一个，没有新 mutation 路径要埋。`session start` 的起止配对仍然存在，只是 meta 里少一个 `scoped` 字段，不影响配对本身。

## 依赖与约束

### 上游 / 下游

- **SessionStart hook 注入 memory**：`hooks.ts` 里 `event === "SessionStart"` 那段（读 `dev/memory/auto.md` + `manual.md` 注入 additionalContext）**绝对保留**。本仓库的"可持续记忆"功能依赖它。
- **`appendEvent({kind:"hook"})`**：保留。LogsView 起止配对里读这个。
- **`statusManager.handleClaudeHook`**：保留。session 状态管理依赖。
- **`app.log.info({ sessionId, event }, "claude hook")`**：保留。fastify 自身日志，跟 LogsView 无关但是排障要看。

### 兼容性

- **POST /api/hooks/claude 旧客户端**：删 PreToolUse 分支后，旧客户端发 PreToolUse 进来不会报错，行为退化为"只记录 `kind:"hook"`、不再返回 `decision: "block"`"。**fail-open** 是预期行为。
- **WS 推送的 session 对象**：删 `Session.scope` 后，后端不再带 `scope` 字段，前端 store 接收无副作用（types.ts 里也删了）。
- **PATCH /sessions/:id 响应**：原本会拼回 `getSessionScope(id) ?? undefined`，删除后响应不再有 `scope` 字段，前端读不到也正常。

### TypeScript 编译兜底

- 静态类型语言项目：每改完一个包，至少跑一次 `pnpm -F @aimon/server build` / `pnpm -F @aimon/web build`，让 TS 抓漏（store 里如果有遗漏的 `s.scope` 读法 / 任何一处忘删的 import / serialize 调用签名漏改）。
- 改完 `serialize` 签名要逐个核对调用点：sessions.ts 里有 4 处（GET 列表、POST 响应、PATCH 响应、startSession 内部）—— **plan 风险点 2**，TS 会兜底但人也要看一遍不要漏。

### 验收必经路径

- **浏览器手测**：plan 验收 2/3/4/5 的步骤是可执行清单，tasks 阶段每条对应一个 verify。
- **hooks fail-open 验证**：用 `curl` 或浏览器 devtools 给 `/api/hooks/claude` POST 一个 `{event:"PreToolUse", session_id:"任意已存在 session", tool_name:"Edit", ...}`，期望 `{ok:true}` —— **plan 验收 4**，需要本地起 server 才能跑。
- **LogsView meta 检查**：起一个 session，LogsView 看到 `scope=session action=start`（这里 scope 是日志分类，不是 SessionScope）的起止配对，meta 展开不再有 `scoped` 字段。

---

context 写完。请确认无误后我进入 Tasks 阶段拆步骤清单。
