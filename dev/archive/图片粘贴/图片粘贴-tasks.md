# 图片粘贴 · 任务清单

> 仅由 AI 维护。每完成一步立即把 `- [ ]` 改成 `- [x]`，再做下一步。

## 服务端

- [x] 1. `pnpm add -F @aimon/server @fastify/multipart` → verify: `@fastify/multipart: ^10.0.0` 入 server/package.json（Fastify 5 对应 v10，与原计划 ^9 比稍新，兼容）
- [x] 2. 从 `server/src/routes/fs-ops.ts` 导出 `appendGitignoreEntry` → verify: 成功改成 `export async function`
- [x] 3. 新建 `server/src/routes/paste-image.ts`：`POST /api/projects/:id/paste-image`；MIME 白名单（png/jpeg/gif/webp）+ 5MB 上限；写到 `<project>/.vibespace/pasted-images/<ISO毫秒>-<6位随机>.<ext>`；写完后 `appendGitignoreEntry(projectPath, '.vibespace/')` → verify: `tsc --noEmit` 通过
- [x] 4. `server/src/index.ts` 注册 multipart plugin（`limits: { fileSize: 5*1024*1024, files: 1 }`）+ `registerPasteImageRoutes` → verify: `tsc --noEmit` 通过

## 前端

- [x] 5. `web/src/components/fileContextMenu.ts` 把 `formatForSession` 改为 `export`
- [x] 6. `web/src/api.ts` 加 `uploadPastedImage(projectId, sessionId, blob, mime)`，走 FormData + fetch，返回 `PastedImageResult` → verify: `tsc --noEmit` 通过
- [x] 7. 改 `SessionView.tsx` 的 Ctrl+V 拦截器：先 `clipboard.read()` 找 `image/*`，命中则前端校验 size → 上传 → `sendInput(formatForSession(...))`；未命中回退到 `readText → term.paste`；失败走 `alertDialog(danger)` → verify: `tsc --noEmit` 通过

## 校验

- [x] 8. 服务端 `npx tsc --noEmit` 通过
- [x] 9. 前端 `npx tsc --noEmit` 通过
- [x] 10. 前端 `npx vite build` 通过
