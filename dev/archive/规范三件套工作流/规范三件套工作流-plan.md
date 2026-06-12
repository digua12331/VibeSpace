# 规范三件套工作流 · Plan

## 大哥摘要

要做的事：在你打开"项目权限抽屉 → 工作流"那个**下拉**里，多加一个选项叫**「规范三件套（OpenSpec + Superpowers + gstack）」**。你**点它**就等于一键把三样东西都装上：OpenSpec（一种比 Dev Docs 更偏"提案先行"的开发流程脚手架）、Superpowers（CLAUDE.md 里追加的一段"7 步流程"提示）、gstack（一组装在你电脑全局的 Claude 插件，提供 /browse、/qa、/ship 等命令）。

切到这个选项时**自动卸掉**当前项目正在用的旧工作流（Dev Docs 或单独的 OpenSpec），让项目从"混着用"回到只装一套。**切回别的工作流时 gstack 不会被卸**——因为 gstack 装在你**整台电脑**上（不是单个项目里），其他项目可能还在用，强卸会误伤。

验收在哪点：打开**"项目权限"抽屉 → "工作流"tab** → 在下拉里能看到「规范三件套」这一项 → 选它点"应用"按钮 → 顶部状态栏会从一行"Dev Docs / OpenSpec / 无 + Superpowers 启用/未启用"变成**三个并排的小标记**：「OpenSpec ✓ / Superpowers ✓ / gstack ✓（或✗ 未安装）」，让你一眼看清楚三件套的状态。

会不会动到你现有的数据：**不会**。OpenSpec 已写的内容（`openspec/changes/<提案名>` 文件夹里的提案文档）切走时**保留**；Superpowers 段是 CLAUDE.md 末尾的引导文本，切走时**只撤这一段**，不动你自己写的 CLAUDE.md 主体；gstack 安装目录（`~/.claude/skills/gstack`）**不会被动**。

---

## 目标

让 VibeSpace 项目的"工作流"下拉新增一个**预设套餐 `spec-trio`**，与现有 `dev-docs` / `openspec` 并列。选它 = 强制带 Superpowers + 标记需要 gstack。

**验收标准（可观察 / 可执行 / 可断言）**：

1. **后端类型检查通过**：`pnpm -F @aimon/server build`（或 `pnpm typecheck`）一次通过。
2. **前端构建通过**：`pnpm -F @aimon/web build` 一次通过（项目无独立 typecheck script，build 包含 tsc，参见 auto.md 2026-05-02 / 终端方向键直通PTY 第 4 条）。
3. **浏览器可观察**（必须，每条都得能在 PermissionsDrawer.tsx 里点出来）：
   - 打开**项目权限抽屉 → 工作流 tab**，下拉里能看到「规范三件套（OpenSpec + Superpowers + gstack）」选项
   - 选「规范三件套」点"应用 / 切换"按钮 → 出现确认弹窗（若有旧工作流）→ 确认 → 顶部状态栏切成三个并排标记「OpenSpec / Superpowers / gstack」
   - **gstack 标记的颜色**根据 `getGstackStatus().installed` 实时反映：已装绿色「gstack ✓」，未装琥珀色「gstack ⚠ 未安装」并旁边一个小按钮"去 Tools 装"切换抽屉 tab 到 Tools
   - 从「规范三件套」切回「Dev Docs」：确认弹窗里**列出会卸什么**（OpenSpec 脚手架 + Superpowers 段 + Harness 文件夹）；点确认后顶部状态栏恢复 dev-docs，**`~/.claude/skills/gstack` 目录用 ls 检查仍存在**
   - 从「无」切到「规范三件套」时，若 gstack **未装**：apply 返回 207 partial，UI 弹"工作流已应用，但 gstack 未装"提示并显示去 Tools 的按钮，**不阻塞** openspec + Superpowers 的装配
4. **操作日志验收**：
   - 在 LogsView 看到 `scope=project action=apply-workflow` 起止配对，`meta.mode='spec-trio'`，meta 里有 `gstackInstalled: boolean`
   - 切回时看到 `scope=project action=remove-workflow` 起止配对，`meta.mode='spec-trio'`
   - 故意把 `~/.claude/skills/gstack` 重命名后切到 spec-trio：LogsView 看到 partial 失败分支日志（ERROR 一条）
5. **db 持久化**：apply spec-trio 成功后 `projects.json` 里目标项目 `workflowMode === 'spec-trio'`；remove 后清空为 `null`。

---

