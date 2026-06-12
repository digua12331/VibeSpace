# 悬浮输入斜杠动态扩展 · 任务清单

- [x] 步骤 1：新增 `packages/server/src/dynamic-slash-service.ts`，导出 `scanDynamicSlashCommands` → verify: 文件存在；类型检查通过
- [x] 步骤 2：新增 `packages/server/src/routes/slash-commands.ts`，注册到 `index.ts` → verify: server tsc 通过；浏览器手敲 `GET /api/projects/<id>/slash-commands/claude` 返回 `{commands:[...]}`
- [x] 步骤 3：前端 `packages/web/src/api.ts` 加 `listSlashCommands` → verify: web tsc 通过
- [x] 步骤 4：前端 `SessionView.tsx` 加 dynamicSlash state + useEffect + getEffectiveSlashCommands，替换两处 `getSlashCommands` 调用 → verify: web tsc 通过
- [ ] 步骤 5：浏览器实测——Claude session 输入 `/` 看到 skill；Gemini session 输入 `/` 看到 commands；shell 不出菜单（**待主理人手动验收**） → verify: 主理人在浏览器 DevTools Network 里能看到 `/api/projects/.../slash-commands/...` 的 GET，菜单展开能看到本机存在的 skill / commands 名
- [x] 步骤 6：双端 typecheck → verify: `pnpm --filter @aimon/web exec tsc -b` 与 `pnpm --filter @aimon/server exec tsc -b` 都退出 0（已跑，EXIT=0）
- [x] 步骤 7：handoff 摘要 → verify: 末轮回复给大哥摘要，第一行写"现在去哪里点哪里能看到效果"
