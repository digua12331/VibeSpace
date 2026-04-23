# 施工边界 · Plan (v1)

> **v1 决策锁定**（用户 Plan 阶段答复）：
> - "只读"语义 = 只拦 Edit/Write/NotebookEdit，Read 放行
> - scope 输入格式 = glob 多行 textarea
> - 启用时不给默认 glob
> - （下游 P5 归档评审：自动触发 + 自动写 lessons.md。不影响本 plan。）

## 背景

主理人是 vibe coder、不看代码，现有 CLAUDE.md 三段式工作流只能"提示词劝说"AI 别动核心模块。一旦 AI 为了接通现有系统"顺手重构"了 `core/` 或 `packages/server` 等关键目录，主理人从 UI 上察觉不到，等真实后果爆出来可能是几天后。

需要一个**物理拦截层**——起会话时圈定"只能写哪些路径、只能读哪些路径"，AI 越界的 `Edit` / `Write` / `NotebookEdit` 调用直接被阻断，不靠提示词自觉。

拦截点选官方 Claude Code Hooks 的 `PreToolUse`。此 hook 由 Claude Code CLI 在每次调用工具前同步触发，hook 脚本返回 `{"decision":"block","reason":"..."}` 即可阻断工具执行（本假设需 Context 阶段跑 POC 验证，见下方"风险与注意"）。

## 目标

在起 AI 会话时允许主理人勾选本会话的施工边界（两个 glob 列表：可写 / 只读），写入 SQLite。Claude 每次 `PreToolUse` 触发时，aimon-hook.mjs 调本地 API 查当前 session 的 scope，按 glob 匹配决定放行或阻断。

| | 行为 |
|---|---|
| 工具 `Edit` / `Write` / `NotebookEdit`，目标路径匹配 readwrite glob | 放行 |
| 同上，目标路径匹配 readonly glob 或不匹配任何 readwrite | 阻断，返回 reason |
| 工具 `Read` / `Glob` / `Grep` / `Bash`（非写操作） | 一律放行（本轮不管） |
| scope 为空（两个 glob 列表都空） | 放行所有（向后兼容，等同今天行为） |

### 可验证的验收标准

**UI 浏览器可观察**：
1. 起会话弹窗里能看到"施工范围"折叠面板，展开后有两栏多行 textarea：**可写**、**只读**，两栏默认空；勾一个"启用施工边界"checkbox 才展开。
2. 填完启动会话后，在右键菜单或会话 tab tooltip 上能看到当前 scope 摘要（例如：`rw: dev/** | ro: core/**`），不填则显示"无限制"。

**端到端手工**：

3. 新建一个测试项目（任意目录），起会话勾 `rw: tmp/**`、`ro: src/**`。在 xterm 里让 Claude 执行"修改 `src/app.ts` 第 10 行"。终端里必须看到 Claude 报告工具被 block 且 reason 包含 "out of session scope: src/app.ts is readonly"。
4. 同一会话，让 Claude 写 `tmp/hello.txt`，必须成功（可从 VS Code 侧栏看到新文件）。
5. 同一会话，让 Claude **读** `src/app.ts`（Read 工具），必须成功（Claude 能引用内容）。
6. **跨会话隔离**：同时开两个会话 A/B，A 的 scope `rw: a/**`、B 的 scope `rw: b/**`。在 A 里让 AI 写 `b/x.txt` 必须被 block。
7. **空 scope 向后兼容**：起会话不填 scope，让 AI 改任意文件，全部放行，行为等同今天。

**类型检查**（CLAUDE.md 硬规则）：
8. `pnpm --filter @aimon/server tsc --noEmit` 和 `pnpm --filter @aimon/web tsc --noEmit` 通过。

## 非目标