## 非目标（本次不做）

- **不自动安装 gstack**——gstack 是机器级且 install 是几分钟级的异步重操作，apply-workflow 路由内 await 会超时。本次只**检测** gstack 是否已装；未装时让用户去 Tools tab 单独装。
- **不卸 gstack 二进制**——切走 spec-trio 时 `~/.claude/skills/gstack` 目录原样不动（gstack 跨项目，强卸会误伤别的项目；用户已在前置问答确认）。
- **不改 gstack-installer.ts 路由 / 状态接口**——gstack 维持机器级 `/api/external-tools/gstack/*` 路由，与项目工作流系统正交。
- **不引入 manifest / tag / badge 数据系统**——本次只在 4 个现成 mode 字面量上加一项，不为"可扩展套餐"做泛化基础设施。
- **不动 Dev Docs / 原 OpenSpec 单选项的现有行为**——它们维持当前装配/卸载逻辑不变。
- **不动 Harness 装配行为**——spec-trio 模式下 Harness 仍按"始终装"语义自动装。
- **不引入"项目级 gstack 启用标记"额外字段**——直接用 `workflowMode === 'spec-trio'` 这一个真源承载语义。

---

## 实施步骤

### 步骤 1 · 后端：`WorkflowMode` 枚举扩展（`packages/server/src/db.ts`）

把 `WorkflowMode = "dev-docs" | "openspec"` 改成 `"dev-docs" | "openspec" | "spec-trio"`。无需改 SQLite schema（workflowMode 存 projects.json，非 SQLite 字段，参见 db.ts:263 注释）。

**如何验证**：grep `WorkflowMode` 全仓库引用点（应该都是 type-only 引用），运行 `pnpm -F @aimon/server build` 通过。

### 步骤 2 · 后端：apply 分支（`packages/server/src/workflow-service.ts`）

`applyWorkflowToProject` 加 `mode === "spec-trio"` 分支。**复用 openspec 装配 + 强制 superpowers**，不复制代码：

- Step1 调 `applyOpenSpecTemplate(projectPath)` —— 与 openspec 分支完全相同
- Step1 成功后**强制**追加 Superpowers anchor —— 不管 opts.superpowers 传什么都装，spec-trio 是预设套餐
- Step2 Harness 与现有逻辑一致（始终装）
- Step3 **新增**：调 `getGstackStatus()` 拿 `installed` 字段，结果塞进 `WorkflowApplyResult.gstack = { installed }`
- partial 判定：`installed === false` 也算 partial（让前端能弹"gstack 未装"提示）

`WorkflowApplyResult` 接口加 `gstack: null | { installed: boolean }` 字段（null 表非 spec-trio 模式，与 devDocs/openspec 的"按 mode 分支才有值"语义一致）。

`WorkflowApplyOptions.mode` 类型同步放宽到 `WorkflowMode`。

**如何验证**：单元手测—— `applyWorkflowToProject('/tmp/X', { mode: 'spec-trio' })` 返回的 result 里 openspec 段已应用、superpowers 段已写、gstack 字段 `{ installed: true/false }`，partial 反映 gstack 装态。

### 步骤 3 · 后端：remove 分支（同文件）

`removeWorkflowFromProject` 加 `mode === "spec-trio"` 分支：

- 先卸 Harness（与现有顺序一致）
- 卸 OpenSpec scaffold（调 `uninstallOpenSpecTemplate`）
- 卸 Superpowers anchor（**强制卸**，因为 spec-trio 把它当作套餐一部分；不看 opts.superpowers）
- **不动 gstack 二进制**——只在返回结果里记 `gstack: { installed: <current> }`，不调 `uninstallGstack`

`WorkflowRemoveResult` 加 `gstack: null | { installed: boolean }` 字段。
`WorkflowRemoveOptions.mode` 类型同步放宽。

**如何验证**：手测—— `removeWorkflowFromProject('/tmp/X', { mode: 'spec-trio' })` 返回 openspec/superpowers 都已撤，`~/.claude/skills/gstack` 目录仍存在。

### 步骤 4 · 后端：status 分支与 `detectedMode` 策略（同文件）

`getWorkflowStatus` 改动：

