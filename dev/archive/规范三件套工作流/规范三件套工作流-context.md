# 规范三件套工作流 · Context

> AI 自用：执行阶段的关键文件边界、决策记录、依赖与约束。大哥不审；归档评审会读这一份产出 auto.md。

---

## 关键文件清单（本次改动边界）

### 后端（packages/server/src）

| 文件 | 改点 | 关键符号/行号 |
|---|---|---|
| `db.ts` | `WorkflowMode` 字面量类型加 `"spec-trio"` | `db.ts:254` |
| `workflow-service.ts` | apply/remove/status 三函数加 spec-trio 分支；`WorkflowApplyResult/RemoveResult/Status` 加 `gstack` 字段；`getWorkflowStatus` 改两参签名 `(projectPath, persistedMode)` | 整个文件 1-407 |
| `routes/projects.ts` | `WorkflowOptionsSchema.mode` 枚举扩 `"spec-trio"`；apply 路由内 `updateProjectWorkflowMode(proj.id, mode)` 已能接受任意 WorkflowMode；status 路由调用 `getWorkflowStatus(proj.path, proj.workflowMode ?? null)` | `projects.ts:50, 146, 247, 341` |
| `gstack-installer.ts` | **不动**——只 import `getGstackStatus` 取 installed | `gstack-installer.ts:108` |

### 前端（packages/web/src）

| 文件 | 改点 | 关键符号/行号 |
|---|---|---|
| `types.ts` | `WorkflowMode` 镜像；`WorkflowApplyResult/RemoveResult/Status` 加 `gstack` 字段 | `types.ts:77, 168, 189, 202` |
| `api.ts` | **不动**——签名都靠 type 自动放宽 | `api.ts:127-161` |
| `store.ts` | **不动**——`setWorkflowMode` 已接受 `WorkflowMode \| null` | `store.ts:285, 714-720` |
| `components/PermissionsDrawer.tsx` | WorkflowTab 1031-1330：下拉加 option；切换逻辑里 DELETE 用 detectedMode；status chip 三件套渲染；gstack 未装专门提示；卸载确认文案改 | `PermissionsDrawer.tsx:1031-1330`（**1080-1212 切换/卸载逻辑** + **1241-1272 状态栏**） |
| `components/NewProjectDialog.tsx` | 下拉加 `<option value="spec-trio">` —— 顺手加，让创建项目时也能选 spec-trio；不影响现有 dev-docs/openspec 流程 | `NewProjectDialog.tsx:7, 110-112` |
| `components/layout/ActivityBar.tsx` | docsItem 计算加 `spec-trio` case：复用 OpenSpec 图标（📜）和"规范"label | `ActivityBar.tsx:25-33` |
| `components/layout/PrimarySidebar.tsx` | docsTitle 和 docs activity body 渲染加 `spec-trio` case：复用 OpenSpecView | `PrimarySidebar.tsx:48-85` |

### 任务文档（dev/active/规范三件套工作流/）

| 文件 | 改点 |
|---|---|
| `规范三件套工作流-plan.md` | 已写（多模型协作回退记录在末尾） |
| `规范三件套工作流-context.md` | 本文件 |
| `规范三件套工作流-tasks.md` | 待写 |
| `规范三件套工作流-tasks.json` | 待写（机器可读副本） |

---

## 决策记录

### 决策 1：保留 `WorkflowMode` 第三枚举值，不改用 flags 表达

**选项 A（采纳）**：`WorkflowMode = 'dev-docs' | 'openspec' | 'spec-trio'`，db 字段直接持久化"用户意图"。
**选项 B（Codex 替代评审建议）**：维持 2 个 mode，把 spec-trio 表达成 `mode='openspec' + flags={superpowers:true, gstack:true}`。

**选 A 理由**：
1. **db 真源唯一性**：用户在 UI 下拉里看到的 4 个选项必须 1:1 映射到 db 字段，否则切换历史无法回溯——"上次用户到底选的是 openspec 还是 spec-trio"光看 mode 字段判断不了，必须再加 boolean，反而是更大的 schema 扩散。
2. **磁盘探测的对称性**：mode 字段是 detectedMode 的兜底语义层，新增 'spec-trio' 只让一处类型扩，引用点 grep 可控（9 个文件）；改成 flags 会让 `detectedMode: WorkflowMode | null` 接口语义模糊。
3. **下拉 UI 与后端 mode 1:1 对应是项目惯例**——`<option value="X">` 的 value 直接当 mode 发请求。新增 flags 字段会让前端 4 选 1 翻译成"mode + flags 合成"两次映射，多余复杂性。

