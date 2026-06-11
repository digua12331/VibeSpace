# 隔离会话继承项目权限 · Context

## 关键文件

- `packages/server/src/routes/sessions.ts:413-455`——唯一的 `addWorktree` 调用点；在 `setSessionWorktree`/`cwd = worktreePath` 附近插入复制逻辑。本次唯一要改的文件。
- 只读参考：
  - `scripts/lib/cli-configs-core.mjs::writeClaudeLocal`——权限 UI 写 `<项目>/.claude/settings.local.json` 的事实来源。
  - `packages/server/src/worktree-paths.ts`——worktree 落在 `packages/server/data/worktrees/<projectId>/<sessionId>`。
  - `packages/server/src/worktree-session-runner.ts:72-81`——经理派工经 `app.inject POST /api/sessions` 走同一路由。
  - `.gitignore:16-21`——`.claude/*` 被忽略仅放行 settings.json/templates/agents，证明 worktree 签出不含 settings.local.json。

## 决策记录

- **在路由层复制而不是改 `git-service.ts::addWorktree`**：addWorktree 是纯 git 封装，塞进 Claude 专属文件复制会污染职责；路由层本来就做 spawn 编排（skills 注入、MCP 注入都在这），且这里能拿到 projectId/sessionId 打日志。不过度设计：不抽 helper、不做配置开关、不做白名单复制多文件。
- **best-effort**：复制失败 warn 不阻塞——失败只是退回"多弹窗"现状，不值得让派工挂掉。
- **日志**：复制成功走 `logSpawnSubstep`（与 addWorktree/pickSkills/injectMcp 同形态）；失败 `serverLog("warn", "session", ...)`。不做起止配对——它是 spawn 大操作内的子步骤，逐条配对会重复（同 auto.md 高频/子步骤日志约定）。

## 依赖与约束

- `node:fs/promises` 已在文件内 import（mkdir/writeFile），需补 `copyFile`；路径用已有 `pathJoin`。
- 不改 API 形状、不改 DB、无破坏性变更。
