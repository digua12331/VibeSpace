# AI开发三件套接入 · context

> 给 AI 自己用，大哥不审。施工边界、决策记录、依赖与约束。

## 关键文件（write_files 白名单的来源）

### 后端必读（参考形态）

| 文件 | 关注点 |
|---|---|
| `packages/server/src/db.ts:112-130, 200-210, 218-292, 297-310, 318-490` | schema migrate / 类型 / rowToProject / CRUD / 五处 SELECT 同步（ARCHITECTURE 3.2） |
| `packages/server/src/workflow-service.ts:1-249` | 现有 apply/remove/status 形态，partial 字段、devDocs+harness 双步流程 |
| `packages/server/src/harness-template-service.ts:1-100` | manifest 化文件拷贝、`existsSync` 跳过、apply/uninstall/status 三件套 |
| `packages/server/src/dev-docs-guidelines.ts` | DEV_DOCS_GUIDELINES + ISSUES_ARCHIVE_SECTION 字符串模板 |
| `packages/server/src/routes/projects.ts:137-277` | apply-workflow / remove-workflow / workflow-status 现有 API + 207 partial |
| `packages/server/src/routes/docs.ts` | docs CRUD 路由形态（仿写 openspec.ts 用） |
| `packages/server/src/docs-service.ts` | dev/active 三段式 + tasks.json 写入参考 |
| `packages/server/src/cli-installer.ts` | InstallJobManager / spawn 子进程模式（gstack 用 spawn 不复用 InstallJobManager 类，参考形态即可） |
| `packages/server/src/install-jobs.ts` | install job 数据结构 |
| `packages/server/src/index.ts:146-167` | 21 个 register*Routes 顺序注册位置 |
| `packages/server/src/log-bus.ts:84-119` | serverLog 用法、scope 取值约定 |
| `packages/server/src/cli-catalog.ts` | agent vs mcp-tool 分类（**仅参考分类思路**，gstack 不进 cli-catalog） |

### 后端写（新建）

| 新文件 | 职责 |
|---|---|
| `packages/server/src/openspec-template-service.ts` | apply/uninstall/status `openspec/{specs,changes,archive}/` + `openspec/AGENTS.md` |
| `packages/server/src/superpowers-guidelines.ts` | SUPERPOWERS_GUIDELINES 字符串常量 + appendSuperpowersGuidelines / removeSuperpowersGuidelines / getSuperpowersStatus |
| `packages/server/src/gstack-installer.ts` | install/update/uninstall/status，spawn git clone + bun setup，bun 检测、Windows symlink 兜底 |
| `packages/server/src/routes/openspec.ts` | OpenSpec changes CRUD（list / read / write / new / archive） |
| `packages/server/src/routes/external-tools.ts` | gstack 安装作业 API |

### 后端写（修改）

| 文件 | 改动点 |
|---|---|
| `packages/server/src/db.ts` | projects 表加 `workflow_mode TEXT NULL`：schema migrate / `Project` + `ProjectRow` 类型 / `rowToProject` / CRUD / 五处 SELECT |
| `packages/server/src/workflow-service.ts` | `applyWorkflowToProject(path, opts: { mode, superpowers })` / `removeWorkflowFromProject(path, opts)` / `getWorkflowStatus(path)` 返回结构加 `mode` `openspec` `superpowers` 子字段 |
| `packages/server/src/routes/projects.ts` | workflow API body 加 zod schema `{ mode?, superpowers? }`；status 返回扩展；db 写 mode 列 |
| `packages/server/src/index.ts` | 注册 `registerOpenspecRoutes` + `registerExternalToolsRoutes` |

### 前端必读（参考形态）

