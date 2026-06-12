# 工作流母版统一更新 · Context

## 关键文件（改动边界）

### 后端
- `packages/server/src/dev-docs-guidelines.ts`
  - `DEV_DOCS_GUIDELINES`（L15 起）：锚点行 `# Dev Docs 工作流` 下嵌版本戳 `<!-- dev-docs-workflow:v1 -->`。
  - 新增导出 `export const DEV_DOCS_VERSION = 1`。
- `packages/server/src/workflow-service.ts`
  - `appendToClaudeMd`（L64）：无需改（仍按锚点 no-op，新装自然带新戳）。
  - `getDevDocsStatus`（L159）：解析已装版本，返回加 `installedVersion`/`currentVersion`/`outdated`。
  - 新增 `updateDevDocsGuidelines(projectPath)`：就地块替换（锚点→下一 `\n---\n`），复用 `insertSectionBeforeSeparator`（L90）的块边界算法；**不复用** `removeDevDocsGuidelines`（L136，slice 到 EOF）。
  - `WorkflowStatus` 接口（L250）：`devDocs` 字段加 `installedVersion:number|null`、`currentVersion:number`、`outdated:boolean`。
  - 新增聚合 `updateWorkflowForProject(projectPath)` + `refreshAllOutdatedProjects()`（后者遍历 `listProjects()`）。
- `packages/server/src/routes/projects.ts`
  - 单项目更新：`/api/projects/:id/workflow`（L271 区）加 PATCH 动作或新增 `.../workflow/update`，serverLog 起止配对（scope=project action=update-workflow）。
- `packages/server/src/routes/workflow.ts`（**新建**）
  - 机器级 `/api/workflow/refresh-all`（POST）：调 `refreshAllOutdatedProjects()`，返回 `{updated:[], skipped:[]}`，serverLog 配对（scope=workflow action=refresh-all）。
  - 在 `packages/server/src/index.ts`（register*Routes 区，L22-51）加 `registerWorkflowRoutes`。
- `packages/server/src/db.ts`：只读 `listProjects()`（L366）取项目清单。

### 前端
- `packages/web/src/types.ts`：`WorkflowStatus`（L207）的 `devDocs`（L209）镜像同步加三字段。
- `packages/web/src/api.ts`：加 `updateProjectWorkflow(id)` + `refreshAllWorkflows()` 客户端函数。
- `packages/web/src/components/PermissionsDrawer.tsx`：workflow tab（WorkflowTab，~L1072）`devDocs.outdated` 时显示"可更新"徽章 + "更新到最新版"按钮（logAction 包，scope=docs/workflow action=update）；加"刷新所有项目"入口（logAction 包，action=refresh-all）。

## 决策记录

- **版本号用单调整数（v1, v2…）手动 bump，不用内容 hash**：hash 能自动检测变更但会让"未实质变更的格式微调"也触发全项目刷新，且无法表达"这次变更值不值得刷"。整数手动 bump 更可控、零依赖。资深工程师视角：不算过度设计——一个常量 + 一行注释约定。
- **更新走"就地块替换"而非"删了重装"**：删函数 slice 到 EOF 会误删 Dev Docs 段之后的 Superpowers 段（实测代码 L154）。块替换只动锚点→下一 `---` 之间，是唯一安全做法。
- **批量刷新挂独立 `/api/workflow/refresh-all`**：机器级能力（跨所有项目），不属单个项目，按记忆"全机器级能力挂独立 `/api/<feature>/*`"（auto.md 技能市场二期那条）。
- **无版本戳的老项目视为 v0**：installedVersion=null→outdated=true，可被刷新。覆盖历史半装项目（呼应记忆"装/卸整套配置要表达 partial、兼容旧项目"）。
- **只做 dev-docs 段，不碰 Superpowers/harness/openspec**：避免范围爆炸。Superpowers 是同构的另一锚点段，下一轮按同模式扩即可，本轮不抽公共框架（不做只用一次的抽象）。

## 依赖与约束

- `WorkflowStatus` 是前后端共享形状（server interface + web type 两份手抄镜像），加字段必须两处同步，否则前端 build 报类型缺失。
- 版本戳必须放在锚点 `# Dev Docs 工作流` 之后、不破坏 `existing.includes("# Dev Docs 工作流")` 锚点检测，也不破坏 `removeDevDocsGuidelines` 的 `\n\n---\n\n# Dev Docs 工作流` 前缀匹配（戳在标题下一行，前缀仍命中）。
- 块边界依赖目标 CLAUDE.md 的 Dev Docs 段以标准 `\n\n---\n\n` 分隔写入（装配产物都满足）；非标准手写格式识别不到 → 当未装处理，不误伤。
- mutation（单更新 + 批量刷新）按硬性规则前端 logAction + 后端 serverLog 双配对；批量刷新返回明细供 LogsView/UI 核对。
- 类型检查命令：`pnpm -F @aimon/server build`、`pnpm -F @aimon/web build`。
