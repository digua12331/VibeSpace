# AI开发三件套接入 · plan

## 大哥摘要（白话）

这次要把你最近调研到的那套"AI 开发三件套"——**OpenSpec**（写需求文档）、**Superpowers**（让 AI 写代码不偷懒）、**gstack**（一键截图/跑测试/发版的工具集）——做进 VibeSpace 软件本身，让以后用 VibeSpace 的人也能用上这套方法论。

**做完后你能在哪里点哪里看到效果**：
1. 新建项目时，在弹窗里多一个"开发流程"下拉菜单，能选"现在的 Dev Docs"或"OpenSpec 模式"或"两个都不要"。
2. 选了"OpenSpec 模式"的项目，左侧栏会出现一个新 tab"**规范**"（取代原来的"Dev Docs" tab），点进去能新建一份变更提案、写 proposal/design/tasks 三件套。
3. 设置抽屉（齿轮按钮里）多一个"**工具集**"标签，里面有"安装 gstack"按钮——点一下，VibeSpace 帮你 git clone 那 28 个 Claude Code 技能到全局技能目录，安装完你在 Claude 会话里直接打 `/browse`、`/qa`、`/ship` 就能用。
4. 新建项目时还能选"**启用 Superpowers 7 步流程**"，VibeSpace 会往项目的 CLAUDE.md（给 AI 看的项目说明书）里塞一段提示——但这一项老实说，只能让 AI 看到提示，**真正的流程约束需要你自己在 Claude Code 里装 Superpowers 插件**，VibeSpace 控不到 Claude Code 插件市场。这点下文"非目标"会再讲。

**不会动到你现有的什么数据/界面**：你现在所有项目里写好的 plan/context/tasks 三段式 markdown 文件不会被搬走或重命名，"Dev Docs" tab 在没启用"OpenSpec 模式"的项目里照旧显示。两套工作流是项目级二选一——**同一个项目**只显示一种规范 tab，**不同项目**互不干扰。

**专业术语翻译**：
- **workflow（工作流）**：项目里给 AI 看的"做事流程说明书"，本质是 CLAUDE.md 段落 + 几个目录骨架
- **OpenSpec**：一种把"需求 / 技术方案 / 任务清单"分成三份 markdown 文件的写法
- **gstack**：28 个一键命令的技能集合（如 `/browse` 让 AI 用浏览器截图）
- **Superpowers**：Claude Code（你装的那个 AI 编辑器）的一个插件，强制 AI 写代码必须按 7 个步骤来，跳一步它就拦你
- **CLAUDE.md**：项目根目录的一份纯文本文件，AI 每次开会话都会先读它，把它当"项目规则手册"
- **`.aimon/skills`**：VibeSpace 内部的项目级技能目录（注意跟 `~/.claude/skills/` 是两回事，详见非目标）

---

## 目标

做完后，**对一个用 VibeSpace 的人**，以下事都成立、可在浏览器观察、可由 `vibespace-browser-tester` 子代理点开验证：

1. **OpenSpec 工作流可装可卸**：在已有项目里通过设置抽屉切到"OpenSpec 模式"，触发 `apply-workflow` 后，项目根出现 `openspec/specs/` 与 `openspec/changes/` 两个目录、`openspec/AGENTS.md`（OpenSpec 标准说明文件）；切回"Dev Docs 模式"或"无"能干净卸载，目录被清空（保留用户已写的内容时给确认弹窗，仿照现有 Dev Docs 卸载逻辑）。
2. **OpenSpec 三件套可视化**：项目处于 OpenSpec 模式时，左侧栏出现"**规范**"tab（替换原 Dev Docs tab）；能列出 `openspec/changes/` 下的所有 change 文件夹；能点"新建 change"在弹窗里输中文名→自动建子目录+三个文件骨架；能在文件预览里编辑/保存 proposal.md / design.md / tasks.md（仿照现有 DocsView 的 markdown 编辑器形态）。
3. **gstack 一键安装**：设置抽屉新增"**工具集**"tab，有"安装 gstack / 更新 / 卸载 / 查看状态"四个按钮；安装走子进程作业（git clone → bun setup），LogsView 看到 `scope=installer action=gstack-install` 起止配对、失败时看到 ERROR；安装完 `~/.claude/skills/gstack/` 出现，状态显示"已安装 v<git short hash>"。
4. **gstack 跨平台兜底**：在没装 bun 的机器上点安装，能看到友好提示"需要先装 bun"+ 一键打开 bun.sh 安装文档；在 Windows 上 bun setup 创建 symlink 失败时，回退为复制（已知坑：auto.md 2026-05-02"Windows 上默认不要依赖 symlink"）。
5. **Superpowers 工作流片段可写可撤**：新建项目对话框 / 设置抽屉里能勾选"启用 Superpowers 7 步流程"，触发后 CLAUDE.md 多一段"启用 Superpowers"提示；卸载时该段干净撤掉。**不验证插件本身是否在 Claude Code 里生效**——这点写进 handoff 摘要让大哥手动验证。
6. **三件相互独立**：同一项目可以同时启用"OpenSpec 模式 + 启用 Superpowers + 已安装 gstack"，三件配置正交，互不删除对方文件。
7. **现有 Dev Docs 数据零损伤**：本任务任何阶段都不动 `dev/active/` 与 `dev/archive/` 已有内容、`docs-service.ts`、`review-runner.ts` 行为不变。

