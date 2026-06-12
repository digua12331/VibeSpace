# Harness 入口统一到抽屉 · Plan

> memory 扫过：auto.md / manual.md 无相关条目。
> 本任务量级在"小改动"边缘（删一个组件 + 改一个右键菜单 + 合并一段提示），按大哥意图把 plan+context 合并一次确认。

---

## 目标

删除 HarnessTeamDrawer 这个独立的"团队配置"抽屉入口，让 PermissionsDrawer 的"工作流" tab 成为 Harness 应用/卸载的唯一前端入口；同时把原 HarnessTeamDrawer apply 成功后弹的"复制 N / 跳过 N / .gitignore 是否追加"详情合并进新入口的 apply 流程，避免能力退化。

### 可验证验收标准（浏览器可观察）

1. **右键菜单不见"🤝 团队"项**：项目右键菜单只剩"代码更改 / 文件 / 用 VSCode 打开 / 权限配置 / 删除项目"。
2. **HarnessTeamDrawer 不可达**：右键、命令面板、键盘快捷键都打不开"团队配置"抽屉。
3. **能力不退化 — apply 详情合并到抽屉**：在 PermissionsDrawer「工作流」tab 点 Harness "应用" → 完成后弹 alertDialog 显示"复制 N 个 / 跳过 N 个 / .gitignore 是否追加"详情，文案与原 HarnessTeamDrawer 一致。
4. **卸载路径不受影响**：Harness "卸载"按钮 + danger confirmDialog + LogsView `scope=project action=remove-harness` 起止配对仍然工作。
5. **Dev Docs 区块不受影响**：应用 / 卸载流程、confirmDialog 提示、logAction 起止配对仍然工作。
6. **类型检查双绿**：`pnpm -F web tsc --noEmit` 0 错误。

---

## 非目标

- **不删后端 `GET /api/projects/:id/harness-status` 路由 + service 函数**：本次只清前端入口，后端死路由留下次清理任务（独立小补丁）。
- **不动 `applyHarness` API 函数**（PermissionsDrawer 仍在用，必须保留）。
- **不改 `harness-applied`（轻量探测）路由**：抽屉的状态展示走它，与本次清理无关。
- **不重构 PermissionsDrawer 整体结构**，只修 `applyHarnessClick` 行为。
- **不改 Harness 模板内容、apply / uninstall 逻辑、操作日志**。

---

## 实施步骤

### Step 1 · 前端 — 删 HarnessTeamDrawer.tsx 整文件

`packages/web/src/components/HarnessTeamDrawer.tsx` 整个文件删除。

verify：tsc 跑出来 PrimarySidebar / ProjectsColumn 等的 import 错（预期），下一步修。

### Step 2 · 前端 — `ProjectsColumn.tsx` 清理

- L5：`import HarnessTeamDrawer from '../HarnessTeamDrawer'` 删。
- 顶部 `harnessTeamProjectId` 相关 state（`useState` 那一行）+ 任何 setter 调用全清。
- 右键菜单（L319 附近）的"🤝 团队"按钮整块删（`<button>` 块连同前后逗号/空白）。
- L344–347 抽屉条件渲染整块删（`{(() => { ... return <HarnessTeamDrawer ... /> })()}`）。

verify：浏览器右键项目，菜单不见"🤝 团队"；`pnpm -F web tsc --noEmit` 0 错误。

### Step 3 · 前端 — `api.ts` 清理 `getHarnessStatus` + 相关类型

- 删 `getHarnessStatus(projectId)`（L103 附近）。
- `types.ts` 中 `HarnessStatus` / `HarnessFileEntry` / `HarnessFileKind` 类型若仅 HarnessTeamDrawer 使用 → 一并删。grep 一遍确认其他文件不引用再删。
- **保留** `applyHarness` + `HarnessApplyResult`（PermissionsDrawer 在用）。

verify：`pnpm -F web tsc --noEmit` 0 错误。

### Step 4 · 前端 — PermissionsDrawer.tsx `applyHarnessClick` 合并 alertDialog 详情

`applyHarnessClick`（L1064–L1083）现状：
```ts
const result = await logAction('project','apply-harness', () => api.applyHarness(project.id), {...})
setHarnessEnabled(true)
```

改造：在 `setHarnessEnabled(true)` 后追加（参照 HarnessTeamDrawer L73–79 原文案）：
```ts
const msg = [
  `复制：${result.copied.length} 个`,
  ...(result.copied.length > 0 ? result.copied.map(p => `  + ${p}`) : []),
  `跳过（已存在）：${result.skipped.length} 个`,
  result.gitignoreAppended ? '已往 .gitignore 追加 .aimon/runtime/' : '.gitignore 已含 runtime 行',
].join('\n')
await alertDialog(msg, { title: '一键安装结果' })
```
失败分支已有 alertDialog（不动）。

verify：浏览器在抽屉里点 Harness "应用"，成功后弹"一键安装结果"详情。

### Step 5 · 全量类型检查 + 浏览器验收

- `pnpm -F web tsc --noEmit` 0 错误。
- 浏览器跑验收 1–6。

---

## 边界情况

- **`HarnessTeamDrawer` 还有别的引用方？** grep 已确认仅 ProjectsColumn 一处导入；如执行阶段发现新增引用（如新加的 sidebar），让 agent 一并清。
- **`HarnessStatus` 类型被 `applyHarness` 返回类型间接依赖？** 不依赖 — `applyHarness` 返回 `HarnessApplyResult`，独立。
- **后端死路由**：`GET /api/projects/:id/harness-status` 删前端入口后无人调用，但后端保留，不影响功能。在 `dev/issues.md` 追加一行清理待办。
- **i18n / a11y**：本任务无新增文案需要翻译；确认按钮 / 抽屉的可访问性属性沿用现状。

## 风险与注意

- **唯一风险**：`alertDialog` 详情中 `result.copied.map(p => '  + ${p}')` 的 path 字符串若过长（manifest 里全部 skill + agent 都首次安装）会让对话框变高。HarnessTeamDrawer 原版不限长，且大多数项目首次装也就 13 项左右，可接受。**不**加截断/折叠 UI。
- 操作日志：现有 `logAction('project','apply-harness',...)` 包装继续保留，alertDialog 在 logAction 之外触发，不影响日志起止配对。
