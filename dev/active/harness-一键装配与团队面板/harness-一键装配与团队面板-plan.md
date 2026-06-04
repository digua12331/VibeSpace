# harness-一键装配与团队面板 · plan

> memory 扫过：`manual.md` "小功能直接改"——本任务量级超过小功能（涉及前后端跨层、新组件 + 新 endpoint），走完整三段式；`auto.md` 仅占位条目。
>
> 上一任务 `harness-subagent卡片与按需技能` 沉淀的相关经验：subagent 不走三段式（与本任务无关，本任务是主 agent 改 UI/server 不派子工）；ContextMenu 已支持 submenu（本任务不用）。

## 背景

`templates/harness/` 已经写好了 install.sh / install.ps1 / INSTALL.md / CUSTOMIZE.md，能把 harness 配置（6 skill + 7 agent + 2 dev/ 文档）一键装到任意项目。但目前**用户必须打开终端跑脚本**——VibeSpace 自己是个 GUI 控制塔，这跟 GUI 调性不符。

把这条能力上拉到 UI 层：
1. **新建项目时一键装齐**：NewProjectDialog 加第 2 个复选框，跟 Dev Docs 守则并列
2. **既有项目能查看 + 装齐**：ProjectsColumn 右键菜单加「团队」项 → drawer 显示当前项目的团队装配状态 + 一键安装按钮

> 顺带发现的副产品：README.md 里描述的 "Karpathy 守则" 复选框已经从代码里删了（grep 全 packages 0 命中）；NewProjectDialog 当前只剩 Dev Docs 一个复选框。本任务**不修** README（属于另一条 issues），但为防止文档误导，会在 dev/issues.md 加一条。

## 目标

### 一键装配（NewProjectDialog）
1. NewProjectDialog 加第 2 个复选框 "🤝 应用 Harness 团队配置"，默认**不勾**（避免新建项目默认带一堆该项目可能用不上的 agent 文件）
2. 勾选后 createProject 流程内自动 apply 模板：6 skill + 7 agent + 2 dev/ + 1 CUSTOMIZE-harness.md + .gitignore 加 .aimon/runtime/
3. 装配过程走 `serverLog('info','installer','apply-harness 开始/成功/失败')` 起止配对，前端 logAction 同步

### 团队面板（既有项目右键 + drawer）
1. ProjectsColumn 右键菜单在「⚙ 权限配置」之后插入「🤝 团队」项
2. 点击后打开 drawer（仿现有 PermissionsDrawer 风格，右侧滑出）
3. drawer 内容三段：
   - **当前装配状态**：列出 7 个 vibespace-* agent + 6 个 skill 哪些已装 / 未装；总体显示"6/13 已装"或"全部已装"
   - **改造度估计**（best effort）：扫已装文件是否还含字面 `vibespace-*`，含 = 未按本项目改名 = 提示"未改造，建议看 CUSTOMIZE-harness.md"；不含 = 已改名 = ✓
   - **操作区**：「一键安装缺失文件」按钮（不覆盖已存在的）；安装完弹 alertDialog 列复制了哪些 + 跳过了哪些
4. drawer 顶部一行小字"改造指南"链接到目标项目里的 `.aimon/CUSTOMIZE-harness.md`（如果存在）—— 点击用 fs-ops 的"在文件夹打开"或新 tab 打开 md 文件

### 验收标准（必须含浏览器可观察项）

#### 一键装配
- **A-tsc**：server tsc + web tsc 全绿
- **A-V1**（浏览器）：点 + 新建项目 → 看到第 2 个复选框 "🤝 应用 Harness 团队配置"（默认不勾），下方有一句小字解释装什么
- **A-V2**（浏览器 + 文件）：勾上 + 创建 → server data 不动；目标项目根新增 16 个文件 + .gitignore 加一行 `.aimon/runtime/`
- **A-V3**（浏览器）：LogsView 看到 `installer apply-harness 开始/成功 (Nms)` 起止配对
- **A-V4**（浏览器）：不勾 + 创建 → 行为完全跟现状一致（CLAUDE.md 装 Dev Docs 守则，但 .aimon / .claude/agents 目录不创建）

