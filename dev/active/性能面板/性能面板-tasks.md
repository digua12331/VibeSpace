# 性能面板 · 任务清单

> 仅由 AI 维护。每完成一步立即把 `- [ ]` 改成 `- [x]`。

- [x] 1. 安装依赖：`pnpm add -F @aimon/server pidusage@^3` 完成，server/package.json 已记录 `pidusage: ^3.0.2`
- [x] 2. `pty-manager.ts` 新增 `getPid(sessionId): number | null`
- [x] 3. 新建 `packages/server/src/perf-service.ts`：懒采样 + 1s 缓存 + 按 projectId 聚合
- [x] 4. 新建 `packages/server/src/routes/perf.ts`：`GET /api/projects/:id/metrics`
- [x] 5. `packages/server/src/index.ts` 注册 `registerPerfRoutes`
- [x] 6. `packages/web/src/types.ts` 加 `SessionPerfSample` / `ProjectPerf`
- [x] 7. `packages/web/src/api.ts` 加 `getProjectPerf(projectId)`
- [x] 8. `store.ts` 的 `Activity` 联合类型加 `'perf'`
- [x] 9. `ActivityBar.tsx` items 数组加 📊 项（排在 docs 后、logs 前）
- [x] 10. `PrimarySidebar.tsx` TITLES + switch 分支加 `'perf'`
- [x] 11. 新建 `packages/web/src/components/sidebar/PerfView.tsx`：本地 2s 轮询 + 汇总条 + 每 session 一行（agent icon / 短 id / CPU% / RSS MB + 进度条 + 小字注释"仅主进程"）
- [x] 12. 服务端 `npx tsc --noEmit` 通过
- [x] 13. 前端 `npx tsc --noEmit` 通过
- [x] 14. 前端 `npx vite build` 通过
