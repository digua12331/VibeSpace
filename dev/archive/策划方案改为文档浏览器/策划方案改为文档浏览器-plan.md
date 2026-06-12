# 策划方案改为文档浏览器 · Plan

## 大哥摘要（先看这段）

左侧 📐"策划方案"那一栏，整体改成 📄"文档"。点开后会**列出你项目根目录下 `docs/` 文件夹里**所有的 `.md`（markdown 文本文档，比如 `cli-installer-plan.md`）文件，**点一下文件名就在主区直接预览**。

原来那套按"功能名"折叠 + 让你填清单（checklist）的玩法**整体废弃**——你没在用，相关代码删干净。

**你需要担心动到什么吗**：不会。`output/` 目录里你之前自己写的文件（比如 `output/示例功能/v0.md`）**原封不动留在磁盘上**，只是这个侧栏不再读它了。SQLite 数据库不动、其它侧栏（文件 / 源代码更改 / Dev Docs / 性能 / 日志）不动、`docs/` 文件夹下的 md 文件本身也不动。

**你怎么验收**：本项目 `docs/` 下当前有 8 个 md（`1.md` / `claude-config-tiers.md` / `cli-installer-plan.md` / `github-changes-viewer-plan.md` / `terminal-layout-plan.md` / `unified-layout-plan.md` / `vscode-layout-plan.md` / `windows-strong-notification.md`）。改完后点 📄"文档"，你会看到这 8 个文件名按字母排序列出来，点任一个 → 主区出来对应文档预览。

---

## 目标 + 验收标准

- **目标**：把左侧 ActivityBar（顶部那一列大图标）第 4 个 `'output'` 项整体替换成"文档"插件，数据源换成 `<项目根>/docs/` 第一层 `.md` 文件。原 `output/<功能名>/checklist.json` 玩法整套移除。

- **验收标准**（可在浏览器里观察）：
  1. 选中本项目 → 左侧 📐 不见了，原位置变成 📄；hover 提示从"策划方案"变成"文档"。
  2. 点 📄 → 右侧面板顶栏显示"文档"；下方列出 8 个 md 文件名按字母排序。
  3. 点击 `cli-installer-plan.md` → 主区开新标签，渲染该 md 的预览（FilePreview 已有的 md 渲染能力）。
  4. 在 LogsView 看到 `scope=docs action=list` 的起止配对（成功一条 info、失败一条 error）。
  5. 故意制造失败：临时把 docs 改成 docss 路径调接口 → LogsView 出现 error 配对；前端发现 docs 不存在 → 列表为空、显示空态文案"项目根下没有 docs/ 文件夹"，**不报错弹窗**。
  6. AI 自派 `vibespace-browser-tester` 跑上述 1–5，**有问题再汇总**。

## 非目标（这次不做）

- 不递归 `docs/` 子目录里的 md（用户已确认"只列第一层"）。
- 不支持 `.md` 以外的扩展名（`.txt` / `.pdf` / 图片不列）。
- 不实现编辑功能——侧栏只是列表 + 点开预览。
- 不实现搜索 / 全文匹配 / 文件 watcher。
- 不动 `output/` 目录里大哥之前的文件本身（只是侧栏不再读它）。
- 不动 Activity 顶栏其它 9 个图标。

## 实施步骤

> 顺序大致按"先后端、再前端类型、再 store、再组件、再标签注册"。每步都带 `verify`（自验证）。
> 命名约定：新 Activity id 用 **`projectdocs`**（避让 workflow 的 `'docs'`）；后端路由用 `/api/projects/:id/docs`；前端组件文件叫 `DocsView.tsx`。

1. **新增后端路由 `packages/server/src/routes/docs.ts`**
   - GET `/api/projects/:id/docs` → 内联 `fs.readdir(<project.path>/docs)` 扫第一层、按 `.endsWith('.md')` 过滤、按文件名字典排序、返回 `{ docs: [{ name: string }] }`。
   - `ENOENT`（docs 目录不存在）和 `ENOTDIR` 都 try/catch 返 `{ docs: [] }`，**不返回 5xx**。
   - 配套 `serverLog('info','docs','list 开始'/'list 成功 (Nms)' / 'list 失败: <reason>')` 起止配对。
   - 在 `packages/server/src/index.ts` 注册新路由。
   - **verify**：curl 三种情形 —— docs 存在 / docs 不存在 / docs 为空，三次都 200，返回字段一致；LogsView 看见起止配对。