| 文件 | 关注点 |
|---|---|
| `packages/web/src/api.ts` | request 包装器、错误格式、所有 mutation 写法 |
| `packages/web/src/types.ts:192,208` | LogEntry / ClientMsg / ServerMsg 与 server 类型镜像约定 |
| `packages/web/src/components/sidebar/DocsView.tsx` | changes 列表 + 三件套 tab + markdown 编辑器（OpenSpecView 仿写） |
| `packages/web/src/components/dialog/NewProjectDialog.tsx` | 现有 Dev Docs 开关位置 + 表单提交 |
| `packages/web/src/components/PermissionsDrawer.tsx` | ButtonsTab / ClaudeTab / CodexTab 内联组件风格（auto.md 2026-05-02 经验） |
| `packages/web/src/components/layout/Workbench.tsx` 或 `ActivityBar.tsx` / `PrimarySidebar.tsx` | 侧栏 view 列表与渲染入口 |
| `packages/web/src/store.ts` | zustand 全局 state，currentProject、workflowMode |
| `packages/web/src/logs.ts:54` | `logAction(scope, action, fn, ctx)` 用法 |
| `packages/web/src/components/StatusBadge.tsx:4` | 配色字典模式（gstack 状态徽章仿写） |

### 前端写（新建）

| 新文件 | 职责 |
|---|---|
| `packages/web/src/components/sidebar/OpenSpecView.tsx` | OpenSpec changes 列表 + proposal/design/tasks 编辑（复用 DocsView 子组件） |

### 前端写（修改）

| 文件 | 改动点 |
|---|---|
| `packages/web/src/api.ts` | 加 openspec.* / externalTools.gstack.* 系列方法、workflow apply 接受新 body |
| `packages/web/src/types.ts` | Project 类型加 `workflowMode`、新增 OpenSpecChange / GstackStatus 类型 |
| `packages/web/src/components/dialog/NewProjectDialog.tsx` | "开发流程"下拉 + "启用 Superpowers" checkbox |
| `packages/web/src/components/PermissionsDrawer.tsx` | 新增"工具集" tab 内联组件（gstack 安装/状态/更新/卸载） |
| `packages/web/src/components/layout/Workbench.tsx`（或 `ActivityBar.tsx` / `PrimarySidebar.tsx`） | 按 `currentProject.workflowMode` 在 DocsView 与 OpenSpecView 之间互斥渲染 |
| `packages/web/src/store.ts` | currentProject.workflowMode 字段、setWorkflowMode action |

### 文档与记忆

| 文件 | 改动点 |
|---|---|
| `README.md` | 增加"项目工作流"章节 |
| `README.zh-CN.md` | 同步双语 |
| `dev/memory/manual.md` | 追加一条本次接入沉淀（Superpowers 浅集成边界、Windows symlink 兜底、三件正交关系） |

### 不动（明确边界）

- `packages/server/src/docs-service.ts` 行为不变
- `packages/server/src/review-runner.ts` 行为不变
- `dev/active/` 与 `dev/archive/` 已有内容不动
- `dev/memory/auto.md` 不手改（机器产出）
- `CLAUDE.md`（项目根）不加新规则
- `.claude/templates/` 本任务不新增预设（Codex 自审建议推迟）

---

## 决策记录

### D1 OpenSpec 自写骨架，不 spawn `openspec init` CLI

**选**：在 `openspec-template-service.ts` 里直接 `mkdir + writeFile` 出 `openspec/{specs,changes,archive}/` + `openspec/AGENTS.md`。
**否**：调用 `npx openspec init` 子进程。
**为什么**：OpenSpec schema 极简（双文件夹 + 三 markdown），自写比依赖外部 npm 全局包更稳。VibeSpace 用户机器**不应**被强制装 npm + openspec 才能用本功能。
**资深工程师视角**：合理。schema 升级跟不上的代价用一行注释 `// 参考 OpenSpec vX.Y schema, 升级时核对` 兜住。

### D2 阶段 1+3 合并：workflow-service 一次扩展两种新工作流

**选**：`applyWorkflowToProject(path, { mode: "dev-docs"|"openspec", superpowers: bool })` 一处方法搞定。
**否**：分两次改 workflow-service。
**为什么**：两者都是 apply/remove 文件 + 写 CLAUDE.md 段，结构一样，分两次改重复模式。
**资深工程师视角**：合理。

### D3 gstack 单独 service 文件，不塞进 cli-installer

**选**：新建 `gstack-installer.ts`。
**否**：扩展 `cli-installer.ts`。
**为什么**：cli-installer 专管 CLI agent 安装，gstack 是 Claude Code skill 集合，性质完全不同；强塞会污染分类，未来再加 mcp-tool / skill-pack / model 都要分。
**资深工程师视角**：合理。新增一个文件可接受。

