# 图片与 Excel 页签预览 · 任务清单

- [x] 后端：新增 `packages/server/src/routes/raw-file.ts`，注册 `GET /api/projects/:id/raw?path=...`（仅 WORKTREE / 50 MB 上限 / safeResolve / 扩展名→MIME / `Cache-Control: no-cache` / `reply.send(createReadStream)`），并在 `packages/server/src/index.ts` 挂上 → verify: server build 通过；活体 curl 等 Step 7 重启后一起验证（当前 stable 进程没载新路由）。
- [x] 前端：在 `packages/web/src/api.ts` 加 `projectRawUrl(projectId, path)`，用 `BASE` 拼绝对 URL → verify: web build 通过。
- [x] 前端：`pnpm --filter @aimon/web add xlsx` 安装依赖 → verify: `web/package.json` 出现 `xlsx@0.18.5`，build 后看到独立 chunk `xlsx-*.js 424.76 kB`。
- [x] 前端：新增 `packages/web/src/components/ImagePreview.tsx`，位图 `<img>` + SVG `<iframe sandbox="">`，挂载/`onLoad`/`onError` 三次 `pushLog` → verify: web build 通过；活体在浏览器手测留到 Step 7。
- [x] 前端：新增 `packages/web/src/components/ExcelPreview.tsx`，`logAction('file', 'preview-xlsx', ...)` 包 fetch + 动态 import + `XLSX.read`；sheet 切换 + 1000×50 截断 + 413/404/parse 错误占位 → verify: web build 通过；xlsx 独立 chunk 已落地（动态 import 成立）；活体测试留到 Step 7。
- [x] 前端：修改 `FilePreview.tsx` —— 加 `isImagePath` / `isExcelPath`；`canImage / canExcel` 仅在 `!ref || ref === 'WORKTREE'` 时为 true；`canPreview` 纳入它俩；body 里两个分支提前 return 到 `<ImagePreview>` / `<ExcelPreview>`；effect 在图片/Excel 的 preview tab 上跳过 `/file` fetch → verify: web build 通过；活体测试留到 Step 7。
- [ ] 收尾活体冒烟（需用户重启 backend 让 raw 路由生效）：浏览器点开一张 png（≤50MB，比如 `.vibespace/pasted-images/` 里的）→ Preview 默认激活并显图；点开一份多 sheet 的 xlsx → 表格 + 多 sheet 可切换；改后缀的伪 xlsx → 看到 ERROR 行；切到历史 commit 上的同一张 png → Preview tab 不出现，回退 Source/Diff；LogsView 看到 `scope=file action=preview-image` 与 `preview-xlsx` 的起止配对各至少一次 + 一行 ERROR。两端 build 已经各自通过（exit 0）。
