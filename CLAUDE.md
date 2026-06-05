> **本项目通用方法论已抽离为 `dev-docs-workflow` skill**（落盘在 `~/.claude/skills/dev-docs-workflow/SKILL.md`），其他项目可按关键词命中加载。**本文件仍是 VibeSpace 的 100% 强制规则**——SessionStart hook 每次注入，与 skill 内容重叠时**以本文件为准**。本文件包含 skill 没有的项目专属补充：`logAction` / `serverLog` 具体函数名、`packages/server/data/logs/` 落盘路径、`vibespace-*` 子代理调度、`dev/issues.md` 入口、`dev/memory/auto.md` 自动评审、`.claude/` 配置分层等。

<!-- dev-docs-workflow:import -->
@.aimon/workflow/dev-docs.md
