# 批量派工秒失败修复 · context

## 关键文件（改动边界）

- `packages/server/src/worktree-session-runner.ts` — 核心。`wireMarkerDetection`（L104-146）改成文件信号轮询；`WorktreeJobSpawnInput` 接口（L14-31）删 `markerDone`/`markerStuck`、回调改名 `onSignalDone`/`onSignalStuck`；`spawnWorktreeJob`（L44-102）spawn 后 mkdir runtime 目录 + 删旧信号；新增导出常量 `JOB_SIGNAL_REL_PATH`。
- `packages/server/src/issue-prompt.ts` — 全文件。删 `ISSUE_DONE_MARKER`/`ISSUE_STUCK_MARKER`；`buildIssuePrompt` 完成约定（L26-30）改为"写信号文件"。
- `packages/server/src/routes/task-subtasks.ts` — 删 `SUBTASK_DONE_MARKER`/`SUBTASK_STUCK_MARKER`（L33-34）；`buildSubtaskPrompt` 完成约定（L93-98）改写；`dispatchOneSubtask`（L194-233）回调改名 + 去 marker 参数。
- `packages/server/src/routes/issue-jobs.ts` — 删 marker import（L10-14）；`dispatchOne`（L157-194）回调改名 + 去 marker 参数。

## 决策记录

- **为什么用带外文件信号而非"扫终端 + 时间窗护栏"**：扫终端找 sentinel 在 TUI 回显/ANSI/重绘/AI 复述下天然脆弱（本 bug 就是回显自触发）。时间窗只能压住首秒，挡不住后续重绘/复述。文件信号把"终端显示"彻底移出判定，是根治。Codex 会审同结论。不算过度设计——它**简化**了 runner（删 buffer 扫描逻辑），不是加抽象。
- **为什么落 `.aimon/runtime/job-signal`**：`.aimon/runtime/` 已在 `.gitignore`，`git add -A` 不会带进分支污染 merge；在 worktree 内 AI 有写权限；路径语义清楚。否决 STATUS.md（有污染/被误改风险）、git commit message（卡住不 commit）、退出码（表达不了 reason）。
- **为什么 setInterval 轮询不用 fs.watch**：Windows/worktree 下 fs.watch 易丢事件或重复触发。1s 轮询 + 严格内容判断足够，更稳。
- **为什么严格只认 `DONE`/`STUCK:` 前缀**：避开半写竞态——读到空/半行/乱码就忽略等下一拍。
- **不抽公共"signal 文件"模块**：只两处用，runner 内部一个常量 + 一段轮询即可，不为复用造抽象。

## 依赖与约束

- 派工 claude 在 worktree 有 Write/Edit/git 权限（全局 `~/.claude/settings.json` 已放行）——信号文件能写、改动能 commit。
- `spawnWorktreeJob` + 4 个 marker 常量仅被 issue-jobs / task-subtasks 独占引用，改接口不外溢。
- 改后端 TS，必须过 `pnpm --filter @aimon/server` tsc。
- 操作日志：runner 命中 signal 时补 serverLog 终点（spawn 那条是起点），满足"起止配对"约束。
- 破坏性变更（改导出接口 / 删导出符号）：改完 grep 全仓确认无残留旧引用。
