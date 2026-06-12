# 提交按钮一键提交并推送 · 任务清单

- [x] 步骤 1：改 `onCommit` 函数体，commit 成功后若非 detached 自动 push；push 失败时 setErr 写"已本地提交，但推送失败：…" → verify: 函数最终 import / 调用图里能看到 `api.gitPush` + `logAction('git', 'push', ...)`；阅读改后函数确认错误前缀正确。
- [x] 步骤 2：改按钮文案、placeholder、tooltip 反映新行为（含 detached 降级文案与 busy='push' 时的"推送中…"） → verify: grep `提交并推送` 与 `仅本地` 在 ChangesList.tsx 各出现 ≥1 次；按钮 JSX 里 busy='push' 分支出现 `推送中…`。
- [x] 步骤 3：跑 `pnpm --filter @aimon/web exec tsc -b` 类型检查 → verify: 退出码 0，无 TS error。结果：EXIT=0 通过。
- [x] 步骤 4：检查 `git diff --name-only HEAD` 仅包含写白名单文件 + 三个 dev/active md → verify: 无越界文件。结果：仅 `packages/web/src/components/ChangesList.tsx`（白名单内）+ `packages/server/tsconfig.tsbuildinfo`（SessionStart 起始就 M 的构建缓存，非本次任务产物）；dev/active md 在 .gitignore 中不入 diff。
- [x] 步骤 5：派 `vibespace-browser-tester` 验收 → 部分完成：V3（源码层文案/placeholder/tooltip 全部就位）PASS；V1/V2（浏览器交互）SKIP，原因是 subagent 未注入 browser-use MCP 工具。源码层 PASS 作为前端文案改动的有效证据；浏览器实测降级为大哥手动验收（详见 handoff）。
