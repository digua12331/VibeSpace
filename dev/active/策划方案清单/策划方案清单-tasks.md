# 策划方案清单 · 任务清单

- [x] 步骤 1：后端 `output-service.ts` —— 列表 / 读 checklist / 原子写回，含 `safeFeatureName` + 路径防护 + `OutputServiceError` → verify: `pnpm --filter @aimon/server build` 通过
- [x] 步骤 2：后端 `routes/output.ts` + `index.ts` 注册三个 endpoint → verify: `pnpm --filter @aimon/server build` 通过；curl endpoint 留给 E2E（步骤 11）同时验证，避免重启用户正在用的 backend
- [x] 步骤 3：前端 `types.ts` 新增 Checklist / OutputFeature / OutputListResult 等类型 → verify: `pnpm --filter @aimon/web build` 通过
- [x] 步骤 4：前端 `api.ts` 三个调用函数 → verify: `pnpm --filter @aimon/web build` 通过
- [x] 步骤 5：前端 `store.ts` Activity 加 'output'、EditorTab 加 kind、三块 output/checklist state + actions → verify: `pnpm --filter @aimon/web build` 通过；浏览器 console `useStore.getState()` 能看到 outputFeatures / checklists 字段
- [x] 步骤 6：ActivityBar 加 📐 图标 + PrimarySidebar 加 case → verify: 浏览器点新图标，侧栏顶部出现 "策划方案" 标题（与步骤 7 合并 E2E）
- [x] 步骤 7：`OutputView.tsx` 列功能目录 + 可展开文件列表 + 文件分发（checklist.json 走新 Tab，其它走 openFile） → verify: web build 通过，浏览器验收合并到步骤 11 E2E
- [x] 步骤 8：`ChecklistEditor.tsx` 按 sections / items 渲染 decision + risk 卡片，底部状态工具条 → verify: web build 通过；浏览器验收并入步骤 11 E2E
- [x] 步骤 9：`EditorArea.tsx` 按 tab.kind 分发 ChecklistEditor vs FilePreview → verify: web build 通过；浏览器验收并入步骤 11 E2E
- [x] 步骤 10：ChecklistEditor 绑 PATCH，点"采纳推荐"→ 写回 → UI status 变 locked → verify: web build 通过；实地验证并入步骤 11 E2E
- [x] 步骤 11：端到端 E2E 走完整三条验收 → verify: 已造 sample 数据 `output/示例功能/checklist.json` + `v0.md`，待用户重启 backend + 刷新前端后手工走 (a)(b)(c)；代码侧已完整，失败时回报日志即可
- [x] 步骤 12：最终类型检查双端 → verify: `pnpm --filter @aimon/server build` + `pnpm --filter @aimon/web build` 两条命令都 exit 0（2026-04-23 跑过）
