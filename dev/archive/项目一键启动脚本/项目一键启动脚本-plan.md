# 项目一键启动脚本 · Plan

## 大哥摘要（先看这段）

每个项目目录里你常放一个 `start.bat`（双击就能打开项目的批处理脚本），现在每次得自己去文件夹里翻、双击，很麻烦。这次给左边「项目列表」每个项目行加一个常驻的 **▶ 启动按钮**，点一下就自动找到该项目的 `start.bat` 并在一个新终端里立即跑起来——效果跟你手动双击那个 bat 完全一样。

如果某个项目目录里没有 `start.bat`，点 ▶ 会弹一个小窗，把这个项目文件夹里能找到的 `.bat`/`.cmd` 文件列出来让你点一个（找不到就让你直接粘一个 bat 的完整路径）；选好后**记住**，以后这个项目点 ▶ 就直接跑它，不用再选。想换成别的脚本，在项目上点右键有个「设置启动脚本…」可以重选或清空。

不会动你现有的任何项目、会话、看板数据；只是在每个项目的配置里多记一个「启动脚本路径」。

## 目标

让用户在项目列表里**点一个按钮**就能执行项目的启动 bat，免去手动翻文件夹双击。可验证的验收标准：

1. **浏览器可观察**：项目行出现一个 ▶ 按钮；点击一个根目录有 `start.bat` 的项目 → 新开一个终端 tab 并自动执行 `start.bat`（终端里能看到 bat 的输出），效果与手动双击一致。
2. **无 start.bat 走自定义**：点击一个根目录没有 `start.bat` 的项目 → 弹窗列出该项目目录里的 `.bat`/`.cmd` 文件；选一个 → 立即执行并记住；再次点 ▶ 直接执行同一个脚本不再弹窗。
3. **兜底**：项目里一个 bat 都没有时，弹窗给一个输入框，粘贴一个 bat 绝对路径也能跑。
4. **重配**：项目行右键菜单出现「设置启动脚本…」，可重新选择或清空已记住的脚本（清空后下次点 ▶ 回到「找 start.bat / 弹窗」逻辑）。
5. **操作日志**：在浏览器 LogsView 能看到 `scope=project action=set-start-script` 的起止配对（设置脚本时），以及已有的 `scope=fs action=run-bat` 起止配对（执行时）；故意 PUT 一个非法 body 能看到一条 ERROR。
6. **类型检查**：`pnpm -F @aimon/web build` 与后端构建通过。

## 非目标（这次不做）

- 不做 `.bat`/`.cmd` 以外类型（.ps1/.sh/.exe）的启动，也不做 Mac/Linux 的等价脚本——本次只覆盖 Windows 的 bat/cmd。
- 不做递归深扫整个项目找脚本（只扫项目根目录一层，start.bat 惯例就在根）。
- 不做「启动前先停掉上一次启动的进程」之类的进程管理——每次点就新起一个终端，跟双击 bat 一致。

## 实施步骤

1. **后端：Project 加 `startScript?` 字段 + CRUD**
   - `db.ts` 的 `Project` interface 加 `startScript?: string | null`（照 `workflowMode` 模式，只落 `projects.json` 真源，不进 SQLite 影子表）。
   - 加 `updateProjectStartScript(id, script | null)`，照 `updateProjectWorkflowMode` 写法。
   - 存储约定：脚本在项目目录内时存**相对项目根**的路径（如 `start.bat`、`scripts/start.bat`），在项目目录外时存**绝对路径**——这样项目整体搬家时内部脚本仍能解析。
   - 验证：起后端不报错；手动改 `projects.json` 加 `startScript` 后 `GET /api/projects` 能读回。