### D4 互斥 sidebar 渲染由 Workbench 决定，不在 view 内部 if-else

**选**：`Workbench.tsx`（或同层渲染入口）按 `currentProject.workflowMode` 选择渲染 `<DocsView />` 或 `<OpenSpecView />`。
**否**：DocsView 和 OpenSpecView 都挂载，自行 `if (mode !== "X") return null`。
**为什么**：单一渲染源 + 切换不抖动 + Codex 自审风险点 2 的直接采纳。
**资深工程师视角**：合理。

### D5 `workflow_mode` 加 DB 列；`superpowers_enabled` 不加列，靠 anchor 探测

**选**：projects 表加 `workflow_mode TEXT NULL`；Superpowers 状态由 `getSuperpowersStatus(path)` 实时扫 CLAUDE.md 是否含锚点 `# Superpowers 7 步流程`。
**否**：两个都加列。
**为什么**：`workflow_mode` 是状态切换的强类型（影响 sidebar 渲染、必须快查）；Superpowers 状态本质就是文件内容，加列等于双份状态（auto.md 2026-05-01 "新建项目极简化与设置整合" 经验）。
**资深工程师视角**：合理。

### D6 gstack 路由独立 `/api/external-tools/*`，不挂 `/api/projects/:id/*`

**选**：`registerExternalToolsRoutes` 独立。
**否**：挂在 projects 命名空间下。
**为什么**：gstack 安装是机器级动作（写 `~/.claude/skills/gstack`），不属于任何单个项目（auto.md 2026-05-02 "技能市场二期" 经验）。
**资深工程师视角**：合理。

### D7 OpenSpec change 名复用 TaskNameSchema

**选**：`POST /openspec/changes` body `{ name }` 走 `TaskNameSchema`（中文必填、禁用字符校验）。
**否**：另写一份校验。
**为什么**：复用现有约束，与 Dev Docs 三段式 task 名一致体感。
**资深工程师视角**：合理。

### D8 OpenSpec archive 目录 `openspec/archive/<name>-<时间戳>/`，与 `dev/archive/` 完全分离

**选**：独立目录。
**否**：复用 `dev/archive`。
**为什么**：避免 review-runner.ts 自动评审误读（Codex 自审风险点 6）；规范变更与 Dev Docs 任务是两类对象。
**资深工程师视角**：合理。

### D9 Dev Docs 默认值不变：`workflow_mode` 默认 `"dev-docs"`，迁移时根据 CLAUDE.md anchor 回填

**选**：新建项目对话框默认选 Dev Docs；已有项目迁移时扫 CLAUDE.md 是否含 `# Dev Docs 工作流` 锚点，是则填 `"dev-docs"`，否则 `null`。
**否**：默认 `null`。
**为什么**：保持现有用户体验不变，已装 Dev Docs 的项目迁移后侧栏 tab 不消失。
**资深工程师视角**：合理。

### D10 `.claude/templates/` 不在本任务交付

**选**：本任务收尾时若结构稳定再追加；否则留给后续小任务。
**否**：本任务一并交付。
**为什么**：模板会随实现反复改（Codex 自审简化建议）。
**资深工程师视角**：合理。

### D11 `workflowMode` 跟 `layout` 同模式：只进 projects.json，不动 SQLite projects 表 schema

**选**：`Project.workflowMode?: "dev-docs" | "openspec" | null` 加在 TypeScript 类型；`loadProjectsJson` 解析时带它；新增 `updateProjectWorkflowMode(id, mode)` setter；SQLite projects 表 schema 不变。
**否**：跑 `addColumnIfMissing(db, "projects", "workflow_mode", "TEXT")`，五处 SELECT 同步加列。
**为什么**：projects.json 是真源（`db.ts:13` + `db.ts:79 syncProjectsTable` 注释），SQLite 是 sessions FK 的影子；现有 `layout` 业务字段就是只走 JSON 不进 SQLite——`workflowMode` 是相同性质的业务字段，没必要双源。少一次 schema 迁移、少一次 syncProjectsTable 改动。
**资深工程师视角**：合理。少做不必要的工作。
**对 tasks 的影响**：T01 的 verify 从"`.schema projects` 看到新列"改为"projects.json 反序列化后含 workflowMode 字段、setter 跑通"。

---

