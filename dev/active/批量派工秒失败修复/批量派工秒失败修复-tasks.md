# 批量派工秒失败修复 · 任务清单

- [x] 步骤 1：runner 改文件信号轮询（删 buffer 扫描、接口去 marker、回调改名、spawn 时 mkdir+删旧信号、exit 前补读、命中补日志、新增 JOB_SIGNAL_REL_PATH 常量） → verify: `pnpm --filter @aimon/server exec tsc --noEmit` 通过
- [x] 步骤 2：issue-prompt.ts 删 marker 常量、完成约定改为写信号文件 → verify: tsc 通过 + grep 无 `ISSUE_*_MARKER` 残留
- [x] 步骤 3：task-subtasks.ts 删 marker 常量、子任务 prompt 改写、回调改名去 marker 参数 → verify: tsc 通过 + grep 无 `SUBTASK_*_MARKER` 残留
- [x] 步骤 4：issue-jobs.ts 去 marker import、回调改名去 marker 参数 → verify: tsc 通过
- [x] 步骤 5：全仓 grep 确认无残留旧引用（markerDone/markerStuck/onMarkerDone/onMarkerStuck/各 *_MARKER）+ server 整体 tsc 绿 + git diff --name-only 只含本任务 write_files → verify: grep 空结果 + tsc 通过 + diff 在白名单内
