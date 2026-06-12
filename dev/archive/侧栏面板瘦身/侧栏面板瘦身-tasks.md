# 侧栏面板瘦身 · 任务清单

- [x] 步骤 1 · SettingsDialog 加"桌面通知"小节 → verify: `pnpm -F @aimon/web typecheck` 绿；浏览器 ⚙ 设置出现"桌面通知"小节、状态徽章正确、点"请求授权"触发原生弹窗；LogsView 出现 `scope=settings action=request-notify-permission` 起止配对
- [x] 步骤 2 · 移除 ActivityBar/PrimarySidebar/Workbench/store 的 4 面板消费者引用 + store 运行时兜底 → verify: `pnpm -F @aimon/web typecheck` 绿；侧栏只剩 7 图标；localStorage activity 改成 "perf" 刷新后回落到"文件"不空白
- [x] 步骤 3 · 删 4 个 web view 文件 + api.ts 5 函数 + types.ts 类型（原子） → verify: `pnpm -F @aimon/web typecheck` 绿；`pnpm -F @aimon/web build` 通过
- [x] 步骤 4 · review-runner 摘 jobsService + 补 serverLog；index.ts 删注册；删 6 个 server 文件 → verify: `pnpm -F @aimon/server typecheck` 绿；归档任务后 LogsView 看到 `scope=docs` 归档评审起止；CLI 安装器进度正常
- [x] 步骤 5 · 引用图 grep 扫底 + diff 白名单核对 → verify: 阶段 E 完整 grep 清单业务代码零命中；`git diff --name-only HEAD` 全在 write_files 白名单内
