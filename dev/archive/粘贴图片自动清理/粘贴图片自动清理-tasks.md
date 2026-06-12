# 粘贴图片自动清理 · 任务清单

- [x] 步骤 1：后端配置存储 `app-settings.ts` + `data/app-settings.json` atomic 写入 → verify: 临时 8987 server `curl /api/app-settings` 返回 `{"pasteImageRetentionDays":1}` 默认值 ✅
- [x] 步骤 2：后端清理函数 `paste-image-cleaner.ts::pruneOldPastedImages()` → verify: 启动一次清理 LogsView 起止配对，meta `{deleted:124, scannedProjects:3, skippedProjects:1, errors:0, retentionDays:1}` ✅
- [x] 步骤 3：`index.ts main()` 末尾接入 fire-and-forget 清理调用 → verify: 临时 server 启动几秒内 console 出现 `[VibeSpace:cleanup] paste-images-prune 开始/成功 (70ms)` ✅
- [x] 步骤 4：后端 REST 路由 `routes/app-settings.ts` GET/PUT + 注册到 `index.ts` → verify: curl GET/PUT 来回（1→3→0→1），非法 999 返回 zod 400 detail ✅
- [x] 步骤 5：前端 types + api client → verify: `pnpm --filter @aimon/web build` 通过 ✅
- [x] 步骤 6：前端 `SettingsDialog.tsx` 独立 modal 组件 + 命令式 API `openSettings()` → verify: `pnpm --filter @aimon/web build` 通过；HMR 进 vite dev ✅
- [x] 步骤 7：`Workbench.tsx` footer 加 ⚙ 设置按钮 → verify: build 过，组件已挂载到 Workbench 顶层 ✅
- [x] 步骤 8：构建 + 浏览器验收 + diff 白名单 → verify: server build + web build 都过 ✅；vibespace-browser-tester **SKIP**（browser-use MCP 工具未注入到本 session，跑不了）⚠️；git diff 比对白名单全过（4 改 + 4 新 + 1 tsbuildinfo 副产物）✅
