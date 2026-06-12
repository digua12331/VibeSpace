# 多模型Plan与浏览器测试Agent更新 · Context

## 关键文件

| 文件 | 处理 |
|---|---|
| `CLAUDE.md` | 改 Plan 阶段规则；补 `AIMON_SESSION_PROMPT_PATH` 读取硬规则 |
| `.claude/agents/vibespace-browser-tester.md` | 展开 browser-use MCP 工具名，重写测试流程描述 |
| `dev/agent-team-blueprint.md` | 同步默认多模型 Plan、测试 agent 工具清单、subagent 边界 |
| `.aimon/skills/团队派工.md` | 同步团队派工说明与 browser tester 工具边界 |
| `docs/agent-harness-overview.md` | 大哥入口同步“Plan 阶段三模型会审” |
| `docs/team-agent-harness-dev-docs-workflow.md` | AI 执行手册同步新 Plan 规则与 browser tester 补强状态 |
| `dev/issues.md` | 勾掉 browser-use 通配符 issue |

## 决策记录

- 决策 1：Plan 阶段采用“三模型会审 + Codex 定稿 + Claude 落盘”。这样满足大哥“Claude、Gemini、Codex 都介入，Codex 出 plan”的方向，同时保留当前会话由 Claude 写文件的现实约束。
- 决策 2：多模型默认只针对默认/高风险任务；极小/小任务仍可跳过，避免为了改文案也拉三模型。
- 决策 3：browser-use MCP 工具按项目历史调研展开为 `mcp__browser-use__browser_*` 形式，不再使用 `mcp__browser-use__*` 通配符。
- 决策 4：不新增新的 `.claude/agents` 计划 agent。Plan 的多模型会审由主 Claude 调外部模型完成；`.claude/agents` 仍负责事实调研、实施和验收。

## 依赖与约束

- `dev/active/接入-browser-use/接入-browser-use-plan.md` 已记录 browser-use MCP 原子工具名。
- `packages/server/src/mcp-bridge.ts` 已负责向 claude/codex session 注入 browser-use MCP 配置。
- `.claude/agents` frontmatter 里的工具名需要是 Claude Code 能识别的具体工具，不依赖通配符。
- 本任务是文档/prompt 更新，不需要跑 TypeScript 构建。
