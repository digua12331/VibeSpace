# 项目一键启动脚本 · 任务清单

- [x] 步骤 1 后端 db.ts：Project 加 startScript 字段 + loadProjectsJson 透传 + updateProjectStartScript → verify: 改完 `pnpm -F @aimon/server build`（或 tsc）通过；手动给 projects.json 某项目加 "startScript":"start.bat"，GET /api/projects 能读回该字段
- [x] 步骤 2 后端 projects.ts：加 GET/PUT /api/projects/:id/start-script（含 zod 校验、扫候选、相对/绝对归一、serverLog 起止配对）→ verify: 后端构建通过；curl GET 返回 {resolved,candidates} 结构；PUT 合法 body 成功、非法 body（如 script:123 或 .txt）返回 400 且 LogsView 见 ERROR
- [x] 步骤 3 前端 types.ts + api.ts：Project 加 startScript；加 getStartScript/setStartScript → verify: `pnpm -F @aimon/web build` 通过
- [x] 步骤 4 前端 StartScriptDialog.tsx 新建：候选列表 + 手敲路径 + 保存并运行 + 清空，弹窗样式照 NewProjectDialog，候选区固定高内部滚动 → verify: web build 通过
- [x] 步骤 5 前端 ProjectsColumn.tsx：项目行加常驻 ▶ 按钮走 onLaunch；右键菜单加「设置启动脚本…」；挂 StartScriptDialog → verify: web build 通过；git diff --name-only HEAD 仅含本任务 write_files
- [ ] 步骤 6 端到端人工验收（待大哥在浏览器里验，AI 已做后端 curl 全分支 + 两端构建）→ verify: 浏览器①有 start.bat 项目点 ▶ 新终端自动执行 bat；②无 start.bat 项目点 ▶ 弹窗列候选、选一个能跑且被记住、再点 ▶ 不弹窗；③右键设置/清空生效；LogsView 见 project/set-start-script 与 fs/run-bat 起止配对，故意非法 PUT 见 ERROR
