# Team Agent + Harness + Dev Docs 执行手册

> 面向主 Claude 和后续 AI 会话。
> 目标：把“抓大放小、少说多做、做事留痕”落成可执行链路。

## 0. 总原则

大哥只负责方向和验收；主 Claude 负责拆解、派工、执行、验证和留痕；Harness 负责隔离、日志、后台任务和记忆。

**大哥是非程序员**。能拿给他确认的只有两类：（1）大方向（这次任务到底要解决什么、什么样算解决了）；（2）有用户感知差异的分叉（A 路径和 B 路径会让用户最终看得见的东西不一样：界面不同 / 数据会不会动到 / 能否撤销 / 操作步骤变没变）。**纯内部实现**的分叉（用 A 函数还是 B 函数、放 utils 还是单独文件、要不要抽 helper），AI 自决，不要打扰。

默认行为：

- Plan 阶段默认走 Claude / Gemini / Codex 三模型会审，Codex 综合定稿，主 Claude 白话化落盘；只停一次等大哥确认。**这是整条流程里唯一一次**。
- Context / Tasks / 执行阶段不等确认。Context 写完直接进 Tasks，不要发“context 写好了请确认”这种消息。
- 技术细节自行决定。
- 所有执行通过文件、日志、任务状态留痕。
- 只有方向、数据安全、验收不可行、连续失败时才打断大哥。

## 0.1 跟大哥说话的规矩（硬性，贯穿全流程）

大哥明确说过他不懂代码。所有面向他的输出（plan 摘要、handoff、对话回复、错误说明）必须遵守：

- **专业术语括号解释**：第一次出现时用一句白话翻译。例：“worktree（git 的临时副本，几个并行任务互不踩脚）”“daemon（在后台一直跑的小程序）”“mutation（会改数据库或文件的操作）”“payload（一次请求里夹带的数据）”。
- **翻译成“用户看得见的变化”**：别说“加了 zod 校验”，说“前端发非法数据时后端会拦下来并提示”；别说“重构了 sessions 路由”，说“会话列表打开速度变快了，行为不变”。
- **让用户拍板的事永远是“要不要这样做 / 在哪里能验收”**，不能是“用 A 还是 B”。后者是 AI 自己的活。

写完一段面向大哥的话，回头检查一遍：里面还有没有裸术语？有没有“做了什么技术动作”而不是“用户能看到什么变化”？有就改。

## 1. 三者分工

| 模块 | 职责 | 主要文件/入口 |
|---|---|---|
| Dev Docs | 锁定方向、验收标准、上下文、任务进度 | `dev/active/<任务名>/` |
| Team Agent | 主 Claude 统筹，subagent 执行明确子任务 | `.claude/agents/`、`dev/agent-team-blueprint.md` |
| Harness | 隔离、日志、hook、MCP、jobs、memory、权限配置 | `dev/harness-roadmap.md`、server routes、LogsView、JobsView |

不要把三者混用：

- Dev Docs 不负责“谁来做”，只负责账本。
- Subagent 不负责“大方向判断”，只负责明确子任务。
- Harness 不负责替 AI 做决策，只负责让执行可控、可见、可复盘。

## 2. 标准任务链路

```text
需求进入
  -> 判断量级
  -> Claude 整理本地 plan 草案 + 事实包
  -> Gemini 补边界
  -> Codex 综合定稿 plan.md
  -> 主 Claude 白话化落盘
  -> 等大哥确认一次
  -> 写 context.md
  -> 写 tasks.md + tasks.json
  -> 按任务类型派 subagent 或主线执行
  -> 每完成一步同步 tasks 状态
  -> 跑类型检查 / smoke / 浏览器验收
  -> 交付短摘要
  -> 大哥验收
  -> 大哥点归档
  -> review job 沉淀 memory
```

### 2.1 量级判断

| 量级 | 例子 | 行为 |
|---|---|---|
| 极小 | 改文案、改标题、加一个无风险小菜单 | 直接做，不写 Dev Docs |
| 小 | 1-2 个文件、无数据风险、用户说“按你想法做” | 可写 Dev Docs，但全程不停 |
| 默认 | 新功能、bug、UI 改动、多文件、跨模块 | 完整 Dev Docs + 三模型会审，只在 plan 后确认一次 |
| 高风险 | 数据库、核心流程、不可逆操作、并发 agent | 完整 Dev Docs + 三模型会审 + worktree + 更严格验收 |

### 2.2 Plan 阶段

默认/高风险任务的 Plan 阶段按 `CLAUDE.md` 走“三模型会审”：

