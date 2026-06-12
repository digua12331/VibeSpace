# 工作流硬约束升级 · 上下文

## 关键文件

### 要改（write_files）

- `CLAUDE.md`
  - 第 144-158 行：tasks.json 模板（步骤 1 加 read_files/write_files 字段示例）
  - 第 166-174 行 `### 执行时的硬性规则（外科式改动）`：步骤 2 在末尾追加两条（读写白名单 + 破坏性变更协议）
  - 第 278 行附近 `## 可持续记忆` 第 1 项 `Plan 阶段的第一步`：步骤 3 加 ARCHITECTURE.md 扫描
  - 第 262 行 `## 规则与边界` handoff 那条：步骤 4 追加 diff 校验要求
- `AGENTS.md`（CLAUDE.md 的 Codex 副本，主语用 "Codex" 而非 "Claude"，不动其他既有替换）
  - 第 142-156 行：tasks.json 模板
  - 第 164-172 行：执行时硬性规则
  - 第 276 行附近：Plan 第 1 步
  - 第 260 行：handoff 段
- `.aimon/docs/team-agent-harness-dev-docs-workflow.md`
  - 第 142-152 行 `### 2.4 Tasks 阶段`：补 read_files/write_files 字段说明 + 起 `### 2.5 执行时硬性规则补充` 节挂两条新规则
  - 第 102-110 行 Plan 必含项：补 ARCHITECTURE.md 扫描
- `dev/ARCHITECTURE.md`（**新建**，≤300 行）
- `dev/active/工作流硬约束升级/工作流硬约束升级-tasks.md` / `-tasks.json`（本任务自身）
- `dev/issues.md`（追加一条 AGENTS.md "Codex 配置分层"段不彻底的发现）

### 只读（read_files）

- `packages/server/src/docs-service.ts:81-202`（确认 readTasksJson 只解析 status，新字段被忽略）
- `packages/server/src/review-runner.ts`（确认归档评审链路不动）
- `packages/server/src/index.ts`（ARCHITECTURE 入口梳理）
- `packages/web/src/main.tsx`（同上）
- `packages/hook-script/index.ts`（同上）
- `dev/memory/auto.md` / `manual.md`（已扫，命中条目记在 plan）
- `~/.claude/skills/dev-docs-workflow/SKILL.md`（**不读不改**——CLAUDE.md 第一段明示"以本文件为准"，本任务规则属 VibeSpace 项目专属）

## 决策记录

### 决策 1：纯规则约束 vs 后端硬卡口

**选**：纯规则约束（AI 自查 + git diff 命令模板）。
**舍**：在 archiveDocsTask 加 diff 比对、违规拒绝归档。
**理由**：
- 归档是末端，违规应在每步 verify 时就发现，不是归档时
- 极小档/小档任务连三个 md 都不写，硬卡口就要做一堆豁免分支才能不卡
- review-runner 是 fire-and-forget，污染它会增加归档延迟和故障面
- AI 自查 + handoff 强制贴 diff 输出，足够在主 Claude 视野内闭环
**资深工程师视角**：会觉得加后端校验过度——本质是给"AI 自我约束"加防御性代码，但 AI 本来就该自查。

### 决策 2：read_files / write_files 用 glob 但不强制脚本校验

**选**：允许 glob、AI 心算判断越界、不引 minimatch 依赖。
**舍**：上 minimatch 在归档时跑严格 glob 匹配。
**理由**：
- 引 minimatch 是给"AI 自查 = AI 跑代码"配套，本质回到决策 1 否决的方向
- AI 看 `packages/server/src/routes/*.ts` 一眼就知道是不是覆盖了某个文件，不需要库

### 决策 3：ARCHITECTURE.md 限 ≤300 行

**选**：4 节硬限 300 行，超了拆到 dev/learnings.md 或具体任务的 context.md。
**舍**：完整描述每个文件每个函数（500+ 行）。
**理由**：
- ARCHITECTURE 用于 plan 第 1 步快速扫，超过 300 行 AI 反而不会读
- 详细信息留给具体任务的 context.md 重新摸——按需读取
- flow-kit RULES.md R1.9 就是这个原则（reference 加载预算 ≤150 行）

