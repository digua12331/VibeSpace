# 记忆按相关性召回 · 任务清单

- [x] 步骤 1：docs-service.ts 加 `readTaskFileHints(projectPath, task)` → verify: 临时跑 tsx 对一个真实任务目录调用返回非空数组、对不存在任务返回 `[]`
- [x] 步骤 2：hooks.ts 加纯函数 `selectAutoLessons(autoLessons, opts)` + 打分助手 → verify: smoke 脚本断言 文件重叠条目排前、无信号退回 slice(-N) 原序
- [x] 步骤 3：hooks.ts `buildMemoryHeader` 改用 `selectAutoLessons`、返回带 mode/autoCount、标题随 mode 切文案 → verify: `pnpm -F @aimon/server build` 通过
- [x] 步骤 4：hooks.ts `buildSessionStartAdditionalContext` 取 fileHints 传入 + `serverLog("info","memory",{mode,autoCount})` → verify: `pnpm -F @aimon/server build` 通过；说明 LogsView 应见 `scope=memory` 一条
- [x] 步骤 5：全量后端构建 + 跑 smoke + 比对 git diff 与 write_files 白名单 → verify: build 绿、smoke 绿、`git diff --name-only HEAD` 仅含白名单文件