#### 团队面板
- **B-tsc**：两侧 tsc 全绿
- **B-V1**（浏览器）：项目右键菜单看到 "🤝 团队" 项；点击打开 drawer
- **B-V2**（浏览器，对一个**没装过**模板的项目）：drawer 显示"0/13 已装"，所有 13 行都是 ✗；底部"一键安装"按钮高亮
- **B-V3**（浏览器，对一个**已装过**模板的项目）：drawer 显示"13/13 已装"，所有行 ✓；改造度提示"未改名"（因为刚装上文件名还是 vibespace-*）
- **B-V4**（浏览器）：手动改一个 agent 文件名 vibespace-explorer.md → myproj-explorer.md，刷新 drawer 显示这条"已改名 ✓"
- **B-V5**（浏览器）：点"一键安装"在已装项目上 → 不覆盖任何文件，alertDialog 显示"全部已存在，跳过"
- **B-LOG**：LogsView 看到 `installer harness-status` GET 路径的访问 + apply 路径的起止；至少一条 ERROR 手动触发（让一个文件变成只读后再点装 → ERROR 入账）

## 非目标（Non-Goals）

1. **不做"一键改造"**：UI 只装文件不改 vibespace-* → myproj-* 之类的项目特定改造；改造仍要用户读 CUSTOMIZE-harness.md 自己手动改（按 plan B v1 边界）
2. **不做"删除已装"**：drawer 不提供"卸载"按钮——卸载就是手动删文件，加这个按钮风险大（误删）
3. **不做"diff 现状 vs 模板"**：drawer 不展示已装文件跟模板的字面 diff——用户要 diff 自己 git diff 即可
4. **不做"实时 watch 改造度"**：drawer 是按需刷新（打开时 + 点刷新按钮）；不做 fs-watch
5. **不修 README.md 的 Karpathy 描述**：那是独立 issue，本任务范围外，加到 dev/issues.md
6. **不做"装/不装单个 skill / 单个 agent"**：v1 全装或全不装；细粒度选择 留 v1.x

## 实施步骤（粗粒度）

### Phase A · 后端能力

A-1. **新建 `packages/server/src/harness-template-service.ts`**：核心逻辑
   - `getTemplateFiles()` 返回模板源 13+2 文件清单（绝对路径 + 目标相对路径）
   - `getHarnessStatus(projectPath)` 探测目标项目里这些文件存在情况 + 改造度（含/不含 `vibespace-*` 字面字符串）
   - `applyHarnessTemplate(projectPath)` 拷贝缺失文件 + .gitignore append；返回 { copied: string[], skipped: string[] }
   - 不引新依赖，全用 node:fs/promises
   verify: server tsc

A-2. **routes/projects.ts 加 2 个 endpoint**：
   - `POST /api/projects/:id/apply-harness` body 空；调 applyHarnessTemplate；操作日志起止
   - `GET /api/projects/:id/harness-status`；调 getHarnessStatus
   verify: curl 两个端点；起止日志可见

A-3. **createProject 路径接 applyHarnessGuidelines 字段**：
   - CreateProjectSchema 加 `applyHarnessGuidelines: z.boolean().optional()`
   - 创建后如果 true 自动调 applyHarnessTemplate（best-effort，失败 warn 不阻塞）
   verify: curl POST /api/projects body 含 applyHarnessGuidelines:true 后目标目录有文件

### Phase B · 前端 UI

B-1. **api.ts + types.ts**：加 HarnessStatus 类型；`getHarnessStatus(projectId)` / `applyHarness(projectId)` / `createProject` 入参加 `applyHarnessGuidelines?` → verify: web tsc

B-2. **NewProjectDialog 加复选框**：第 2 个复选框 "🤝 应用 Harness 团队配置"，默认不勾，下方一句解释；submit 时把 applyHarnessGuidelines 传给 createProject → verify: A-V1 / A-V2 / A-V4

B-3. **新建 `components/HarnessTeamDrawer.tsx`**（仿 PermissionsDrawer 结构）：
   - props: `{ project: Project; onClose: () => void }`
   - useEffect 打开时 fetch getHarnessStatus；按需刷新按钮
   - 三段渲染：状态总览（X/13）/ 文件清单表 / 操作区"一键安装缺失"
   - 一键安装走 logAction 包 applyHarness；完成后重新 fetch
   verify: B-V1 / B-V2 / B-V3 / B-V5

