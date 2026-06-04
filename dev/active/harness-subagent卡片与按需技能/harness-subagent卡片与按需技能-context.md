# harness-subagent卡片与按需技能 · context

## 关键文件（改动边界）

执行阶段原则上**只动这里列的文件**。要溢出先回来补这份清单。

### Phase A · Subagent run 卡片

#### 后端 — 新建 / 改

| 文件 | 行号/符号 | 改什么 |
|---|---|---|
| `packages/server/src/subagent-runs.ts`（**新建**） | 全文件 | 仿 `jobs-service.ts` 的内存 Map 模式。导出 class `SubagentRunsService` + 单例；方法 `registerStart({ parentSessionId, runId?, subagentType, description, prompt }) → runId` / `markDone(runId)` / `list(parentSessionId)` / `listAll()` / `prune()`；30 min 自清；EventEmitter `change`；serverLog 起止配对（`scope='subagent'`） |
| `packages/server/src/routes/hooks.ts` | `extractToolFilePath` L106；现有 PreToolUse / 末尾 default 分支 | 旁边加 `extractTaskInvocation(payload)` 抽取 `tool_name === 'Task'` 时的 `subagent_type` / `description` / `prompt`（**实施时先 console.log 实际 payload 字段名**）；PreToolUse 命中 Task → `subagentRuns.registerStart(...)`；PostToolUse 命中 Task → `subagentRuns.markDone(toolUseId)`；保留 scope 检查路径不动 |
| `packages/server/src/routes/subagent-runs.ts`（**新建**） | 全文件 | `GET /api/sessions/:id/subagent-runs` 返回该 parent 的列表；wire shape `{ id, parentSessionId, subagentType, description, prompt, state: 'running' \| 'done', startedAt, endedAt? }`；prompt 在 wire 里截断到 1KB（详细完整保留在 server 内存，UI 一般不需要全文） |
| `packages/server/src/index.ts` | route 注册区 | `await registerSubagentRunsRoutes(app)` |

#### 前端 — 新建 / 改

| 文件 | 改什么 |
|---|---|
| `packages/web/src/types.ts` | 加 `SubagentRunState = 'running' \| 'done'`；`SubagentRun { id, parentSessionId, subagentType, description, prompt, state, startedAt, endedAt? }` |
| `packages/web/src/api.ts` | `listSubagentRuns(sessionId): Promise<SubagentRun[]>` |
| `packages/web/src/store.ts` | 加 state `subagentRunsBySession: Record<string, SubagentRun[]>` + action `refreshSubagentRuns(sessionId)`（错误就静默不爆 UI——hook 链断了不应该让父 session 不可用）|
| `packages/web/src/components/editor/EditorArea.tsx` | session 标签内：在现有 `📝 task` / `🌿 worktree` / scope badge 之后追加一个 `🤖×N`（N = `subagentRunsBySession[s.id].filter(r=>r.state==='running').length`）；N=0 不显示 |
| `packages/web/src/components/terminal/SessionView.tsx` | `return (` 后头部 div（L901 顶栏 div）下方插入新独立 div：当 `subagentRunsBySession[session.id]?.length > 0` 时渲染横排 chips bar；每 chip = `📌 <subagentType>·<desc 8字截断> <state pill>`；hover tooltip 显示完整 description；click → alertDialog 显示 description / prompt 截断 / 起止 / 状态；轮询：active 时每 5s 调 refreshSubagentRuns(session.id) |

### Phase B · Skills 按需注入

#### 后端 — 新建 / 改

| 文件 | 改什么 |
|---|---|
| `packages/server/src/skills-service.ts`（**新建**） | 扫 `<projectPath>/.aimon/skills/*.md`；**手动 parse** yaml frontmatter（开头 `---` 到下一个 `---` 之间，每行 `key: value`，array 形如 `triggers: [a, b]` 或多行 `triggers:\n  - a\n  - b`，**不引新依赖**）；导出：`SkillEntry { name, triggers: string[], body: string }`、`listSkills(projectPath): Promise<SkillEntry[]>`、`pickSkillsForTask(projectPath, taskName): Promise<SkillEntry[]>`（case-insensitive substring 匹配，命中即收集）、`buildRuntimePrompt(skills): string`（按文件名字典序拼接，分隔 `\n\n---\n\n`） |
| `packages/server/src/routes/sessions.ts` | `startSession` 函数：spawn 前调 `pickSkillsForTask(proj.path, task)`；命中数 > 0 时：`mkdir -p <proj.path>/.aimon/runtime/`、写 `<sessionId>-prompt.md` (overwrite)、把 path 通过 env `AIMON_SESSION_PROMPT_PATH` 注入 `ptyManager.spawn({ env })`；操作日志 `serverLog('info','skills','injected', { sessionId, taskName, skills, runtimePath })`；不命中或无 skills 目录或无 task → 跳过整段 |
| `packages/server/src/routes/projects.ts` | 新加 `GET /api/projects/:id/skills` 返回该项目所有可用 skill（name + triggers，不含 body 减体积） |

