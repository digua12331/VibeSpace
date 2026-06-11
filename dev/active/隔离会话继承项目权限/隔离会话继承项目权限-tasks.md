# 隔离会话继承项目权限 · 任务清单

- [x] sessions.ts 在 addWorktree 成功后 best-effort 复制项目根 .claude/settings.local.json 进 worktree → verify: `pnpm --filter @aimon/server build` 通过；diff 只含 sessions.ts ✓
