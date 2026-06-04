# 施工边界 · Context

> **v1 状态**：Plan 阶段已完成 POC 验证假设 A/B/C/D 全部通过；以下决策和改动清单是基于真实代码的盘点，作为 Tasks 阶段的边界。

## POC 结论汇总（来自 Plan 阶段）

| 假设 | 结论 | 备注 |
|---|---|---|
| A. PreToolUse 支持同步 block | ✅ | Hook 返回 `{"decision":"block","reason":"..."}` 立即阻断 Edit 工具调用，文件不动 |
| B. stdin JSON schema | ✅ | 字段：`tool_name` / `tool_input.file_path` / `cwd` / `hook_event_name` / `session_id`(Claude 的) / `tool_use_id` / `permission_mode` |
| C. env var 继承 | ✅ | hook 子进程能读到父 PTY 注入的 `AIMON_SESSION_ID` |
| D. hook 注册机制 | ✅（**已是既有能力**）| `hook-installer.ts::EVENTS` 已包含 `PreToolUse`，`AIMON_SESSION_ID` 已在 `pty-manager.ts:146` 注入 |

**Plan 中的步骤 5（env var 注入）、步骤 6（hook 注册）可删**：这两项在当前代码里已经生效，只是 aimon-hook.mjs 的 PreToolUse 分支没做阻断逻辑。

**额外收获**：Hook 的 `reason` 字段会**被 Claude 原样喂回给 AI**（POC stdout 里 Claude 复述了 "POC-BLOCK: hook unconditionally blocked..."）。意味着 scope 拒绝理由写得越清晰，AI 越能自我调整路径，不需要额外 UI 推送通知。

## 关键文件（会读 / 会改）

### 后端（packages/server）

| 文件 | 相关位置 | 本次改动 |
|---|---|---|
| `src/db.ts` | `migrate()` line 97-123 的 `db.exec` 建表块；类型 `Session` line 211 | **加**：`session_scopes` 表建表 SQL；CRUD 函数 `getSessionScope` / `setSessionScope`；类型 `SessionScope` |
| `src/routes/hooks.ts` | 整个文件 39 行 | **改**：`/api/hooks/claude` 在 `event === "PreToolUse"` 时查 session_scope，做 glob 匹配，response 额外带 `{decision: "block", reason: "..."}` |
| `src/routes/sessions.ts` | `CreateSessionSchema` line 22-30；`startSession()` line 113-145 | **改**：Body schema 增加可选 `scope: { enabled, readwrite: string[], readonly: string[] }`；`startSession` 创建 session 后同步写 `session_scopes` |
| `packages/hook-script/aimon-hook.mjs` | 整个文件 76 行 | **重构**：PreToolUse 分支改成"等 response"；解析 response body 里的 decision；有 decision 时打印 JSON 到 stdout。其他事件保留原 fire-and-forget |

### 前端（packages/web）

| 文件 | 相关位置 | 本次改动 |
|---|---|---|
| `src/api.ts` | `createSession()` line 101 | **改**：入参增加可选 `scope` 字段，透传到 POST body |
| `src/components/StartSessionMenu.tsx` | `handleStart` line 98 附近（会话启动入口） | **改**：加"施工范围"折叠面板（checkbox + 两栏 textarea），启动时把 scope 传给 createSession |
| `src/components/sidebar/DocsView.tsx` | line 268 的 `api.createSession({ projectId, agent: 'claude' })` | **改**：docs 侧栏自动起 claude 会话时不传 scope（向后兼容，等同今天）|
| `src/types.ts` | `Session` 相关类型 | **加**：`SessionScope` 类型定义 |

### 其他

- `packages/server/package.json`：**新增依赖** `picomatch` (`^4.0.0`) —— 零依赖、最快的 glob 库。项目里查过无既有 glob 依赖。

## 决策记录

### D1. 阻断决策放**后端**而非 hook 本地

**方案 A（采纳）**：后端 `/api/hooks/claude` 在识别 `event === "PreToolUse"` 时查 scope、跑 glob、response 里返回 `{decision, reason}`。hook 读 response、打 stdout。

**方案 B（拒绝）**：hook 自己调 `GET /api/sessions/:id/scope` 拿 globs，本地跑 picomatch 匹配。

选 A 的理由：
- 集中化逻辑便于未来加审计日志（记录 blocked 事件到 `session_events`）
- hook 脚本保持薄，只做"JSON 协议转换器"的角色
- 性能差异可忽略：hook 到本地 127.0.0.1 的 HTTP 调用本就在几毫秒，多一个 glob 匹配不影响
- 当前 `/api/hooks/claude` 已经是所有 hook 事件的汇总端点，复用它比新开 `/api/sessions/:id/scope/check` 一致性更好

**资深工程师检视**：scope 逻辑放后端 vs hook 两种都合理，选后端不算过度设计，是从"事件审计方向"选了更可扩展的一边。非"只用一次的抽象"。

### D2. scope 存**独立新表**而非 sessions 表加列

**方案 A（采纳）**：新建 `session_scopes` 表。
```sql
CREATE TABLE IF NOT EXISTS session_scopes (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  readwrite_json TEXT NOT NULL DEFAULT '[]',
  readonly_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
```

**方案 B（拒绝）**：在 `sessions` 表新增 `scope_enabled`、`readwrite_json`、`readonly_json` 三列。

