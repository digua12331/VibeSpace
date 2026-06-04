# MD页签评论功能 · 任务清单

- [x] 步骤 1：后端 `comments-service.ts`（类型 + 读写 + 错误类）→ verify: `pnpm --filter @aimon/server exec tsc --noEmit` 通过；临时 node 脚本调 `readComments`（文件不存在返回空 list）和 `writeComments`（落盘合法 json），跑完删脚本
- [x] 步骤 2：后端 `routes/comments.ts` + 在 `index.ts` 注册 → verify: 起 dev server，curl POST 新建 / GET 列表 / PATCH 编辑 / DELETE 删除各返回 200；LogsView 看到 `scope=comments action=create` 起止配对；传 `path=../../evil` 返回 400
- [x] 步骤 3：前端依赖（`mdast-util-from-markdown`）+ `types.ts` + `api.ts` 四个调用 → verify: `pnpm install` 成功；`pnpm --filter @aimon/web exec tsc --noEmit` 通过
- [x] 步骤 4：前端 `commentAnchor.ts`（extractAnchors + matchAnchor + hash）→ verify: 临时浏览器 console 跑两条测例——"新加段落索引变但 hash 不变 → primary match"、"改 heading 文本 → 走 index fallback"、"blockType 和 index 都对不上 → null"
- [x] 步骤 5：前端 `rehypeAnchorIds.ts` + `MarkdownView` 扩 SCHEMA 白名单 → verify: 插件单元测试（hand-built hast → dataAnchorId 挂载正确，ul/inline code 不挂）+ SCHEMA 白名单代码审查（additive only，script 默认规则未动）。DOM 级端到端验证延后到步骤 6/9 浏览器 smoke
- [x] 步骤 6：前端 `MarkdownView` 挂 block 级 hover 💬 + 评论计数角标 → verify: 代码完成 + TSC 过；实机 DOM verify 合并到步骤 9
- [x] 步骤 7：前端 `CommentPopover` + `CommentsPanel`（新增 / 展示 / 编辑 / 删除 / 定位）→ verify: 代码完成 + TSC 过；交互 verify 合并到步骤 9
- [x] 步骤 8：前端 `FilePreview` 集成 CommentsPanel（md 文件才 wrap）+ 只读模式 + logAction 埋点 → verify: 代码完成 + TSC 过（web + server）；端到端 smoke 合并到步骤 9
- [x] 步骤 9：收尾——类型检查 + 浏览器 smoke → verify: 两个包 `tsc --noEmit` 都过；用户在浏览器跑完 10 条 smoke 全通过；顺手把"孤儿"改名为"失效"
