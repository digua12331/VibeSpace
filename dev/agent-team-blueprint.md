# agent-team-blueprint

> VibeSpace **本仓库自身开发**的 agent 团队配置。基于已落地的 7 层 harness（s03/s04/s05/s07/s08/s09 部分/s12），把"什么任务 × 哪个 agent × 哪个 skill × 哪条工作流"串起来。
>
> 跟 `dev/harness-roadmap.md`（项目层 12 层路线图）配套读。

## 一、总图

```
                     大哥（你）
                          │
                          │ 1. 写需求 / 改 plan
                          ▼
                  Dev Docs (s03/s07)
                  plan → context → tasks
                          │
                          │ 2. 起 claude session 绑 task
                          ▼
                  ┌───────────────────────┐
                  │   主 claude session   │
                  │   （绑 task → 📝 X）  │
                  └─────┬───────────┬─────┘
                        │           │
              派 Task 工具 │           │ 跑 Bash
                        ▼           ▼
                  ┌──────────┐  ┌──────────┐
                  │subagents │  │tsc/smoke │
                  │ (s04 卡片)│  │ /build  │
                  └──────────┘  └──────────┘
                        │
                  完成后 → 归档
                        │
                        ▼
                  review job (s08 后台)
                  codex/gemini 写 auto.md
                        │
                        ▼
                  下次 session 启动
                  自动注入记忆 (hook)
                  + 按需 skill (s05)
```

## 二、项目级团队成员（`.claude/agents/`）

跟着仓库 git 同步的 7 个项目专属 subagent。命名前缀 `vibespace-` 避免跟全局 agent 冲突：

| name | 工具 | 派工场景 |
|---|---|---|
| **vibespace-explorer** | Read / Glob / Grep（read-only）| 测绘代码区域；返回 ≤30 行清单（不解释、不复制代码）。Plan / Context 阶段并行调研用 |
| **vibespace-route-author** | Read / Edit / Write / Bash | 加新 fastify route + zod + 操作日志 + 前端 api 同步。一次性交付端到端切片 |
| **vibespace-db-scribe** | Read / Edit / Bash | DB schema 改动专家：加列走三处套路 + 类型/CRUD/SELECT 同步 |
| **vibespace-ui-decorator** | Read / Edit | EditorArea/SessionView 加 badge/chip；按 5 色调色板和顺序约定 |
| **vibespace-smoke-author** | Read / Write / Edit / Bash | 写 scripts/&lt;feature&gt;-smoke.mjs；端口避让/agent='shell'/cleanup |
| **vibespace-browser-tester** | Read / Bash / 具体 browser-use MCP 工具 | 浏览器端自动化跑 V1..V5；导航/点击/输入/断言文案；返回 PASS/FAIL/SKIP 报告。**继承父 session 的 browser-use MCP 工具**（mcp-bridge 自动注入到 .mcp.json），frontmatter 必须逐个列出 `mcp__browser-use__browser_navigate` 等具体工具名，不用通配符 |
| **vibespace-rules-auditor** | Read / Glob / Grep（read-only）| 审 plan/context/tasks/diff 合规；产 BLOCK/WARN/INFO 清单 ≤30 行 |

**用法**：claude Task 工具调用时 `subagent_type` 填上面任一个 name。每个 agent 的 system prompt 里都点明它该 Read 哪几个项目文件 / .aimon/skills 来获取领域知识——所以哪怕你换台机器跑这个仓库，subagent 行为也一致。

**怎么扩**：直接在 `.claude/agents/` 加新 md 文件即可（frontmatter `name` / `description` / `tools`，body 是 system prompt）。新 agent 进 git 跟项目走。

### subagent 跟 Dev Docs 三段式的关系（重要）

**所有 vibespace-* subagent 都不走 plan→context→tasks 三段式**。三段式是**主 claude 跟大哥对话**用的协议——大哥提需求，主 claude 写 plan→等确认→写 context→不停确认→写 tasks→执行。

subagent 是主 claude 在**实施（tasks）阶段**派出去的"子工"，它收到的就是 tasks 阶段的某一个具体执行项。subagent 没法跟人对话（一次性返回结果），它如果再走三段式 = 嵌套写 plan.md 等谁确认？没有谁能确认它。所以 subagent 拿到任务**直接动手做**，跑完返回报告。

每个 vibespace-* agent 的 system prompt 都明示了这一条（"关于三段式"段）。如果某个 subagent 接到不明确的派工（"加点东西" / "改一改" 这种），它的标准动作是返回一行"派工不明确，需要主 agent 补：……"——而**不是**自己写 plan.md 补完。**这是边界**：让 subagent 走三段式 = 滥用，应该让主 claude 重写派工。

## 三、工作流阶段 × 角色

### Plan 阶段（默认三模型会审，Codex 定稿）

主 claude 不再单独拍脑袋写 plan。默认档任务按 `CLAUDE.md` 走：

