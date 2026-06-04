# 操作日志规则与全量埋点 · 任务清单

- [x] 1. CLAUDE.md 追加「操作日志规则」节（适用范围 / 起止配对 / 必填字段 / 豁免清单 / 验收方式） → verify: `grep -n "操作日志" CLAUDE.md` 命中 ≥1；人读一遍语义清晰、豁免清单完整。
- [x] 2. 扩展 WS 消息类型（前端 `types.ts` 的 `ClientMsg` 加 `log-from-client`、`ServerMsg` 加 `log`；后端 `ws-hub.ts` 顶部注释同步） → verify: `pnpm -F web tsc --noEmit` 与 `pnpm -F server tsc --noEmit` 双绿。
- [x] 3. 新建 `packages/server/src/log-bus.ts`（`serverLog` / `persistClientLog` / `handleClientLogRoundtrip` / `appendJsonl` / `getLogFilePath` UTC 切日） → verify: 文件存在；`pnpm -F server tsc --noEmit` 绿；`getLogFilePath()` 单测（临时 ad-hoc）返回 `.../data/logs/YYYY-MM-DD.log`。
- [x] 4. `ws-hub.ts` 导出 `broadcast(msg)` 无过滤广播方法 + 收消息 switch 加 `case 'log-from-client'` 路由到 `persistClientLog` / `handleClientLogRoundtrip` → verify: `pnpm -F server tsc --noEmit` 绿；后端启动不报错。
- [x] 5. 前端 `ws.ts` 加 `sendClientLog(entry)` 方法（`rawSend` 在 `readyState !== OPEN` 时 return false、静默丢弃）。`case 'log'` 分发挪到步骤 6（需要 pushLog 的 `_fromServer` 私参一起改） → verify: `pnpm -F web tsc --noEmit` 绿。
- [x] 6. 前端 `logs.ts` 扩展：`pushLog` 加 `_fromServer?` 私参 + 默认通过 `sendClientLog` 回传；新增 `logAction<T>(scope, action, fn, ctx?)` 起止配对 + 耗时；新增 `testBackendLog()` 发带 `roundtrip:true` 的 client log → verify: `pnpm -F web tsc --noEmit` 绿；浏览器 Console `await window.__vibe.logAction('test','demo',async()=>{await new Promise(r=>setTimeout(r,200))})` 看到两条 + 耗时 ≈200ms。
- [x] 7. 前端 `main.tsx` 在 `import.meta.env.DEV` 时挂 `window.__vibe = { pushLog, logAction, testBackendLog, clearLogs }` → verify: tsc 绿；dev/prod 浏览器验证挪到步骤 12 全链路冒烟。
- [x] 8. 示范埋点① `NewProjectDialog.tsx:30` `api.createProject(...)` 外包 `logAction('project','create', fn, { meta: { name } })` → verify: 浏览器点「新建项目」确认，LogsView 出现 `project create 开始` + `project create 成功 (XXXms)` 两条；失败时出现 ERROR 条。
- [x] 9. 示范埋点② `StartSessionMenu.tsx` 现有 4 处 `pushLog` 整合为一次 `logAction('session','start', fn, ctx)` 包装（保留原有 toast） → verify: 点启动 CLI，LogsView 见起止配对；故意选个不存在的 CLI 时见 ERROR 配对。
- [x] 10. 示范埋点③ `DocsView.tsx:237` 归档按钮外包 `logAction('docs','archive', fn, { meta: { task } })` + 后端 `routes/docs.ts:114-130` 归档路由前后加 `serverLog('info'/'error', 'docs', ...)` → verify: 归档一个任务，LogsView 见前端起止 + 后端 `归档评审 enqueue: <任务名>` 三条。
- [x] 11. 后端 `index.ts:155` 启动日志 `console.log("VibeSpace backend ... listening")` 改为 `serverLog('info','server','backend listening', { url, port, version })`；db/projects.json 两行保留 `console.log` → verify: 启动后端 + 刷新前端，LogsView 首次连接后出现该条 INFO。
- [x] 12. 全链路冒烟：`pnpm -F web tsc --noEmit && pnpm -F server tsc --noEmit` 双绿；启动前后端，依次执行 plan 验收 1–7 全部通过 → verify: 7 条验收逐条打勾；`packages/server/data/logs/<today>.log` 存在、`wc -l` ≥ 6、`tail -1` 合法 JSON。
- [x] 13. `dev/issues.md` 追加待补清单（删项目 / 重命名项目 / 停止会话 / 切换 CLI / Dev Docs 派单 / fs 写文件 / paste-image / hook 安装 / 考虑日志保留策略） → verify: `grep -c "操作日志" dev/issues.md` ≥ 8；每条单行。
- [x] 14. 输出 handoff 摘要（≤10 行：改动文件、验证命令、遗留 TODO） → verify: 最后一轮回复末尾有该段；语义清晰到能直接当 commit message。