**自动化验收命令**：
- `pnpm -F @aimon/server typecheck`（后端类型检查通过）
- `pnpm -F @aimon/web build`（前端构建+类型检查通过——本仓库 web 包没单独 typecheck 脚本，按 auto.md 2026-05-02 经验用 build 兜底）
- `vibespace-browser-tester` 跑下面【浏览器验收清单】，全部 PASS

**浏览器验收清单**（交付前 AI 自派 vibespace-browser-tester 跑）：
- [V1] 新建项目对话框出现"开发流程"+"启用 Superpowers"两项控件
- [V2] 创建一个选 OpenSpec 模式的新项目，侧栏出现"规范"tab、Dev Docs tab 不出现
- [V3] 在"规范"tab 里点"新建 change"，输入名字 `测试-提案`，能看到生成 `openspec/changes/测试-提案/{proposal,design,tasks}.md` 三件
- [V4] 改某个文件保存，文件预览刷新，LogsView 看到 `scope=openspec` 起止
- [V5] 设置抽屉→"工具集"→"安装 gstack"，看到 LogsView 起止 + 安装后状态"已安装"
- [V6] 故意断网/给个错的 git URL 重跑安装，LogsView 看到 ERROR
- [V7] 关闭 OpenSpec 模式（切回"无"或"Dev Docs"），`openspec/` 目录被清空，侧栏"规范"tab 消失

---

## 非目标（明确不做）

1. **不重新实现 Superpowers 的 7 步流程约束**。Superpowers 是 Claude Code 自己的插件，VibeSpace 的角色限于"提示 AI 项目启用了这套流程"，**真正的强制约束在 Claude Code 插件市场装的 Superpowers 本体**。本任务在 handoff 里明确告诉大哥这一点。
2. **不在 VibeSpace UI 里复刻 gstack 的 28 个技能**。gstack 安装完，触发方式还是在 Claude 会话里打 `/browse` 等 slash 命令——VibeSpace 只做"安装/状态/卸载"三件事。
3. **不把现有 Dev Docs 工作流改造成 OpenSpec 双文件夹模型**。Dev Docs（`dev/active/<任务名>/`）保持原样不动；OpenSpec（`openspec/{specs,changes}/`）独立目录，互不干扰。
4. **不深度集成 OpenSpec 的 `openspec init` CLI**。VibeSpace 后端自己写出 OpenSpec 的目录骨架和 `AGENTS.md`（参考 OpenSpec 官方仓库 README 的最简格式）——理由：OpenSpec CLI 是 npm 全局包，强行 spawn 它会把"用户机器装没装 npm/openspec"也变成 VibeSpace 的依赖，与现有"开箱即用"理念冲突。**风险**：若 OpenSpec 官方 schema 升级，VibeSpace 写出的目录骨架可能跟不上——本任务接受这个风险，加一行注释提示后续维护。
5. **不为 gstack 在 VibeSpace 内部做"调用面板"**。gstack 装好之后是 Claude Code 会话级的 slash 命令，触发权在用户（在 Claude 会话里手打）。
6. **不动 `docs-service.ts` / `review-runner.ts` / `dev/memory/auto.md` 自动评审链路**。新加的 OpenSpec 改动文件不会被现有归档评审误读（两者目录完全分离）。
7. **不为本任务新建"工具集"以外的全局功能**。gstack 安装是"机器全局"动作（写 `~/.claude/skills/gstack`），不属于任何单个项目——按 auto.md 2026-05-02"全机器级能力优先挂独立 `/api/<feature>/*` 路由"经验，gstack 安装走 `/api/external-tools/*` 而不是 `/api/projects/:id/*`。