- 新增 `gstack: { installed: boolean }` 字段（调 `getGstackStatus()` 取 installed）
- `detectedMode` 探测**按 Codex 评审采纳的方案改成 db 优先**：先看 projects.json 持久化的 `workflowMode`；若为 `'spec-trio'` 且 openspec 目录在 + superpowers anchor 在 → 返回 `'spec-trio'`；否则按现有"磁盘探测降级"逻辑（探测出 dev-docs 或 openspec）
- `applied` 聚合：spec-trio 模式下 `full = openspec.applied==='full' && superpowers.enabled && harness.installed===harness.total && gstack.installed`；任一缺失 = partial

由于 `getWorkflowStatus` 只接收 `projectPath` 不接收 projectId，需要把 db 字段读取下沉——**改成 `getWorkflowStatus(projectPath, persistedMode)` 两参**，调用方（projects.ts:344）从 `getProject(id)` 拿 `workflowMode` 传进来。

**如何验证**：把一个项目 projects.json 改成 `workflowMode: 'spec-trio'`，调 `/api/projects/:id/workflow-status` 返回 detectedMode='spec-trio'、gstack 字段就位。

### 步骤 5 · 后端：路由 zod schema（`packages/server/src/routes/projects.ts`）

`WorkflowOptionsSchema`（在文件顶部）把 `mode` 枚举从 `["dev-docs", "openspec"]` 扩到 `["dev-docs", "openspec", "spec-trio"]`。三个路由（POST / DELETE / GET）的请求体 schema 自动跟着改（共用 schema）。

apply / remove 路由内的"默认 mode" fallback 保持 `"dev-docs"` 不变（旧前端零参兼容）。

`updateProjectWorkflowMode(proj.id, mode)` 调用点不动（已能接受任意 WorkflowMode）。

**如何验证**：`curl -X POST -d '{"mode":"spec-trio"}'` 不再 400；传 `{"mode":"xxx"}` 仍 400。

### 步骤 6 · 前端：类型镜像（`packages/web/src/types.ts`）

`WorkflowMode = 'dev-docs' | 'openspec' | 'spec-trio'`。`WorkflowApplyResult` / `WorkflowRemoveResult` / `WorkflowStatus` 各加 `gstack: null | { installed: boolean }` 字段。`WorkflowApplyOptions` / `WorkflowRemoveOptions` 的 `mode` 类型自动随 WorkflowMode 扩展。

**如何验证**：`pnpm -F @aimon/web build` 通过。

### 步骤 7 · 前端：WorkflowTab 下拉新增选项（`packages/web/src/components/PermissionsDrawer.tsx:1031-1330`）

#### 7.1 下拉新增 option

在 select 里插入第 4 项：

```
<option value="spec-trio">规范三件套（OpenSpec + Superpowers + gstack）</option>
```

`WorkflowChoice` 类型自动跟着 `WorkflowMode` 扩展。

#### 7.2 切换逻辑增强（`applyWorkflowClick`）

切换时 DELETE 旧 mode 的 `body.mode` 字段要**用 `detectedMode` 实际值**（与现有逻辑一致），spec-trio → openspec 时传 `mode='spec-trio'`，openspec → spec-trio 时传 `mode='openspec'`，确保后端按对应分支卸载。

spec-trio 模式下 Superpowers 勾选框**禁用并强制勾上**（visual：勾上但不可点，旁边小字"规范三件套已包含 Superpowers"）。

#### 7.3 顶部状态栏改造（PermissionsDrawer.tsx:1243-1272 那段）

当 `detectedMode === 'spec-trio'` 时，"当前状态"行改成**三个并排小 chip**：

```
[ OpenSpec ✓ ]  [ Superpowers ✓ ]  [ gstack ✓ ]   或   [ gstack ⚠ 未安装 ]
                                                         ↑ 点击切到 Tools tab
```

- ✓ 绿色：openspec.applied==='full' / superpowers.enabled / gstack.installed
- ✗ 红色：对应 false
- ⚠ 琥珀色 + "去装"按钮：仅 gstack 未装时，按钮 onClick `setActiveTab('tools')`

当 `detectedMode` 不是 spec-trio 时，状态栏维持现有"模式 + 整体 + Superpowers"单行形态不变。

#### 7.4 partial 处理增强（`applyWorkflowClick` 内 207 分支）

`api.applyWorkflow()` 返回 result 后判断：
- 若 `result.partial && result.gstack && !result.gstack.installed` → 弹**专门的 gstack 未装提示**（不是通用 partial 失败提示），文案："工作流已应用。但 gstack 未装，请去 Tools tab 安装。" 提供"现在去装"按钮跳 tab。
- 其他 partial 维持现有 `alertDialog('部分应用失败，请查看 LogsView 日志')`。

