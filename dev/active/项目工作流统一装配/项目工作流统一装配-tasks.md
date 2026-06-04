# 项目工作流统一装配 · 任务清单

- [x] 1. 物理搬迁两份 docs：`mkdir -p .aimon/docs` + `git mv docs/agent-harness-overview.md .aimon/docs/` + `git mv docs/team-agent-harness-dev-docs-workflow.md .aimon/docs/`；同步两份 docs 内文里互相引用的相对路径（如 `docs/team-...md` → 同目录文件名） → verify: `ls .aimon/docs/` 列出两份；`ls docs/` 不再有这两份；docs 内文 grep 不到旧路径
- [x] 2. `.gitignore`：删 line 23-24 两条 `!docs/agent-harness-overview.md` / `!docs/team-agent-harness-dev-docs-workflow.md` → verify: `git status` 确认两份 docs 在新位置 tracked
- [x] 3. CLAUDE.md 真源表更新：把末尾两条 `docs/` 引用改 `.aimon/docs/`；全文 grep `docs/team-agent-harness-dev-docs-workflow.md` 与 `docs/agent-harness-overview.md` 确认无遗漏 → verify: `grep` 命中点为 0（除引用本任务文档自身的 plan/context）
- [x] 4. `harness-template-service.ts`：`getTemplateFiles()` 加 `.aimon/docs/*.md` 动态发现段（仿 skills/agents 写法）；`uninstallHarnessTemplate` 末尾 `rmdir` 列表加 `.aimon/docs`（叶子→根顺序：`.aimon/docs` → `.aimon/skills` → `.claude/agents` → `.aimon`）；顶部注释同步 → verify: `pnpm --filter @aimon/server exec tsc -b` 0 错误
- [x] 5. 新建 `packages/server/src/workflow-service.ts`：3 个 export `applyWorkflowToProject` / `removeWorkflowToProject` / `getWorkflowStatus`；内部按 context 决策 1/3/5 顺序 + 失败 abort + 不回滚 → verify: `pnpm --filter @aimon/server exec tsc -b` 0 错误
- [x] 6. `routes/projects.ts`：删 7 个旧端点（`apply-dev-docs` POST / `dev-docs` DELETE / `dev-docs-status` GET / `harness` POST / `harness` DELETE / `harness-status` GET / `harness-applied` GET）；新增 3 个统一端点（`workflow` POST / `workflow` DELETE / `workflow-status` GET），用 `serverLog('project', 'apply-workflow' | 'remove-workflow' | 'workflow-status', ...)` 起止；调整 import → verify: `pnpm --filter @aimon/server exec tsc -b` 0 错误 + 起 dev server 后 `curl` 三个新端点返回正常
- [x] 7. 前端 `api.ts` + `types.ts`：删旧的 5 个函数与对应类型；新增 `applyWorkflow` / `removeWorkflow` / `getWorkflowStatus` 与 `WorkflowApplyResult` / `WorkflowUninstallResult` / `WorkflowStatus` → verify: `pnpm --filter @aimon/web exec tsc -b` 0 错误
- [x] 8. 前端 `PermissionsDrawer.tsx` UI 两块合一（含部分已应用三态展示）+ DocsView ⚙ 按钮删除（执行阶段补 context）：删 `enabled / harnessEnabled` 等两套 state，改为 `workflowState / workflowBusy / workflowLoadError`；删 3 个旧 handler，新增 `applyWorkflowClick` / `removeWorkflowClick`（前端 `logAction('project', 'apply-workflow' | 'remove-workflow', fn)` 包装；卸载 confirmDialog 二次确认保留）；JSX 两块合一 → verify: `pnpm --filter @aimon/web exec tsc -b` 0 错误
- [x] 9. 全量类型检查（前后端两端都 0 错误） → verify: `pnpm --filter @aimon/server exec tsc -b` 与 `pnpm --filter @aimon/web exec tsc -b` 都 0 错误
- [ ] 10. 浏览器实操验收 → verify:
      ① 权限抽屉「工作流」tab 只剩一个块"项目工作流"（不是两个）；
      ② 干净目标项目点"应用" → `.aimon/docs/` 两份在 + CLAUDE.md 工作流段在 + LogsView 见 `scope=project action=apply-workflow` 起止配对（前端 + 后端两套都有）；
      ③ 同项目点"卸载"（confirmDialog 二次确认） → 文件清理 + CLAUDE.md 段移除 + 状态翻"未应用" + LogsView 见 `remove-workflow` 起止；
      ④ 失败分支：手动锁住一份目标 docs 文件，点"应用"得到 `partial: true` 弹窗 + LogsView 见 ERROR；
      ⑤ "部分已应用"显示：手工把目标项目的 `.aimon/skills/` 删一半再开抽屉，状态显示"部分已应用"，按钮文字"应用剩余"——等大哥浏览器验收（agent 跑不了浏览器交互 + ④⑤ 需要手动触发）
