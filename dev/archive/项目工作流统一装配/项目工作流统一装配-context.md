# 项目工作流统一装配 · 上下文

## 关键文件

### 后端

- `packages/server/src/harness-template-service.ts`（全量改动）
  - `getTemplateFiles()` line 71-125：动态发现 manifest，加 `.aimon/docs/*.md` 段
  - `uninstallHarnessTemplate()` line 229-261：末尾 `rmdir` 兜底列表 line 249 加 `.aimon/docs`，顺序保持叶子→根
  - 顶部注释 line 2-9 同步：把 "把 .aimon/skills + .claude/agents + dev/harness-*.md + 一份 CUSTOMIZE 拷到目标项目" 改成包含 `.aimon/docs/*.md`

- `packages/server/src/dev-docs-guidelines.ts`（不改实现，但要看清楚 export 的接口）
  - 现有 `applyDevDocsGuidelines(proj)`、`removeDevDocsGuidelines(proj)`、`getDevDocsStatus(proj)`（具体函数名以源码为准，本任务只调用，不改实现）

- `packages/server/src/workflow-service.ts`（**新建**）—— 聚合层
  - `applyWorkflowToProject(projectPath)`: 先 `applyDevDocsGuidelines` 再 `applyHarnessTemplate`，第一个失败 abort
  - `removeWorkflowFromProject(projectPath)`: 先 `uninstallHarnessTemplate` 再 `removeDevDocsGuidelines`（卸载顺序反向；先把文件清掉，再撤 CLAUDE.md 段）
  - `getWorkflowStatus(projectPath)`: 聚合 dev-docs 状态 + harness 状态，输出 `{ devDocs: {...}, harness: {...}, applied: 'none' | 'partial' | 'full' }`
  - 不引新依赖；只 import 上述两个 service 的现有 export

- `packages/server/src/routes/projects.ts`
  - **删除**：`POST /:id/apply-dev-docs` (line ~422)、`DELETE /:id/dev-docs` (line ~482)、`GET /:id/dev-docs-status` (line ~441)、`POST /:id/harness` apply 分支 (line ~245)、`DELETE /:id/harness` (line ~286)、`GET /:id/harness-status` (line ~337)、`GET /:id/harness-applied` (line ~354) 共 7 个端点
  - **新增**：`POST /:id/workflow`、`DELETE /:id/workflow`、`GET /:id/workflow-status` 共 3 个端点
  - 所有新端点用 `serverLog('project', 'apply-workflow' | 'remove-workflow' | 'workflow-status', ...)` 起止配对
  - import 段：移除 `applyHarnessTemplate / uninstallHarnessTemplate / getHarnessStatus / isHarnessApplied`、移除 `applyDevDocsGuidelines / removeDevDocsGuidelines / getDevDocsStatus`（如果它们是裸 import 的话，还得反查 `dev-docs-guidelines.ts` 真名）；改为只 import `workflow-service` 的 3 个新 export

### 前端

- `packages/web/src/api.ts`
  - **删除**：`applyHarness`、`removeHarness`、`applyDevDocsGuidelines`、`removeDevDocs`、`getDevDocsStatus`（line 100-160 范围内）以及对应类型 `HarnessApplyResult` / `HarnessUninstallResult`
  - **新增**：`applyWorkflow(projectId)` / `removeWorkflow(projectId)` / `getWorkflowStatus(projectId)` 三个函数，对应 `WorkflowApplyResult` / `WorkflowUninstallResult` / `WorkflowStatus` 类型
  - 类型应映射后端聚合返回结构，避免前端再做 shape 转换

- `packages/web/src/components/PermissionsDrawer.tsx`
  - 删 `enabled` / `harnessEnabled` 两个 state、删 `harnessApplying` / `harnessRemoving` / `loadError` / `harnessLoadError` 两套 state；改为 `workflowState: 'none' | 'partial' | 'full' | null`、`workflowBusy: boolean`、`workflowLoadError: string | null`
  - 删 `toggle()` / `applyHarnessClick()` / `removeHarnessClick()`，新增 `applyWorkflow()` / `removeWorkflow()` 一对 handler
  - JSX line 1166-1267 范围：两个 `<div className="rounded border ...">` 块合一；顶部说明文字（line 1167-1171）改成统一描述（"会写 CLAUDE.md 工作流段 + 拷 .aimon/.claude/dev 配置文件 + 两份说明书 docs 到目标项目"）；状态文字根据 `workflowState` 渲染"已应用 / 部分已应用 / 未应用"；按钮按状态切"应用 / 应用剩余 / 卸载"
  - 卸载按钮的 `confirmDialog` danger 二次确认保留
  - 状态加载 effect（line 1037-1054 附近）改成单次 `getWorkflowStatus`

- `packages/web/src/types.ts`
  - 跟随后端聚合返回结构加 3 个新 type：`WorkflowApplyResult` / `WorkflowUninstallResult` / `WorkflowStatus`
  - 删除 `HarnessApplyResult` / `HarnessUninstallResult` / `HarnessStatus`（如果定义在 types 里；如果只是 api.ts 内联，也一起删）

### 文档与配置

