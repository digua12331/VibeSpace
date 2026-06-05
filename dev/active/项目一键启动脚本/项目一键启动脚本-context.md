# 项目一键启动脚本 · Context（AI 自用）

## 关键文件（改动边界）

后端：
- `packages/server/src/db.ts`
  - `Project` interface（~264-273）：加 `startScript?: string | null`。
  - `loadProjectsJson`（51-78）：**必须**在 `.map` 重建 `base` 时把 `startScript` 透传回来，否则读 projects.json 会被丢弃（白名单式重建）。`saveProjectsJson` 整体序列化无需改。
  - 加 `updateProjectStartScript(id, script | null)`，紧跟 `updateProjectWorkflowMode`（~398）后，写法照抄。
  - `syncProjectsTable`/`rowToProject` 不动（影子表不存 startScript）。
- `packages/server/src/routes/projects.ts`
  - 顶部 import：`updateProjectStartScript` from db；`readdirSync` 补进 node:fs（已有 existsSync/statSync）；`isAbsolute, relative, sep` 补进 node:path（已有 join）。
  - `registerProjectRoutes` 内加 `GET /api/projects/:id/start-script` 和 `PUT /api/projects/:id/start-script`，放在 `/:id/skills` 之后、`DELETE /:id` 之前。
  - serverLog 约定：`set-start-script 开始` / `成功 (Nms)` / `失败: <reason>`（scope=project）。

前端：
- `packages/web/src/types.ts`：`Project` 加 `startScript?: string | null`。
- `packages/web/src/api.ts`：加 `getStartScript(projectId)` 和 `setStartScript(projectId, script|null)`（jsonInit('PUT',...)）。
- `packages/web/src/components/layout/ProjectsColumn.tsx`：
  - 项目行（251-295）加常驻 ▶ 按钮（放 🌿 之前），点击走 `onLaunch(p)`。
  - 右键菜单（304-423）加「🚀 设置启动脚本…」一项（删除项前）。
  - 新增 state `scriptDialogProject` / `launching`，底部挂 `<StartScriptDialog>`。
  - import `runBatFile` from '../runExecutable'、`StartScriptDialog`、type `Project`。
- `packages/web/src/components/StartScriptDialog.tsx`（新建）：选择/设置启动脚本弹窗，照 `NewProjectDialog.tsx` 的 overlay+fluent-acrylic 样式。

复用不改：`packages/web/src/components/runExecutable.ts::runBatFile`（起 cmd + sendInput `cd /d "<dir>" && "<file>"\r`，已带 logAction('fs','run-bat')）。

## 决策记录

- **存相对优先**：`startScript` 在项目目录内时存相对项目根的路径（forward-slash），目录外存绝对路径。理由：项目整体搬家时内部脚本仍能解析；外部脚本换机器失效可接受（失效自动回退弹窗）。不引入额外配置，资深工程师视角不算过度设计。
- **两个端点（GET resolve + PUT save）而非一个**：GET 负责「解析出要跑的绝对路径 + 列候选」一次返回；PUT 只管持久化。职责清晰，前端 ▶ 一次 GET 即可决定「直接跑」还是「弹窗」。不做 RESTful 洁癖拆更多。
- **只扫项目根一层找候选**：start.bat 惯例在根目录；递归全盘扫是过度设计且慢。
- **▶ 常驻而非 hover**：大哥诉求是「每次找麻烦」，常驻可见才解决问题；与 hover 的 🌿 形成主次。挤的话执行时退 hover（plan 已声明）。
- **不复用 file input 选文件**：浏览器拿不到文件绝对路径（安全限制），故用「列项目内 bat 候选 + 手敲路径兜底」，不上原生文件选择器。
- **run 路径不再加日志**：`runBatFile` 自带 `fs/run-bat` 起止日志；只给 `set-start-script` mutation 补前端 logAction + 后端 serverLog。

## 依赖与约束

- projects.json 是真源；SQLite projects 影子表只有 id/name/path/created_at，不碰。
- `runBatFile(projectId, absPath)` 要绝对路径，自己 cd 到 dir 再执行，已处理空格（引号包裹）。
- 前端无 node:path，join 用字符串拼 `${project.path}\\${rel}`；isAbsolute 用正则 `/^([a-zA-Z]:[\\/]|\\\\|\/)/`。
- 后端 PUT 校验：后缀 `.bat|.cmd` + 解析后 `existsSync`，否则 400。
- 顺手发现的无关 bug（不在本任务改，记 issues）：db.ts `isWorkflowMode` 只认 'dev-docs'|'openspec'，漏 'spec-trio'，会把 spec-trio 模式读回时降级成 null。
