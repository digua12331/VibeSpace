# 工作流入口形态对齐 · Plan

> memory 扫过：auto.md 仅 hook-smoke 一条无关；manual.md 有"小功能直接改"偏好——本任务涉及删用户文件，**非小功能**，走完整三段式流程，不冲突。

---

## 目标

把设置抽屉「工作流」tab 的 Dev Docs 与 Harness 两块统一成"状态文字 + 应用/卸载按钮"形态，并为 Harness 新增卸载能力（DELETE /api/projects/:id/harness），让两块在视觉、交互、日志上完全对称。

### 可验证验收标准（浏览器可观察）

1. **形态对称**：两块状态行排版、按钮位置、按钮文字一致；Dev Docs 区块不再显示 checkbox。
2. **Dev Docs 未启用**：显"未应用"+ "应用"按钮 → 点击无二次确认 → 完成后状态变"已应用"，按钮变"卸载"。
3. **Dev Docs 已启用**：点"卸载" → 弹 danger confirmDialog → 确认后状态变"未应用"；LogsView 见 `scope=project action=set-devdocs` 起止。
4. **Harness 未应用**：点"应用" → 按钮变"应用中…" → 完成后状态变"已应用"；LogsView 见 apply 起止配对（保留现有）。
5. **Harness 已应用**：点"卸载" → 弹 danger confirmDialog（文案明确："会删除 Harness apply 时拷贝的全部 manifest 文件，**包括你可能修改过的**；用户自行新增的文件不动；`.gitignore` 不会被修改"）→ 确认后状态变"未应用"；LogsView 见 `scope=project action=remove-harness` 起止。
6. **Harness 卸载失败分支**：手动锁住 manifest 中某文件 → 点"卸载" → alertDialog 展示哪些文件未删 → LogsView ERROR 条目，meta 含 `failedCount`（不放完整文件列表）。
7. **LogsView 格式正确**：apply 起止、卸载起止、失败 ERROR 条目齐全。
8. **类型检查**：`pnpm -F server tsc --noEmit` + `pnpm -F web tsc --noEmit` 双绿。

---

## 非目标

- 不动 HarnessTeamDrawer 与 `harness-status`（全量探测）路由，其入口与数据流不变。
- 不引入"卸载前自动备份用户改过的文件"。
- 不改 Harness 模板内容（`.aimon/skills/`、`.claude/agents/`、`templates/harness/`）。
- 不为 manifest 引入版本控制 / 快照机制——uninstall 直接调 `getTemplateFiles()` 取当前 manifest。
- 不修改 `.gitignore`（理由见边界）。
- 不为 uninstall 加"用户改过的文件就跳过"检测。
- 不为 uninstall 加"全部成功或全部回滚"事务语义。

---

## 实施步骤

### Step 1 — 后端：`harness-template-service.ts` 新增 `uninstallHarnessTemplate`

- 调 `getTemplateFiles()` 取 manifest（与 apply 共用同一来源，天然一致）。
- 遍历 `dstRel`，逐个 `unlink(join(projectPath, dstRel))`：ENOENT 跳过累入 `skippedCount`；其他错误（EPERM/EBUSY）累入 `failedFiles: string[]`，继续。
- 不动 `.gitignore`。
- 返回 `{ removedCount, skippedCount, failedFiles }`。

verify：`pnpm -F server tsc --noEmit` 通过。

### Step 2 — 后端：`projects.ts` 注册 `DELETE /api/projects/:id/harness`

- 取 proj，404 guard。
- `serverLog info project 'harness-uninstall 开始'` `{ projectId }`。
- 调 `uninstallHarnessTemplate(proj.path)`。
- `failedFiles.length > 0` → 207 + `{ ok: false, removedCount, skippedCount, failedFiles }`，serverLog error。
- 全成 → 200 + `{ ok: true, removedCount, skippedCount, failedFiles: [] }`，serverLog info `harness-uninstall 成功 (Nms)`。

verify：`curl DELETE /api/projects/<id>/harness` 返回 200 或 207；`type CLAUDE.md` 不变；`.aimon/skills/aikanban-*` 已删。

### Step 3 — 前端：`api.ts` 新增 `removeHarness`

- 内联 `HarnessUninstallResult` 接口（参考 `removeDevDocs` 的处理方式，不进 types.ts）。

verify：`pnpm -F web tsc --noEmit` 通过。

### Step 4 — 前端：`PermissionsDrawer.tsx` `WorkflowTab` 改造

**Dev Docs 区块（checkbox → 按钮形态）**：
- 移除 `<label><input type="checkbox">` 结构，改"状态行 + 按钮"，与 Harness 同款排版。
- enabled=true → "卸载"按钮（rose 色调）；enabled=false → "应用"按钮（accent 色调）。
- toggling 态 → 按钮文字"应用中…/卸载中…"，disabled。
- `toggle()` 函数体不动（确认 + logAction 全保留）；只改 JSX。