- **不做递归子进程保护**。AI 若通过 `Bash` 工具调 shell 写文件（如 `echo x > core/foo.ts`），PreToolUse 只看 Bash 本身而看不到被写的具体路径，本轮不拦。vibe coder 发现 AI 偷走 shell 绕过 scope 这件事本身也能在终端里看到命令字符串，真要拦是后续 Task。
- **不做 scope 模板库**（"前端模块预设"、"后端模块预设"等）。等跑几周看真实需求再说。
- **不做 scope 变更审计面板**。blocked 事件目前只在终端内显示 reason 即可，不做专门 UI 查看历史。
- **不做 `~/.claude/settings.json` 之外的 CLI 保护**。Codex / gemini / opencode 本轮不覆盖（它们没有官方等价的 PreToolUse 钩子，要做得另起方案）。
- **不追加到 CLAUDE.md**。scope 是会话级强约束，跟 CLAUDE.md 的长期规则正交，不互相污染。

## 实施步骤（粗粒度，细节留给 Context + Tasks）

1. **Context 阶段先跑 POC 验证假设**（见下方风险），包括：PreToolUse 能否同步 block、Claude 传给 hook 的 JSON 协议字段名、hook 怎么知道当前 sessionId。
   - verify: 手写一个最小 hook 脚本（打印 stdin + 固定返回 block），配到 ~/.claude/settings.json，起 claude 会话让它改文件，观察实际是否阻断、stdin JSON 长什么样。

2. **SQLite 新增 `session_scopes` 表**（字段：`session_id PK`、`readwrite_json`、`readonly_json`、`enabled`、`created_at`）。
   - verify: `sqlite3 packages/server/data/aimon.db ".schema session_scopes"` 能看到表结构。

3. **后端新增 HTTP：`GET /api/sessions/:id/scope`，`PUT /api/sessions/:id/scope`**。
   - verify: curl PUT 存 scope，再 GET 回来内容一致；无 scope 返回 `{enabled: false}`。

4. **扩展 aimon-hook.mjs 支持 PreToolUse**：读 stdin JSON → 若 `tool_name ∈ {Edit, Write, NotebookEdit}` → 拿 `tool_input.file_path` → 调 `GET /api/sessions/<AIMON_SESSION_ID>/scope` → glob 匹配 → 输出 `{"decision":"block"|"approve", "reason":"..."}` 到 stdout。
   - verify: 命令行模拟 `AIMON_SESSION_ID=xxx echo '{"tool_name":"Edit","tool_input":{"file_path":"core/a.ts"}}' | node aimon-hook.mjs`，观察 stdout JSON。

5. **PtyManager 在 spawn session 时注入 `AIMON_SESSION_ID` 环境变量**（已有 `AIMON_BACKEND_URL` 的注入点可复用，见 dual-instance plan 里提到的机制）。
   - verify: 会话里跑 `echo $env:AIMON_SESSION_ID`（pwsh）能打印出当前 session id。

6. **hook-installer.ts 注册 PreToolUse 到 ~/.claude/settings.json**（现在只注册了 Stop / Notification 等生命周期 hook，见 `packages/server/src/hook-installer.ts`）。
   - verify: 服务器重启后，`~/.claude/settings.json` 的 `hooks.PreToolUse` 条目存在且命令指向 aimon-hook.mjs。

7. **Web 起会话弹窗 `StartSessionMenu`（或其下游对话框）增加"施工范围"折叠面板**：checkbox + 两个 textarea + 简短说明。
   - verify: 浏览器里看到 UI、填值、submit 后 Network 面板能看到 POST /api/sessions 带了 scope 字段。

8. **会话 tab 上显示 scope 摘要**：无限制显示灰色"无限制"，有限制显示 `rw:N ro:M` 徽标，hover 时 tooltip 显示完整 glob 列表。
   - verify: 浏览器里肉眼观察。

9. **端到端手工验收**：跑上方 3–7 条验收标准。

## 边界情况

- **Scope 为空**：enabled=false，hook 无条件放行（最高优先级短路，不查表之外的 glob）。
- **glob 冲突**：路径同时命中 readwrite 和 readonly → 以 **readonly 优先**（更保守、更符合"圈地保护"的直觉）。
- **相对 vs 绝对路径**：hook 拿到的 `tool_input.file_path` 大概率是绝对路径，必须先相对化到项目根（项目根路径后端已有，hook 可以从 scope API 一并返回）。
- **项目外路径**（如 `~/.claude/settings.json`、`C:\Windows\...`）：本 scope 系统只管项目内。项目外一律**放行**（不是本功能职责，vibe coder 不会因此受害）。
- **Hook API 超时或后端不可达**：**fail-open**（放行并在 hook stdout 的 reason 写一条 warning，让 AI 的反馈里能看到"scope 暂时失效"）。阻断优先让会话能进行，不要让主理人陷入"AI 卡死 + 我不知道为什么"的死境。
- **Claude 同时调多个工具（batched tool_use）**：每次工具调用都走一次 PreToolUse，hook 独立判定，任何一条 block 则该条被拦，其他正常。

