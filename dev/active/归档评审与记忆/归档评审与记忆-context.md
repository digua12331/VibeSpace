# 归档评审与记忆 · Context

> Plan v0 决策已锁（用户 2026-04-23 答复）：
> - D1 = B（后端 spawn CLI：首选 codex、失败回退 gemini）
> - D2 = 异步后台（归档不阻塞）
> - D3 = 双文件（`auto.md` + `manual.md` + `rejected.md`）
> - D4 = A+B 双保险（改 CLAUDE.md + SessionStart hook 注入）
> - D5 = 勾选撤回（UI 复选框 → 批量移到 `rejected.md`）
> - D6 = 先按 plan 里的 prompt 骨架跑，不细分维度
>
> 物理前提（用户未显式回答，按默认走；若错会在 Tasks 阶段失败时标记）：
> - 首选 codex。codex 调用失败（未登录 / 超时 / 非 0 退出）→ 自动回退 gemini
> - 两个都失败 → lessons.md 不写，归档照常成功，UI 出 toast + 后端日志
> - `dev/active/施工边界/` 本轮不动，用户自主决定何时归档

## 关键文件（会读 / 会改 / 会新建）

### 后端（packages/server）

| 文件 | 行号 / 位置 | 改动类型 | 说明 |
|---|---|---|---|
| `src/routes/docs.ts` | 111-127 的 archive 路由 | **改** | archive 成功后 fire-and-forget 触发 review-runner |
| `src/docs-service.ts` | 334-355 的 `archiveDocsTask` | **不动** | 归档逻辑本身不变，review 走新路径 |
| `src/review-runner.ts` | 新建 | **新** | 核心模块：读归档目录 → 构 prompt → spawn codex/gemini → 解析 stdout → append 到 auto.md |
| `src/memory-service.ts` | 新建 | **新** | `dev/memory/` 的 CRUD：read/append/rollback 三个函数 |
| `src/routes/memory.ts` | 新建 | **新** | GET/POST 路由暴露给前端 |
| `src/index.ts` | 138 前后 | **改** | 注册 memory 路由 |
| `src/hook-installer.ts` | 14-21 的 EVENTS | **不动** | SessionStart 已在列表里，不需动 |

### Hook 脚本（packages/hook-script）

| 文件 | 改动 |
|---|---|
| `aimon-hook.mjs` | 在 `SessionStart` 事件的 POST response 里解析出"memory injection" payload，通过 stdout `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}` 输出给 Claude（Claude Code 官方支持此协议注入系统上下文） |

### 前端（packages/web）

| 文件 | 行号 | 改动 |
|---|---|---|
| `src/types.ts` | 附近 | 加 `MemoryEntry` / `MemoryFileKind` / `MemoryPayload` 类型 |
| `src/api.ts` | 附近 | 加 `getMemory(projectId)` / `rollbackMemory(projectId, items)` |
| `src/store.ts` | 附近 | 加 memoryData / refreshMemory / rollbackMemory state + action |
| `src/components/sidebar/DocsView.tsx` | 10 行 DocsViewMode / 123 view state / 363-384 tab 按钮区 / 501 view 条件渲染 | `DocsViewMode` 扩 `'memory'`；tab 加一列；渲染出 auto/manual/rejected 三段 + checkbox + 撤回按钮 |
| `src/components/sidebar/MemoryView.tsx` | 新建 | 记忆 tab 的子组件（让 DocsView.tsx 不继续膨胀） |

### 项目根规范

| 文件 | 改动 |
|---|---|
| `CLAUDE.md` | 追加 "## 可持续记忆（自动沉淀 + 手动追记）" 一节：Plan 阶段第一步先读 `dev/memory/auto.md` + `manual.md`；归档时会自动蒸馏出 auto 条目（可在 UI 撤回）；手动想写的长期经验手动追加到 manual.md |
| `dev/memory/auto.md` | **新建**（骨架） |
| `dev/memory/manual.md` | **新建**（骨架） |
| `dev/memory/rejected.md` | **新建**（骨架，撤回后的归档池） |

## 决策记录

### D-A. review-runner 用 node:child_process 而非 pty-manager

**方案（采纳）**：`child_process.spawn(cliPath, [...args], { cwd, timeout })`，stdin 塞 prompt、stdout 读结果。

