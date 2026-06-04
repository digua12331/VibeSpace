# 新建项目极简化与设置整合 · Plan

> memory 扫过：auto.md 仅有一条 `hook-smoke-1776939102315` 经验 A，与本任务无关；manual.md 有一条"小功能直接改"偏好，本任务是中等规模改动，走完整流程，与该偏好不冲突。无相关记忆条目。

---

## 目标

解决两个耦合问题：

1. **新建项目流程繁琐**：用户当前需手动填路径 + 勾选多项配置才能建项目。目标是"只填项目名 → 确认 → 项目建好"。
2. **Dev Docs 工作流开关只能在建项目时一次性设置，建后无法更改**：目标是把它迁移到项目设置抽屉，常驻可改。

### 可验证验收标准（浏览器可观察）

1. **UI 简化**：点"+ 新建项目"，对话框只见一个"项目名"输入框 + 一个默认收起的"高级"折叠区（含自定义路径），不再显示 Dev Docs toggle 和 Harness toggle（Harness 移入高级区）。
2. **默认路径推断**：输入项目名 `foo` → 确认 → 后端在 `F:\VibeSpace\foo` 自动 `mkdirSync` 创建目录并注册项目；项目出现在项目列表。
3. **重名报错**：输入已注册的项目名 → 确认 → UI 显示错误提示；LogsView 出现 `scope=project action=create` ERROR 配对。
4. **高级路径自定义**：展开"高级"，填自定义路径（如 `D:\work\foo`）→ 确认 → 以自定义路径创建。
5. **设置抽屉新增工作流 tab**：打开 PermissionsDrawer（UI 文字已称"设置"），tab 栏出现第三个"工作流"。
6. **Dev Docs 状态读取**：进入"工作流" tab，开关反映当前项目 `CLAUDE.md` 是否含 Dev Docs anchor 块。
7. **Dev Docs 开关可写**：切换开关 → 开（追加守则块）/ 关（移除守则块）→ 看到 `CLAUDE.md` 实时变化；LogsView 出现 `scope=project action=set-devdocs` 起止配对。
8. **失败分支**：把项目目录置只读 → 切换开关 → LogsView 出现 ERROR 条目，UI 显示错误，开关回滚到操作前值。

---

## 非目标

- 不重写 PermissionsDrawer 的权限模型或 Codex 配置逻辑。
- 不引入"项目模板系统"（Harness toggle 仅迁位置，逻辑不动）。
- 不做"自定义默认根目录"配置 UI（`F:\VibeSpace` 先硬编码服务器常量）。
- 不改 `.codex` 权限模型。
- 不批量迁移老项目的 Dev Docs 状态（按需读，不预迁）。
- 不为 Dev Docs 开关引入 DB 字段（状态从 CLAUDE.md 文件读，不入库）。

---

## 决策记录

### 建项目时是否默认自动应用 Dev Docs？

**默认 OFF**。原来的 toggle 默认 ON 是因为它就在表单里能马上看到、能马上关；迁移后第一次建项目就强制写 CLAUDE.md 会让"轻量试用项目"也被侵入。建后用户可随时进设置抽屉打开。**这是与现状的行为变更，需主理人确认**。

### "关闭 Dev Docs"是否需要确认弹窗？

**需要**。移除逻辑剪掉的是 `---\n\n# Dev Docs 工作流` 到 EOF 的块，如果用户在该块之后自写了内容会一起被删。弹窗文字："此操作会移除 CLAUDE.md 中的 Dev Docs 工作流段落（含其后所有内容）。如该段落后有自定义内容请先备份。确认继续？"

### PermissionsDrawer 是否重命名？

**不重命名组件名**（避免 import 连锁改动）。Header 里 UI 文字已是"设置"，只在新增 tab 时顺势体现"项目设置"语义。

### Harness toggle 何去何从？

迁入"高级"折叠区，仍在 NewProjectDialog 里建项目时一次性触发（不进设置抽屉）。理由：Harness 是"建项目模板"性质，事后改的需求弱，留在建时入口最自然。

---

## 实施步骤

### Step 1 — 后端：`POST /api/projects` body 简化 + 默认根目录

**文件**：`packages/server/src/routes/projects.ts`

- 顶部加 `const DEFAULT_ROOT = 'F:\\VibeSpace'`。
- `CreateProjectSchema`：`path` 改为 `z.string().min(1).optional()`。
- 当 body 未传 `path` 时：`path = path.join(DEFAULT_ROOT, name)`，`mkdirSync(path, { recursive: true })` 兜底；父目录无写权返回 400。
- `path` 已存在但非目录返回 `path_not_directory`；DB 已有同 path 返回 `path_already_exists`（依赖现有 UNIQUE 约束，context 阶段确认 db.ts schema）。
- 加 `serverLog('info','project','project-create 开始/成功/失败', { name, path, pathMode })`。

verify：`curl -X POST .../api/projects -d '{"name":"test-proj"}'` → 201 且 `F:\VibeSpace\test-proj\` 已建。

### Step 2 — 后端：新增 `GET /api/projects/:id/dev-docs-status` 与 `DELETE /api/projects/:id/dev-docs`

**文件**：同上

- `GET .../dev-docs-status`：读 `<project.path>/CLAUDE.md`，检测含 anchor `# Dev Docs 工作流`，返回 `{ enabled, claudeMdExists }`。
- `DELETE .../dev-docs`：找 `\n\n---\n\n# Dev Docs 工作流` 到下一个 `---` 或 EOF 的整块，剪掉，trim 末尾换行回写。
- 两条路由均加 `serverLog` 起止配对。

