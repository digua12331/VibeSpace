# 新建项目极简化与设置整合 · Context

## 关键文件

### 后端

**`packages/server/src/routes/projects.ts`** — 改

- L28–33 `CreateProjectSchema`：`path: z.string().min(1)` → `z.string().min(1).optional()`；删除 `applyDevDocsGuidelines: z.boolean().optional()` 字段（彻底移除）。
- L158–231 `POST /api/projects` 处理函数：
  - 现状：`statSync(path)` 校验目录 → 不是目录 400/`path_not_directory` → 不存在 400/`path_not_found` → `createProject()` → UNIQUE 抛错转 409/`path_already_exists`。
  - 改动：`path` 缺省时 `path = join(DEFAULT_ROOT, name)` + `mkdirSync(path, { recursive: true })`；mkdirSync 抛 → 400/`path_unwritable`。mkdirSync 成功后跳过 statSync。显式传 path 时沿用现有 statSync 流程不变。
  - `serverLog` 起止配对：`scope=project`，`msg=project-create 开始/成功 (Nms)/失败: <reason>`，`meta={ name, path, pathMode: 'auto'|'custom' }`。
  - 移除 `if (applyDevDocsGuidelines) { appendDevDocsGuidelines(...) }` 整块（L178–187）。`applyHarnessGuidelines` 字段及 serverLog 零改动。
- L42–66 `appendToClaudeMd` 函数：只读，不改。
- L68–69 `MAIN_GUIDELINES_ANCHOR = "# Dev Docs 工作流"`：只读，新增 GET dev-docs-status 复用。
- L120–135 `appendDevDocsGuidelines`：只读（apply-dev-docs 路由 + WorkflowTab "开"操作复用）。
- L327–344 `POST /api/projects/:id/apply-dev-docs`：只读保留。
- **新增** `GET /api/projects/:id/dev-docs-status`：读 `<proj.path>/CLAUDE.md`，`indexOf(MAIN_GUIDELINES_ANCHOR) >= 0` 判断，返回 `{ enabled, claudeMdExists }`，serverLog 起止。
- **新增** `DELETE /api/projects/:id/dev-docs`：anchor 块切除（见决策 4），serverLog 起止。

**`packages/server/src/db.ts`** — 只读确认

- L125–130 `CREATE TABLE projects`：`path TEXT NOT NULL UNIQUE` ✅ UNIQUE 已在。
- L331–343 `createProject()`：手动 `list.some(p => p.path === input.path)` 抛 `"UNIQUE constraint failed: projects.path"`，路由层已 catch 转 409。无需补前置查询。

**`packages/server/src/log-bus.ts`** — 只读

- L54–86 `serverLog(level, scope, msg, extra?)`：extra 含 `projectId?`/`sessionId?`/`meta?`，meta JSON.stringify ≤2KB。本任务 scope 统一 `"project"`。

### 前端

**`packages/web/src/api.ts`** — 改

- L94–101 `createProject`：`path?: string` 改可选；删除 `applyDevDocsGuidelines?: boolean` 入参。
- L116–123 `applyDevDocsGuidelines`：保留不动（DocsView + WorkflowTab "开"复用）。
- **新增** `getDevDocsStatus(projectId): Promise<DevDocsStatus>`。
- **新增** `removeDevDocs(projectId): Promise<{ ok: boolean; enabled: boolean }>`。

**`packages/web/src/types.ts`** — 改

- 在 Dev Docs 段落（L417 附近）新增：

```ts
export interface DevDocsStatus {
  enabled: boolean
  claudeMdExists: boolean
}
```

**`packages/web/src/components/NewProjectDialog.tsx`** — 改（149 行）

- L10 `applyDevDocs` state 整行删除。
- 新增 `showAdvanced` state（默认 `false`）。
- L26–28 submit 校验仅 `!name.trim()`，`path` 空不报错。
- L36–51 logAction：删 `applyDevDocsGuidelines: applyDevDocs`；meta 加 `pathMode: path.trim() ? 'custom' : 'auto'`；`...(path.trim() ? { path: path.trim() } : {})` 条件传参。
- JSX：主区只留名称输入框；L82–106 原路径 + Dev Docs toggle + Harness toggle → 路径 + Harness 迁入受控折叠区（不用 `<details>`，与项目其他受控展开一致），Dev Docs toggle 删除。

**`packages/web/src/components/PermissionsDrawer.tsx`** — 改（1107 行）

- L69 `mode` state 类型扩为 `'workflow' | 'permissions' | 'buttons'`，初值 `'workflow'`（**待大哥确认默认 tab，见决策 7**）。
- L238 dirty 提示条件 `mode === 'permissions'` 不变。
- L243 保存按钮条件 `mode === 'permissions'` 不变。
- L264–271 tab 栏在"🛡 权限"前插入工作流 TabBtn。
- L356 之前插入 `{mode === 'workflow' && <WorkflowTab project={project} />}`。
- L5 import 补 `confirmDialog`；新增 `import { logAction } from '../logs'`。
- **新增** `WorkflowTab` 内联在文件末尾（`PostSaveRestartDialog` 之前）：
  - state：`enabled: boolean | null`、`claudeMdExists`、`toggling`、`loadError`
  - mount：`api.getDevDocsStatus(project.id)` → set state；失败设 loadError
  - `toggle(target: boolean)`：关时先 `confirmDialog('此操作会移除 CLAUDE.md 中的 Dev Docs 工作流段落（含其后所有内容）。如该段落后有自定义内容请先备份。确认继续？', { title: '关闭 Dev Docs 工作流', confirmLabel: '确认移除', variant: 'danger' })` 返回 false 提前 return；包 `logAction('project', 'set-devdocs', fn, { projectId: project.id, meta: { target } })`；开调 `applyDevDocsGuidelines`、关调 `removeDevDocs`；成功 `setEnabled(target)`，失败 catch 回滚 enabled 不变（logAction 自动 ERROR）。
  - UI：toggle 开关（`<input type="checkbox" className="mt-0.5 accent-accent">`）+ 说明文字 + 加载/错误状态。