---

## 实施步骤

### 阶段 1：扩展 workflow-service 加两种新工作流类型（OpenSpec + Superpowers）

合并原方案的"阶段 1（OpenSpec）+ 阶段 3（Superpowers）"——两者都是 `workflow-service.ts` 加新类型，apply/remove 结构相同（参见 Codex 自审"简化建议"）。

**1.1 数据库**：扩展 `db.ts` 给 projects 表加 `workflow_mode` 列（按 ARCHITECTURE 3.2 节走三段同步：schema migrate / 类型 / CRUD + 五处 SELECT 同步）。值域：`null | "dev-docs" | "openspec"`。Superpowers 不进 `workflow_mode`（它跟规范工作流正交，存在独立列 `superpowers_enabled` 或仅靠 CLAUDE.md anchor 探测——后者更省迁移）。**决策**：用 anchor 探测，不加 `superpowers_enabled` 列。

**1.2 服务层**：
- `workflow-service.ts` 现有 `applyWorkflowToProject` / `removeWorkflowFromProject` / `getWorkflowStatus` 加 `mode` 参数（默认 `"dev-docs"` 兼容现有调用）
- 新建 `openspec-template-service.ts`：写 OpenSpec 标准目录骨架（`openspec/{specs,changes,archive}/` + `openspec/AGENTS.md` 最简版）；apply/remove/status 接口形态仿 `harness-template-service.ts`
- 新增 `appendSuperpowersGuidelines(projectPath)` / `removeSuperpowersGuidelines(projectPath)`（仿现有 `appendDevDocsGuidelines`）：写一段固定 CLAUDE.md 锚点 `# Superpowers 7 步流程`，内容为简短说明 + Claude Code 插件市场链接
- 现有 Dev Docs apply/remove 逻辑不变

**1.3 路由**：`routes/projects.ts` 现有 `/api/projects/:id/workflow` POST/DELETE/GET 加 body 字段：
```ts
{ mode?: "dev-docs" | "openspec", superpowers?: boolean }
```
默认 `mode="dev-docs", superpowers=false`，向后兼容现有前端调用。返回结构在现有 `WorkflowApplyResult` 上加 `openspec` / `superpowers` 子结果，沿用 207 partial 语义。

**1.4 OpenSpec CRUD 路由**：新建 `routes/openspec.ts`，参照 `docs-service.ts` 形态：
- `GET /api/projects/:id/openspec/changes`：列 `openspec/changes/` 子目录 + 每个 change 的状态徽章（draft/in-progress 通过文件标记）
- `GET /api/projects/:id/openspec/changes/:name`：返回三个文件的元信息
- `GET /api/projects/:id/openspec/changes/:name/:file`（file ∈ `proposal | design | tasks`）：返回 markdown 内容
- `PUT /api/projects/:id/openspec/changes/:name/:file`：写文件
- `POST /api/projects/:id/openspec/changes`：新建 change（body: `{ name }`，校验中文名+不含禁用字符，仿照 `TaskNameSchema`）
- `POST /api/projects/:id/openspec/archive`：把 change 整体 mv 到 `openspec/archive/<name>-<YYYYMMDD-HHmm>/`
- 全部走 `serverLog('info'|'error', 'openspec', '<action> 开始|成功|失败')`

**1.5 安全边界**：所有 `:name` 走 `path.resolve()` 后校验最终路径仍在 `<project>/openspec/changes/` 下，防路径穿越（auto.md 2026-05-02 技能管理面板那条）。

### 阶段 2：在 PermissionsDrawer 新增"工具集"tab + gstack 安装器

