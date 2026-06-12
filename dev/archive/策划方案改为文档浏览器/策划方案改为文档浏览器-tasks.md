# 策划方案改为文档浏览器 · 任务清单

- [x] 1. 新增 `packages/server/src/routes/project-docs.ts` + index.ts 注册 → verify: 文件已创建；index.ts 第 29/167 行已替换；类型检查通过（**路由实测延迟**：dev server uptime ~80min 跑老代码，需重启）
- [x] 2. 删 `routes/output.ts` + `output-service.ts` + index.ts 摘除注册 → verify: 两文件已不存在；grep `registerOutputRoutes|OutputServiceError|listOutput|readChecklist|patchChecklistItem|output-service` 在 packages/server 下 0 命中（仅 tsconfig.tsbuildinfo 编译缓存命中，重建会清）
- [x] 3. types.ts 清 Output*/Checklist* 系列 + 加 ProjectDocFile/ProjectDocsListResult → verify: grep 旧 type 在 packages/web 下 0 命中
- [x] 4. api.ts 清旧函数 + 加 listProjectDocs → verify: grep `listOutput|getChecklist|patchChecklistItem` 0 命中；URL `/api/projects/[^/]+/output` 0 命中
- [x] 5. store.ts 改 outputFeatures→projectDocs / Activity union 'output'→'projectdocs' / EditorTabKind 收窄到 'file' / 删 checklist 字段族 → verify: grep 旧字段 + 字面量 0 命中
- [x] 6. 新增 `sidebar/ProjectDocsView.tsx` + 删 `sidebar/OutputView.tsx` → verify: 文件互换；logAction('project-docs','list') 已埋
- [x] 7. EditorArea.tsx 删 ChecklistEditor lazy + kind='checklist' 分支 + extractFeature 函数 → verify: grep 0 命中
- [x] 8. 删 `editor/ChecklistEditor.tsx` → verify: 文件不存在
- [x] 9. ActivityBar.tsx line 42：id 'output'→'projectdocs' + icon 📐→📄 + label '策划方案'→'文档' → verify: 编辑完成；类型检查通过
- [x] 10. PrimarySidebar.tsx 改 import / STATIC_TITLES / case 分支 → verify: grep `'output'|"output"` 在 layout 下 0 命中（仅 PTY 事件名 `'output'` 命中，与本任务无关）
- [x] 11. 全仓 grep 残留 + 类型检查 → verify: server `tsc --noEmit` EXIT=0；web `tsc --noEmit -b` EXIT=0；残留 0（除 tsconfig.tsbuildinfo 缓存 + `output/示例功能/v0.md` 用户文件）
- [-] 12. 自派 vibespace-browser-tester **blocked** → 原因：用户机器的 dev server（127.0.0.1:8787）uptime ~80min 跑的是会话开始前编译的老代码，缺新增的 project-docs 路由；web (5173) 也未跑。需用户重启 server + 启动 web 后再跑。交付到 handoff 由用户验收
- [x] 13. write_files 越界检查 → verify: `git status --short` 13 项本任务改动全在 plan 清单内；diff 多出的 9 项（app-settings / db / pty-manager / sessions / ws-hub / SettingsDialog / StatusBadge / hibernate-sweeper / 等）为会话开始前已存在的预存改动，本任务未触碰
