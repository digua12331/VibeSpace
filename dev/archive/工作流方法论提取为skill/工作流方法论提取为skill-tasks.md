# 工作流方法论提取为skill · 任务清单

- [x] 步骤 1：创建任务目录与 plan/context 两文件 → verify: `dev/active/工作流方法论提取为skill/` 下能看到 plan.md 与 context.md
- [x] 步骤 2：写 tasks.md / tasks.json → verify: 两文件存在且 status 字段同步
- [x] 步骤 3：调用 Skill skill-creator，喂 7 条方法论材料 → verify: skill-creator 加载并返回 skill 创建引导（已确认）
- [x] 步骤 4：把 SKILL.md 落盘到 `~/.claude/skills/dev-docs-workflow/` → verify: 文件存在，frontmatter 含 name+description（已确认 — Claude Code 系统提示里已列出 dev-docs-workflow）
- [x] 步骤 5：description 关键词覆盖触发词清单 → verify: description 包含 plan / 重构 / bug / 新功能 / 三段式 / 量级 等多个关键词（已确认）
- [x] 步骤 6：在 VibeSpace CLAUDE.md 顶部加一行指向该 skill → verify: 该文件搜索 dev-docs-workflow 有命中（已确认）
- [x] 步骤 7：写 handoff 摘要给大哥 → verify: 回复末尾有 ≤10 行白话验收指引，第一行是"在哪里看到效果"
- [ ] 步骤 8（待主理人手动验收）：在别的项目新会话里说"加个新功能"，看是否触发该 skill 加载 → verify: 系统提示里出现 dev-docs-workflow