#### 前端 — 改

| 文件 | 改什么 |
|---|---|
| `packages/web/src/api.ts` | `listProjectSkills(projectId): Promise<{ name: string; triggers: string[] }[]>` |
| `packages/web/src/components/StartSessionMenu.tsx` | useEffect：menu 打开 + projectId 变 → fetch listProjectSkills 缓存；预测显示：当前任务名（来自 task↔session 绑定的 selectedTask state，**v1 暂复用现有"绑定到任务"输入路径**）substring 命中的 skills 在菜单底部显示一条小字 `将注入：a · b · c`；项目无 skills 目录时不显示；命中 0 条不显示 |

> **v1 留个边界**：StartSessionMenu 当前**没有**"先在菜单里选任务再启动"的 UI（现状是 spawn 之后再去 DocsView 右键绑）。v1 不补这个 UX 缺口——预测条只在用户绑了 task **后**重启 session 时有意义；菜单首次启动若没有"先选 task"的 UI，则 `将注入：xxx` 暂时一直为空（因为 createSession 入参 task 也是空）。这跟前端能力当前现状一致，不破坏什么。

#### 测试 / 文档

| 文件 | 改什么 |
|---|---|
| `README.md` | "Concepts" 节补两段：subagent 卡片（s04 落地） + skills 按需注入（s05 落地）；提醒 `.aimon/runtime/` 应进 .gitignore，`.aimon/skills/` 应进 git |
| `dev/learnings.md` | 视情况补条 Task 工具 payload 字段实测结果 / yaml frontmatter 手动解析坑 |

---

## 决策记录

每条都过了"资深工程师会不会觉得过度设计"。

### Phase A 决策

#### A-D1 · 不引入 sessions 表加 `parent_session_id` 列
**选**：subagent run 元数据走纯内存（subagent-runs.ts），不动 DB
**不选**：DB 加列持久化
**理由**：subagent run 是"调用过程"信息不是"业务实体"；与 jobs-service 一致；重启清零可接受。资深视角：合理。

#### A-D2 · runId 用 nanoid 而不是 claude 自己的 toolUseId
**选**：服务端自己 nanoid(12)
**不选**：把 PreToolUse 的 `toolUseId` / `tool_use_id` 当主键
**理由**：claude payload 字段格式可能变；nanoid 自主可控；同 toolUseId 被多次 Pre/Post（重试场景）下当成新 run 也合理——v1 不去重。资深视角：合理。

#### A-D3 · prompt 在 wire 上截断到 1KB
**选**：server 内存留全文，wire 截断
**不选**：全 wire 透传
**理由**：subagent prompt 可能很长（claude 派 subagent 时整个上下文都塞进 prompt）；UI 用 alertDialog 显示已经够用；后续要看全文可加"展开"按钮。资深视角：边际成本极低，可接受。

#### A-D4 · 5s 轮询，不接 WS
**选**：JobsView 已有 3s 轮询样板，subagent 5s
**不选**：扩 ws-hub 协议加 'subagent-change' 推送
**理由**：与 MemoryView / JobsView 节奏一致；扩 ws 是过度。10 个并发 session 也才 2 次/秒 GET。资深视角：标准。

#### A-D5 · subagent runs UI 放 SessionView 顶栏下方独立 div
**选**：active session 视图顶部出现 chips bar（仅当有 runs 时）
**不选**：放 EditorArea 标签下方 / 放 LogsView 里
**理由**：subagent 是当前活跃 session 的局部上下文；放标签下方会被多 session 混乱；放 LogsView 跟操作日志混在一起。资深视角：合理。

#### A-D6 · 父 session 标签 `🤖×N` 仅显示 running 数
**选**：N = 当前 running 数
**不选**：N = 全部历史（含 done）
**理由**：done 的看 chips 卡片就够，标签 badge 是"当下注意力"信号——running 才需要 attention。资深视角：合理 UX。

### Phase B 决策

#### B-D1 · 手动 parse yaml frontmatter，不引 gray-matter
**选**：30 行手写 parser（识别开头 `---` / 下一个 `---` / 行内 `key: value` / triggers 兼容 inline array 和多行 list）
**不选**：`gray-matter` 包
**理由**：依赖只为这 30 行不值；frontmatter 格式简单。资深视角：合理。如果 frontmatter 复杂度上来再换库。

