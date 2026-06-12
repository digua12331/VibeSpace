# HTML页签就地编辑 · 任务清单

- [x] T1 后端：fs-ops.ts 新增 `PUT /api/projects/:id/fs/write-file`（守卫 safeResolve+toRepoRelative+拒绝 hub+要求文件已存在；serverLog 起止；bustStatusCache）→ verify: 后端类型检查/构建通过；curl 改真实文件一个字落盘成功；越界路径 `../` 被拒；不存在路径 404；日志文件见 `scope=fs` 起止配对
- [x] T2 前端 api：api.ts 加 `writeProjectFile(projectId, path, content)` → verify: `pnpm -F @aimon/web build` 类型通过；签名与后端 body `{path,content}` 对齐
- [x] T3 注入脚本：htmlPreviewPicker.ts 加编辑模式（enter-edit/exit-edit/request-save 消息；编辑态 contentEditable + 门控 picker preventDefault；保存前清理注入脚本/contenteditable/outline 再序列化回传 `__aiSave__`）→ verify: 浏览器进编辑能定位光标打字；回传 HTML 不含注入脚本与 contenteditable 残留
- [x] T4 HtmlPreview.tsx：加 `editable` prop + 「预览/编辑」切换 + 「保存」按钮 + dirty 局部状态 + logAction 包保存 + 含脚本页面警告条 → verify: build 通过；浏览器走通 编辑→改字→保存→重开仍在；LogsView 见 `scope=html-preview action=save-file` 起止配对；故意断后端触发一次 ERROR
- [x] T5 FilePreview.tsx：给 `<HtmlPreview>` 传 `editable={isWorktree && !file.truncated}` → verify: build 通过；打开历史版本/截断文件时「编辑」按钮消失
- [x] T6 收尾：`pnpm -F @aimon/web build` 通过；`git diff --name-only HEAD` 比对仅白名单文件；失败分支 ERROR 已人工触发确认 → verify: 上述全绿，diff 无越界文件