**2.1 路由**：新建 `routes/external-tools.ts`，注册 `/api/external-tools/gstack/*`（按 auto.md 2026-05-02"全机器级能力独立路由"经验，**不**挂 `/api/projects/:id/`）：
- `GET /status`：返回 `{ installed: boolean, version?: string, location?: string, bunAvailable: boolean }`
- `POST /install`：触发安装作业（fire-and-forget，复用 `cli-installer.ts` 的 `InstallJobManager`——按 Codex 自审简化建议，不新建独立 service）
- `POST /update`：`git pull` + 重跑 setup
- `DELETE`：删除 `~/.claude/skills/gstack` 目录

**2.2 安装作业实现**（在 `cli-installer.ts` 加一个 entry，或单独 `gstack-installer.ts` 服务文件——选后者，因为 cli-installer 现在专门管 CLI agent 不管 skill 集合，强塞会污染分类）：
- 检测 bun：`spawn('bun', ['--version'])`，捕获 ENOENT → 状态返回 `bunAvailable: false`，前端给提示
- 安装：`spawn('git', ['clone', '--depth', '1', 'https://github.com/garrytan/gstack.git', '~/.claude/skills/gstack'])`，再 `spawn('bun', ['./setup'])`
- 跨平台：路径用 `os.homedir()` + `path.join`（auto.md 2026-05-02"用户家目录读取"经验）
- Windows symlink fallback：检测 setup 运行后 `~/.claude/skills/<skill-name>` 是否真的成为有效链接；失败则**告警提示**用户"Windows 上 setup 可能因 symlink 权限不全，可考虑以管理员身份重试或仅用 gstack/skills/<skill>"——**不自动改写 setup 脚本**，避免维护负担

**2.3 前端**：
- `PermissionsDrawer.tsx`：新增"工具集"tab（仿 ButtonsTab 内联组件，不抽新文件——auto.md 2026-05-02"PermissionsDrawer 大组件加小 tab 跟随内联"经验）
- 4 个按钮 + 状态显示 + 错误提示
- 调用走 `logAction('installer', 'gstack-install', () => api.installGstack(), {...})`

**2.4 仓库 URL 假设**：`https://github.com/garrytan/gstack.git` 来自用户提供文档，本任务**未联网验证可达**——plan 中以"假设"声明，实际实现前会去 fetch 一次确认；不可达则停下来跟大哥确认。

### 阶段 3：UI 入口与互斥显示

**3.1 NewProjectDialog.tsx**：在现有"是否启用 Dev Docs"开关位置改成下拉菜单"开发流程模式"：
- 选项：`无 / Dev Docs（现有） / OpenSpec`
- 旁边一个独立 checkbox"启用 Superpowers 7 步流程提示"（说明文案括号解释）
- 默认值：与现有行为一致（Dev Docs 默认开）

**3.2 现有项目切换路径**：`PermissionsDrawer` 加一个"工作流"tab（如果已有就扩展；现有 `Settings` tab 已经有装/卸 Dev Docs 的开关——按 auto.md 2026-05-01"开关状态优先从文件内容实时读取"经验，由 `workflow-status` 接口判定）。

**3.3 侧栏互斥渲染**：参照 Codex 自审风险点 2，**不在前端用 if-else 切**，而是在 `Workbench.tsx` 或 `ActivityBar` 渲染层根据 `currentProject.workflowMode` 决定渲染 `<DocsView />` 还是 `<OpenSpecView />`：
- `workflowMode === "dev-docs"` → 显示 Dev Docs 图标 + DocsView
- `workflowMode === "openspec"` → 显示 规范 图标 + OpenSpecView
- `workflowMode === null` → 都不显示
- 这样侧栏 item 顺序稳定，切换不抖动

**3.4 OpenSpecView.tsx 新建**：仿 `DocsView.tsx` 的 changes 列表 + 三件套 tab 切换 + markdown 编辑（直接复用 `DocsView` 的 markdown 编辑器子组件，不重复造轮子）。

**3.5 切换工作流的二次确认**：从 `dev-docs` → `openspec` 或反过来时，弹窗提示"切换会保留旧目录但隐藏其 tab，是否继续"，避免用户误以为数据丢了。

