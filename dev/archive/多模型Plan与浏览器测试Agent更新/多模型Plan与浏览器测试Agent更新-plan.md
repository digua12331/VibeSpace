# 多模型Plan与浏览器测试Agent更新 · Plan

## 大哥摘要

这次把 Plan 阶段改成默认多模型会审：Claude 先做本地草案，Gemini 补边界，Codex 定最终 plan，Claude 负责落盘和给你确认。
同时更新团队 agent 规则，并修掉浏览器测试 agent 的 browser-use 工具通配符问题，让它能真正接浏览器测试任务。
只改流程文档、agent prompt 和问题状态，不动业务功能和已有数据。
验收方式：看 `CLAUDE.md` 与 `.claude/agents/vibespace-browser-tester.md` 是否写清新规则；grep 不再出现 `mcp__browser-use__*` 通配符。

## memory 扫过

- `dev/memory/manual.md`：命中 2026-04-30 大哥偏好：只关心大方向和验收，技术选择 AI 自决；本次继续保持一次确认。
- `dev/memory/auto.md`：只有 hook-smoke 条目，无关。

## 目标

1. `CLAUDE.md`：把 Plan 阶段从“可选多模型第二意见”改成默认“三模型会审 + Codex 定稿 + Claude 落盘”。
2. `.claude/agents/vibespace-browser-tester.md`：展开 browser-use MCP 工具名，删除通配符和开放问题，让测试 agent 能按测试 task 执行。
3. 团队 agent 相关规则同步：`dev/agent-team-blueprint.md`、`.aimon/skills/团队派工.md` 和两份 `docs/` 说明不再与 `CLAUDE.md` 打架。
4. `dev/issues.md`：把 browser tester 通配符问题标记为已处理。

## 非目标

- 不实际调用 Gemini/Codex 生成本任务 plan；本任务是在修改规则本身。
- 不启动 dev server，也不真实跑 browser-use。
- 不改业务代码、UI、后端路由或安装逻辑。

## 实施步骤

1. 建立本任务 Dev Docs 档案，并同步 tasks 状态。
2. 更新 `CLAUDE.md` 的 runtime skill 读取规则和默认多模型 Plan 规则。
3. 更新团队 agent 蓝图、团队派工 skill 与两份 docs 文档。
4. 更新 `vibespace-browser-tester` 的 browser-use 工具清单与测试流程。
5. 勾掉 `dev/issues.md` 中已解决的 browser tester 问题。
6. grep 验证关键规则和通配符清理，跑 `git diff --check`。

## 边界情况

- 如果 Gemini/Codex 工具不可用，新规则必须允许记录“跳过原因”后由 Claude 兜底写 plan，不能阻塞任务。
- 极小/小任务仍可跳过等待确认，避免把多模型会审变成日常噪声。
- browser-use 工具名以项目历史调研的 MCP 暴露名为准：`browser_navigate`、`browser_click`、`browser_type` 等。

## 风险与注意

- Codex “定稿”在 Claude 会话里实际表现为：Claude 调用 Codex 外部意见，然后把 Codex 定稿写入 `plan.md`；文件写入者仍是当前主 Claude。
- browser-use MCP 工具名如果未来升级变化，测试 agent 仍可能需要跟着更新；这次先移除已知通配符问题。