1. Claude 读 memory、按需 skill prompt 和代码，整理本地 plan 草案 + 事实包。
2. Gemini 基于 Claude 草案查上游依赖、边界情况和长上下文遗漏。
3. Codex 做结构评审，并综合用户需求、Claude 事实包、Gemini 评审输出最终 plan。
4. Claude 只做白话化兜底、术语翻译、大哥偏好核对和 Dev Docs 落盘。

`plan.md` 末尾必须保留 `## 多模型 Plan 会审`，记录 Gemini、Codex、Claude 各自贡献；外部工具不可用时也要写清跳过原因。极小/小任务可以跳过多模型会审。

Plan 文件**第一段必须是大哥摘要**，3-5 行白话：

```md
## 大哥摘要

这次要做什么：
做完后在哪里点哪里能看到：
会不会动到已有数据/界面：
验收方式：
风险：
```

大哥主要靠这段决定要不要点头。**写得不像人话就是不合格**——专业术语裸奔、说技术动作而不说用户感知变化、列 A 还是 B 给大哥选，都算不合格，要重写。

大哥只确认这一层。不要把技术选择拿给大哥拍板。

Plan 还必须包含：

- `memory + ARCHITECTURE 扫过`：开 plan 之前先看 `dev/memory/auto.md` + `dev/memory/manual.md` + `dev/ARCHITECTURE.md`（项目架构地图，长期稳定）。前两份相关条目显式引用，ARCHITECTURE 相关章节用 `@dev/ARCHITECTURE.md#章节` 形式引用；无关一句“扫过无相关条目/章节”。
- 目标
- 验收标准（UI 改动必须至少含一条“浏览器里能看到/能点出来”的行为描述）
- 非目标
- 实施步骤
- 边界情况
- 风险与注意

#### 2.2.1 写 plan 时的“问之前的过滤器”

不是所有不确定都要回头问大哥。按下面四条过滤：

| 情形 | 处理 |
|---|---|
| 心里默认的前提、依赖的接口行为、数据量级、边界场景 | **写进 plan 给自己存档**，不专门追问。只有当假设错了会改变验收方式或大方向时，才回头确认 |
| 用户这句话能理解成 A 或 B，且 A、B 让用户**最终看到的东西不一样** | 列出来让用户挑 |
| 用户这句话能理解成 A 或 B，但**只在内部实现路径不同** | AI 自决，不要列给用户看 |
| 发现一条**显著**简单的路（少一半工作量、少动一个模块、少一个外部依赖） | 先说出来让用户决定 |
| 微小优化、个人审美的“我觉得这样写更好” | 自决，不要回头问 |
| 读代码后发现“验收标准实际验证不了 / 用户描述与代码现状不符” | 停下来问 |
| 纯实现细节看不懂 | AI 自己研究，不打扰 |

简言之：**影响验收方式才停，影响用户看到什么才问；纯实现的事自己扛**。

### 2.3 Context 阶段（AI 自用，**不停下等确认**）

大哥确认 plan 后，直接写 `context.md`，**不要发“context 写好了请确认”这种消息**——这一段是给 AI 自己看的，大哥不审。写完直接进 Tasks 阶段。

但仍然要认真写，因为：（1）执行阶段会回头对照边界；（2）归档评审会读它产出 auto.md 记忆；（3）上下文耗尽换会话时新一轮会话靠它衔接。

Context 记录：

- 关键文件（含相关符号或行号范围，本次改动的边界线）
- 决策记录（每个决策都过一遍“资深工程师看到这个方案，会不会觉得过度设计？”——会就简化）
- 依赖与约束
- 任务边界

**唯一例外**：写 context 时发现 plan 实际不可行（关键文件不存在、依赖接口不是想象的样子、验收方式实际无法验证），回去改 plan 并重新征求用户确认一次。这是整条流程里 plan 之外唯一的回头确认情形。

### 2.4 Tasks 阶段

写 `tasks.md` 和 `tasks.json`。

要求：

- 每一步都有 `verify:`。
- 每一步声明 `read_files`（允许读）和 `write_files`（允许改）。**默认档/UI 改动/跨多文件任务必填**；极小档/小档可省。允许 glob。具体 json 字段见 `CLAUDE.md` 的 tasks.json 模板。
- `tasks.md` 是人类可读真源。
- `tasks.json` 是 UI/脚本可读状态。
- 每完成一步立即同步 md/json。
- 卡住时标 `blocked`，并写明原因。

### 2.5 执行时硬性规则补充

外科式改动（`CLAUDE.md` 已列）之外，本项目额外约束两条：

