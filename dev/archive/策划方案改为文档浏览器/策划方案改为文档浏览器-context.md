# 策划方案改为文档浏览器 · Context

## 关键文件清单（边界）

**创建**：
- `packages/server/src/routes/docs.ts` — 新路由 GET `/api/projects/:id/docs`
- `packages/web/src/components/sidebar/ProjectDocsView.tsx` — 新侧栏组件（注意不叫 DocsView，避让 workflow 已存在的 `sidebar/DocsView.tsx`）

**编辑**：
- `packages/server/src/index.ts` — line 36 import + line 174 register；改 output → docs
- `packages/web/src/types.ts` — 700–773 行：删 Output*/Checklist* 系列；加 DocFile/DocListResult
- `packages/web/src/api.ts` — 734–762 行：删 listOutput/getChecklist/patchChecklistItem；加 listDocs
- `packages/web/src/store.ts` — line 45 Activity union（'output' → 'projectdocs'）；239–256 + 实现段：删 checklist 字段族；outputFeatures/refreshOutput 改名 docs/refreshDocs
- `packages/web/src/components/editor/EditorArea.tsx` — line 17 删 ChecklistEditor lazy；line 348–353 删 kind='checklist' 三元分支；line 379 删 extractFeature 函数
- `packages/web/src/components/layout/ActivityBar.tsx` — line 42 改 id/icon/label
- `packages/web/src/components/layout/PrimarySidebar.tsx` — line 13 OutputView import → ProjectDocsView；line 23 STATIC_TITLES output → projectdocs；line 87–89 case 'output' → 'projectdocs'

**删除**：
- `packages/server/src/routes/output.ts`
- `packages/server/src/output-service.ts`
- `packages/web/src/components/sidebar/OutputView.tsx`
- `packages/web/src/components/editor/ChecklistEditor.tsx`

**不动**：
- `packages/server/src/db.ts`（已有未提交改动，与本任务无关）
- 用户磁盘上的 `output/示例功能/v0.md` 等文件本身
- `sidebar/DocsView.tsx`（workflow 用）

## 决策记录

1. **组件命名**：新组件叫 `ProjectDocsView`（不叫 `DocsView`）。原因：`sidebar/DocsView.tsx` 是 workflow（Dev Docs）已占名。Activity id 同步用 `projectdocs`，命名对齐。
2. **后端 readdir 内联**：不复用老的 `output-service.ts`。原因：老 service 核心是 checklist.json 解析，对新需求毫无复用价值。直接在新 route 里 `fs.readdir` 一次完事（< 15 行）。
3. **store 字段原地改名**：`outputFeatures → docs`、`refreshOutput → refreshDocs`、`outputLoading/outputError → docsLoading/docsError`。IDE 全局 rename，配合 grep 字面量验证。同时直接砍 `checklists/refreshChecklist/patchChecklistItem` 等 checklist 字段族。
4. **路径拼接约定**：后端返回裸文件名（`{ name: 'guide.md' }`），前端 `openFile({ path: 'docs/' + name })`。避免双重 `docs/docs/`。
5. **openFile 不传 kind**：ProjectDocsView 点击 md 走 FilePreview 默认 md 渲染（FilePreview 已支持 markdown）。
6. **ENOENT/ENOTDIR 静默**：后端 try/catch ENOENT/ENOTDIR，返回 `{ docs: [] }`，HTTP 200。前端空态文案 "项目根下没有 `docs/` 文件夹"。
7. **破坏性变更协议**：每个删除步骤的 verify 必须含 grep 残留验证（函数名 + 路径字符串 + selector 字面量三类）。
8. **删 extractFeature**：EditorArea.tsx:379 的 `extractFeature` 函数只服务 ChecklistEditor，本任务一起删（自己引入的孤儿要清掉的逆操作 — 本次让它成为孤儿，本次就该清）。

## 是否过度设计自检

- 没新增"以后可能用到"的字段（DocFile 只保留 name，不预留 size/mtime/path 等冗余字段）
- 没引入新的查询缓存层 / SWR 库
- 没做 watcher 自动刷新
- 没做搜索 / 全文 / 树形结构
- 没保留兼容性 shim（直接删 output 路由，不留 deprecated 标记）

## 依赖与约束

- TypeScript `tsc --noEmit` 必过（CLAUDE.md 静态类型硬规则）
- LogsView 操作日志：`logAction('docs', 'list', ...)`（前端） + `serverLog('info', 'docs', ...)`（后端）
- 交付前自派 `vibespace-browser-tester`（manual.md 2026-05-06）
- ActivityBar id `'projectdocs'` 不冲突 workflow `'docs'`
- Zustand selector 字面量访问 — grep `.outputFeatures` / `.outputLoading` / `.outputError` / `.refreshOutput` / `.checklists` / `.checklistsLoading` / `.checklistsError` / `.refreshChecklist` / `.patchChecklistItem`

## 相关记忆（auto.md / manual.md 已扫）

- `manual.md 2026-04-30` 大哥偏好：技术选择 AI 自决、术语翻译——本任务的"用 ProjectDocsView 而非 DocsView"等命名决策已自决落 context，不打扰大哥
- `manual.md 2026-05-06` 大哥偏好：交付前自派 tester
- `auto.md 2026-05-02 项目工作流统一装配`：删 API 但前端还在调 → 用 grep verify 兜底
- `auto.md 2026-05-02 项目切换卡顿优化`：小范围缓存复用 store，不引新库——本任务延续该原则
- `dev/archive/策划方案清单`：本任务前身，废弃方向已经确认
