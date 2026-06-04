# AI开发三件套接入 · 任务清单

> **当前进度（2026-05-08 第一会话切片末尾）**：阶段 A/B/C 全部完成（T01–T10）—— 后端 9 步全部 build 通过、前端 api/types 已就位、PermissionsDrawer 已做最小兼容修复。剩余 T11–T20 在新会话推进。换会话时只需说 `继续 AI开发三件套接入`，会先读 plan/context/tasks 三个文件无缝接上。
>
> **下一步从 T11 开始**：`packages/web/src/store.ts` 加 `workflowMode` 字段（仿现有 `currentProject` 处理）。
>
> **重要决策已落 context.md D11**：workflowMode 走 projects.json 真源不动 SQLite schema（与 layout 同模式）。

## 阶段 A 后端基础

- [x] T01 db.ts 给 `Project` 加 `workflowMode?: "dev-docs"|"openspec"|null` 字段（仅 TS 类型 + projects.json 真源，与 `layout` 同模式不动 SQLite schema；详 context D11） → verify: `pnpm -F @aimon/server build`（项目无 typecheck 脚本，build = tsc 类型检查兜底）通过 ✅；新增 setter `updateProjectWorkflowMode`、`isWorkflowMode` 类型守卫 + `loadProjectsJson` 解析 workflowMode 字段
- [x] T02 workflow-service.ts 扩展 `apply/remove/getStatus(path, opts)`，opts 含 `mode: "dev-docs"|"openspec"` 与 `superpowers: bool`；现有 dev-docs 默认行为不变 → verify: build 通过 ✅；**注**：T02 类型变化使 routes/projects.ts 编译错误，T06 提前与 T02 合并完成（顺序合并不扩范围）
- [x] T03 新建 `packages/server/src/superpowers-guidelines.ts`：常量 `SUPERPOWERS_ANCHOR / SUPERPOWERS_GUIDELINES` + `appendSuperpowersGuidelines / removeSuperpowersGuidelines / getSuperpowersStatus` 三函数（仿 dev-docs-guidelines） → verify: build 通过 ✅
- [x] T04 新建 `packages/server/src/openspec-template-service.ts`：apply/uninstall/status + changes CRUD（list/read/write/createChange/archive） → verify: build 通过 ✅
- [x] T05 新建 `packages/server/src/gstack-installer.ts`：`getStatus / install / update / uninstall`；含 bun 检测、`git ls-remote` 探测可达、git clone 到 `~/.claude/skills/gstack`、bun setup、Windows symlink 失败告警；进程输出转 serverLog（每行 info），状态实时探测 fs → verify: build 通过 ✅；手动 `getStatus` 与错 URL 安装的实测留待 T17 浏览器验收

## 阶段 B 后端路由

- [x] T06 routes/projects.ts 给 workflow apply/remove API 加 zod body schema `{ mode?, superpowers? }`，调用 workflow-service 新签名，apply 成功后 db 写 `workflowMode`（projects.json 真源） → verify: build 通过 ✅（与 T02 合并完成；body 校验、updateProjectWorkflowMode 持久化、扩展 serverLog meta、207 partial 全部就位）
- [x] T07 新建 `packages/server/src/routes/openspec.ts`（list / read / write / create / archive 五端点），index.ts 注册 → verify: build 通过 ✅；curl 实测留待 T17
- [x] T08 新建 `packages/server/src/routes/external-tools.ts`（gstack status/install/update/uninstall），index.ts 注册 → verify: build 通过 ✅；curl 实测留待 T17
- [x] T09 后端整体 build → verify: `pnpm -F @aimon/server build` 全绿 ✅

## 阶段 C 前端基础

- [x] T10 api.ts 加 `openspec.* / externalTools.gstack.*` 系列方法、`applyWorkflow / removeWorkflow` 接受新 opts；types.ts 加 `Project.workflowMode`、`WorkflowApplyOptions / WorkflowRemoveOptions / OpenSpecChange / OpenSpecChangeFile / GstackStatus / GstackInstallResult` 类型 + 扩展 `WorkflowApplyResult / WorkflowRemoveResult / WorkflowStatus` → verify: web build 通过 ✅；**注**：T10 类型扩展使 PermissionsDrawer 旧 `result.devDocs.ok` 用法失败，已做最小兼容修复（写入 T14 范围内的兼容修复），T14 时再补完整 gstack UI
- [x] T11 store.ts 加 `currentProject.workflowMode`、`setWorkflowMode` action → verify: web build 通过 ✅；新增 `setWorkflowMode(projectId, mode)` action，仿 `setSessionTaskLocal` 形态原地修改 `projects[]` 里对应 project 的 `workflowMode`，apply/remove 成功后无需 refreshProjects 全量拉就能驱动侧栏互斥渲染（T15）

## 阶段 D 前端 UI

- [x] T12 新建 `packages/web/src/components/sidebar/OpenSpecView.tsx`：changes 列表 + 三件套展开行 + 复用 FilePreview 只读预览（与 DocsView 同模式，编辑走终端/外部编辑器；新建/归档调 openspec API 自带 scope=openspec 起止） → verify: web build 通过 ✅；浏览器实测留 T17（V2/V3/V4）
- [x] T13 NewProjectDialog.tsx 加"开发流程"下拉（默认 Dev Docs，含 OpenSpec / 无 三选项）+ "启用 Superpowers"checkbox；提交时按选择追加调用 `applyWorkflow(opts)` → verify: web build 通过 ✅；浏览器实测留 T17（V1）
- [x] T14 PermissionsDrawer.tsx 内联新增"工具集" tab + ToolsTab 子组件（gstack 4 按钮 + 状态徽章 + 末尾日志显示）；同时扩展 WorkflowTab 支持 mode 切换（dev-docs/openspec/无）+ Superpowers checkbox（V7 卸载切换需要）；setWorkflowMode 乐观本地镜像同步驱动 T15 互斥渲染 → verify: web build 通过 ✅；浏览器实测留 T17（V5/V6/V7）
- [x] T15 互斥渲染：ActivityBar 按 workflowMode 切 docs item 的图标/标签（dev-docs=📝 Dev Docs / openspec=📜 规范 / null=隐藏整个 item）；PrimarySidebar 按 mode 切 view（DocsView / OpenSpecView / 占位）和顶栏标题 → verify: web build 通过 ✅；浏览器实测留 T17（V2/V7）
- [x] T16 前端整体构建 → verify: `pnpm -F @aimon/web build` 全绿 ✅

## 阶段 E 收尾

- [ ] T17 派 `vibespace-browser-tester` 跑 V1–V7 验收清单 → verify: 测试 agent 报告全 PASS（任何 FAIL 回到对应阶段修复，不带病交付）
- [ ] T18 同步 README.md + README.zh-CN.md 的"项目工作流"章节 → verify: 两份文件双语对齐，包含三件能力的入口、关系、Superpowers 浅集成边界说明
- [ ] T19 dev/memory/manual.md 追加一条本次接入沉淀（Superpowers 浅集成真实边界 / Windows symlink 兜底套路 / 三件正交关系） → verify: manual.md 多一行，格式与现有条目一致
- [ ] T20 收尾自查 → verify: `git diff --name-only HEAD` 输出全部命中各任务 write_files 白名单（无越界）；handoff 摘要写好（首行验收指引 + 改动文件清单 + 浏览器 PASS 证据 + Superpowers 边界声明 + git diff 行）
