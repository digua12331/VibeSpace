# 工作流改独立文件引用 · 任务清单

- [ ] 1. 装配改写：workflow-service 加文件/引用常量 + `writeDevDocsFile` + `ensureImportBlock`，`appendDevDocsGuidelines` 改为"写独立文件 + 确保引用块"（去内联、去 ISSUES retrofit）→ verify: 干净临时项目装配后，`.aimon/workflow/dev-docs.md` 存在含戳、CLAUDE.md 含引用行无 361 行内联；`pnpm -F @aimon/server build` 过
- [ ] 2. 三态状态：`getDevDocsStatus` 返回 `form: none|inline-legacy|file` + 版本字段（file 形态读独立文件戳）；`WorkflowStatus.devDocs` 接口 + `types.ts` 镜像加 `form` → verify: 构造三种形态临时项目，status.form 各自正确；server+web build 过
- [ ] 3. 迁移/更新核心：`findInlineBlockRange` + `migrateOrUpdateDevDocs`（legacy→替换成引用块+写文件；file→覆盖文件+自愈引用），`updateProjectDevDocs` 改调它；删上轮 `updateDevDocsGuidelines` 内块替换 → verify: 断言脚本——三段式([内容]+[老内联]+[Superpowers])迁移后相邻段逐字保留、Dev Docs 变引用行、独立文件存在含戳；file 形态更新覆盖文件、引用行+内容不变
- [ ] 4. 卸载兼容两形态 + refresh-all 分派：`removeDevDocsGuidelines` 删引用块或内联块 + 删独立文件；`refreshAllOutdatedDevDocs` 按 form 迁移/更新/跳过 → verify: 断言脚本——file 形态卸载后引用行与独立文件均没、相邻段保留；legacy 形态卸载后内联块没；server build 过
- [ ] 5. 路由 + 前端三态 UI：`projects.ts` update 路由 meta 带 action；`api.ts` DevDocsUpdateResult 加 form/action；`PermissionsDrawer.tsx` 按 form 显示"待迁移/可更新/已是独立文件形态" + 对应按钮，刷新卡片文案改"迁移/更新所有项目"→ verify: `pnpm -F @aimon/web build` 过；【待大哥手动验收】浏览器三态显示、点迁移/更新状态翻转、LogsView 起止配对
- [ ] 6. 金丝雀：只对 VibeSpace 自身跑一次迁移（保留项目专属补充段），核对 CLAUDE.md 变薄+引用行在+独立文件落地 → verify: 人工开真会话问"工作流第一步是什么/破坏性变更协议是什么"，AI 答得出 = 引用生效；【交给大哥决定是否全量】
- [ ] 7. 收尾核对白名单 + 双端 build → verify: `git diff --name-only HEAD` 无越界；server + web build 均过
