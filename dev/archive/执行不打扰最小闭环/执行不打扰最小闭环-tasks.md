# 执行不打扰最小闭环 · 任务清单

- [x] 1 BudgetManager 核心（task-budget.ts）：state 字段 + EventEmitter + 默认上限 + 监听 statusManager 'change' 做 stall 探测 → verify: `pnpm -C packages/server exec tsc -b --force` 通过；状态机由 step 8 smoke 端到端覆盖
- [x] 2 接入 routes/hooks.ts：PreToolUse/PostToolUse 计 rounds / 算 token 估算 → verify: `pnpm -C packages/server exec tsc -b --force` 通过；端到端由 step 8 smoke 覆盖
- [x] 3 真熔断 + STATUS.md 写入（task-status.ts）：BudgetManager 触发上限 → ptyManager.kill + appendStatusEntry CUTOFF → WS broadcast → verify: `pnpm -C packages/server exec tsc -b --force` 通过；端到端由 step 8 smoke 覆盖
- [x] 4 自动 checkpoint：statusManager 'change' stopped/crashed → appendStatusEntry STEP_DONE/STEP_FAIL（idle 不写避免噪声） → verify: `pnpm -C packages/server exec tsc -b --force` 通过；端到端由 step 8 smoke 覆盖
- [x] 5 SessionStart hook 注入 STATUS 摘要：改 routes/hooks.ts buildSessionStartAdditionalContext 末尾追加任务恢复块（限 3KB） → verify: `pnpm -C packages/server exec tsc -b --force` 通过；端到端由 step 8 smoke 覆盖
- [x] 6 验收失败默认策略：recordVerifyResult 接口 + maxVerifyFails 触发熔断 → verify: 接口已在 step 1 实现 + 熔断路径已在 step 3 实现；端到端由 step 8 smoke 覆盖
- [x] 7 前端 DocsView：types + api + store + UI（BudgetPill + 04_status FileRow + 熔断红色卡片 + 2s polling） → verify: `pnpm -C packages/web exec tsc -b --force` 通过；浏览器手动验收交大哥跑（manual.md 偏好——自派 vibespace-browser-tester 由 step 8 总收尾）
- [x] 8 scripts/budget-cutoff-smoke.mjs + package.json + .aimon/templates/task-budget.example.json → verify: `pnpm smoke:budget-cutoff` 全 assertion 通过 ✅；server+web tsc 全绿；上一任务 smoke:issues-jobs 没回归 ✅；STATUS.md 已被 `dev/` 整体 .gitignore 覆盖，不需要单独条目
