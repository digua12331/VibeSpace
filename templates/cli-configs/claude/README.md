# Claude Code 项目配置模板

被 aimon 一键复制到 `<项目>/.claude/` 后，Claude Code 会自动读取。

| 文件 | 说明 |
| --- | --- |
| `settings.json` | 团队共享的基线：`permissions.allow/ask/deny` 初始值。 |
| `settings.local.json.example` | 本地覆盖的样例；复制为 `settings.local.json` 后 aimon 面板读写它。 |
| `agents/` | 项目范围的 subagent 定义（可选）。 |
| `skills/` | 项目范围的 skill 定义（可选）。 |
| `commands/` | 项目范围的 slash command（可选）。 |

## 权限语法速查

- 整工具：`"Bash"`、`"Read"`、`"WebFetch"` …
- Bash 前缀：`"Bash(pnpm:*)"` 允许 `pnpm <anything>`；`"Bash(git status)"` 精确匹配。
- 按域 WebFetch：`"WebFetch(domain:github.com)"`。
- MCP 工具：`"mcp__<server>__<tool>"`。

三个数组：
- `allow` — 免确认直接放行
- `ask` — 每次执行时弹窗询问
- `deny` — 直接拒绝，优先级最高
