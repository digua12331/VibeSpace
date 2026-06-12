# 大任务自拆并行 · 任务清单

## 批 1：后端基建（不动前端）

- [x] 1 抽公共 worktree-session-runner.ts（新建 + 参数化 marker / verify） → verify: tsc 通过；`pnpm smoke:issues-jobs` 仍全过
- [x] 2 改 routes/issue-jobs.ts：dispatchOne / wireSessionOutput / runVerifyPipeline 改成调用 runner → verify: tsc 通过；issues-jobs smoke 不回归 ✅
- [x] 3 新建 task-subtasks.ts：SubtaskSpec / SubtaskGraph / parseSubtasksFromPlan / validateGraph / topologicalOrder → verify: tsc 通过；step 9 smoke 覆盖端到端
- [x] 4 新建 task-subtasks-store.ts：SubtaskRunManager（仿 IssueJobManager），加 merged 状态 + 磁盘元数据 + EventEmitter → verify: tsc 通过；step 9 smoke 覆盖
- [x] 5 task-status.ts：StatusEntry 加 subtaskId 字段 + formatEntry 输出 → verify: tsc 通过；端到端由 step 9 smoke 覆盖
- [x] 6 新建 routes/task-subtasks.ts：5 个 HTTP 端点 + zod 校验 + serverLog 起止配对 + ws-hub broadcast → verify: tsc 通过；index.ts 注册新路由 ✅
- [x] 7 改 index.ts 注册 task-subtasks 路由 + 完整 server tsc → verify: `pnpm -C packages/server exec tsc -b --force` 通过 ✅

## 批 2：前端 UI

- [x] 8 前端 types + api + store：SubtaskSpec / SubtaskRun 类型镜像 + 5 个 API 函数 + taskSubtasks 字段 + WS 接收 → verify: `pnpm -C packages/web exec tsc -b --force` 通过 ✅
- [x] 9 DocsView：05_subtasks 入口 + 子任务列表（每行：id / 标题 / 状态 / 依赖 / worktree）+ 一键派工 + approve 全部按钮 + 主任务行子任务统计 pill → verify: web tsc 通过 ✅；UI 静态部分手动 + plan 8 条清单 4 条由 smoke 覆盖、4 条留大哥浏览器手动验收

## 批 3：smoke + 文档收尾

- [x] 10 scripts/task-subtasks-smoke.mjs：parseSubtasksFromPlan / 拓扑 dispatch（agent='shell'）/ approve-all 顺序 / 循环依赖 400 / write_files 重叠自动加边 + package.json smoke:task-subtasks + `.aimon/templates/subtasks-syntax.example.md` → verify: `pnpm smoke:task-subtasks` 全过 ✅（16/16）；issues-jobs smoke + budget-cutoff smoke 都不回归 ✅
- [x] 11 README.zh-CN.md + CLAUDE.md + dev/issues.md 文档更新 → verify: 大哥按 plan 验收清单逐条在浏览器里跑；handoff 摘要含验收指引 ✅

## 不做（plan 写但本轮跳过的 step）

- plan 原 step 7 (plan UI 自拆编辑器) — 第一版跳过；大哥需要时直接改 plan.md 的 `## 自拆与依赖` JSON 块。理由：步骤复杂、回报低（大哥更可能用 AI 写好的拆分而非手改），后续真有需求再单独起任务。