**理由**：
- review 是**一次性非交互**任务，不需要 PTY 的 TTY 仿真、resize、scrollback buffer 这些复杂特性
- pty-manager 的 SessionEntry 结构、killed 标志、事件广播都是针对长期交互 session 设计的，硬套 review 会多写很多胶水
- 失败处理简单：promise reject → 回退到第二个 CLI

**资深工程师检视**：不是过度设计、也不是"为抽象而抽象"。pty-manager 和 review-runner 两者职责清晰分开是最小增量。

### D-B. 评审结果格式约束

为了 parser 不踩坑，让模型严格按以下格式输出，每条**单行**：
```
- [<ISO日期> / <任务名>] <一句话结论>（上下文：<为什么这是可复用经验>）
```

- 模型可能犯错 —— 输出多行、加解释、加 code fence。runner 按行过滤：只收**正则匹配** `^- \[\d{4}-\d{2}-\d{2}` 开头的行
- 模型判断"没有值得沉淀的"→ 输出空 / 输出 `(no lessons)` → runner 一条都不 append，但 review job 标记为 success
- 最多接受 5 条（再多截断，防止模型跑飞）

### D-C. 归档 → 评审的触发协议

**流程**：
1. 前端点归档按钮 → POST `/api/projects/:id/docs/:task/archive`
2. 后端 `archiveDocsTask` 完成 rename 后，**立即** 返回 `{archivedAs}`（HTTP 200）
3. 同步 call `kickoffArchiveReview(proj.path, taskName, archivedAs)` —— 该函数 **不 await**，直接 return；内部 setImmediate → async 跑 review-runner
4. review-runner 执行 → 成功则 append 到 `auto.md`；失败则 append 到 `rejected.md`（特殊条目标记 `[review-failed / <taskName>] <error>`）
5. 前端收到 archive response 后主动 `refreshMemory()` 几次（轮询），或用 ws 推送"memory.updated"事件刷新 UI
   - 本轮先走**前端定时轮询**（3s 一次、持续 2 分钟）。ws 推送等后续再做。

**不做事务**：review 失败不回滚归档。归档语义 = "人已经满意"，review 是附加价值，挂了不影响主流程。

### D-D. prompt 骨架（实装版，基于 plan D6）