#### 7.5 卸载确认文案（`removeAllClick`）

`detectedMode === 'spec-trio'` 时确认弹窗文案改成：
> 会撤销 OpenSpec 脚手架（保留 `openspec/changes` 已写内容） + Superpowers 段 + Harness 文件夹。**gstack 不会被卸**——它装在 `~/.claude/skills/gstack` 是机器级，其他项目可能还在用。

**如何验证**：浏览器手测三件套切换、状态栏 chip 渲染、gstack 未装时琥珀色 + 跳 tab。

### 步骤 8 · 前端：Docs 侧栏 fall-through（`packages/web/src/components/layout/ActivityBar.tsx` + `PrimarySidebar.tsx`）

ActivityBar 25-31 + PrimarySidebar 48-81 当前根据 `workflowMode` 渲染：
- `'dev-docs'` → DocsView
- `'openspec'` → OpenSpecView
- 其他 / null → 空

spec-trio 模式应**复用 OpenSpec 侧栏**（spec-trio 的核心规范就是 OpenSpec）。把两处的判断改成：

```ts
const isOpenSpecMode = workflowMode === 'openspec' || workflowMode === 'spec-trio'
```

TypeScript 编译期会强制覆盖所有新枚举的 case（exhaustive 检查）—— Codex 评审强调的点。

**如何验证**：在 spec-trio 项目里左侧 Activity Bar 显示 OpenSpec 图标，点开是 OpenSpecView（changes 列表）。

### 步骤 9 · 操作日志补充

`apply-workflow` 后端 serverLog 的 meta 加 `gstackInstalled: status.gstack?.installed ?? null`（成功和部分失败两条都加）。
`remove-workflow` 后端 serverLog 的 meta 同上。
前端 `logAction('project', 'apply-workflow', ...)` 的 ctx.meta 已经在传 `mode`，不用动；但前端 `applyWorkflowClick` 切到 spec-trio 时**额外 pushLog 一条**：`level=info scope=project msg='规范三件套切换：gstack 未装' meta={gstack:false}`（仅当未装），让 LogsView 能搜到此条提示历史。

**如何验证**：LogsView 看到 `apply-workflow 成功` 那条 meta 里有 `gstackInstalled` 字段。

### 步骤 10 · 类型检查 + 浏览器验收（必做交付前自检）

按 manual.md 2026-05-06 偏好，交付前 AI **自己**先派 `vibespace-browser-tester` 跑一遍验收清单（清单见步骤 1 验收第 3 项五条），有问题再汇总。

---

## 边界情况

1. **磁盘上有 openspec 目录 + superpowers anchor 但 db `workflowMode==='openspec'`**：detectedMode 按 db 优先返回 `'openspec'`，UI 状态栏维持现有单行形态，**不**误判成 spec-trio。这是"用户在 openspec 模式下手动勾了 Superpowers"的合法状态。
2. **磁盘上 spec-trio 三件套都装齐 + db `workflowMode==='spec-trio'`**：detectedMode 返回 `'spec-trio'`，UI 显示三 chip 全绿。
3. **db `workflowMode==='spec-trio'` 但磁盘 openspec 目录被用户手删**：detectedMode 仍按 db 返回 spec-trio，但 `applied='partial'`，状态栏 OpenSpec chip 显示 ✗ 红色——用户能看到不一致。
4. **gstack 已装但 bun setup 半失败**（git clone 完了 setup 失败）：`getGstackStatus().installed=true`（只看 .git 目录），但 skills 没链接好。本次**不引入更细粒度状态**，仍按 installed=true 处理；这种情况是 Tools tab 的责任，不归工作流管。
5. **用户切到 spec-trio 时 gstack 卡在安装中**：本次不感知"安装进行中"状态，调用瞬时 `getGstackStatus()` 返回什么就用什么。Tools tab 内的安装作业完成后下次 refresh 自然更新。
6. **极旧前端（用 fetch 不带 mode 字段）选了 spec-trio**：apply 路由零参 fallback mode='dev-docs'，行为退化为 dev-docs；不在本次兼容范围。
7. **OpenSpec 单装 + 用户单独勾 Superpowers 再切到 spec-trio**：切换逻辑发 DELETE `{mode:'openspec', superpowers:true}` → openspec 目录与 Superpowers anchor 都被卸 → POST `{mode:'spec-trio'}` → 又装回去。多走一个来回但状态正确。

---

## 风险与注意

