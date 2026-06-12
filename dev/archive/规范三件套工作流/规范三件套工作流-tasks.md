# 规范三件套工作流 · 任务清单

- [x] T1 后端 `WorkflowMode` 字面量类型扩 `"spec-trio"`（db.ts）→ verify: grep `WorkflowMode` 引用点确认，运行 `pnpm -F @aimon/server build` 通过
- [x] T2 `workflow-service.ts` apply 加 spec-trio 分支 + 结果类型加 `gstack` 字段 → verify: 函数 import `getGstackStatus`，apply 走 spec-trio 时复用 openspec 装配 + 强制 superpowers + 末尾塞 gstack 字段；`pnpm -F @aimon/server build` 通过
- [x] T3 `workflow-service.ts` remove 加 spec-trio 分支 + 结果类型加 `gstack` 字段 → verify: spec-trio 卸载 openspec + superpowers + harness 但不调 uninstallGstack；`pnpm -F @aimon/server build` 通过
- [x] T4 `workflow-service.ts` `getWorkflowStatus` 改两参签名 `(projectPath, persistedMode)` + 加 gstack 字段 + detectedMode 走 db 优先 → verify: 函数签名变；`pnpm -F @aimon/server build` 通过；调用方 routes/projects.ts:344 同步改
- [x] T5 `routes/projects.ts` zod schema 扩 `"spec-trio"` 枚举 + status 路由传 persistedMode → verify: `pnpm -F @aimon/server build` 通过；手测 curl 发 `{"mode":"spec-trio"}` 不再 400
- [x] T6 前端 `types.ts` 镜像 WorkflowMode + 三个 shape 接口加 gstack 字段 → verify: `pnpm -F @aimon/web build` 通过（类型同步无报错）
- [x] T7 `PermissionsDrawer.tsx` WorkflowTab 下拉新增 spec-trio option + 切换逻辑改 + Superpowers 在 spec-trio 模式下禁用且强制勾 → verify: build 通过；浏览器看到下拉 4 项；切到 spec-trio 时 Superpowers 框 disabled 且 checked
- [x] T8 `PermissionsDrawer.tsx` WorkflowTab 状态栏改造：spec-trio 模式下三 chip 并排；gstack 未装显琥珀色 + 跳 Tools tab 按钮 → verify: 浏览器在 spec-trio 项目里看到三 chip；点 gstack 未装的按钮切到 Tools tab
- [x] T9 `PermissionsDrawer.tsx` 切换 partial 处理：gstack 未装时弹专门提示而非通用 partial 失败 → verify: 故意把 gstack 目录改名，apply spec-trio 后弹"gstack 未装"专项提示+跳 tab 按钮
- [x] T10 `PermissionsDrawer.tsx` 卸载确认文案改：spec-trio 模式提示"gstack 不会被卸" → verify: 浏览器在 spec-trio 项目点"卸载全部"看到包含"gstack 不会被卸"的确认弹窗
- [x] T11 `NewProjectDialog.tsx` 下拉加 spec-trio option → verify: build 通过；浏览器新建项目对话框下拉看到 4 项
- [x] T12 `ActivityBar.tsx` docsItem 加 spec-trio → 复用 OpenSpec 图标（📜）和"规范"label → verify: build 通过；spec-trio 项目左侧 Activity Bar 显示 📜 规范
- [x] T13 `PrimarySidebar.tsx` docsTitle 和 docs body 加 spec-trio → 复用 OpenSpecView 渲染 → verify: build 通过；spec-trio 项目点 docs 看到 OpenSpec 提案列表
- [x] T14 后端 serverLog 起止 meta 加 `gstackInstalled` 字段（apply/remove 两路由）→ verify: LogsView 看到 `apply-workflow 成功 (Nms)` 那条 meta 里有 `gstackInstalled` 字段
- [x] T15 验收闭环：`pnpm -F @aimon/server build` + `pnpm -F @aimon/web build` 双绿；自派 vibespace-browser-tester **被大哥撤回**——浏览器验收转交大哥手测；handoff 摘要写出明确点位