### 阶段 4：文档与项目记忆同步

**4.1 README.md / README.zh-CN.md**：增加"项目工作流"章节（按 auto.md 2026-05-01"双语主文档同步"经验同时改两份），讲清三件套是什么、怎么开关、跟现有 Dev Docs 的关系（**项目级二选一**）。

**4.2 `.claude/templates/`**：本任务**不**新增模板预设（按 Codex 自审简化建议——推迟到三件验收后再提取，否则模板会随实现反复改）。在阶段收尾时若结构稳定再追加。

**4.3 `dev/memory/manual.md`**：手动追加一条本次接入的总结（仿现有大哥偏好条目格式），把"三件并存设计、Windows symlink 兜底、Superpowers 浅集成的真实边界"沉淀给后续任务。

**4.4 CLAUDE.md（项目根）**：本任务**不**给项目根 CLAUDE.md 加新规则——三件套都是"项目级可选能力"，不应升级为强制规则。

---

## 边界情况

1. **half-applied 项目**：若用户曾装过 OpenSpec、手动删了 `openspec/AGENTS.md`，状态接口要返回 `partial`（参考现有 workflow-service 的 partial 设计）；卸载时要按文件清单逐个删，不要 `rmdir openspec/` 误伤用户后来手写的内容（auto.md 2026-05-01 工作流入口形态对齐）。
2. **CLAUDE.md 锚点冲突**：用户可能手写过 `# Superpowers 7 步流程` 这样的标题。`apply` 检测到锚点存在直接 `no-op`；`remove` 只删 VibeSpace 写入的精确锚点块（前后包含 anchor + 固定 separator）。
3. **OpenSpec change 名包含禁用字符**：复用 `TaskNameSchema` 校验，禁止 `/ \ : * ? " < > |`。
4. **同名 change 已存在**：`POST /openspec/changes` 直接返回 409 + 提示文案；不自动归档旧的（与 Dev Docs 三段式逻辑保持差异：Dev Docs 是任务级"残留同名归档"，OpenSpec change 是规范级"严禁同名覆盖"）。
5. **bun 缺失但用户硬点安装**：返回 412 + 友好文案 + bun.sh 链接；状态接口的 `bunAvailable: false` 应让前端先 disable 安装按钮。
6. **网络断开**：git clone 失败 ERROR 落 LogsView，UI 显示重试按钮。
7. **Windows 路径**：所有路径用 `path.join` + `path.resolve`，不出现 `/` 硬编码。
8. **`workflow_mode` 列在已有数据库上的迁移**：已有项目默认 `null`（兼容现有"未装"语义）；若已经装了 Dev Docs，迁移脚本扫描 CLAUDE.md 是否包含 `# Dev Docs 工作流` 锚点，是则回填 `"dev-docs"`。
9. **侧栏切换时 OpenSpec 数据未加载完**：复用现有 DocsView 的 `<Spinner />` 模式。
10. **gstack 重复安装**：先检测 `~/.claude/skills/gstack/.git` 存在则提示"已安装，是否更新"；不静默覆盖。

---

## 风险与注意

### Codex 自审吸收（已在方案里调整）
1. ✅ **阶段 1+3 合并**：workflow-service 一次性扩展两种 workflow 类型（采纳）
2. ✅ **互斥显示移到渲染层**：不在 OpenSpecView 内部 if-else，由 `Workbench` 按 `workflowMode` 选渲染哪个组件（采纳）
3. ✅ **不新建 gstack-installer-service**：先评估 `cli-installer.ts` 复用——结论是 cli-installer 专管 CLI agent 类型，gstack 是 skill 集合性质不同，**仍单独建 `gstack-installer.ts`**（部分采纳：精简了构成但保留独立服务文件理由）
4. ✅ **`.claude/templates/` 推迟**：本任务不交付（采纳）
5. ✅ **archive 目标目录**：明确写 `openspec/archive/<name>-<时间戳>/`，仿 Dev Docs `dev/archive`（采纳）
6. ✅ **workflow_mode 与 gstack 正交关系**：明确说三件相互独立（采纳）
7. ✅ **NewProjectDialog vs PermissionsDrawer**：新项目走 Dialog，已有项目走 Drawer，两者都支持（采纳）
8. ⚠️ **db.ts 三段同步 + 五处 SELECT 同步**：明确按 ARCHITECTURE 3.2 走（已写进阶段 1.1）