B-4. **ProjectsColumn 右键菜单加 "🤝 团队" 项**：
   - 在「⚙ 权限配置」后、「删除项目」前插入
   - 点击 setMenu(null) + setHarnessTeamProjectId(projectId) 触发 drawer
   - drawer 渲染条件：harnessTeamProjectId 非 null && 项目存在
   verify: B-V1 通过

### Phase C · 收尾

C-1. **dev/issues.md 加一条**：README "Karpathy 守则" 描述过时（grep 0 命中），单独 issue 不在本任务修
   verify: 肉眼读

C-2. **dev/learnings.md 加经验**（如适用）：harness 模板从 templates/harness/ 拷到 server-side 的"文件清单 helper"模式（不引新依赖，全 node:fs）
   verify: 肉眼读

C-3. **README.md 那一节稍稍重写**：原"Reusing the harness config in other projects"段加一句"也可以在 VibeSpace UI 新建项目时勾选 / 既有项目右键打开团队面板一键装"
   verify: 肉眼读

C-4. **全量验收**：A-V1..V4 + B-V1..V5 + ERROR + tsc + smoke:worktree
   verify: 手动+命令行全过

## 边界情况

- **目标项目根不可写**（权限）→ applyHarness 失败；ERROR 日志 + 用户能看到 alertDialog
- **目标项目已经手动装过部分文件**：drawer 显示"6/13 已装"；点一键安装只补缺失（不覆盖）
- **目标项目曾改名 vibespace-* → myproj-***：改造度显示已改名 ✓；但安装路径仍找原 vibespace-*.md 不存在 → 视作未装；用户实际有 myproj-* 但 UI 显示空——这是**当前限制**，drawer 顶部加注释"按 vibespace-* 字面文件名探测；改名后看不到"
- **NewProjectDialog 勾选了但目录创建失败 / 模板拷贝失败**：项目仍然创建（CLAUDE.md 守则也仍写）；warn 日志；不阻塞
- **dev/ 目录在目标项目里被 .gitignore 整体忽略**（VibeSpace 自身就这样）：blueprint / roadmap 文件**仍写到目标项目的 dev/**；如果目标也 ignore 那是用户自己事，VibeSpace 不修改用户 .gitignore 的 dev/ 行
- **server 在 dev:alt 模式跑**：模板源路径要按本仓库根算（仓库自己），不是按用户项目算；用 `fileURLToPath(import.meta.url)` 推根

## 风险与注意

1. **模板源路径**：harness-template-service.ts 要找 VibeSpace 仓库根的 .aimon/skills 和 .claude/agents——server 是个独立子包，往上推两级到仓库根。Windows 路径分隔符注意。
2. **Drawer 形态**：现有 PermissionsDrawer 是右侧滑出 modal；新 HarnessTeamDrawer 沿用同样 z-index 和 overlay 处理，不要冒撞
3. **改造度探测的局限**：v1 仅 grep 字面 `vibespace-*` 是否存在；用户改名成别的也算"改造"，但用户**保留 vibespace-* 命名**而只重写 body 的话仍显示"未改造"——这是误报；可接受
4. **熔断点**：B-3 的 drawer 如果 fetch 失败 / 渲染挂掉，**不要**用 try/catch 吞——让它显示错误，否则用户不知道哪步出了问题
5. **不引新依赖**：模板源拷贝走 node:fs/promises 的 readdir/copyFile/mkdir/appendFile，不要引 fs-extra 之类

## 假设（请用户确认）

- AS1：第 2 个复选框默认**不勾**（用户的项目大部分跟 VibeSpace 栈不一样，默认勾会污染）—— 反对的话改默认勾
- AS2：右键菜单图标用 🤝（握手）—— 你之前说"添加团队图标"没说具体用啥，备选 👥 / 🛠 / 🧰；我用 🤝 因为它最贴"团队"语义
- AS3：drawer 形态用右侧滑出（仿 PermissionsDrawer），不用 modal 居中——更符合 VibeSpace 既有 UI 调性
- AS4：改造度探测只看 vibespace-* 字面字符串；不做更复杂的 AST 分析——v1 简化
- AS5：v1 不提供"一键改造"（自动改名 vibespace-* → myproj-*）；用户必须读 CUSTOMIZE-harness.md 自己改——避免暗黑魔法