**Harness 区块（新增卸载按钮）**：
- 移除"已应用，撤销请联系开发"提示。
- enabled=true → "卸载"按钮（rose 色调）；enabled=false → "应用"按钮（accent 色调）。
- 新增 `harnessRemoving` state；`removeHarnessClick()`：
  1. `confirmDialog({ variant: 'danger', title: 'Harness 卸载确认', message: '会删除 Harness apply 时拷贝的全部文件（包括你可能修改过的）；用户自行新增的文件不动；.gitignore 不会被修改。', confirmLabel: '确认卸载' })`。
  2. `logAction('project', 'remove-harness', () => api.removeHarness(project.id), { projectId })` 包装。
  3. 返回 `failedFiles.length > 0` → `alertDialog('以下文件未删成功：\n' + failedFiles.join('\n'), { variant: 'danger' })`。
  4. 无论是否有 failedFiles，请求未抛即 `setHarnessEnabled(false)`。

**不抽 `<WorkflowItem>` 子组件**：两块 JSX 各有差异（claudeMdExists 提示 vs removedCount 提示），重复 < 30 行，不过度抽象。

verify：浏览器跑验收 1–7。

### Step 5 — 操作日志埋点验收

- LogsView 全验收项见对应起止 + 失败分支 ERROR 条目。
- `data/logs/YYYY-MM-DD.log` JSONL 行存在。

verify：LogsView + tail log 文件无遗漏。

### Step 6 — 类型检查终态

`pnpm -F server tsc --noEmit` + `pnpm -F web tsc --noEmit` 0 错误。

---

## 边界情况

### apply 文件级 vs 目录级

`applyHarnessTemplate` 是文件级逐一 copyFile（context 阶段确认）。uninstall 同样文件级 unlink，**不**做 `rmSync(dir, { recursive: true })`，避免误删用户在同目录新建的文件。

### manifest 动态性

`getTemplateFiles()` 在 apply / uninstall 各调一次，结果取决于 VibeSpace repo 调用时刻状态。两次之间 VibeSpace 增/减 skill 时：增 → uninstall 会 ENOENT 跳过；减 → uninstall 不会触及该文件（manifest 不含），用户可手动删。可接受遗留。

### 用户改过的文件

不检测、直接删。二次确认文案明确警告。

### 用户已删的文件

ENOENT → 跳过，`skippedCount++`，不视为错误。

### 文件被锁（EPERM/EBUSY）

收集进 `failedFiles`，继续删其余，最终 207 + failedFiles。前端 alertDialog 列出。**不回滚**已删文件——回滚需要重新 apply（用户自己决定），引入回滚复杂度大幅上升且无明确需求。

### `.gitignore` 不动

apply 追加的 `.aimon/runtime/` 行**没有 marker**，无法区分是 apply 加的还是用户原本就有的。"精确移除"风险大于"不动"——保留 .gitignore 一行多余条目无副作用，安全的取舍。二次确认文案明示。

### 与 HarnessTeamDrawer 并存

HarnessTeamDrawer 走 `/api/projects/:id/harness-status`（全量 file-level）+ `applyHarness`；本任务新 DELETE 路由独立，不影响 `harness-applied`（轻量）路由。共用 `getTemplateFiles()` manifest 不会不一致。

### Dev Docs 切换形态时 logAction / 二次确认不丢

只改 JSX 不动 `toggle()` 函数体，`logAction('project','set-devdocs')` 包装与 `if (!target) confirmDialog` 二次确认天然保留。verify 步骤显式确认 LogsView 仍有 `set-devdocs` 起止。

---

## 风险与注意

1. **manifest 动态性 vs 快照**：用 `getTemplateFiles()` 现扫 manifest，本 plan 选动态。**需大哥在确认 plan 时拍板**：是否可接受动态 manifest（简单但略有遗留），还是要 apply 时把文件列表快照到目标项目某元数据文件，uninstall 读快照（更精确但要新增元数据）。

2. **删用户改过的文件不检测**：本 plan 最大破坏性决策。**需大哥拍板**。

3. **卸载部分失败不回滚**：返回 207 + failedFiles 让前端弹窗。**需大哥拍板**是否可接受部分成功状态。

4. **`.gitignore` 不动**：因 apply 没加 marker 无法精确区分。**需大哥拍板**是否可接受残留。

5. **scope 不一致问题**：现有前端 `logAction('project','apply-harness')` 与后端 `serverLog scope='installer'` 不一致。context 阶段统一为 `'project'`（installer 更适合 CLI 安装器场景）。**这是顺手清理项**，不需大哥单独决策。