代价：apply/remove/status 三函数各加一个 if 分支（约 30 行）；zod 枚举扩一项；前端 Tab 状态栏分支写两次。**全部都是 if/switch 形态，不引入新机制**。

### 决策 2：`detectedMode` 改为 db 字段优先

**原逻辑**（workflow-service.ts:385-388）：纯磁盘探测——dev-docs anchor 在 → 'dev-docs'；openspec 目录在 → 'openspec'；都没 → null。
**新逻辑**：先看 `persistedMode`（projects.json 持久化 workflowMode），若为 'spec-trio' 且 openspec 目录在 + Superpowers anchor 在 → 返回 'spec-trio'；否则按原磁盘探测降级到 dev-docs / openspec / null。

**理由**：spec-trio 在磁盘上**物理无法**与"openspec + 单独勾 Superpowers"区分（两者写入的文件完全相同）。必须有一处 db 字段承载用户的"我选了套餐"这个意图。

**为什么不违反 manual.md 2026-05-01 / 新建项目极简化 第 1 条"已有锚点块的开关状态优先从文件内容实时读取，不要另加数据库字段制造双份状态"**：
- 那条经验针对的是"开关状态可以从文件唯一推断"的场景（Dev Docs 段有/无 = enabled/disabled 一一对应）。
- 本次 spec-trio vs openspec+Superpowers 是**多对一映射**——多个用户意图对应同一磁盘状态，必须分离存储。
- 持久化字段（`workflowMode`）早已存在；本次只是抬高它在 detectedMode 探测中的权重，**没有引入新字段**。

代价：`getWorkflowStatus` 签名从 `(projectPath)` 改成 `(projectPath, persistedMode)`，单一调用点 `routes/projects.ts:344` 同步改。

### 决策 3：apply-workflow 路由**不在内部触发 gstack 安装**

`getGstackStatus()` 已经会做 `fs.existsSync(.git 目录)` + `spawn git rev-parse` 检测（gstack-installer.ts:108-124），**单次调用 < 1s**。但 `installGstack` 是 `git clone --depth 1 + bun ./setup`，几分钟级。

**采纳**：apply 内只调 `getGstackStatus()` 取 `installed` 字段；未装 → 标 `partial: true` + 返回 `gstack: { installed: false }`；前端识别后引导用户去 Tools tab 单独装。

**理由**：
1. Fastify 默认无超时但前端 fetch 通常超时（用户 perceived），转圈几分钟体验崩。
2. gstack install 有独立路由 `/api/external-tools/gstack/install` 已经做了 streamProcessLog 实时日志 + 8KB trailing。复用比塞进 apply-workflow 干净。
3. manual.md 2026-04-30 偏好："把'做了什么'翻译成'用户看得见的变化'"——用户看到的是即时反馈 + 一个明确按钮，不是黑盒等待。

### 决策 4：切走 spec-trio 时**不卸 gstack 二进制**

用户在前置问答 preview 明确确认。`removeWorkflowFromProject` 的 spec-trio 分支：
- 卸 Harness 文件（与现有顺序一致）
- 卸 OpenSpec scaffold
- 卸 Superpowers anchor（**强制卸**，不看 opts.superpowers——spec-trio 把它当套餐一部分）
- **不调** `uninstallGstack()`

副作用：spec-trio → dev-docs 切换后，`~/.claude/skills/gstack` 目录仍在。用户若想完全清理需去 Tools tab 单独点。在卸载确认弹窗文案里**明示这一点**。

### 决策 5：NewProjectDialog 顺手加 spec-trio 选项

plan 漏写。新建项目对话框（NewProjectDialog.tsx:103-117）也有"开发流程"下拉，调用同一 `applyWorkflow(projectId, opts)`。**加 spec-trio option 是 1 行改动**，不加会让用户体验断裂（必须"先建 dev-docs 项目 → 再去抽屉切 spec-trio"）。

代价小、收益清晰，加进 tasks 边界。

---

## 依赖与约束