```
You are reviewing a completed dev task. Your job: extract "lessons" worth carrying to FUTURE tasks in this repo. Cross-task applicability is the only bar — task-specific bug fixes, workarounds, or decisions do NOT qualify.

Context files (read all before answering):
<plan.md content>
<context.md content>
<tasks.md content>

Changed source files in this task (each has a short diff summary):
<file list with summary>

Output format — each lesson on ONE line, exactly this shape:
- [<YYYY-MM-DD> / <task-name>] <one-sentence conclusion>（上下文：<why this repeats>）

Rules:
- Write in Chinese (the main repo language).
- Output 0–5 lessons. Empty output is acceptable.
- No headings, no code fences, no extra commentary. Just lines starting with `- [`.
- If nothing worth carrying, output: (no lessons)

Task name: <task-name>
Today: <YYYY-MM-DD>
```

task-name 和日期在 runner 里拼接注入，不让模型"想象"这些字段。

### D-E. SessionStart hook 注入的幂等性与大小

**问题**：每次 Claude session 启动 hook 都注入一遍 lessons，可能一条经验被同会话内的"后续子任务"重复看到 → 模型产生 "我已经知道这个" 的噪声。

**对策**：
- hook 只注入**第一次** SessionStart（不重复）—— 这本就是 SessionStart 的语义，无需特殊处理
- 如果 lessons 超过 10 KB，只注入最新 30 条（用 tail 30）。足够覆盖主理人近期踩过的坑，不把上下文挤爆

**资深工程师检视**：10 KB / 30 条是拍脑袋数字，可能偏紧。但先紧后松是对的 —— 发现条数不够再放宽，比反过来清理污染容易。

### D-F. 撤回是 move 不是 delete

**`rollback` 语义**：选中条目**从源文件删除、原文追加到 `rejected.md`**。保留历史便于以后反悔。

**文件格式**：`rejected.md` 每条前加一行元信息：
```
<!-- rolled-back from auto.md at 2026-04-23T12:34:56Z -->
- [2026-04-10 / 某任务] xxx（上下文：yyy）
```

注释行让撤回有时间审计，又不破坏 markdown 可读性。

### D-G. CLAUDE.md 追加位置

**追加到哪**：当前 CLAUDE.md 第 144-152 行已有 "## 跨任务知识沉淀" 一节（讲手动写 `dev/learnings.md`）。

**方案**：在该节**之后**新增 "## 可持续记忆（自动沉淀 + 手动追记）" 段落，**不动**既有 "跨任务知识沉淀"。理由：
- 既有段落讲的是"手动"通道，新段落讲的是"自动+UI"通道。两者互补、不冲突
- 不覆盖用户可能已经精细打磨过的既有文字
- `dev/learnings.md`（CLAUDE.md 里提到的旧路径）**不迁移、不废弃**。如果用户从没写过就没影响；写过就保留

**新段落要点**：
1. Plan 阶段第一步：先读 `dev/memory/auto.md` + `dev/memory/manual.md`，**在 plan.md 里显式点出相关条目的编号或一句引用**（确保 AI 真的看了、而不是只是 hook 塞进去但被模型忽略）
2. 归档时自动触发 codex/gemini 评审，产出追加到 `auto.md`
3. UI「记忆」tab 可撤回 auto 条目
4. 自己想沉淀的长期经验，**手动**追加到 `manual.md`（不走评审）

### D-H. 条目解析的容错策略

`memory-service` 读 auto.md / manual.md 时，按行切、按正则 `^- \[(\d{4}-\d{2}-\d{2}) \/ ([^\]]+)\] (.+)$` 匹配。不匹配的行（如空行、标题、注释）**保留原文但不解析**，在 API 返回的结构里标 `kind: "raw"`（前端用灰色文字显示，不给 checkbox）。

**为什么**：用户可能手动在 manual.md 里写整段自然语言而不是单行条目，不能因为格式不匹配就吞掉。

## 依赖与约束

- **必须：codex 或 gemini CLI 至少有一个能非交互跑**。用户本地装了 codex@latest + gemini@latest（通过 `/api/cli-installer/status` 已确认两个都 `installed: true`，但未验证登录态）
- **codex 非交互调用命令**：当前代码库里未出现。假定用 `codex exec` 或管道喂 stdin —— Tasks 阶段第一步做 POC 确认命令行语法，失败就退到 `gemini -p "..."` 或管道
- **Claude Code hook 的 additionalContext 协议**：SessionStart 事件允许 hook 通过 stdout 返回 JSON `{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext: "..."}}`，Claude 会把该字段作为系统上下文加载。这点需要 Tasks 阶段 POC 验证
- **轮询而非 ws**：前端收到归档响应后 3s 一次轮询 memory API，持续 2 分钟。2 分钟内 review 没跑完的视为失败案例
- **双实例兼容**：stable (8787) / dev (9787) 各自有独立的 `dev/memory/`（因为 memory 是项目级，不是实例级）—— 同一项目在两端看到的应该一致。review-runner 写的是文件系统，两端自动同步
- **与施工边界的耦合**：zero。memory 的读写路径（`dev/memory/`）不在施工边界通常会保护的 `core/**` 或 `packages/**` 下，scope 不会拦。即便有人给会话配了紧 scope，`dev/memory/` 也该是 readwrite 白名单

## 范围外（溢出提醒，不动）

- `dev/issues.md` 问题面板的"派 Claude"流程不动。本功能不替代它
- `dev/learnings.md`（CLAUDE.md 里提到的旧路径）不迁移、不废弃
- 不支持 lesson 编辑（撤回+重写）。撤回是唯一的修复手段
- 不做跨项目记忆共享
- 不做记忆搜索 / 过滤 UI（列表直接渲染，按日期倒序）
- ws 推送 memory.updated 本轮不做，前端靠轮询

## 我在写这份 context 时顺手看到的无关问题

- CLAUDE.md 第 150 行提到的 `dev/learnings.md` 从未在项目中创建过，但 CLAUDE.md 里把它当"存在的参考选项"。本 plan 决定保留 `dev/learnings.md` 作为主理人可选手动笔记（不强制），新系统用 `dev/memory/`。若后续发现 `learnings.md` 纯粹噪声，另起任务一键合并到 `manual.md` 并删除 CLAUDE.md 那行描述。这条判断足够小，**不追加到 issues.md**。
