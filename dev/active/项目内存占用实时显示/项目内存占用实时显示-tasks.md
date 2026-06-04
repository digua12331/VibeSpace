# 项目内存占用实时显示 · 任务清单

- [ ] 步骤 1：新增 `packages/server/src/process-mem-service.ts` —— 10s ticker + CIM 查询 + 进程树 BFS + 按项目聚合 + broadcast；含 8s 超时与起停日志 → verify: 文件存在，server tsc 通过
- [ ] 步骤 2：`packages/server/src/index.ts` 启动调 `startProcessMemTicker`、退出钩子调 `stopProcessMemTicker` → verify: 启动后 LogsView 看到一条 `scope=mem-stats msg=ticker-start`
- [ ] 步骤 3：`packages/web/src/types.ts` 加 `mem-stats` 联合分支 → verify: web tsc 通过
- [ ] 步骤 4：`packages/web/src/store.ts` 加 `memByProject` 字段 + setter → verify: store 类型正确
- [ ] 步骤 5：`packages/web/src/main.tsx` switch 接 `mem-stats` → 调 setter → verify: 收到消息能进 store
- [ ] 步骤 6：`packages/web/src/components/layout/ProjectsColumn.tsx` 渲染内存数字 → verify: 有 AI 会话的项目行末尾显示 `850 MB` 或 `1.2 GB`，无会话不显示
- [ ] 步骤 7：server `tsc --noEmit` + web `tsc -b` 双双通过 → verify: 退出码 0
- [ ] 步骤 8：浏览器自查（如能起则验收）：项目行显示数字、起停会话 10 秒内变化、日志面板见 ticker 起停 → verify: 截图或自述
