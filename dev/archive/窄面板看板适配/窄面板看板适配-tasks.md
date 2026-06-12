# 窄面板看板适配 · 任务清单

- [x] 步骤 1：改 HubProjectCard.tsx header 布局支持 wrap → verify: 文件 diff 只动 L83–137 区间，外层 className 出现 `flex-wrap`，按钮组出现 `ml-auto`
- [x] 步骤 2：跑 `pnpm -C packages/web typecheck`（或 `tsc --noEmit`）→ verify: 0 错误（实际命令 `pnpm -C packages/web exec tsc -b --noEmit`，EXIT=0）
- [ ] 步骤 3：浏览器验收 → verify: 派 vibespace-browser-tester 在 sidebar 拖到 ~320px / 480px / 640px 三种宽度下截图，确认「+ 派任务」三字完整、按钮组贴右、宽屏单行不变
- [ ] 步骤 4：write_files 边界自查 → verify: `git diff --name-only HEAD` 仅包含 `packages/web/src/components/hub/HubProjectCard.tsx` + `dev/active/窄面板看板适配/*`
