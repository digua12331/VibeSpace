# 工作流母版统一更新 · 任务清单

- [x] 1. 母版盖版本戳：`dev-docs-guidelines.ts` 锚点行下嵌 `<!-- dev-docs-workflow:v1 -->`，导出 `DEV_DOCS_VERSION = 1` → verify: grep 母版含该戳；`pnpm -F @aimon/server build` 过 ✓
- [x] 2. 状态读版本 + 暴露 outdated：`getDevDocsStatus` 解析已装版本，`WorkflowStatus.devDocs` 加 `installedVersion`/`currentVersion`/`outdated`（server interface + web types.ts 两处同步）→ verify: server build + web build 过；断言脚本里无戳 CLAUDE.md outdated=true ✓
- [x] 3. 就地块替换函数 `updateDevDocsGuidelines`：锚点→下一 `\n\n---\n\n#` 之间替换为最新母版，保住后续段，不切 EOF → verify: 断言脚本对 [自有内容]+[旧版段含内部---]+[Superpowers段] 更新后两段逐字保留、Dev Docs 段已换新；文件尾场景也过 ✓
- [x] 4. 后端能力 + 路由：聚合 `updateProjectDevDocs`/`refreshAllOutdatedDevDocs`；`projects.ts` 加 `/api/projects/:id/workflow/update`（serverLog 配对）；新建 `routes/workflow.ts` 暴露 `/api/workflow/refresh-all` 并在 index.ts 注册（serverLog 配对，含 catch→error 分支）→ verify: server build 过 ✓；【待大哥手动验收】浏览器点更新后 LogsView 看 `scope=project action=update-workflow` 与 `scope=workflow action=refresh-all` 起止配对
- [x] 5. 前端按钮 + 状态 + api：`api.ts` 加 `updateProjectWorkflow`/`refreshAllWorkflows`；`PermissionsDrawer.tsx` workflow tab 显示"工作流可更新"徽章 + "更新到最新版"按钮 + "刷新所有项目"卡片（均 logAction 包）→ verify: `pnpm -F @aimon/web build` 过 ✓；【待大哥手动验收】浏览器旧项目显示可更新→点更新→变已最新
- [x] 6. 收尾核对白名单：`git diff --name-only HEAD` 与 write_files 比对——本任务 8 文件全在白名单内，无越界；server + web build 均过 ✓