### 真实风险
1. **R1（最重）：阶段 3 Superpowers 浅集成等于没做**
   - 现实：VibeSpace 写一段 CLAUDE.md 提示 ≠ Claude Code 装了 Superpowers 插件，AI 不会"被强制 7 步"
   - 决策：保留这一阶段是因为大哥需求里明确"三件一起做但浅集成"，且 CLAUDE.md 提示对没装插件的用户也有教育意义（让他知道有这个选项）
   - 验收：只验"CLAUDE.md 写入了 + LogsView 起止配对 + 卸载干净"，**不验插件实际工作**——handoff 里坦白告诉大哥"这一项 VibeSpace 控不到 Claude Code 插件市场"

2. **R2：bun 在 Windows 上的稳定性**
   - 用户机器可能没装 bun；gstack setup 在 Windows 上需要 symlink 权限
   - 兜底：缺 bun 给提示+链接；symlink 失败给告警，**不自动绕过**——避免维护一份"VibeSpace 自己改写的 gstack setup"

3. **R3：OpenSpec 官方版本升级**
   - 我们自己写 OpenSpec 目录骨架，OpenSpec npm 包升级后骨架格式可能漂移
   - 兜底：在 `openspec-template-service.ts` 顶部注释明确"参考 OpenSpec vX.Y schema，升级时手动核对"
   - 后续若用户反馈不一致，再考虑 spawn `openspec init` 路径

4. **R4：gstack repo 真实可达性未联网验证**
   - 本 plan 假设 `https://github.com/garrytan/gstack.git` 公开可达
   - 实施第一步：先 fetch 一次（HTTP HEAD 或 git ls-remote），不可达则停下来跟大哥确认是否换 fork

5. **R5：现有 30+ 未归档 active 任务堆积**
   - 不影响本任务，但 dev/active 已有大量未归档目录（项目长期使用痕迹）
   - 本任务**不**做归档清理，专注当前需求

6. **R6：OpenSpec change 与 review-runner.ts 误判**
   - 现状：归档评审走 `dev/archive/` 触发，**不**扫 `openspec/`
   - 已确认：本方案 OpenSpec archive 目标 `openspec/archive/`，与 `dev/archive/` 完全分离，不会误读

### 假设清单（实施前需校验）
- [A1] `https://github.com/garrytan/gstack.git` 公开可访问
- [A2] OpenSpec 双文件夹模型 `specs/` + `changes/` 是当前主流稳定 schema（参考用户提供文档）
- [A3] Claude Code Superpowers 插件在主流版本里安装方式不变（市场里搜索安装）
- [A4] `~/.claude/skills/` 是 Claude Code 跨平台一致的 skill 加载路径

---

## 多模型 Plan 会审

> **[Gemini 评审]** 跳过：本地 `gemini-cli` MCP `spawn echo ENOENT`（Windows 环境未配置 Gemini CLI），重试一次仍失败，按 CLAUDE.md 规则回退。
>
> **[Codex 评审]** 跳过：`codex:codex-rescue` 调用返回 401（OpenAI API key 未配置或未通过认证），重试同样 401。子代理返回的"Claude 自审清单"已吸收进方案——8 条风险点（其中 4 条直接调整了方案结构，4 条作为已知风险沉淀进【风险与注意】段），3 条简化建议（阶段合并、cli-installer 复用评估、`.claude/templates` 推迟）全部采纳，3 条疑问已在【非目标】或【边界情况】里明确回答。
>
> **[Codex 综合主笔]** 跳过：因 Codex 401 无法主笔，本 plan 由 Claude 单独综合写出，已主动按多模型协作精神做 Codex 自审视角的结构调整。
>
> **[Claude 白话化兜底]** 已自查：大哥摘要白话化（5 段、术语都括号翻译）；术语首次出现配白话；对照 manual.md 偏好（小功能直接做、大方向 + 验收为先、专业术语翻译、自派浏览器测试 agent）已遵守；plan 不让大哥挑技术分叉（只让他在大方向 + 验收方式上点头）。