verify：curl GET / DELETE 状态符合预期；CLAUDE.md 内容用 `type` 检视。

### Step 3 — 前端 API 层

**文件**：`packages/web/src/api.ts` + `types.ts`

- `createProject` 入参 `path` 改为可选。
- 新增 `getDevDocsStatus(projectId)` / `removeDevDocsGuidelines(projectId)`。

verify：`pnpm -F web tsc --noEmit` 0 错误。

### Step 4 — 前端：简化 NewProjectDialog

**文件**：`packages/web/src/components/NewProjectDialog.tsx`

- 主界面只留 `name` 必填。
- `showAdvanced` 状态（默认 false），折叠区含：`path`（可选，placeholder `留空则自动创建 F:\VibeSpace\<名称>`）、`applyHarness` toggle。
- 移除 `applyDevDocs` 字段及对应 toggle，建项目调用不再传 `applyDevDocsGuidelines: true`。
- `submit`：`path` 空不传，非空才传；保留 `logAction('project','create',...)`，meta 加 `pathMode: 'auto'|'custom'`。

verify：浏览器对话框只见名称 + 收起的"高级"区；展开见路径 + Harness；无 Dev Docs toggle。

### Step 5 — 前端：PermissionsDrawer 加"工作流" tab

**文件**：`packages/web/src/components/PermissionsDrawer.tsx`

- 顶层 mode 扩展为 `'workflow' | 'permissions' | 'buttons'`，tab 顺序：工作流 / 权限 / 按钮。
- 同文件底部加 `WorkflowTab` 组件（不抽独立文件，避免过度拆分）：
  - mount 调 `getDevDocsStatus`，开关展示 `enabled`。
  - 切换：开 → 调既有 `applyDevDocsGuidelines`；关 → 弹确认框（见决策）→ 调新 `removeDevDocsGuidelines`。
  - 用 `logAction('project','set-devdocs', fn, { projectId, target: enabled })` 包装。
  - loading 态 + 失败回滚开关。
  - 二级说明文字解释这开关做啥。
- "工作流" tab 即时生效，不复用 header 的"保存"按钮（保存按钮仍只在 `mode==='permissions'` 显示）。

verify：抽屉 tab 栏见三 tab；切换 Dev Docs 开关后 LogsView 见配对 + CLAUDE.md 内容变化。

### Step 6 — 类型检查 + 端到端验收

- `pnpm -F web tsc --noEmit` + `pnpm -F server tsc --noEmit` 全过。
- 按验收标准 1–8 浏览器手动逐项验。

---

## 边界情况

1. **`F:\VibeSpace\<name>` 已存在但 DB 无记录**：允许复用目录（路径存在 ≠ 项目存在）；DB 有同 path 才 409。
2. **`F:\VibeSpace` 根不存在或无写权**：`mkdirSync` 抛错，后端 500/400，前端 LogsView ERROR。
3. **重复点"开"Dev Docs**：`appendToClaudeMd` 已用 anchor 检测幂等，`wrote=false`，开关保持 ON 不报错。
4. **用户在 Dev Docs 块后自写了内容，点"关"**：移除会一并删，因此 Step 5 的弹窗确认必加。
5. **CLAUDE.md 不存在时点"关"**：anchor 不存在，直接返回 `{ ok: true, enabled: false }`，幂等不写文件。
6. **并发切换**：两个前端窗口同时切，last-write-wins，可接受，无锁。
7. **Windows 路径分隔符**：后端全程 `path.join`，前端只传字符串不拼接，无跨平台问题。
8. **老项目升级**：旧项目 CLAUDE.md 已含 anchor，"工作流" tab 进去读到 `enabled: true`，无需迁移。

---

## 风险与注意

1. **`F:\VibeSpace` 硬编码**：临时方案。`DEFAULT_ROOT` 是常量，未来可改环境变量 `AIMON_DEFAULT_ROOT` 一行迁移。**假设主理人接受当前 Windows + 固定盘符场景。**
2. **Dev Docs 块移除的安全性**：依赖精确匹配 `\n\n---\n\n# Dev Docs 工作流` → 下一 `---` 或 EOF 的范围。如用户改过分隔符格式可能失效，实现时建议加 2–3 个典型 CLAUDE.md 格式的单测。
3. **`applyDevDocs` 字段处置**：前端 API 入参 `applyDevDocsGuidelines` 推荐**直接删**（更干净），后端 schema 也移除。如为兼容性保留参数会留死代码。
4. **DB `path` UNIQUE 约束**：当前 path 重复检测依赖 SQLite UNIQUE 报错，context 阶段需查 `db.ts` schema 确认；若无 UNIQUE 需补前置查询。
5. **行为变更需主理人确认**：建项目默认不再自动应用 Dev Docs（原默认 ON）；关 Dev Docs 弹确认；Harness 移入高级折叠区。

---

*plan 版本：2026-04-30*
