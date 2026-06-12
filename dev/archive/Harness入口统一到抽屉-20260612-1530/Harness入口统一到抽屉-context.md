# Harness 入口统一到抽屉 · Context

## 关键文件

### 1. `packages/web/src/components/HarnessTeamDrawer.tsx` — 删整个文件

仅 `ProjectsColumn.tsx:5` 一处导入；删除后该 import 报错由 Step 2 修。

### 2. `packages/web/src/components/layout/ProjectsColumn.tsx` — 改

- L5：`import HarnessTeamDrawer from '../HarnessTeamDrawer'` 删。
- 顶部 `harnessTeamProjectId` state 声明 + setter 调用全清（grep 确认范围）。
- L319–322：右键菜单"🤝 团队"`<button>` 块删。
- L344–347：`{(() => { ... return <HarnessTeamDrawer ... /> })()}` IIFE 整块删。

### 3. `packages/web/src/api.ts` — 改

- 删 `getHarnessStatus(projectId)`（L103 附近）。
- 保留 `applyHarness` + `HarnessApplyResult`（抽屉在用）。

### 4. `packages/web/src/types.ts` — 改

- `HarnessStatus` / `HarnessFileEntry` / `HarnessFileKind` 仅 HarnessTeamDrawer 用，删。
- 保留 `HarnessApplyResult`、`HarnessApplied`。
- 执行前 grep 一次"HarnessStatus|HarnessFileEntry|HarnessFileKind"确认无新增引用。

### 5. `packages/web/src/components/PermissionsDrawer.tsx` — 改

- `applyHarnessClick`（L1064–L1083）：在 `setHarnessEnabled(true)` 后追加 alertDialog 详情（文案抄 HarnessTeamDrawer L73–79）。
- 其余不动。

### 6. `dev/issues.md` — append

追加：`- [ ] 清理后端死路由 GET /api/projects/:id/harness-status + service 函数 getHarnessStatus（文件 packages/server/src/routes/projects.ts、harness-template-service.ts；上下文：前端 HarnessTeamDrawer 已删除，该路由无消费方）`

---

## 决策记录

### D1. 不动后端死路由

理由：① 减少本次跨前后端协调；② 死路由保留无功能副作用；③ 已在 issues.md 留追踪条目，避免遗忘。资深工程师视角：合理的范围控制，不过度。

### D2. 类型清理同步进行

`HarnessStatus` 等类型仅 HarnessTeamDrawer 使用；删组件不删类型 = 留死类型。grep 证伪后一并清。

### D3. apply 详情合并 — 文案沿用原文，不重写

抄 HarnessTeamDrawer 现有 L73–79 文案"复制 N / 跳过 N / .gitignore"，不发明新格式。

### D4. 不引入"安装详情折叠/截断"

manifest 量级 ≤ 20 项，首次安装最长 ≤ 25 行 alertDialog，可接受。

### D5. 不抽公共 helper 给"格式化 apply 结果"

只在 PermissionsDrawer 一处用，抽出来反而是只用一次的抽象。

---

## 依赖与约束

- **TypeScript**：`pnpm -F web tsc --noEmit` 0 错误（前端单边改动，后端不动）。
- **样式**：alertDialog 沿用 DialogHost 既有 info 风格（不传 variant），与原 HarnessTeamDrawer 一致。
- **操作日志**：`logAction('project','apply-harness',...)` 已在；alertDialog 在 logAction 外调用不影响起止配对。
- **测试**：项目无单测体系；本任务无新逻辑分支，依赖浏览器手动验收。
