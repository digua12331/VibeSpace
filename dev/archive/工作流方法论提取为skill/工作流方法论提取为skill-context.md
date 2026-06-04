# 工作流方法论提取为skill · 上下文

## 关键文件

- `F:\VibeSpace\KB\AIkanban-main\CLAUDE.md` — 真源，通用方法论的出处
- `C:\Users\Administrator\.claude\skills\dev-docs-workflow\SKILL.md` — 新建落盘点
- `dev/active/工作流方法论提取为skill/` — 本任务的 plan/context/tasks 三文件
- skill-creator 内置 skill — 由 `Skill` 工具调用，路径未知（系统级）

## 决策记录

- **skill 名定为 `dev-docs-workflow`**：与项目里"Dev Docs"术语对齐；英文友好；用户级目录命名习惯
- **共 7 条方法论入 skill**：1) 三档量级判定 / 2) 三段式骨架 / 3) 多模型会审 / 4) 外科式改动+熔断 / 5) 白话化 / 6) 操作日志方法论 / 7) dev/active 目录约定
- **不抽 vibespace-* agent 调度表**：那是项目内置 agent，全局 skill 装到别的项目根本不存在这些 agent
- **不抽操作日志的具体函数名（logAction/serverLog）**：方法论沉淀写"begin/end 配对 + ERROR 路径"即可，函数名是 VibeSpace 专属
- **不抽自动评审/记忆系统**：`dev/memory/auto.md` 自动评审依赖 VibeSpace 后端 fire-and-forget 机制 + UI 撤回按钮，不是纯方法论
- **CLAUDE.md 不删通用部分**：本轮纯增量，避免一次改太多。资深视角自查："这是不是过度设计？"——不是，只是迁移；"是不是只用一次的抽象？"——不是，旨在多项目复用
- **跳过多模型会审**：本任务无代码改动、无大方向分叉，外部模型评审价值低于其调用成本

## 依赖与约束

- skill 文件必须有 YAML frontmatter（`name` + `description` 至少这两个字段）
- description 必须包含触发关键词，覆盖：新功能 / new feature / 重构 / refactor / bug 修复 / bug fix / 非平凡改动 / 计划 / plan / 任务清单 / tasks / 三段式 / 量级判定
- 用户级 skill 目录是 Claude Code 标准约定（`~/.claude/skills/<name>/SKILL.md`），无需额外注册

## 范围边界（执行阶段对照用）

本次只动以下文件：
- 新建：`C:\Users\Administrator\.claude\skills\dev-docs-workflow\SKILL.md`
- 新建：`dev/active/工作流方法论提取为skill/{plan,context,tasks}.md` + `tasks.json`
- 修改：`F:\VibeSpace\KB\AIkanban-main\CLAUDE.md`（顶部加 1 行指引）

任何超出此清单的文件改动，都属于越界——若发现需要溢出，先回头补 context 再继续。
