# Codex CLI 项目配置模板

被 aimon 一键复制到 `<项目>/.codex/` 后，Codex 启动时会自动读取。

| 文件 | 说明 |
| --- | --- |
| `config.toml` | 审批策略 / 沙盒 / 行为调优。aimon 的权限面板读写这个文件。 |
| `AGENTS.md` | 项目上下文提示（类似 CLAUDE.md 之于 Claude Code）。 |
| `prompts/` | 项目级自定义 slash command/模板（可选）。 |

## 核心权限键

- `approval_policy`: never / on-failure / on-request / untrusted
- `sandbox_mode`: read-only / workspace-write / danger-full-access
- `sandbox_workspace_write.network_access`: bool
- `sandbox_workspace_write.writable_roots`: 绝对路径数组
