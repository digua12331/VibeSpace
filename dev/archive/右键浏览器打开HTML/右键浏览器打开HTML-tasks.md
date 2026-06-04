# 右键浏览器打开HTML · 任务清单

- [x] T1 · 后端 `packages/server/src/routes/fs-ops.ts` 新增 `POST /api/projects/:id/fs/open-in-browser` 路由：内部 `openWithDefaultApp(abs)`（Windows `cmd.exe /c start "" <abs>`、macOS `open`、Linux `xdg-open`），fire-and-forget；`safeResolve` + `existsSync` + 后缀白名单 `/\.(html?|xhtml)$/i`；前后各埋 `serverLog('info'/'warn'/'error','fs',...)` → verify: TS 类型通过；curl 合法 .html 返 200；非 html 返 400 `not_a_html_file`；越界路径 400；不存在 404
- [x] T2 · 前端 `packages/web/src/api.ts` 新增 `openInBrowser(projectId, path): Promise<{ok:boolean}>`，放在 `openInVscode` 下方 → verify: TS 类型通过；函数签名与 `openInFolder` 同款
- [x] T3 · 前端 `packages/web/src/components/fileContextMenu.ts` 条件插入「🌐 在浏览器打开」，位置在「打开所在文件夹」后、`execItem` 前；点击走 `logAction('fs','open-in-browser',...)`，失败 `alertDialog` → verify: TS 类型通过；浏览器里右键 .html 能看到该项，右键 .md / 目录看不到
- [x] T4 · `pnpm -C packages/server build && pnpm -C packages/web build`（web 的 build 脚本是 `tsc -b && vite build`，已覆盖类型检查）→ verify: 两包均成功，无 TS 错误
- [ ] T5 · 手动冒烟（浏览器，需大哥）：`pnpm dev` 起服务 → 右键某份 .html 点「🌐 在浏览器打开」→ 系统默认浏览器拉起；LogsView 里 `scope=fs action=open-in-browser` 起止配对（前端）+ 一条后端 `info fs open-in-browser 成功` → verify: 两条观察都达成。**AI 无法替大哥点菜单，待人工验证**
- [ ] T6 · 失败分支冒烟（浏览器，需大哥）：devtools 里 `fetch('/api/projects/<id>/fs/open-in-browser', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({path:'README.md'})}).then(r=>r.json()).then(console.log)` → 后端 400 `not_a_html_file`；LogsView 后端 `warn fs open-in-browser 拒绝` → verify: warn 条目出现。**待人工验证**
