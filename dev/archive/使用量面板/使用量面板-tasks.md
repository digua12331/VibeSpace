# 使用量面板 · 任务清单

- [x] 1. 实现 `packages/server/src/usage-service.ts`：解析 `~/.claude/projects/**/*.jsonl`，输出 `{today,last5h,last7days,skipped,asOf}` → verify: 写一段一次性 node 脚本调它，看返回数字看起来合理（today 与最近活跃时段有数据、last7days 长度=7、skipped 不爆炸）
- [x] 2. 实现 `packages/server/src/routes/usage.ts` + 在 `index.ts` 注册，加 `serverLog('info'/'error','usage','read ...')` 起止配对 → verify: server tsc 通过；启动后端后 `curl http://127.0.0.1:8787/api/usage/claude` 返回 200 + 合法 JSON
- [x] 3. 在 `packages/web/src/types.ts` 加 `ClaudeUsage / UsageByModel / UsageDayPoint` 类型 → verify: web tsc 通过
- [x] 4. 在 `packages/web/src/api.ts` 加 `getClaudeUsage()` → verify: web tsc 通过
- [x] 5. 实现 `packages/web/src/components/sidebar/UsageView.tsx`（三块卡片 + 折叠的 Codex/Gemini 占位 + loading/error/ready 三态 + `logAction('usage','read',...)` 包裹拉取） → verify: web tsc 通过
- [ ] 6. 接入 `store.ts`(Activity 加 'usage') + `ActivityBar.tsx`(items 加 📈 使用量) + `PrimarySidebar.tsx`(TITLES + switch 加 case) → verify: 浏览器打开 → 看到 📈 图标 → 点开看到三块卡片 + Codex/Gemini 占位 → LogsView 看到 `scope=usage action=read 开始` 与 `成功 (Nms)` 配对
- [ ] 7. 失败路径人工触发验证：临时让 `/api/usage/claude` 抛错（例如在路由里 `throw new Error('demo')`，验证完立即还原） → verify: 前端 UsageView 显示错误态 + LogsView 出现 `level=error scope=usage` 条目；还原后正常
- [ ] 8. handoff 摘要：列改动文件、跑过的命令、遗留 TODO（如有） → verify: 摘要 ≤ 10 行写在最后回复