2. **后端：两个端点（resolve + 保存）**
   - `GET /api/projects/:id/start-script` → 返回 `{ resolved: string | null, candidates: string[] }`。
     - `resolved`：已保存的 `startScript` 解析成绝对路径且文件存在 → 用它；否则 `<project.path>/start.bat` 存在 → 用它；都没有 → `null`。
     - `candidates`：扫项目根目录一层，返回 `.bat`/`.cmd` 文件名列表（供弹窗选择）。
   - `PUT /api/projects/:id/start-script` body `{ script: string | null }` → 校验（zod；非空时把绝对/相对都允许，落库时若在项目根下转成相对）→ `updateProjectStartScript` → `serverLog` 起止配对，失败走 ERROR 分支。
   - 路由注册进 `index.ts`（沿用 `registerProjectRoutes`，直接加在 projects.ts 里即可，无需新文件）。
   - 验证：curl GET 返回结构正确；PUT 合法/非法 body 各一次，LogsView 看到起止/ERROR。

3. **前端：api.ts + types.ts**
   - `types.ts` 的 `Project` 加 `startScript?: string | null`。
   - `api.ts` 加 `getStartScript(projectId)` 和 `setStartScript(projectId, script)`。
   - 验证：`pnpm -F @aimon/web build` 通过。

4. **前端：项目行 ▶ 按钮 + 启动流程**
   - `ProjectsColumn.tsx` 项目行加一个**常驻** ▶ 按钮（放在 🌿 前面），`onClick` `stopPropagation`。
   - 点击逻辑：`getStartScript` → `resolved` 非空则 `runBatFile(p.id, resolved)`；为空则打开「设置启动脚本」弹窗。
   - 验证：浏览器点有 start.bat 的项目 → 新终端执行 bat。

5. **前端：StartScriptDialog 弹窗**
   - 新建 `StartScriptDialog.tsx`：标题「设置启动脚本」，列出 `candidates` 可点选；底部一个输入框可粘贴绝对路径；「保存并运行」按钮。弹窗**高度固定，内容超出内部滚动**（项目偏好）。
   - 选定/输入后：`setStartScript` 保存（`logAction('project','set-start-script', …)`）→ 成功后 `runBatFile`。
   - 验证：无 start.bat 的项目点 ▶ 弹窗出现、选一个能跑、再次点 ▶ 不再弹窗。

6. **前端：右键菜单「设置启动脚本…」**
   - `ProjectsColumn.tsx` 右键菜单加一项，打开同一个弹窗（带「清空」按钮把 `startScript` 设 `null`）。
   - 验证：右键能打开弹窗、清空后下次点 ▶ 回到默认 start.bat 逻辑。

## 边界情况

- 已保存的 `startScript` 指向的文件后来被删/改名 → `resolved` 走文件存在校验，失效时回退到「找 start.bat / 弹窗」，不报死。
- 项目根没有 start.bat 也没有任何 bat/cmd → 弹窗只显示输入框 + 提示「没找到 bat，可粘贴一个 bat 路径」。
- 路径含空格 → `runBatFile` 已用引号包裹 `cd /d "<dir>" && "<file>"`，安全。
- 相对路径解析：以 `project.path` 为基准 join；绝对路径直接用。
- 项目正忙（`busy === p.id`，整行 `pointer-events-none`）→ ▶ 同样不可点，符合现状。

## 风险与注意

- **执行任意 bat 的安全面**：这是功能本身要求（跑用户自己机器上、自己项目里的 bat），不是注入漏洞；但 PUT 的 `script` 与执行前都做「文件存在 + 后缀是 .bat/.cmd」校验，避免存进奇怪值。路径用引号包裹防空格/特殊字符断句。
- **跨设备**：相对路径随项目走没问题；绝对路径（项目外脚本）换机器会失效——失效时自动回退弹窗，可接受。
- **UI 拥挤**：项目行右侧已有 🌿(hover) + 内存 + 计数；▶ 设为常驻图标按钮，做到与 🌿 同尺寸（w-6 h-6）紧凑排布，不挤压项目名（项目名仍 `flex-1 min-w-0 truncate`）。若实测过挤，退一步改成 hover 显现——这条到执行时按浏览器实际观感定。

## 多模型 Plan 会审

> 跳过：Codex CLI 未安装/未配置（`@openai/codex` 缺失），按工作流回退 Claude 单独出 plan，已自审过 a~f 六个风险点（端点数量、相对/绝对路径、扫描深度、安全面、兜底输入、按钮拥挤）。
