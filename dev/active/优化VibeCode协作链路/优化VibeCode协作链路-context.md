# 优化VibeCode协作链路 · 上下文

## 关键文件

- `docs/agent-harness-overview.md`：当前是三层关系总览，但更像知识入口；本任务要改成大哥使用手册，突出“你只管方向和验收，AI 自己做事并留痕”。
- `docs/team-agent-harness-dev-docs-workflow.md`：当前是现状盘点；本任务要改成 AI 执行手册，明确 Dev Docs / Team Agent / Harness 如何串成标准链路。
- `.gitignore`：当前 `docs/*` 默认忽略，仅白名单了 `docs/claude-config-tiers.md` 和 `docs/team-agent-harness-dev-docs-workflow.md`；需要补 `docs/agent-harness-overview.md` 白名单。
- `dev/active/优化VibeCode协作链路/优化VibeCode协作链路-tasks.md` 与 `.json`：记录本任务执行状态。

## 决策记录

- 决策 1：两份 docs 不再都做“总览”。`agent-harness-overview.md` 面向大哥，讲怎么用；`team-agent-harness-dev-docs-workflow.md` 面向 AI，讲怎么执行。这样避免重复。
  - 资深工程师是否会觉得过度设计：不会。两份文档服务不同读者，减少冲突。
- 决策 2：不修改 `CLAUDE.md` 或 `dev-docs-guidelines.ts`。本任务已在 plan 里限定为文档链路优化；真源规则同步属于后续代码/规则任务。
  - 资深工程师是否会觉得过度设计：不会。避免扩大任务范围。
- 决策 3：worktree 不写成“所有任务强制开启”。极小/单文件小改不开；多文件、并发、数据库、核心流程、风险任务默认或必须开启。
  - 资深工程师是否会觉得过度设计：不会。符合成本与风险匹配。
- 决策 4：把 `AIMON_SESSION_PROMPT_PATH` 读取要求写成“链路硬规则”，但标明当前服务端只负责生成与注入 env，真正强制消费需后续同步到 `CLAUDE.md` / 模板。
  - 资深工程师是否会觉得过度设计：不会。准确区分已落地能力和待补强能力。

## 依赖与约束

- `CLAUDE.md` 是 Dev Docs 真源；本文档不能与它冲突。
- `dev/agent-team-blueprint.md` 是团队 agent 真源；本文档只提炼派工表，不重写 agent 定义。
- `dev/harness-roadmap.md` 是 harness 真源；本文档只提炼已落地能力和后续缺口。
- `.gitignore` 修改必须只补文档白名单，不改变现有忽略策略。

