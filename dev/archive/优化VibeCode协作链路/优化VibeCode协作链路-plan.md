# 优化VibeCode协作链路 · 计划

## 大哥摘要

这次要把 Team Agent、Harness、Dev Docs 三套能力收束成一条更顺的 vibe code 链路：你只在大方向上点一次头，后续由 AI 自己拆解、派工、执行、验证和留痕。
做完后，你主要看两处：`docs/agent-harness-overview.md` 作为“怎么用”的入口，`docs/team-agent-harness-dev-docs-workflow.md` 作为“AI 怎么执行”的手册。
不会主动改业务功能或数据；本轮重点是统一规则、文档和必要的轻量提示，让后续任务少问你技术细节。
验收方式：新文档能清楚回答“什么时候问你、什么时候不问你、怎么留痕、谁负责干活、哪里验收”。

## memory 扫过

- 相关：`dev/memory/manual.md` 里 2026-04-30 大哥偏好明确写了：大哥不懂代码，只关心“大方向 + 能验收”；纯内部实现分叉由 AI 自决；Dev Docs 确认压成只在 plan 后停一次。
- 相关：`dev/memory/manual.md` 里 2026-04-24 大哥偏好明确写了：小功能可直接改，不必完整走 plan→context→tasks。
- `dev/memory/auto.md` 当前仅有 hook-smoke 冒烟样例，与本任务无实质关系。

## 目标

1. 把“抓大放小、少说多做、做事留痕”固化成当前项目的协作链路，而不是停留在对话里的口头原则。
2. 明确三者分工：
   - Dev Docs：负责大方向、任务拆解、验收标准、执行进度。
   - Team Agent：负责谁来做事，主 Claude 统筹，subagent 只执行明确子任务。
   - Harness：负责隔离、日志、hook、后台任务、记忆沉淀等基础设施。
3. 让大哥只需要关心：
   - plan 摘要是否对；
   - 最终在哪里验收；
   - 归档后是否沉淀经验。
4. 让 AI 明确默认行为：
   - Plan 后只等一次确认；
   - Context/Tasks/执行阶段不再要求大哥确认；
   - 技术细节自行判断；
   - 只有方向、数据安全、验收不可行、连续失败时才打断。

## 验收标准

1. `docs/agent-harness-overview.md` 被整理成大哥入口文档，能用白话说明：
   - 你只需要做什么；
   - AI 会自动做什么；
   - 什么时候必须问你；
   - 什么时候不该问你；
   - 做完在哪里看留痕。
2. `docs/team-agent-harness-dev-docs-workflow.md` 被整理成执行手册，能清楚说明：
   - Dev Docs / Team Agent / Harness 三者如何串起来；
   - 标准任务流；
   - subagent 派工表；
   - skill 触发与 `AIMON_SESSION_PROMPT_PATH` 的硬规则；
   - LogsView / JobsView / memory / issues 的留痕规则；
   - worktree 什么时候开、什么时候不开。
3. 两份文档不互相打架：总览文档只讲“怎么用”，执行文档讲“怎么落地”；细节真源仍指向 `CLAUDE.md`、`dev/agent-team-blueprint.md`、`dev/harness-roadmap.md`。
4. 明确列出当前项目需要后续修的链路缺口，例如：
   - `dev-docs-guidelines.ts` 与根 `CLAUDE.md` 不同步；
   - browser-tester 的 MCP 工具通配符风险；
   - 是否恢复施工边界；
   - 是否把 `AIMON_SESSION_PROMPT_PATH` 读取要求写入硬规则。
5. 完成后不直接修改业务代码；只交付文档层面的链路优化方案，后续是否继续改代码由大哥确认。

## 非目标

- 本任务不直接修 browser-use MCP、施工边界、hook 阻断、Dev Docs 自动应用规则等代码问题，只把它们列为后续明确任务。
- 本任务不改数据库、不改 session 启动逻辑、不改 UI 行为。
- 本任务不引入新的 agent 或新的 harness 层，只整合现有能力。

## 实施步骤

1. 整理 `docs/agent-harness-overview.md`：把它改成大哥视角的“少说多做使用手册”。
   - verify：读文档前 3 分钟能理解自己只负责方向和验收。
2. 整理 `docs/team-agent-harness-dev-docs-workflow.md`：把它改成 AI 执行视角的“链路操作手册”。
   - verify：文档能从需求进入一路讲到归档记忆，且包含派工、留痕、worktree、skill、熔断规则。
3. 对齐两份文档的术语和边界。
   - verify：两份文档对“一次确认”“context/tasks 不等待确认”“subagent 不对话”“留痕位置”的描述一致。
4. 在文档末尾列出“后续应另起任务处理”的技术缺口。
   - verify：缺口清单是行动项，不把未落地能力写成已完成能力。

## 边界情况

- 如果发现两份 docs 与 `CLAUDE.md` 的真源规则冲突，以 `CLAUDE.md` 为准，本任务只修 docs，不改真源。
- 如果发现要真正做到“少说多做”必须改代码，例如强制读取 `AIMON_SESSION_PROMPT_PATH`，本任务只记录后续任务，不在本轮顺手实现。
- 如果文档需要引用当前还未落地的能力，必须标成“后续补强”，不能写成已完成。

## 风险与注意

- 风险 1：文档写得太抽象，大哥仍然不知道怎么验收。处理方式：每个规则都落到“你看哪里、AI 做什么、留痕在哪里”。
- 风险 2：把“少说多做”写成“AI 可以乱动”。处理方式：保留数据安全、用户可见方向、验收不可行、连续失败的打断条件。
- 风险 3：重复已有文档。处理方式：`agent-harness-overview.md` 做入口，`team-agent-harness-dev-docs-workflow.md` 做执行手册，真源仍指向现有核心文档。