### 决策 4：极小档/小档显式豁免新规则

**选**：步骤 2 措辞明示"极小档/小档可省 read_files/write_files、可省 diff 校验"。
**理由**：
- manual.md 第 6 条（2026-04-24 大哥偏好）：小功能直接改不走流程
- 不豁免就跟既有偏好硬冲突，规则会变废纸或大哥会撤回

### 决策 5：破坏性变更协议的 5 条触发条件

**选**：删文件 / 删 ≥5 行业务代码 / 改跨文件 import 的导出符号 / 改公共 API（HTTP/WS/IPC）/ 改 SQLite 表结构。
**舍**：所有 export 符号 / 任何代码删改。
**理由**：
- 太宽（"任何 export"）会卡每个 helper 改动
- 太窄（仅 API）会漏掉跨包 import 的 type/const 改名
- 5 条覆盖了 auto.md 第 15 条（合并/删除 API 前必须搜调用点）+ 第 17 条（搬迁会被分发的文档要查多个落点）+ vibespace-db-scribe 子代理的固有约束（db.ts 三处同步）

### 决策 6：不下沉到全局 skill

**选**：本次新规则只写到 VibeSpace 项目内三处（CLAUDE.md / AGENTS.md / .aimon/docs/）。
**舍**：同步到 `~/.claude/skills/dev-docs-workflow/SKILL.md`。
**理由**：
- 三条规则中两条强依赖 VibeSpace 项目结构（packages/* / .aimon/skills / vibespace-* 子代理 / dev/ARCHITECTURE.md）
- auto.md 第 33 条经验："抽取全局 skill 时只搬通用方法论，项目专属路径、函数名、后台机制继续留在项目规则里"
- CLAUDE.md 第一段已明示"以本文件为准"，全局 skill 是通用方法论副本

## 依赖与约束

### 兼容性

- `docs-service.ts::readTasksJson` 当前 schema 只读 `steps[].status`（行 191-197），其他字段被忽略——新增 read_files/write_files 不会破坏 UI / 状态聚合 / 归档
- 现有任务（`dev/active/*` 下 24 个目录）不需要追溯加白名单——本规则只对**新任务**生效
- review-runner.ts 不动，归档评审 prompt 维持现状，新规则不影响 lessons 提取

### 执行顺序约束

- 步骤 1-4（CLAUDE.md 修改）必须先于步骤 5（AGENTS.md / .aimon/docs 同步）——不然 AGENTS.md 同步时拿不到新内容
- 步骤 6（派 explorer）和步骤 1-5 可以并行，但步骤 7（写 ARCHITECTURE.md）依赖步骤 6 输出
- 步骤 8（self-test diff 校验）必须最后——它要验证整个 diff 都在白名单内

### 不变约束（要确认本任务结束时仍成立）

- packages/server/src/docs-service.ts 行为完全不变
- packages/server/src/review-runner.ts 行为完全不变
- 现有 dev/active/* 24 个任务的 tasks.json 不被本任务触碰
- `~/.claude/skills/dev-docs-workflow/SKILL.md` 不被本任务触碰

## 任务边界

**本任务做**：改 4 份文档（CLAUDE.md / AGENTS.md / .aimon/docs/team-agent-harness-dev-docs-workflow.md / 新建 dev/ARCHITECTURE.md）+ 在 dev/issues.md 追加一条无关问题（AGENTS.md "Codex 配置分层" Claude→Codex 替换不彻底）。

**本任务不做**：
- 不改 packages/* 任何源码
- 不动归档评审 / 操作日志 / Issues 任何现有规则
- 不改全局 skill SKILL.md
- 不动 dev/active/* 现有 24 个任务
- 不写 minimatch / diff 校验脚本（决策 1）
- 不修复 AGENTS.md 里 "Codex 配置分层" 段（记 issue，不顺手修）