## 依赖与约束

### 上游（外部）

- **OpenSpec npm 包**（参考 schema）：双文件夹 `specs/` + `changes/`，每个 change 含 proposal.md / design.md / tasks.md。本任务**不依赖该包**，自写骨架。
- **Superpowers Claude Code 插件**：用户自己在 Claude Code 插件市场安装。VibeSpace 只往 CLAUDE.md 写引导提示。
- **gstack repo**：`https://github.com/garrytan/gstack.git`（**实施第一步先 git ls-remote 验证可达**，不可达停下来跟大哥确认）。依赖 bun（用户机器需自行安装）。

### 项目内约束（必须遵守）

- **ESM NodeNext**：相对 import 必须带 `.js` 后缀（auto.md 2026-05-02 使用量面板经验）
- **路径**：`os.homedir()` + `path.join`，不硬编码 Windows 路径或斜杠（auto.md 同上）
- **路径穿越**：`path.resolve()` 后校验最终路径仍在合法目录下（auto.md 2026-05-02 技能管理面板）
- **Windows symlink**：不依赖；若 gstack setup 创建 symlink 失败给告警，不自动绕过（auto.md 2026-05-02 同上）
- **db.ts 三段同步**：schema migrate / 类型 / CRUD（ARCHITECTURE 3.2）
- **db.ts 五处 SELECT 同步**：`db.ts:205, 433, 464, 474, 484`（ARCHITECTURE 3.2）
- **操作日志起止配对硬性**：所有 mutation 走 `serverLog` / `logAction`，scope 用小写单词，action 用动词
- **`reply.code(207).send(...)`**：partial 失败语义（auto.md 2026-05-01 工作流入口形态对齐）
- **zod safeParse**：路由 body 校验，错误返回 `{ error: 'invalid_body', detail: parsed.error.issues }`
- **错误码 snake_case**：`{ error: 'not_found', detail: '...' }`
- **类型镜像**：server `types/log.ts` ↔ web `types.ts` 手抄同步（ARCHITECTURE 4 末段）

### 跨平台

- Windows / macOS / Linux 三端兜底：bun 检测 / git 检测 / `~/.claude/skills/` 路径计算
- Windows 上 spawn 时，命令名加 `.cmd`/`.exe` 兜底（必要时）
- 子进程 ENOENT 必须捕获

### 测试边界

- 后端类型检查：`pnpm -F @aimon/server typecheck`
- 前端构建+类型检查：`pnpm -F @aimon/web build`（auto.md 2026-05-02 终端方向键直通PTY 经验：web 包没单独 typecheck）
- 浏览器验收：`vibespace-browser-tester` 跑 V1–V7（manual.md 2026-05-06 大哥偏好：交付前自派）

---

## 实施顺序的暗约束

1. **先 db.ts 改 schema 再改服务层**：迁移失败必须早暴露
2. **先后端跑通再动前端**：UI 在 API 没就位前没法验
3. **OpenSpec 与 gstack 可并行**：两者后端互不依赖
4. **Superpowers 是最浅的，最后做**：只有 CLAUDE.md 一段文本 + 一个 checkbox
5. **README 双语 + manual.md 沉淀放最后**：避免边写边返工
6. **每个阶段都要在浏览器里点过一次**才 mark done（manual.md 2026-05-06 大哥偏好）

---

## 已知陷阱（实施时必检）

- T1：`workflow_mode` 加列后，旧 SQLite 文件的迁移路径——确认 `addColumnIfMissing` 跑过（db.ts:112）
- T2：`workflow-service` 现有调用方传 `mode` 默认值——所有调用点要确认默认 `"dev-docs"` 行为不变
- T3：OpenSpec changes 列出时若用户手删某个 change 子目录里的 `proposal.md`，UI 怎么显示——边界情况 1 已写 `partial`
- T4：gstack git clone 完成但 bun setup 未跑——状态查询要区分"克隆完成 / setup 完成 / 未装"三态
- T5：CLAUDE.md 锚点写入——若用户先手写过同名标题，apply 检测到锚点存在直接 `no-op`，**不**附加
- T6：Workbench 渲染层切换时，旧 OpenSpec/DocsView 状态（编辑中的 markdown）不持久化——切换前给"未保存"提示