**`packages/web/src/logs.ts`** — 只读

- L54–98 `logAction(scope, action, fn, ctx?)` 直接复用。

**`packages/web/src/components/sidebar/DocsView.tsx`** — 只读（不改）

- L214 `api.applyDevDocsGuidelines(projectId)` 调用保留。WorkflowTab 是第三处调用方。

---

## 决策记录

### 决策 1：`DEFAULT_ROOT` 模块顶部 `const`，不读 env

```ts
const DEFAULT_ROOT = 'F:\\VibeSpace'
```

放 `routes/projects.ts` import 之后。未来迁 env 一行改动。无 multi-host 需求，不过度设计。

### 决策 2：错误码命名延续现有体系

新增一个：`path_unwritable`（400），与 `path_not_directory` / `path_not_found` 同层级。不发明新体系。

### 决策 3：`mkdirSync` 成功后跳过 `statSync`

mkdirSync 成功即目录存在；失败 → 400/`path_unwritable`，归类为可预见的客户端配置错误（盘符不存在、权限不足），不用 500。显式传 path 时仍走原 statSync 流程。

### 决策 4：anchor 块移除用 indexOf + slice，不用正则

```ts
const REMOVE_PREFIX = '\n\n---\n\n' + MAIN_GUIDELINES_ANCHOR
const idx = content.indexOf(REMOVE_PREFIX)
if (idx < 0) return reply.send({ ok: true, enabled: false })  // 幂等
const trimmed = content.slice(0, idx).replace(/\s+$/, '')
writeFileSync(target, trimmed + '\n', 'utf8')
return reply.send({ ok: true, enabled: false })
```

依赖 `appendToClaudeMd` 总以 `---\n\n${body}` 格式追加，与现有实现吻合。CLAUDE.md 不存在直接返回幂等成功，不写文件。

### 决策 5：CLAUDE.md 不存在或无 anchor → DELETE 200 幂等

"已经没有"等同"关闭成功"，不返回 404。

### 决策 6：`WorkflowTab` 内联同文件

`ClaudeTab` / `CodexTab` / `ButtonsTab` 全内联在 `PermissionsDrawer.tsx`，无一抽独立文件。跟随既有风格。

### 决策 7：`mode` 初值 `'workflow'`（**待大哥在开工前拍板**）

打开设置抽屉默认落"工作流" tab。如果大哥偏好默认仍是"权限"（多数人用抽屉是为了改权限不是为了切 Dev Docs），改回 `'permissions'` 即可。

### 决策 8：二次确认弹窗用 `confirmDialog`，不用 `window.confirm`

项目全局无 `window.confirm`，`confirmDialog`（含 danger variant）已被 12+ 处复用，标准做法。补一行 import 即可。

### 决策 9：`applyDevDocsGuidelines` 仅 NewProjectDialog 一处需删传参

grep 确认：`createProject` 调用中传 `applyDevDocsGuidelines` 只在 `NewProjectDialog.tsx:39`。`api.applyDevDocsGuidelines` 独立函数继续存在（DocsView + WorkflowTab 调）。

### 决策 10：Harness 行为零改动，仅迁 UI 位置

`applyHarnessGuidelines` 字段在 createProject 调用中保留，NewProjectDialog 折叠区迁入 toggle 后仍传同字段。后端 `applyHarnessTemplate` 路径完全不动。

---

## 依赖与约束

**后端**

- 新增路由在 `projects.ts` 同文件注册，不抽新文件。
- `mkdirSync` / `readFileSync` / `writeFileSync` 已在 L2 import；`join` 在 L3；`serverLog` 在 L21。直接用。

**前端**

- `DevDocsStatus` 类型放 `types.ts` Dev Docs 段；`api.ts` import 它。
- `PermissionsDrawer.tsx` 补两行 import：`confirmDialog`（`./dialog/DialogHost`）+ `logAction`（`../logs`）。
- WorkflowTab toggle 控件样式跟随 NewProjectDialog 现有 checkbox（`accent-accent`）。

**TypeScript**

- 前端 `pnpm -F web tsc --noEmit` 0 错误。
- 后端 `pnpm -F server tsc --noEmit` 0 错误。

**测试**

- 项目无 vitest / jest 单测。anchor 切片逻辑手动验证（curl + `type` 检视文件）。tasks 完工时往 `dev/issues.md` 追加一条："考虑为 `removeDevDocs` anchor 切片逻辑加 1–2 个单测（文件：packages/server/src/routes/projects.ts；上下文：DELETE dev-docs 路由的 indexOf+slice，目前无测试覆盖）"。
