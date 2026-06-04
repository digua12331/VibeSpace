# harness-一键装配与团队面板 · 任务清单

## Phase A · 后端能力

- [x] A-1. 新建 `packages/server/src/harness-template-service.ts`：`HarnessFileSpec` 类型 + `getTemplateFiles()` + `getHarnessStatus(projectPath)` + `applyHarnessTemplate(projectPath)` → verify: server tsc 通过；自测脚本调三个函数均返回合理结果
- [x] A-2. `routes/projects.ts`：`CreateProjectSchema` 加 `applyHarnessGuidelines`；createProject 成功后若 true 则调 applyHarnessTemplate（best-effort）；新增 `POST /api/projects/:id/apply-harness` + `GET /api/projects/:id/harness-status`；操作日志起止配对 → verify: curl 三种路径全过；ERROR 路径手动触发一次（目标只读目录）
- [x] A-3. `templates/harness/install.sh` 顶部加注释提醒"加新模板文件时记得改 packages/server/src/harness-template-service.ts" → verify: 肉眼读

## Phase B · 前端 UI

- [x] B-1. 前端 `types.ts`（`HarnessFileEntry` / `HarnessStatus`）+ `api.ts`（`createProject` 入参加 applyHarnessGuidelines / `getHarnessStatus` / `applyHarness`）→ verify: web tsc 通过
- [x] B-2. `NewProjectDialog.tsx`：第 2 个复选框 "🤝 应用 Harness 团队配置"（默认 false）；submit 时透传 applyHarnessGuidelines；logAction meta 加该字段 → verify: A-V1 / A-V2 / A-V4 浏览器
- [x] B-3. 新建 `components/HarnessTeamDrawer.tsx`：仿 PermissionsDrawer 居中 modal；status fetch / 三段渲染（总览 / 文件清单表 / 操作区）/ 一键安装按钮（logAction 包） → verify: B-V2 / B-V3 / B-V5 浏览器；ERROR 触发
- [x] B-4. `ProjectsColumn.tsx` 右键菜单在权限后插入「🤝 团队」项；本地 state `harnessTeamProjectId` + render `<HarnessTeamDrawer />` → verify: B-V1 浏览器；B-V4 改名后 status 反映

## Phase C · 收尾

- [x] C-1. `dev/issues.md` 加 README Karpathy 描述过时一行；`README.md` 末尾"Reusing the harness config..."段加 UI 入口提示；`dev/learnings.md` 视情况追加 → verify: 肉眼读
- [x] C-2. 全量验收：浏览器 A-V1..V4 + B-V1..V5 + ERROR 日志；命令行 server tsc + web tsc + smoke:worktree 全过 → verify: 手动+命令行全过