- **读写白名单**：tasks.json 每步声明的 `read_files` / `write_files` 即本步改动边界。verify 通过后、勾完成前必须跑 `git diff --name-only HEAD` 与 `write_files` 比对——越界文件不算完成，要么回滚越界改动、要么停下来回 plan 扩范围。极小档/小档可省。
- **破坏性变更协议**：本步若涉及 ① 删源码文件 / ② 删 ≥5 行连续业务代码 / ③ 改跨文件 import 的导出符号（type/interface/function/class/const/default export）/ ④ 改 HTTP 路由 / WebSocket 消息类型 / IPC 通道 / ⑤ 改 SQLite 表结构（列增删改/索引/约束），**必须先 grep 引用图、列受影响清单、等大哥点头才动手**，并在该步 `verify` 加一次"修改后 grep 同符号确认无残留旧引用"。目的是防止"删了 API 但前端还在调"这类事故。

handoff 摘要末尾必须附一行 `git diff --name-only HEAD` 真实输出，证明改动都在本任务 `write_files` 白名单内（极小档/小档可省）。

## 3. 打断大哥的条件

只能在这些情况下打断：

| 条件 | 动作 |
|---|---|
| 用户可见结果有分叉 | 列出差异，让大哥选方向 |
| 会动已有数据或不可逆操作 | 明确风险，等确认 |
| 验收方式无法成立 | 说明为什么验不了，重写 plan |
| 连续验证失败 2-3 次 | 熔断，报告错误和已尝试方案 |
| 用户明确要求暂停 | 立即暂停 |

不要因为这些事情打断：

- 函数命名。
- 文件放哪里。
- 用哪个 helper。
- 是否抽象。
- 先改前端还是后端。
- subagent 怎么派。
- 类型怎么定义。

## 4. Team Agent 派工规则

主 Claude 是项目经理。默认先判断任务是否能拆成独立、可验收的子任务；能拆再派。

| 场景 | subagent | 说明 |
|---|---|---|
| 跨目录摸现状 | `vibespace-explorer` | 只读，返回事实清单，不贴代码 |
| 新增后端接口 | `vibespace-route-author` | route + zod + serverLog + 前端 api/types |
| 改数据库 | `vibespace-db-scribe` | schema、迁移、类型、mapper、SELECT 同步 |
| 加前端 badge/chip | `vibespace-ui-decorator` | 只处理小型 UI 标记，不重构大组件 |
| 写 smoke 脚本 | `vibespace-smoke-author` | 端口避让，默认 agent=`shell` |
| 浏览器验收 | `vibespace-browser-tester` | 按验收清单返回 PASS/FAIL/SKIP |
| 交付前规则审查 | `vibespace-rules-auditor` | 查 Dev Docs、日志、外科式改动、diff 边界 |

### 4.1 Subagent 边界

Subagent 绝对不走 Dev Docs 三段式。

它们的规则：

- 接到明确任务就直接做。
- 跑完返回结果。
- 不跟大哥对话。
- 不写 plan/context/tasks。
- 不明确就返回“派工不明确，需要主 agent 补充：...”。

主 Claude 不应派：

- 核心方向判断。
- 连续 debug 假设链。
- 简单 grep。
- 依赖上一步结果的连续小改。

## 5. Skill 注入规则

当 session 绑定 task 名后，服务端会按 `.aimon/skills/*.md` 的 `triggers` 匹配任务名，并写入：

```text
.aimon/runtime/<sessionId>-prompt.md
```

同时通过环境变量暴露：

```text
AIMON_SESSION_PROMPT_PATH
```

AI 执行硬规则：

> 如果 `AIMON_SESSION_PROMPT_PATH` 存在且文件可读，主 Claude 必须先读它，再开始执行。

当前链路说明：

- 服务端已负责匹配 skill、生成 runtime prompt、注入 env。
- `CLAUDE.md` 已要求主 Claude 读取该文件；模板和 harness 安装文档仍需后续同步。

常见触发：

| 任务名关键词 | skill |
|---|---|
| `db` / `schema` / `字段` / `加列` | `db加列三处套路.md` |
| `route` / `api` / `接口` / `endpoint` | `加新api路由.md` |
| `badge` / `chip` / `标签` | `前端加badge.md` |
| `操作日志` / `埋点` / `logAction` | `操作日志埋点.md` |
| `smoke` / `端到端` | `smoke脚本.md` |
| `subagent` / `派工` / `Task工具` | `团队派工.md` |

## 6. Worktree 策略

worktree 是 git 的临时副本，用来让任务隔离执行。

不要所有任务都强制开 worktree。按风险决定：

| 任务类型 | 策略 |
|---|---|
| 极小文案/标题改动 | 不开 |
| 单文件小改 | 可不开 |
| 多文件功能 | 默认开 |
| 并发多 agent | 必开 |
| DB / 核心流程 / 迁移 | 必开 |
| 不确定风险任务 | 必开 |

主 Claude 如果不开 worktree，要能说明风险很低；如果开 worktree，交付摘要里要提醒大哥当前改动在隔离分支里。

## 7. 留痕规则

少说多做的前提是做事有痕。