- `.gitignore` line 23-24：删两条 `!docs/...` 白名单
- `CLAUDE.md` 末尾"真源文档"表（在文件最后几行）：两条引用从 `docs/` 改 `.aimon/docs/`
- `docs/agent-harness-overview.md` → `.aimon/docs/agent-harness-overview.md`（git mv）；文件内 line 188-189 / 211 等自我引用同步改路径
- `docs/team-agent-harness-dev-docs-workflow.md` → `.aimon/docs/team-agent-harness-dev-docs-workflow.md`（git mv）；文件内自我引用同步

## 决策记录

### 决策 1：底层 API 合并而非 UI-only 合并

- 原 plan：保留两个底层 API，前端 UI 拼合。
- 主理人拍板：合并底层。
- 权衡：删 7 个端点 + 新增 3 个端点是一波较大改动，但前端只有 PermissionsDrawer 一个消费方，没有第二个调用点；保留旧端点违反 CLAUDE.md "不做没人要求的灵活性"。**资深工程师视角不会觉得过度设计**——反而觉得原 plan 留两套 API 才是过度设计。

### 决策 2：搬到 `.aimon/docs/`，保留原文件名

- 不改成中文文件名（"主理人入口.md" / "AI执行手册.md"），避免 CLAUDE.md 真源表里 5 处以上引用全部同步出错的风险。
- `.aimon/docs/` 目录天然不在 `.aimon/runtime/` 的 ignore 范围内（`.gitignore` 只 ignore 了 `.aimon/runtime/`，没有 ignore `.aimon/`），不需要新加白名单。

### 决策 3：service 层用新文件 `workflow-service.ts`，不在 `routes/projects.ts` 里现编

- 路由层应当薄；聚合逻辑（顺序调用、失败 abort、聚合状态）属于业务，放 service 层。
- 新文件而非塞进 `harness-template-service.ts`：harness 那个文件已经有明确语义（拷贝 .aimon/.claude 文件），不应该让它"知道"还有个 dev-docs 概念。

### 决策 4：UI 显示"部分已应用"状态而非自动补全

- 资深工程师视角：自动补全会让 apply 按钮的行为不可预测——有时拷文件，有时改 CLAUDE.md，有时两者都做。明确显示"部分已应用 (Dev Docs ✓ / Harness ✗)" + 按钮文字"应用剩余"才是诚实的 UI。

### 决策 5：失败不自动回滚

- 第一步成功、第二步失败时不回滚第一步——回滚逻辑会带来"成功后又被撤销"的隐式行为，调试更难。
- 改为返回 `partial: true` 让 UI 明确告诉用户"已经做了 A，B 失败了，可以重试"。重试 apply 时 A 已存在会被 skip（`existsSync` 短路），不会重复写入；最终一致性达到。

## 依赖与约束

- `applyDevDocsGuidelines` 与 `removeDevDocsGuidelines` 的具体接口（参数 / 返回值）未细看；写 service 时再看一次 `dev-docs-guidelines.ts` 确认。
- `applyHarnessTemplate` 当前返回 `{ copied, skipped, gitignoreAppended }`；`uninstallHarnessTemplate` 返回 `{ removedCount, skippedCount, failedFiles }`。聚合返回结构沿用这两个的字段，只在外层包一层。
- 前端 `logAction` 包装顺序：**外层**前端 `logAction('project', 'apply-workflow', fn)` 进 LogsView；**内层**后端 `serverLog('project', 'apply-workflow', ...)` 起止 + `serverLog('project', 'apply-workflow.dev-docs', ...)` / `serverLog('project', 'apply-workflow.harness', ...)` 子步骤起止落盘。LogsView 会同时看到外层和内层条目；这是有意的，方便排障。
- 类型检查命令：`pnpm --filter @aimon/server exec tsc -b`、`pnpm --filter @aimon/web exec tsc -b`。

## 任务边界

执行阶段原则上只动以下文件：

- `packages/server/src/harness-template-service.ts`
- `packages/server/src/workflow-service.ts`（**新建**）
- `packages/server/src/routes/projects.ts`
- `packages/web/src/api.ts`
- `packages/web/src/types.ts`
- `packages/web/src/components/PermissionsDrawer.tsx`
- `packages/web/src/components/sidebar/DocsView.tsx`（**执行阶段发现的溢出**：DocsView 顶部 ⚙ 按钮原本调 `applyDevDocsGuidelines` 单装 Dev Docs，旧 API 已删→必须改。按"融合为一个"精神删掉 ⚙ 按钮 + 删 `onApplyRules` / `applyingRules` state + 空状态提示文案改为指向权限抽屉。不改其它逻辑。）
- `.gitignore`
- `CLAUDE.md`
- `docs/agent-harness-overview.md` → `.aimon/docs/agent-harness-overview.md`（mv）
- `docs/team-agent-harness-dev-docs-workflow.md` → `.aimon/docs/team-agent-harness-dev-docs-workflow.md`（mv）

任何溢出（动 `dev-docs-guidelines.ts` 实现、动 `.aimon/skills/*`、动其它 routes 文件）必须先回头补 context。