#### B-D2 · runtime prompt 文件路径用 sessionId 命名
**选**：`<proj>/.aimon/runtime/<sessionId>-prompt.md`
**不选**：随机临时名
**理由**：用户能从文件名追到是哪个 session 的；debug 友好；启动时已存在覆盖（不依赖事先清理）。资深视角：合理。

#### B-D3 · 不在 startSession 里主动 GC `.aimon/runtime/` 老文件
**选**：留档，由用户自己清或加到 gitignore
**不选**：spawn 时清掉同 project 下所有过期 runtime
**理由**：留档对 debug 有用；session 关闭时不主动删——这跟 worktree 任务里"DELETE 默认不删 worktree"是一致选择（明确 vs 静默）。资深视角：合理。

#### B-D4 · v1 不验收 agent 实际读 prompt（已和用户对齐）
**选**：验收只到"runtime 文件 + env + UI + log"
**不选**：v1 强制改 CLAUDE.md 加"读 env 指令"模板
**理由**：用户明确说"不要把 agent 真读作为 v1 验收"；改 CLAUDE.md 模板是另一个独立改动，单独立项更干净。

#### B-D5 · pickSkillsForTask 用 case-insensitive substring，不上 fuzzy / embedding
**选**：`taskName.toLowerCase().includes(trigger.toLowerCase())`
**不选**：fuse.js / embedding 余弦
**理由**：v1 朴素；用户拿到效果不好可以自己加 trigger 字符串而不是改算法。资深视角：合理。

#### B-D6 · 多个 skill 命中时按文件名字典序拼接
**选**：稳定排序 + `\n\n---\n\n` 分隔
**不选**：按 trigger 命中数排序 / 按 mtime 排序
**理由**：可重现 + 可预测；用户改文件名能控制顺序。资深视角：合理。

---

## 依赖与约束

### 上游 / 兼容性

- **claude hook 协议**：现有 `routes/hooks.ts` 已经收到所有工具的 PreToolUse / PostToolUse；本任务**不破坏**现有 scope 检查路径（`extractToolFilePath` + `evaluateScope`），只是在它旁边加 `extractTaskInvocation` 分支
- **Task tool payload 字段**：plan 里写了"实施时先 console.log 真实 payload"——A-2 实施第一步就是这个；不要拍脑袋
- **PtyManager.spawn env 注入**：现有签名 `spawn({ env? })` 已接受任意 env map；Phase B 只是多塞一个 `AIMON_SESSION_PROMPT_PATH`
- **dev:alt / stable 双实例**：两边的 server data 和用户项目 .aimon 路径独立，互不干扰

### 数据结构

- subagent-runs：纯内存 Map<runId, SubagentRunRecord>，30 min 自清；server 重启清零
- skills runtime：仅文件系统 `<proj>/.aimon/runtime/<sessionId>-prompt.md`；不入 SQLite
- 不动 sessions 表 schema（不加 parent_session_id 列）

### 操作日志（按 CLAUDE.md 规则）

- Phase A：
  - `serverLog('info','subagent','start', { runId, parentSessionId, subagentType })`
  - `serverLog('info','subagent','done', { runId, ms })`
  - 至少一条 ERROR 在 PostToolUse payload 解析失败时（手动构造一次验证）
- Phase B：
  - `serverLog('info','skills','injected', { sessionId, taskName, skills, runtimePath })`
  - 跳过情况（无 task / 无目录 / 0 命中）写 `level='info'` 但不带 `injected`，meta 里写 reason
  - frontmatter 解析失败：`level='warn'`，meta 含文件名 + error.message

### 性能

- subagent runs 轮询：5s × N session，单次 GET 简单 Map 过滤，<1ms
- skills service：spawn 时同步扫一次 skills 目录，文件数应 <50 ms 内完成；缓存留给后续

### 熔断点（按 CLAUDE.md）

- A-2 实施时如果 Task PostToolUse 实际字段格式跟假设差太多（比如根本没 `tool_name` 在 payload 顶层 / 没 `tool_input` 嵌套），**停手 console.log 出实际 payload 给用户看**，再调整设计。**不要盲改 2-3 次还跑不通**——按 CLAUDE.md 熔断规则。
- B-1 frontmatter parser 如果发现用户的 skill md 里有复杂 yaml（嵌套对象 / 多行字符串），**不要扩 parser**——直接告诉用户"v1 仅支持简单 key: value + flat array triggers，复杂场景换 gray-matter 是下一个 task 的事"。
