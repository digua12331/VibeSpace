# 策划方案清单 · Context

## 关键文件（= 本次改动边界）

原则：除此之外的文件不动；真要越界，回头补这份清单。

### 新增文件

- `packages/server/src/output-service.ts`
  - `listOutput(projectPath)`：扫 `<project>/output/` 下一级目录，返回 `{ features: Array<{ name, files: string[] }> }`；`output/` 不存在时返回 `{ features: [] }`，不 throw。
  - `readChecklist(projectPath, feature)`：读 `output/<feature>/checklist.json`，`JSON.parse` 失败抛 `OutputServiceError('invalid_json')`，文件不存在抛 `('not_found')`。
  - `patchChecklistItem(projectPath, feature, sectionId, itemId, patch)`：读 → 在 `sections[].items[]` 里按 id 找到一条 → 浅合并 `patch` 字段 → 原子写（临时文件 + `rename`）。非法 id 抛 `('item_not_found')`。
  - `OutputServiceError` 仿 `DocsServiceError`（`code` + `httpStatus` + `message`）。
  - 路径防护：所有 `feature` 参数先走本文件内的 `safeFeatureName`（仅允许不含 `/ \ : * ? " < > |` 的单段名字），拼接前 `path.resolve` 再校验 `startsWith(outputRoot + sep)`。
- `packages/server/src/routes/output.ts`
  - `GET /api/projects/:id/output`
  - `GET /api/projects/:id/output/:feature/checklist`
  - `PATCH /api/projects/:id/output/:feature/checklist`
  - PATCH body 形态见下面"PATCH 体形态"。
- `packages/web/src/components/sidebar/OutputView.tsx`
  - 仿 `DocsView` 的视觉和交互（`fluent-btn`、缩进、hover、顶部标题 + 刷新按钮）。两级树：功能名 → 文件列表。
  - 只管状态 + 渲染；fetch 通过 store action。
  - 文件 click 分发：文件名 === `checklist.json` → 打开清单编辑 Tab；其它 → 走 `openFile` 普通预览。
- `packages/web/src/components/editor/ChecklistEditor.tsx`
  - Props：`{ projectId, feature }`。
  - 挂载时读 checklist；按 `sections[]` 渲染折叠分区；每个 item 一张卡片，decision / risk 两种布局。
  - 底部状态工具条：decision 类选 "采纳推荐 / 选备选之一 / 自定义" 三选一；risk 类切 "pending / locked / modified"。
  - 点选后立即 PATCH，成功后用返回的新 checklist 全量替换 store 缓存（non-optimistic，错误弹 toast）。

### 改动的现有文件

- `packages/web/src/types.ts`
  - 新增 `ChecklistStatus`、`ChecklistDecisionItem`、`ChecklistRiskItem`、`ChecklistItem`、`ChecklistSection`、`ChecklistDoc`、`OutputFeature`、`OutputListResult` 类型（结构对齐用户给的 JSON schema）。
- `packages/web/src/store.ts`
  - `Activity` union 加 `'output'`（第 31 行）。
  - `EditorTab` 加可选字段 `kind?: 'file' | 'checklist'`（第 33-43 行），`file` 为缺省值。`openFile` 接纳 `kind`，不改 key 算法（避免 key 碰撞重开）。
  - 新增状态与 action：
    - `outputFeatures: Record<projectId, OutputFeature[]>`
    - `outputLoading / outputError`
    - `checklists: Record<'<pid>::<feature>', ChecklistDoc>`
    - `checklistsLoading / checklistsError`
    - `refreshOutput(projectId)`
    - `refreshChecklist(projectId, feature)`
    - `patchChecklistItem(projectId, feature, sectionId, itemId, patch)`
- `packages/web/src/api.ts`
  - `listOutput(projectId)`、`readChecklist(projectId, feature)`、`patchChecklistItem(...)` 三个新函数，复用 `request<T>` 和既有错误翻译。
- `packages/web/src/components/layout/ActivityBar.tsx`（第 23-40 行的 `items`）
  - 在 `files` 和 `scm` 之间插入 `{ id: 'output', icon: '📐', label: '策划方案' }`。emoji 选 📐（尺子/规划），和现有六个不撞。
- `packages/web/src/components/layout/PrimarySidebar.tsx`
  - `TITLES` 加 `output: '策划方案'`；`switch` 加 `case 'output': body = <OutputView />`。
- `packages/web/src/components/editor/EditorArea.tsx`
  - 渲染 tab 内容的那一行（现在是 `<FilePreview ...>`）加一段三元：`tab.kind === 'checklist' ? <ChecklistEditor projectId={tab.projectId} feature={extractFeature(tab.path)} /> : <FilePreview ... />`。`extractFeature` 就是 `tab.path` 去掉 `output/` 前缀和 `/checklist.json` 后缀的中间段，内联写，不抽 util。
- `packages/server/src/index.ts`
  - 引入并注册 `registerOutputRoutes(app)`（照 `registerDocsRoutes` 的位置、风格）。

**未改动但会读到的文件**（仅为熟悉模式）：`packages/server/src/routes/docs.ts`、`packages/server/src/docs-service.ts`、`packages/web/src/components/sidebar/DocsView.tsx`。

## 决策记录

逐条自问"资深工程师会觉得过度设计吗？"过一遍，过不了就砍到过为止。

### D1. 清单 Tab 走 `openFile` 单槽、加 `kind` 字段区分渲染