选 A 的理由：
- scope 语义独立于 session 基础字段（status / pid / timing 等），耦合会污染 sessions 表
- `sessions` 表有既定迁移脚本（line 125-154 处理 legacy CHECK 约束），再加 3 列增加迁移复杂度
- ON DELETE CASCADE 通过外键自然跟随，删 session 自动清 scope

**资深工程师检视**：新表是边界清晰的最小设计，不是"只用一次的抽象"。未来若 scope 要版本化、多 profile 等，独立表是基础。

### D3. `aimon-hook.mjs` 的扩展策略 = 按事件分支

现在的 hook 是纯"fire-and-forget"：读 stdin → POST 后端 → 永远 exit 0。`done()` 第 17 行注释明确："Always 0 — we cannot block claude on our backend."

**改动**：
- 保留其他事件的 fire-and-forget 行为（Stop / Notification / PostToolUse / UserPromptSubmit / SessionStart）
- 仅 `PreToolUse` 事件改为等待 response 并解析 response body
- response body 有 `{decision: "block"}` → 打印该 JSON 到 stdout → exit 0
- response body 无 decision 或 response 失败 → **fail-open**（不打印任何东西 → claude 视为放行）
- 超时 1500ms 不变：超时 = fail-open

**资深工程师检视**：这是最小改动路径。不改全局行为，只给一个事件开特殊通道。没有"顺带重写 hook"。

### D4. glob 库 = `picomatch`

- 项目现无 glob 依赖（`pnpm list -r` 已查，package.json 里也无 glob/minimatch/micromatch/picomatch）
- picomatch 零依赖、体积 < 10KB、速度最优，是 micromatch 的底层引擎
- 只在**后端**引入，hook 脚本保持零依赖（只用 `node:http` / `node:fs`）

### D5. scope 数据规范化

用户在 UI textarea 里粘贴的 glob 多行字符串，**在写入数据库前**：
1. 按 `\n` 切
2. 每行 trim
3. 去空行
4. 去重（保留首次出现顺序）
5. 拒绝绝对路径（`/` 或 `C:/` 开头）和向上跳出（`..`），返回 400 让用户修正

glob 匹配时（后端）：
1. 取 `tool_input.file_path`（绝对路径 + Windows 反斜杠）
2. 解析项目根（通过 `session.projectId` → `project.path`）
3. 如果 `file_path` 不在项目根之下 → **放行**（项目外文件不是本功能职责）
4. 否则转为项目根相对路径 + POSIX 正斜杠 → picomatch 匹配
5. 先查 readonly（命中 → block），再查 readwrite（命中 → allow），都不命中 → block

### D6. UI 入口 = StartSessionMenu

- 起会话路径只有两处：`StartSessionMenu.tsx:98` 和 `DocsView.tsx:268`
- 前者是用户显式点"+ 启动 AI / 终端"的主入口 → 加 scope UI
- 后者是 docs 侧栏触发 Claude 自动做 plan 的快捷路径 → 不加 UI，默认空 scope（向后兼容）

scope 面板默认**收起**，勾选"启用施工边界"后展开。避免给不用 scope 的用户增加视觉噪声。

### D7. 会话 tab 上的 scope 徽标

- 无 scope / scope 空 → 不显示任何徽标（今天行为）
- 启用 scope → 徽标 `🛡 rw:N ro:M`，hover tooltip 列全部 glob
- 徽标信息从 session-level state 读（前端首次加载时 fetch；后续不变，scope 一旦起会话就固定）

## 依赖与约束

- **Claude Code 版本**：`>= 2.1.117`（当前 POC 所用），支持 `hook response` 的 `decision: "block"` 协议。
- **picomatch**：`^4.0.0`。
- **向后兼容**：所有不传 scope 的起会话请求 = 今天行为，不影响现有 stable 实例、不影响 docs 侧栏的自动 claude 起会话。
- **Stable / Dev 双实例**：hook 的阻断决策通过 `AIMON_BACKEND` env var 路由到对应的后端（stable 8787 / dev 9787），与 dual-instance 机制完全兼容。
- **Session 生命周期**：scope 存在于 `session_scopes` 表，外键 CASCADE 跟随 sessions。重启会话（`POST /api/sessions/:id/restart`）**不继承**旧 scope —— 因为 restart 实际是 kill + 新建一个 sessionId（见 `startSession` line 122 `nanoid(16)`），要重新传 scope。**这是个小遗留点**：UI 需要在 restart 场景下再弹一次 scope 面板，或者记住用户上次的值作为默认。Tasks 阶段实现时标记为"已知限制"，不作为核心交付的必须项。

## 范围外（溢出提醒，不动）

- 本次不触碰 `~/.claude/settings.json` 的 PreToolUse 注册逻辑（hook-installer.ts）。已存在。
- 本次不触碰 PTY 的 env var 注入（pty-manager.ts:146）。已存在。
- 本次不优化 aimon-hook.mjs 对**其他事件**的处理。保持现状。
- 本次不处理 Codex / gemini 等非 Claude CLI 的阻断。它们没有官方 PreToolUse 等价钩子。

## 我在写这份 context 时顺手看到的无关问题（追加到 `dev/issues.md`，不在本次改）

_（如有发现，按 CLAUDE.md 的 Issues 档案规则追加到 `dev/issues.md`。当前阅读过程中未见明显游离问题，暂无追加。）_
