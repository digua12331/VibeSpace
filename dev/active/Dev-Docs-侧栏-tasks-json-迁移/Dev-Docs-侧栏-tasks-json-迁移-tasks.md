# Dev-Docs-侧栏-tasks-json-迁移 · 任务清单

> 仅由 AI 在推进过程中维护；人类读，不改。

- [x] 步骤 1 — 服务端：`docs-service.ts` 加 `blocked` 状态类型；新增 `readTasksJson` + 内部 schema；改 `summarizeTask` 走 json 优先、失败回退 md。→ verify: `pnpm --filter @aimon/server exec tsc --noEmit -p tsconfig.json` 成功 ✓ (tsc 静默通过)
- [x] 步骤 2 — Web 类型：`types.ts` 的 `DocTaskStatus` 加 `'blocked'`。→ verify: `pnpm --filter @aimon/web exec tsc -b --noEmit` 成功 ✓
- [x] 步骤 3 — UI：`DocsView.tsx` 的 `StatusPill` 加 `blocked` 分支（rose 色系，文案 "阻塞 X/Y"）。→ verify: 再跑一次 web typecheck 成功 ✓
- [x] 步骤 4 — 构造浏览器验收用 fixture 目录 `dev/active/测试-json任务/`（3 步 status：done / doing / blocked + 对应 md）。→ verify: 目录与文件落盘，文件内容符合 context 的 schema ✓
- [ ] 步骤 5 — 浏览器验收 4 个场景 + 回归。→ verify: 场景全部符合"context · 验收标准"；现有 8 个任务显示结果无变化（**blocked：等用户在浏览器里点过 4 个场景**）
- [ ] 步骤 6 — 清理 fixture、写 handoff 摘要。→ verify: `测试-json任务/` 已删除；对话末尾给出 ≤10 行摘要