## 风险与注意

### 必须在 Context 阶段先验证的假设

- **假设 A：Claude Code 官方 hooks 的 `PreToolUse` 支持同步 block**（返回 `{"decision":"block"}` 或退出码 2 会阻断工具调用）。若不支持（只能记录、不能拦），整个方案失效。Context 阶段先跑最小 POC。
- **假设 B：hook 脚本拿到的 stdin JSON 字段名确实是 `tool_name` / `tool_input.file_path`**。实际可能是 `name` / `input.path` 或别的。POC 时打印完整 stdin 即可确认。
- **假设 C：hook 子进程能读到父 PTY 注入的 env 变量** `AIMON_SESSION_ID`。需要确认 Claude Code 启动 hook 时继承的是父 PTY 的 env 还是重置 env。**如果不继承**，退路：aimon-hook.mjs 从 cwd 反查项目、从 SQLite 的 `sessions` 表里找"该项目当前唯一 running 的 session" —— 这个退路只在同项目同时只有一个 claude session 时成立，需要限制用法或找更靠谱的标识。
- **假设 D：项目里可复用某个 glob 库**（preferably picomatch / minimatch）。`pnpm list -r glob minimatch picomatch micromatch` 查一下，有就用，没有引 `picomatch`（零依赖最小）。

### 其他风险

- **误伤临时文件**：AI 可能想写 `.tmp` / `.cache` 文件到 scope 外。本轮策略：**不开白名单，写不了就算了**，AI 会自己调整路径。若后续发现高频误伤，再加 "总是允许写的 allowlist"。
- **hook 新增同步网络调用的性能**：每次 Edit/Write 都打一次 localhost API。后端需要保证 scope 查询是 O(1)（SQLite 按主键查），响应时间 < 10ms。若观察到延迟明显（AI 感觉"卡"），在 hook 里做进程级内存缓存（session_id → scope，TTL 30s）。本轮先不做缓存。
- **Stable / Dev 双实例干扰**：按 dual-instance plan 的既定机制，hook 通过 `AIMON_BACKEND_URL` 决定打到 8787 还是 9787。scope 查询复用同一逻辑，自动跟随。无新风险。
- **卸载 / 降级**：服务器退出后 `~/.claude/settings.json` 里的 PreToolUse hook 不会自动摘除（和现有 Stop hook 行为一致）。若脚本路径失效，Claude 调用 hook 会超时 → fail-open → 放行。**不阻塞用户**，但会让 AI 每次 Edit 多等 N 秒。这是既有问题，不在本 plan 范围内修。

### 已拍板的决策（v1 用户确认）

- **"只读"的语义 = 前者**：`ro:` 路径只拦 `Edit` / `Write` / `NotebookEdit`，`Read` / `Glob` / `Grep` 一律放行。理由：AI 要读 core 才能找到新模块要接的接口，全拦会让它瞎写。
- **scope 输入格式 = glob 多行**：UI 上两栏都是多行 textarea，一行一个 glob pattern（空行忽略）。对 vibe coder 更友好。
- **默认值 = 不给**：启用施工边界时 textarea 默认空。空就是空，让用户显式填每一条，避免 AI 因为我们内置的默认 glob 写错文件后用户却不知道默认是什么。

### 相关联的下游任务（P5 归档评审）· 供备忘，不在本 plan 范围

- P5 已定：**自动触发 + 自动写 `dev/memory/lessons.md`**（用户 v1 决策）。
- 到 P5 plan 阶段需要明确：双模型强制（写代码的 AI 不能评审自己）、`lessons.md` 分区存放（`auto/` vs `manual/`）、"一键撤回最近 N 条自动规则"入口。
- 本 plan（P2 施工边界）与 P5 正交，不互相依赖。