```text
Claude 读 memory / skill / 代码，整理本地 plan 草案 + 事实包
  -> Gemini 查长上下文边界和上游依赖
  -> Codex 做结构评审
  -> Codex 综合主笔输出最终 plan.md
  -> Claude 白话化兜底并写入 Dev Docs
  -> 大哥只确认一次
```

这里的 Codex / Gemini 是外部模型会审，不是 `.claude/agents/` 子工。`.claude/agents/` 在 Plan 阶段只做事实调研或规则审稿：

| 何时派 | subagent_type | 干啥 |
|---|---|---|
| plan 写"现状假设"前 | `vibespace-explorer` | 测绘相关代码区，返回 ≤30 行清单（不解释、不复制代码） |
| plan 写完想自查 | `vibespace-rules-auditor` | 审 plan 是否符合 CLAUDE.md / Dev Docs 三段式 / memory 扫过协议 |

**memory + skill 自动注入**：SessionStart hook 会自动塞 `auto.md` + `manual.md` 进系统提示（10KB 内）；如果 `AIMON_SESSION_PROMPT_PATH` 存在，主 claude 必须先读当前任务命中的 skill prompt。plan 第一段必须写"memory 扫过：……"——这是已沉淀的协议。

### Context 阶段（高频派 subagent）

context.md 要列"关键文件清单 + 决策"——**清单部分**适合并发派多个 vibespace-explorer 跨多目录采集：

