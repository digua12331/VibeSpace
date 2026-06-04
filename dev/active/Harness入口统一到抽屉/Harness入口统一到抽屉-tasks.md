# Harness 入口统一到抽屉 · 任务清单

- [x] 1. 删 `packages/web/src/components/HarnessTeamDrawer.tsx` 整文件 → verify: 文件不存在；`pnpm -F web tsc --noEmit` 仅 ProjectsColumn import 错（预期）
- [x] 2. `ProjectsColumn.tsx` 清理：删 L5 import；删 `harnessTeamProjectId` state 声明 + 所有 setter 调用；删 L319 附近"🤝 团队"`<button>` 块；删 L344–347 IIFE 抽屉渲染整块 → verify: 浏览器右键项目，菜单不见"🤝 团队"项
- [x] 3. `api.ts` 删 `getHarnessStatus`；`types.ts` 删 `HarnessStatus` / `HarnessFileEntry` / `HarnessFileKind`（grep 一次确认无其他引用）；保留 `applyHarness`/`HarnessApplyResult`/`HarnessApplied` → verify: `pnpm -F web tsc --noEmit` 0 错误
- [x] 4. `PermissionsDrawer.tsx` `applyHarnessClick`（L1064 附近）：在 `setHarnessEnabled(true)` 之后追加 alertDialog（文案抄 HarnessTeamDrawer 原 L73–79："复制 N / 跳过 N / .gitignore 是否追加"，title `'一键安装结果'`） → verify: 浏览器抽屉点 Harness "应用"，成功后弹"一键安装结果"详情，文案完整
- [x] 5. `dev/issues.md` 追加一行：`- [ ] 清理后端死路由 GET /api/projects/:id/harness-status + service 函数 getHarnessStatus（文件 packages/server/src/routes/projects.ts、harness-template-service.ts；上下文：前端 HarnessTeamDrawer 已删除，该路由无消费方）` → verify: tail 一行确认存在
- [x] 6. 全量类型检查：`pnpm -F web tsc --noEmit` → verify: 0 错误
- [ ] 7. 浏览器跑 plan 验收 1–6：① 右键无"🤝 团队" ② HarnessTeamDrawer 不可达 ③ Harness 应用后弹 alertDialog 详情 ④ Harness 卸载流程不退化 ⑤ Dev Docs 流程不退化 ⑥ tsc 双绿（已在步骤 6 自动验） → verify: 5 项浏览器实操通过 — 等大哥浏览器验收