| 痕迹 | 写到哪里 | 什么时候写 |
|---|---|---|
| 大方向与验收 | `plan.md` | 动手前 |
| 关键文件与决策 | `context.md` | plan 确认后 |
| 执行进度 | `tasks.md` | 每完成一步 |
| UI/脚本状态 | `tasks.json` | 与 tasks.md 同步 |
| 用户可感知操作 | LogsView + JSONL | mutation 起止配对 |
| 后台长任务 | JobsView | review / install 等 |
| 顺手发现的问题 | `dev/issues.md` | 当前任务外的问题 |
| 长期经验 | `dev/memory/auto.md` | 归档 review 自动写 |
| 大哥偏好 | `dev/memory/manual.md` | 手动追加 |

### 7.1 操作日志

凡是用户可感知操作或 mutation API，都必须有起止配对：

- 前端：`logAction(scope, action, fn, ctx?)`
- 后端：`serverLog(level, scope, msg, extra?)`

验收项必须写清楚：

```text
在 LogsView 看到 scope=X action=Y 的起止配对。
```

文档类任务、纯说明、纯注释不需要强行加日志。

### 7.2 Issues

发现与当前任务无关的问题，不要顺手修。追加到：

```text
dev/issues.md
```

单行格式：

```md
- [ ] <简要描述>（文件 <相对路径>[:行号]；上下文：<一句话>）
```

## 8. 验证与交付

交付前按任务风险选择验证：

| 改动类型 | 最低验证 |
|---|---|
| 文档 | 通读 + grep 关键段落 |
| TypeScript 源码 | `pnpm -C packages/server exec tsc -b` 或 `pnpm -C packages/web exec tsc -b` |
| API / DB | 对应 smoke 或 curl 端到端 |
| UI 行为 | 浏览器验收或明确人工验收步骤 |
| LogsView 相关 | 成功和失败日志至少各验证一次 |

交付摘要 ≤10 行，**写给大哥看，不是工程笔记**。**第一行必须是验收指引**——白话告诉大哥“现在去哪里点哪里能看到效果”：

```md
验收：现在去哪里点哪里，看什么结果（一句白话，不带术语）。

改了什么（涉及的主要文件）：
验证过什么（跑了什么命令 / 点了什么 UI）：
有没有遗留 TODO：
是否需要归档：
```

术语括号解释，符合 0.1 节“跟大哥说话的规矩”。**没有这段摘要不算交付完成**；第一行不是验收指引也不算合格。

不要复述长过程。过程已经在 Dev Docs、LogsView、JobsView、memory 里。

## 9. 当前项目的后续补强项

这些不属于每次任务自动顺手修的范围，应单独立项：

1. ~~同步 `CLAUDE.md` 与 `packages/server/src/dev-docs-guidelines.ts`，避免 UI 应用到新项目时写入旧版 Dev Docs 规则。~~（✅ 已于 2026-05-07 解决：本仓 dev-docs-guidelines.ts 已与 CLAUDE.md 当前版本同步，任务"工作流模板同步"）
2. 把 `CLAUDE.md` 里的 `AIMON_SESSION_PROMPT_PATH` 读取规则同步到模板和 harness 安装文档。
3. 若 browser-use MCP 未来升级工具名，同步更新 `vibespace-browser-tester` 的具体工具清单。
4. 评估是否恢复施工边界（scope 阻断），用于保护核心目录和数据文件。
5. 清理 `GET /api/projects/:id/harness-status` 与 `getHarnessStatus` 等前端不再消费的旧接口。
6. 明确 worktree 默认策略是否需要做成 UI 默认项，而不是只写在文档里。

## 10. 真源优先级

如果文档冲突，按这个优先级：

1. `CLAUDE.md`
2. `dev/agent-team-blueprint.md`
3. `dev/harness-roadmap.md`
4. `.aimon/skills/*.md`
5. `docs/*.md`

本文档是执行手册，不是最终真源。发现冲突时，修本文档或同步真源，不要让两套规则长期并存。

## 11. 工作流生效的信号（自查用）

每次任务结束前，AI 应当反向核对下面这几条。任何一条不符合，说明流程出了问题，下一次要纠：

- diff 里没有跟本任务无关的改动。
- 不再因为“过度实现”反复重写。
- 澄清问题发生在动手之前，而不是事后返工。
- PR 干净、聚焦，没有顺手重构或“顺便改进”。
- **大哥在整个任务里只点过一次头**（plan 阶段），之后只在交付时验收，没有被技术细节、命名选择、文件结构这种琐碎打扰。
- 对大哥输出的每段话都看得懂——术语都翻译过，没有“zod / mutation / payload / route handler”裸奔。
- 交付摘要第一行能直接拿去验收，不用回头解读。
