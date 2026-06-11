# 隔离会话继承项目权限 · Plan

## 大哥摘要

派工出去的 AI（项目经理派工、问题派 AI、开了"隔离"开关的会话）一直疯狂弹权限确认，是因为它们跑在 worktree（git 的临时副本目录）里，而你在「项目设置→权限」里配的权限只存在项目根目录的一份本地文件里，副本里没有这份文件。本次改动：每次建好副本后，自动把这份权限文件复制进去。改完后，派工 AI 会直接继承你配好的全部权限，不再重复弹窗。不动你的任何现有数据和界面。

## 目标

- 隔离会话（isolation=worktree）启动后，其 worktree 目录里存在 `.claude/settings.local.json`，内容与项目根的一致。
- 验收：起一个隔离会话，检查 `packages/server/data/worktrees/<项目>/<会话>/.claude/settings.local.json` 存在且内容与项目根一致；项目根没有该文件时静默跳过、会话照常启动。
- 类型检查：`pnpm --filter @aimon/server build` 通过。

## 非目标

- 不解决"权限改了之后已存活的隔离会话不会热更新"（副本是启动时复制的快照）。
- 不动"同意并不再问"按键模拟（↓+回车在两选项弹窗会选错）的隐患——已在交付说明里提过，另行处理。
- 不复制 `.claude/` 下其他不进 git 的文件。

## 实施步骤

1. `routes/sessions.ts`：`addWorktree` 成功后，best-effort 复制项目根 `.claude/settings.local.json` → worktree 同路径。源文件不存在则跳过；复制失败只记 warn 日志，不阻塞会话启动。→ verify: 类型检查通过 + 起隔离会话看文件存在。

## 边界情况

- 项目根没有 `.claude/settings.local.json`：跳过，不报错。
- worktree 里 `.claude/` 目录不存在（项目没把 settings.json 进 git）：先 `mkdir -p` 再复制。
- 复制失败（权限/磁盘）：warn 日志，会话照常启动——权限文件缺失只是退回现状（多弹窗），不应让派工失败。

## 风险与注意

- `addWorktree` 全仓只有 `routes/sessions.ts:428` 一个调用点，经理派工/issue 派 AI 都经内部 `app.inject` 走同一路由，改一处全覆盖。
- memory 扫过：复用"项目级可选配置按 best-effort、坏文件只跳过并记日志"的既有约定（auto.md 2026-05-02 会话启动模板条目）；日志用 serverLog/logSpawnSubstep 既有形态。

## 多模型 Plan 会审

跳过：小档任务（单文件、加性改动、易回滚），按工作流不调外部模型。