- **detectedMode 数据源切换风险**：从"纯磁盘探测"改成"db 优先 + 磁盘兜底"。CLAUDE.md 提到过 manual.md 2026-05-01 / 新建项目极简化 第 1 条"已有锚点块的开关状态优先从文件内容实时读取，不要另加数据库字段制造双份状态"。本次破例理由：spec-trio 在磁盘上**物理无法**与"openspec + Superpowers"区分开，必须用 db 字段做语义层。改动只影响 detectedMode 一个字段，不引入新的双份状态——`workflowMode` 早就在 projects.json 持久化了，本次只是抬高它在 detectedMode 探测中的权重。这条要在 context.md 记录决策依据。
- **TypeScript exhaustive 检查**：加完 WorkflowMode 第三值后必须 grep `workflowMode === ` / `WorkflowMode` 所有引用点，确保没有遗漏 switch 分支或 `if/else` 链。前端 PrimarySidebar / ActivityBar / WorkflowTab 是已知改点；其他引用点 grep 时若发现仍需 fall-through 处理。
- **getWorkflowStatus 签名变更**：从 `(projectPath)` 改成 `(projectPath, persistedMode)`，会动到 `routes/projects.ts:344` 一处调用方。改完同时 typecheck。
- **apply-workflow 路由不做 install gstack 的边界**：apply 路由内**不能** await installGstack（几分钟级，HTTP 路由会超时）。本次明确只 detect 不 install。用户体感差异：选 spec-trio 时若 gstack 未装，apply 仍即时返回（partial），UI 显式提示"去 Tools 装"——这与 manual.md 2026-04-30 "把'做了什么'翻译成'用户看得见的变化'" 一致：用户看到的是即时反馈 + 一个明确按钮，而不是转圈卡几分钟。
- **207 partial 的前端识别**：现有 `request()` 不抛 207，前端必须显式判断 `result.partial`。Codex 评审强调点，已在步骤 7.4 覆盖。
- **db.ts 三段同步**：本次只加 `WorkflowMode` 字面量类型扩展，**不**动 schema/类型/CRUD 其他段；`workflowMode` 字段类型早已存在。只确保 type 一处改，引用点 grep 干净。
- **Codex 提议的"完全不加新枚举，纯用 flags 表达"已评估**：那个方案能省后端 zod / WorkflowMode 类型扩展、apply/remove 分支增加。**未采纳**理由：（1）db 持久化层无法区分"openspec mode 的两次启用"和"spec-trio 一次启用"——必须有一个真源记录用户意图，加 flag 字段反而是更大的 schema 变更；（2）下拉里的"独立选项"是用户明确诉求（前置问答 preview 已确认），UI 层选项与后端 mode 一一对应最不易出错。决策放 context.md。

---

## 多模型 Plan 会审

> [Gemini 评审] 跳过：本机未安装 `gemini` CLI（spawn ENOENT）。按 CLAUDE.md 规则失败一次不死循环重试，回退到 Claude 单独写 plan。
> [Codex 评审] 跳过：Codex CLI 自身 OpenAI API 401（密钥未配置或过期）。但 codex 子 agent 给出了基于事实包的高质量替代评审（详见对话历史），关键建议已采纳：
> - 「detectedMode 脆弱性 → db 持久化优先」→ 步骤 4 已采纳
> - 「apply 路由超时风险 → 不在路由内 install gstack，只检测」→ 非目标 + 步骤 2/7.4 已采纳
> - 「partial 207 前端识别陷阱」→ 步骤 7.4 已采纳
> - 「PermissionsDrawer 切换 hook 的 DELETE body.mode 字段」→ 步骤 7.2 已采纳
> - 「switch exhaustive grep 检查」→ 风险与注意第 2 条已采纳
> - 「zod 双端同步」→ 步骤 5+6 已分两步明确写出
> 替代评审强调的"不加新枚举改用 flags"方案已评估并在风险段记录未采纳理由。
> [Codex 综合主笔] 跳过（同上）。回退 Claude 单独综合 + 自审。综合时的取舍：保留 WorkflowMode 第三枚举值（用户感知一致性 + db 真源完整性），但 apply/remove 内部复用 openspec 子函数不复制实现；gstack 维持机器级独立、不在工作流路由内 install。
> [Claude 白话化兜底] 大哥摘要重写成 4 段白话；术语 anchor / scaffold / 207 / exhaustive 在第一次出现时括号翻译；步骤 7.3 给出 chip 视觉示意；步骤 10 强制要求自派 browser-tester（manual.md 2026-05-06 偏好）。
