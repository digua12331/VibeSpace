# 多模型Plan与浏览器测试Agent更新 · 任务清单

- [x] 步骤 1：建立 Dev Docs plan/context/tasks/tasks.json → verify: `dev/active/多模型Plan与浏览器测试Agent更新/` 下四件套存在
- [x] 步骤 2：更新 `CLAUDE.md` 的 runtime skill 和默认多模型 Plan 规则 → verify: grep 命中 `AIMON_SESSION_PROMPT_PATH`、`三模型会审`、`Codex 定稿`
- [x] 步骤 3：同步团队规则文档与 skill → verify: `dev/agent-team-blueprint.md`、`.aimon/skills/团队派工.md`、两份 `docs/` 都包含新 Plan / browser tester 规则
- [x] 步骤 4：更新 `vibespace-browser-tester` 工具清单和测试流程 → verify: 文件不再包含 `mcp__browser-use__*`，且包含具体 `mcp__browser-use__browser_navigate`
- [x] 步骤 5：勾掉已解决 issue → verify: `dev/issues.md` 对应 browser tester 行为 `- [x]`
- [x] 步骤 6：最终检查 → verify: 无待办状态；`git diff --check` 无内容格式错误；本轮改动范围只含规则/文档/agent prompt