| 任务类型 | 推荐子工编排 |
|---|---|
| 改后端某层 + 前端 | 派 2 个 `vibespace-explorer`：一个调研 packages/server/src/<相关层>/，一个调研 packages/web/src/<相关组件>/ |
| 加新 route | 派 1 个 `vibespace-explorer` 看现有 routes/*.ts 模板（或直接派给 vibespace-route-author 让它自己 Read 模板）|
| 改 DB schema | 派 1 个 `vibespace-explorer` 看 db.ts 的现有列与三处套路位置 |

**决策部分**主 claude 自己写——决策外包是反模式。

### 实施（Tasks）阶段（按改动类型派专家）

写代码主线本身可以**直接派给对应专家** subagent，由它一次性交付端到端切片：

| 改动类型 | 派给谁 | 备注 |
|---|---|---|
| 加 fastify route | `vibespace-route-author` | 含前端 api.ts / types.ts 同步、操作日志起止配对 |
| 改 DB schema 加列 | `vibespace-db-scribe` | 三处套路 + 类型 / CRUD / SELECT 同步；自跑 smoke:persistence |
| 加 UI badge / chip | `vibespace-ui-decorator` | 5 色调色板 + 顺序约定 + IIFE 模板 |
| 写 smoke 脚本 | `vibespace-smoke-author` | 端口避让 + agent='shell' + cleanup |
| 复合改动 | 主 claude 自己干 | 跨多个领域、需要顺序协调时派子工反而拖累 |

熔断 / review 时机（无论改动类型）：

1. **熔断后 codex 救场**：连续 2-3 步 verify 不过时按 CLAUDE.md 熔断规则，派 `codex:rescue` 换视角看
2. **commit 前合规自查**：派 `vibespace-rules-auditor` 审 diff，BLOCK 项必须改才提交
3. **架构 review**（重大改动）：派 `feature-dev:code-reviewer` 审一次

实施阶段最大杠杆是 **skill 注入**——如果 task name 命中 skill（参 s05），自动有领域提醒进 prompt 文件，不用主 agent 自己翻 CLAUDE.md。**专家 subagent 也会自己 Read 对应的 .aimon/skills 文件**（每个 agent 的 system prompt 第一步都点了路径），所以给它们派工时不需要把领域知识贴进 prompt。

### 验收阶段（命令行不派子工，浏览器派 vibespace-browser-tester）

- **命令行**：`pnpm -C packages/server exec tsc -b` / `pnpm -C packages/web exec tsc -b` / `pnpm smoke:*` 这些用 Bash 直接跑。**没有理由**为了跑 tsc 派 subagent。
- **浏览器 V1..V5**：派 `vibespace-browser-tester` 用 browser-use MCP 工具自动跑：导航 → 点击 → 输入 → 断言文案 → 返回 PASS/FAIL/SKIP 清单。前提是父 session 是 claude 或 codex（mcp-bridge 才会注入 browser-use；shell session 派出去的 subagent 拿不到 MCP 工具）。
- **派工时附验收清单**：把 plan.md 里的 `### 验收标准` 段贴给 vibespace-browser-tester；它会按 V 项编号逐条跑、逐条报。

### 归档阶段（s08 自动后台）

大哥在 📘 Dev Docs sidebar 点 📦 归档 → server fire-and-forget 起 codex/gemini 跑 review-runner → 提取经验追加到 `dev/memory/auto.md` → 下次 session SessionStart hook 自动注入。**这条循环已经完整闭环**，不要再人为干预（除非 codex/gemini 写歪了，大哥到「记忆」tab 撤回）。

## 四、Skill × 任务名 触发表

| 任务名关键词出现 | 命中的 skill | 注入内容 |
|---|---|---|
| `db` / `schema` / `加列` / `migrate` / `字段` | `db加列三处套路.md` | sessions 表加列三处套路 + addColumnIfMissing helper 说明 |
| `route` / `路由` / `api` / `endpoint` / `接口` | `加新api路由.md` | fastify route 模板 + zod / serverLog / 前端同步 |
| `badge` / `标签` / `前缀` / `chip` | `前端加badge.md` | 颜色调色板 + 顺序约定 + IIFE 模板 |
| `操作日志` / `埋点` / `logAction` | `操作日志埋点.md` | 起止配对 + meta ≤2KB + scope/action 命名 |
| `smoke` / `冒烟` / `端到端` | `smoke脚本.md` | 端口避让 + 主流程模板 + agent 选 shell |
| `Task工具` / `subagent` / `子工` / `派工` | `团队派工.md` | 何时派 / 何时不派 / subagent_type 选择 |

大哥新建 task 时**任务名里多塞几个关键词**就能触发对应 skill。比如：
- `加subagent路由` → 命中 `加新api路由` + `团队派工`
- `db加worktree字段` → 命中 `db加列三处套路`

## 五、跟 7 层 harness 的对应

| harness 层 | blueprint 落点 |
|---|---|
| s03 TodoWrite | Dev Docs 三段式（已做）+ 本 blueprint 描述各阶段角色 |
| s04 Subagents | 见"工作流阶段 × 角色" — Plan/Context 可派 read-only 子工，Tasks 按明确切片派专家子工，验收派 browser tester |
| s05 Skills | 见"Skill × 任务名 触发表" — 6 个项目级 skill 已落 `.aimon/skills/` |
| s07 Tasks | task↔session 绑定后标签前缀 📝 task；关闭未完成 task 的 session 时 confirm 提示 |
| s08 Background Jobs | 归档触发 review job → 写 `dev/memory/auto.md`；CLI 安装也走 jobs 面板 |
| s09 Mailbox | 拆出未来评估（见 `dev/harness-roadmap.md`），blueprint 里**不依赖**它 |
| s12 Worktree | 多 agent 并发改同一文件场景下用 worktree 隔离；blueprint 推荐"调研系派 Explore subagent，实施系派独立 worktree session"——如果真要并行实施，用 worktree 而不是 subagent |

## 六、给大哥的实操建议

1. **task 命名**有意思一点——多塞几个关键词，触发更多相关 skill，prompt 更聚焦
2. **skill 改动**直接编辑 `.aimon/skills/<name>.md` 即可；session 启动时是快照，已起的 session 不受影响（重启 session 才重读）
3. **想加新 skill**：在 `.aimon/skills/` 里加一个新 md 文件，frontmatter 写 triggers，内容 ≤ 100 行；下次 session 启动时如果 task name 命中就自动注入
4. **不想被 skill 影响**的临时任务：task name 里别用 trigger 关键词，或干脆不绑 task（直接 spawn）
5. **agent 没读 skill 怎么办**：现在 `CLAUDE.md` 已经要求主 claude 在 `AIMON_SESSION_PROMPT_PATH` 存在时先读它。若仍没读，优先检查 session 启动时是否绑定 task、`.aimon/runtime/<sessionId>-prompt.md` 是否生成、LogsView 是否有 `skills injected` 日志。

## 七、通用团队的母版回写约定（借鉴 luban skill 的"事故喂养规则"）

`templates/agent-team/` 的 team-* 通用团队（2026-06-12 起随工作流装配到所有项目）靠两条腿进化：

1. **上报腿（各项目侧）**：team-usage.md 已写明——目标项目的主 AI 发现团队成员的**通用**缺陷时，不就地私改，而是在交付摘要里向大哥上报"这是母版级问题"。
2. **回写腿（本仓库侧）**：大哥把上报带回本仓库后，在这里改 `templates/agent-team/` 母版（走正常 Dev Docs 流程），改完跑 `pnpm smoke:agent-team`；各项目**重新应用工作流**即自动刷新（指纹机制保证只刷用户没本地化改过的文件）。

判断"通用 vs 项目特有"的标准与跨任务知识沉淀一致：**换一个项目还会不会再犯？** 会 → 母版；只在这个项目犯 → 就地改该项目的角色文件（代价是该文件从此脱离母版升级，这是预期行为）。

来源：四条借鉴（派工填空模板 / 疑问句≠授权 / 首单小卡信任阶梯 / 子工心跳）均出自 `~/.claude/skills/luban` 的方法论，2026-06-12 评估后采纳。

## 八、不在 blueprint 范围

- ~~自动派工（s11 已劝退）~~ —— **2026-06-09 复活为 `经理AI受约束派工`**（半自动+关键闸口停，非全自动撒手）；详见 `dev/harness-roadmap.md` s11 条 + `dev/active/经理AI受约束派工/`。手动起 session 派 task 仍保留为常规路径。
- agent 间邮箱（s09 拆出）—— 等单独 spike 验完 MCP 协议链再说
- AI 自动 review 大哥代码（系统级 hook）—— 跟 blueprint 是不同方向，留给将来
