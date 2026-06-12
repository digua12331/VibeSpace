# VibeSpace CLI · 任务清单

- [x] 步骤 1：建 packages/cli 骨架 → pnpm install 拾起 5 个 workspace
- [x] 步骤 2：args parser + config + ping → `node --check` 全部通过；ping/json/unreachable/unknown 边界全对
- [x] 步骤 3：project create/list/delete/switch → 4 条全工作；confirmation_required + project_not_found 安全闸有效
- [x] 步骤 4：session start → shell session 起成功，pid 返回；project switch 后默认 project 联动生效
- [x] 步骤 5：docs read/write/archive → --content / --stdin 均工作；archive 修复 fastify 空 body bug 后通过
- [x] 步骤 6：skill install → 装到 `~/.claude/skills/vibespace-cli/SKILL.md` 4518 bytes；二次跑显示"已是最新"
- [x] 步骤 7：skill 真源 vibespace-cli.md → frontmatter 触发词写好；显式声明"不取代 Dev Docs 三段式"
- [x] 步骤 8：双语 README 加 CLI 小节 → README.md / README.zh-CN.md 都加；Repository layout 也补了 packages/cli 行
- [x] 步骤 9：边界 + 烟测 → 12 条验收全通过；`git diff --name-only HEAD` 仅 3 个 modified + 12 个 untracked，全在边界内；**vibespace-cli skill 已被 Claude Code 自动加载**（系统 reminder 里看到）