### 后端契约
- `Project.workflowMode` 字段已存在（db.ts:264），存 projects.json 真源；本次只扩字面量类型，**不动 SQLite schema**（projects 影子表无 workflowMode 列）。
- `updateProjectWorkflowMode(id, mode|null)` 单字段写入早已支持任意 `WorkflowMode | null`，类型扩后自动兼容。
- 操作日志硬性：apply-workflow / remove-workflow 必须 serverLog 起止 + 前端 logAction 起止（dev/ARCHITECTURE.md §3.1）。新增 meta 字段 `gstackInstalled: boolean | null` 必须 ≤ 2KB JSON-serializable。
- Fastify 207 partial 仍是 2xx：前端 `request()` 不抛错，必须显式判断 `result.partial`（auto.md 2026-05-01 / 工作流入口形态对齐 第 4 条）。

### 前端契约
- `WorkflowMode` 必须双端同步——zod 枚举（server）和 type union（web）同步扩。
- TypeScript exhaustive：grep 9 个 `workflowMode` / `WorkflowMode` 引用点，**每处包含 switch / if/else** 都要加 spec-trio case。
- `aimon/web` 无独立 typecheck script，验收用 `pnpm -F @aimon/web build`（auto.md 2026-05-02 / 终端方向键直通PTY 第 4 条）。

### 兼容性
- 旧前端不带 mode 字段 → 后端 `opts.mode ?? "dev-docs"` 默认值不变。新前端切到 spec-trio 时必须**显式**发 `mode: "spec-trio"`。
- 项目数据迁移：现有 projects.json `workflowMode` 值不会自动变 spec-trio——这是 opt-in，用户必须主动点。
- Codex 评审强调点："spec-trio → openspec / dev-docs 切换时 DELETE body.mode 必须传 'spec-trio'"——后端 remove 分支按 mode 路由卸载逻辑，传错会卸错。已在 plan 步骤 7.2 写明。

### gstack 路径假设
- `getGstackStatus()` 探测 `~/.claude/skills/gstack/.git` 目录是否存在。Windows + macOS + Linux 均 `os.homedir()` 兼容（auto.md 2026-05-02 / 使用量面板 第 4 条）。
- `installed=true` 不区分 bun setup 是否完成——这是 Tools tab 责任域，工作流层只看是否克隆下来。

### 不引入的依赖
- 不引 npm 包；不引新 zustand store；不引新前端组件库。
- 不引入"工作流套餐 manifest"数据系统——本次只在 4 个字面量 mode 上做 if 分支。

---

## 与项目记忆的对齐（plan 阶段已扫）

- ✅ auto.md 2026-05-01 / 项目工作流统一装配 第 2 条「partial 状态后端 + UI 必须明确表达」→ plan 步骤 7.4 + 决策 3
- ✅ auto.md 2026-05-01 / 工作流入口形态对齐 第 4 条「207 partial 前端按正常返回值处理」→ plan 步骤 7.4
- ✅ auto.md 2026-05-01 / 项目工作流统一装配 第 1 条「合并/删除 API 前必须全仓库搜索调用点」→ context 第一节 9 文件清单（已 grep）
- ✅ auto.md 2026-05-02 / 终端方向键直通PTY 第 4 条「Web 包验收用 `pnpm -F @aimon/web build`」→ plan 步骤 10
- ✅ manual.md 2026-04-30 偏好「术语括号翻译 + 翻译成用户可见变化」→ plan 大哥摘要段
- ✅ manual.md 2026-05-06 偏好「交付前自派 browser-tester」→ plan 步骤 10 + tasks 最后一步
- ✅ ARCHITECTURE.md §3.1 操作日志规则 → plan 步骤 9
- ✅ ARCHITECTURE.md §3.2 db.ts 三段同步（本次只动类型段，不动 schema/CRUD）

---

## 资深工程师视角自审（CLAUDE.md 必答）

> "资深工程师看到这个方案，会不会觉得过度设计？"

- **不做用户没要的功能**：✅ 只在下拉加一项 + 改顶部状态栏；不加 manifest / tag / category / 工作流市场。
- **不做只用一次的抽象**：✅ 不抽 `applyWorkflowPreset()` 公共 helper；apply/remove/status 各加 if 分支直接复用 openspec 子函数。
- **不做没人要求的"灵活性"**：✅ spec-trio 是固定预设，不暴露"自定义套餐"配置入口。
- **不为不可能发生的场景写错误处理**：✅ gstack 半装（clone 完 setup 失败）不做细粒度状态——是 Tools tab 责任域。
- **200 行能解决的问题不写 500 行**：估算改动总量约 250 行（含后端 80 / 前端 170），无新文件。

通过。
