# 技能管理面板 · 任务清单

- [x] 步骤 1：写 `packages/server/src/skill-catalog-service.ts`（路径表常量 + scan/parse/add/remove 五个纯函数 + 安全校验） → verify: `pnpm -C packages/server typecheck` 通过
- [x] 步骤 2：写 `packages/server/src/routes/skill-catalog.ts`（三个端点 + zod + serverLog 起止配对 + ERROR 分支） → verify: `pnpm -C packages/server typecheck` 通过
- [x] 步骤 3：在 `packages/server/src/index.ts` 注册新路由 → verify: server 重启不报错
- [x] 步骤 4：在 `packages/web/src/types.ts` 加新类型 + `api.ts` 加客户端函数 → verify: `pnpm -C packages/web typecheck` 通过
- [x] 步骤 5：写 `packages/web/src/components/sidebar/SkillsView.tsx`（agent tab + 双栏 + 操作按钮 + promptDialog + logAction 包装） → verify: web typecheck 通过
- [x] 步骤 6：在 `store.ts` 扩 Activity union、`ActivityBar.tsx` 加 🧩 入口、`PrimarySidebar.tsx` 加 case → verify: web typecheck 通过
- [x] 步骤 7：双语 README 同步（Highlights + Architecture + `.aimon/skills` vs CLI skills 区分） → verify: 两份 README 都含区分说明
- [ ] 步骤 8：浏览器手工实操验收（待主理人触发） → verify: 大哥按 context 验收回放路径走一遍 + LogsView 起止配对 + 落盘日志 grep 能搜到