- 采用：扩展现有 `EditorTab` 加 `kind?: 'file' | 'checklist'`，`openFile` 把它一起塞进 tab；`EditorArea` 内部根据 kind 分发到 `FilePreview` 或 `ChecklistEditor`。
- 备选：新开一个独立的 `openChecklist` action + 另一个 tab 数组（双槽）。
- 为什么不选备选：双槽要改 `closeFile` / `setActiveFile` / `activeTabKind` / persist 逻辑一大圈，为了支持一个"清单和普通文件并存"的场景 —— 用户没要。现有单槽的行为（点新文件替换旧预览 Tab）也可以直接应用到清单上：点另一个文件就替换清单，点另一个清单就替换这个清单。这一致且够用。
- 资深工程师审视：单槽复用 ✓ 不过度设计。

### D2. PATCH 用"单 item 字段合并"而非"整份 doc If-Match 替换"

- 采用：PATCH body 形态 `{ sectionId: string, itemId: string, patch: Partial<ChecklistItem> }`，服务端读文件 → 浅合并对应 item → 原子写回全文。
- 备选：客户端带 etag/mtime，PUT 整份 doc，冲突时 412。
- 为什么不选备选：本项目单用户，没有并发编辑。If-Match 引入的 mtime 泄漏 / 时钟不齐 / 412 回退交互，属于没人要的"灵活性"。
- 资深工程师审视：单用户本地工具，不做乐观锁 ✓。

### D3. 编辑写回不做前端 optimistic update

- 采用：点按钮 → `PATCH` → 服务端返回新 checklist → 直接用响应替换 store 里的副本；期间按钮 disabled 显示 "…"。
- 备选：optimistic 先改本地、失败回滚。
- 为什么不选备选：本地 Fastify 响应时间 <50ms，optimistic 省的延迟没法感知；回滚逻辑会加一堆状态机。
- 资深工程师审视：延迟短不做 optimistic ✓。

### D4. 非法 / 格式不符的 checklist.json 走"兜底块"而非异常提示

- 采用：`ChecklistEditor` 读到 `invalid_json` 或类型不匹配时，渲染一个灰底的"格式不识别"卡片，附 `openFile` 跳 raw JSON 的链接。
- 备选：alert 弹窗。
- 为什么不选备选：alert 打断流；raw JSON 跳转让用户直接能改。
- 资深工程师审视：正常的用户体验 ✓。

### D5. `output/` 不存在时后端返回空列表而非 404

- 采用：`listOutput` 在 `output/` 缺失时返回 `{ features: [] }`，200。
- 备选：404。
- 为什么不选备选：大多数项目刚创建时 `output/` 就是空的，不算"错误"；UI 也不需要两条分支。
- 资深工程师审视：约定胜于报错 ✓。

### D6. ActivityBar 图标选 emoji 📐

- 现有六个：📁（文件）🌿（scm）📝（docs）📊（perf）📋（logs）🔔（inbox）。
- 候选：📐 🧩 🗂️ 📦。
  - 🗂️ 和 📁 太像 —— 弃。
  - 📦 会和归档按钮里的 📦 emoji 冲突（`DocsView.tsx` 里用在"归档"上）—— 弃。
  - 🧩 有点"拼图、插件"语义，不贴"策划方案" —— 弱。
  - 📐 有"规划 / 尺度"语义，且形状和现有六个都不撞。选 📐。

## 依赖与约束

### PATCH 体形态

```jsonc
// 请求
PATCH /api/projects/:id/output/:feature/checklist
{
  "sectionId": "A",
  "itemId": "A1",
  "patch": {
    "status": "locked",
    "userChoice": "recommend"   // 由前端写入的自由字段，保存在同一 item 对象上
  }
}

// 响应：刚写完的完整 checklist doc
{
  "feature": "...",
  "version": 1,
  "sections": [ ... ]
}
```

前端对用户选择的三态约定（写进 item 上，不扩 schema 顶层）：

- "采纳推荐" → `{ status: 'locked', userChoice: 'recommend' }`
- "选备选 N" → `{ status: 'modified', userChoice: `alt:${N}` }`（N 为 0-indexed）
- "自定义" → `{ status: 'modified', userChoice: 'custom', userAnswer: '<文本>' }`
- Risk 类：`{ status: 'locked' | 'modified' | 'pending' }`，无 userChoice 字段。

这些字段不存在于用户给的 schema 里，但 schema 没禁止扩展字段 → 直接加到 item 对象上。**读取侧兼容**：item 没有 userChoice 时按 "pending / recommend 待选" 渲染。

### 路径安全

- `:feature` 路径参数：在 `output-service` 里用 `safeFeatureName(name)` 校验，拒绝空串、拒绝含 `/ \ : * ? " < > |`、拒绝 `.` / `..`。
- 拼路径用 `path.resolve`，然后断言 `resolved.startsWith(outputRoot + sep)`，两层防 `../..`。

### 类型检查

实现阶段每步结束必跑的命令（具体以 `package.json` 脚本为准，tasks 阶段里每步的 verify 都要落到这些命令之一）：

- `pnpm -C packages/web typecheck`（或 `build`，看 scripts 存在哪个）
- `pnpm -C packages/server typecheck`（同上）

### 不在边界内的事（来自 plan 的 Non-Goals，这里重申防越界）

- 不做功能目录 CRUD（只展示）。
- 不做 `v0.md` 生成 / 锁定联动。
- 不做多清单并存（`output/<feature>/` 下多个 `*.json` 只认 `checklist.json`）。
- 不做 version/协同/锁。

---

**请确认**：关键文件清单、PATCH body 形态、item 上扩 `userChoice`/`userAnswer` 字段的约定，以及 📐 图标选择。确认后进入 Tasks 阶段。