2. **删除老后端三件套**：`packages/server/src/routes/output.ts` + `packages/server/src/output-service.ts`；`index.ts` 移除 `registerOutputRoutes` 调用。
   - **破坏性变更协议触发**（删源文件 + 删跨文件导出符号 + 删 HTTP 路由 3 条）：
     - `verify`：grep `OutputServiceError|listOutput|readChecklist|patchChecklistItem|registerOutputRoutes` 在 packages/server 下应该 0 命中；grep `/api/projects/:id/output` 字符串应 0 命中。

3. **前端 types.ts 清理 + 新增**（packages/web/src/types.ts 723–773 行段落）
   - 删：`ChecklistStatus` / `ChecklistItem` / `ChecklistSection` / `ChecklistDoc` / `OutputFeature` / `OutputListResult`（含注释段 `// ---------- Output (策划方案清单) ----------` 整段）。
   - 新增：`export interface DocFile { name: string }` + `export interface DocListResult { docs: DocFile[] }`。
   - **verify**：`tsc --noEmit`（项目类型检查）通过；grep `ChecklistDoc|OutputFeature|ChecklistItem|ChecklistSection|ChecklistStatus|OutputListResult` 在 packages/web 下应 0 命中。

4. **前端 api.ts 清理 + 新增**（packages/web/src/api.ts 734–762 行段落）
   - 删：`listOutput` / `getChecklist` / `patchChecklistItem` 三个函数 + 注释。
   - 新增：`export function listDocs(projectId: string): Promise<DocListResult>` → 调 `/api/projects/${encodeURIComponent(projectId)}/docs`。
   - **verify**：tsc 通过；grep `listOutput\|getChecklist\|patchChecklistItem\|/api/projects/[^/]+/output` 在 packages/web 下应 0 命中。

5. **前端 store.ts 清理 + 改名**（packages/web/src/store.ts 239–256 + 实现段）
   - 删：`checklists` / `checklistsLoading` / `checklistsError` / `refreshChecklist` / `patchChecklistItem` 全部字段 + 对应 setter 实现。
   - 原地改名：`outputFeatures → docs`、`outputLoading → docsLoading`、`outputError → docsError`、`refreshOutput → refreshDocs`（IDE 全局 rename）。`refreshDocs` 内部改成调用 `listDocs(projectId)`。
   - **verify**：tsc 通过；grep `\.outputFeatures\|\.outputLoading\|\.outputError\|\.refreshOutput\|\.checklists\|\.refreshChecklist\|\.patchChecklistItem` 在 packages/web 下应 0 命中（包括 Zustand selector 字面量）。

6. **新增 `packages/web/src/components/sidebar/DocsView.tsx`**（替换 OutputView.tsx）
   - 选中项目时拉 `refreshDocs(projectId)`；空态文案"项目根下没有 `docs/` 文件夹"。
   - 列表项：📄 + 文件名；点击 `openFile({ projectId, path: 'docs/' + name })` —— **不传 kind**（走 FilePreview 默认 md 渲染分支）。
   - 顶部刷新按钮 + 错误条样式跟 OutputView 现有形态对齐。
   - `useEffect` + `refreshDocs` 用 `logAction('docs','list', ...)` 包装。
   - 同步删 `packages/web/src/components/sidebar/OutputView.tsx`。
   - **verify**：浏览器选中本项目，📄 面板显示 8 个 md；LogsView 有起止配对。

7. **删除 ChecklistEditor + 移除 kind='checklist' 分支**
   - 删 `packages/web/src/components/editor/ChecklistEditor.tsx`。
   - `packages/web/src/components/editor/EditorArea.tsx` 移除第 17 行 `lazy(import('./ChecklistEditor'))` + 第 323-行 `kind === 'checklist'` 三元分支，保留默认 FilePreview 分支即可。
   - **verify**：grep `ChecklistEditor\|kind === 'checklist'\|kind: 'checklist'` 在 packages/web 下应 0 命中；tsc 通过；浏览器随机点几个其它文件（非 md）/ md，预览仍然正常。

8. **ActivityBar.tsx 调整**（packages/web/src/components/layout/ActivityBar.tsx）
   - 第 42 行 `{ id: 'output', icon: '📐', label: '策划方案' }` → `{ id: 'projectdocs', icon: '📄', label: '文档' }`。
   - `useStore` 里 `Activity` 类型同步更新：`'output' → 'projectdocs'`（在 store.ts 的 Activity union 里改）。
   - **verify**：tsc 通过；浏览器看到 📄 在原 📐 位置。

9. **PrimarySidebar.tsx 调整**（packages/web/src/components/layout/PrimarySidebar.tsx）
   - 第 23 行 `output: '策划方案'` → `projectdocs: '文档'`。
   - 第 71 行 `case 'output'` 渲染分支 → `case 'projectdocs'`，并把 `<OutputView />` 换成 `<DocsView />`，import 路径同步。
   - **verify**：grep `'output'\|"output"` 在 packages/web/src/components/layout 下应 0 命中；浏览器点 📄 看到面板。

10. **vibespace-browser-tester 自验收**
    - 任务交付前自派 `vibespace-browser-tester`，跑上面验收 1–5 + 故意打错 URL（造 error 路径）。
    - **verify**：tester 报告全 PASS；有 FAIL 才汇总给大哥。

## 边界情况

- `docs/` 目录不存在 / 为空 / 仅含子目录（无第一层 .md） → 列表空、显示空态文案、不报错。
- `docs/` 下混有非 .md 文件（如 `.png` 附件、`.txt`） → 列表只显示 .md。
- 文件名含中文 / 空格 / 特殊字符（如 `1.md`） → 列表显示正常；点击后 `openFile` 的 path 用普通字符串拼接（FilePreview 内部自己处理 encoding）。
- 项目未选中 → 显示"请先在左侧「项目」列表中选中一个项目"（沿用 OutputView 现有空态文案）。
- 切换项目 → 列表立即重拉（`useEffect` 依赖 `projectId`）。
- **多 worktree**：后端用 `getProject(id).path` 拿主项目路径，与 worktree 隔离（worktree 切换不影响这个面板）。
- 文件被外部删除后再点 → FilePreview 自身的错误处理（404 → 显示空内容）；本任务不引入 watcher。

## 风险与注意

- **破坏性变更协议触发**（CLAUDE.md 硬规则）：删源文件 ≥ 4 个、删跨文件导出符号 ≥ 10 个、删 HTTP 路由 3 条。每个删除步骤的 `verify` 必须包含 grep 残留验证，已在上述步骤里逐条写明。
- **store 字段字面量风险**：Zustand 的 `useStore((s) => s.outputFeatures)` 是字符串字面量访问，TypeScript rename 可能覆盖不到——所以步骤 5 的 verify 显式 grep `.outputFeatures` 等字面量。
- **Activity id 冲突**：workflow 已用 `'docs'`，所以新 id 用 `projectdocs`（不撞 + 语义清晰，比 `userdocs` / `docs2` 都好）。
- **FilePreview 路径处理**：后端返裸文件名，前端拼 `docs/${name}` —— 避免双重 `docs/docs/` 之类的拼错。
- **未提交改动 `M packages/server/src/db.ts`**：与本任务无关；本任务执行期间**不动该文件**，避免误叠改动。
- **output/ 目录本身保留**：大哥磁盘上已有的 `output/示例功能/v0.md` 等文件本任务**不删**——只是侧栏不再读它，留给大哥自己处理。

## 关键文件

**会写（创建 / 编辑 / 删除）**：
- 创建：`packages/server/src/routes/docs.ts`、`packages/web/src/components/sidebar/DocsView.tsx`
- 编辑：`packages/server/src/index.ts`、`packages/web/src/types.ts`、`packages/web/src/api.ts`、`packages/web/src/store.ts`、`packages/web/src/components/editor/EditorArea.tsx`、`packages/web/src/components/layout/ActivityBar.tsx`、`packages/web/src/components/layout/PrimarySidebar.tsx`
- 删除：`packages/server/src/routes/output.ts`、`packages/server/src/output-service.ts`、`packages/web/src/components/sidebar/OutputView.tsx`、`packages/web/src/components/editor/ChecklistEditor.tsx`

**会读（验证 / grep / 引用追踪）**：
- 所有命中过 grep `listOutput|OutputFeature|outputFeatures|readChecklist|patchChecklistItem|output-service|OutputChecklist|OutputView|ChecklistDoc|refreshOutput|ChecklistEditor|'output'|"output"|/api/projects/[^/]+/output` 的文件

---

## 多模型 Plan 会审

> 跳过：外部工具均不可用。Codex 实际为 401 认证失败后由 Claude 兜底产出评审清单（10 条建议，已采纳：内联 readdir / projectdocs 命名 / 后端裸文件名 / 字面量 grep / ENOENT 显式 try-catch / openFile 不传 kind）；Gemini CLI 未安装（`spawn gemini ENOENT`）。按 CLAUDE.md「外部工具失败重试一次仍失败则回退 Claude 单写 + plan.md 记一行原因，不阻塞 plan 交付」处理。
> [Claude 单独综合主笔] 在 Claude 调研草案基础上吸收 Codex 兜底评审的 10 条修正，独立写出本文，无三方协作痕迹可记。
> [Claude 白话化兜底] 大哥摘要从工程描述改写成 5 行白话；术语 markdown / FilePreview / ActivityBar 首次出现已括号或上下文翻译；按 manual.md 2026-04-30 偏好把"用户感知差异"写在最前。
