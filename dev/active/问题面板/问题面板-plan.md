# 问题面板 · 计划

## 目标

在 Dev Docs 侧栏加一个「任务 / 问题」切换，让 AI 把执行期发现的**无关死代码/问题**往项目根下 `dev/issues.md` 追加一条带复选框的条目（**不改代码**）；用户在 UI 看到列表后，能"派一个新的 Claude 终端去处理某一条"或"一键派一个终端串行处理全部未处理"。同步把这条新规则追加到 Dev Docs 守则模板，并手动同步到本仓库根 `CLAUDE.md`。

派单采用 **S1 半自动**：新建 Claude session + 把 prompt 写到剪贴板 + 切到该 session + 提示用户 `Ctrl+V Enter`，**不**做自动 pty 写入（避免冷启动时序坑）。

**老项目 CLAUDE.md 要能升级拿到新章节**（"缺章节就补"，不整段覆盖用户手改）。

**可验证验收标准**：

1. **规则落盘**：`packages/server/src/dev-docs-guidelines.ts` 出现 `## Issues 档案` 章节，说明"看到无关问题 → 追加到 `dev/issues.md` 的 `- [ ]` 清单，**不改代码**；派来处理的 Claude 终端每处理完一条把对应行 `- [ ]` 改成 `- [x]`，每条必须单行"。仓库根 `CLAUDE.md` 同步落地同一段，`diff` 两处该章节无差异。
2. **老项目升级**：手动构造一个只含**老版守则**（没有 `## Issues 档案`）的 CLAUDE.md，点 ⚙ → 该章节被追加到主守则段内、主 `---` 分隔符之前；再点一次 → no-op（幂等）。构造一个已含新章节的 CLAUDE.md，点 ⚙ → no-op。
3. **后端读取**：`GET /api/projects/:id/issues` 返回 `{ path, content, items: [{ line, text, done }...] }`。手动建一个 `dev/issues.md` 含 3 条 `- [ ]` + 1 条 `- [x]`，`curl` 返回 4 个 item、`done` 字段正确。
4. **前端切换**：`DocsView` 顶部出现「任务 / 问题」分段按钮；点「问题」切到问题视图，列表渲染条目，`- [ ]` / `- [x]` 显示为"未处理 / 已处理" pill。
5. **单条派单（S1）**：未处理条目右侧"派 Claude"按钮 → 新建 `agent='claude'` session、前端选中该 session、条目的 prompt 已写入剪贴板、弹 toast/dialog "已就绪，请在新终端里 Ctrl+V 回车"。手测粘贴进终端确实是预期 prompt。
6. **一键全部（S1）**：顶部"一键全部"按钮（只在问题视图且有未处理条目时出现）→ 新建一个 session + 所有未处理条目拼成编号列表放剪贴板 + 同样提示。
7. **无回归**：既有「任务」tab 的展开、归档、搜索、⚙应用守则行为完全不变；TypeScript `tsc --noEmit` 通过；手测 UI 无报错。

## 非目标（Non-Goals）

- **不做**自动向 pty 写入 prompt（排除 S2/S3），不依赖 Claude CLI 输出格式。
- **不做**"问题"按任务/按文件分组，不做跨项目聚合视图，不做问题详情面板。
- **不做** UI 上"手动新建问题"的入口：问题唯一来源是 AI 在执行期追加 + 用户直接编辑 `dev/issues.md`。
- **不做**问题级别的"进行中"状态：只保留 `- [ ] / - [x]` 两态（和任务对齐）。
- **不做**自动归档、多行条目解析。
- **不做**整段覆盖式升级：CLAUDE.md 升级仅"缺章节就补"，不重写用户手改过的老章节。
- **不改**`dev/active/*` 下既有任务文件结构，也不改 `docs-service.ts` 既有导出。
- **不做** i18n，沿用中文文案。

## 实施步骤

1. **扩展守则模板** — `packages/server/src/dev-docs-guidelines.ts` 在"执行时的硬性规则"之后新增 `## Issues 档案` 章节：说明追加位置（`dev/issues.md`）、单行格式（`- [ ] <描述>（文件 path:line；上下文：一句话）`）、"发现即追加，不改代码"、"派来处理的终端每完成一条把 `- [ ]` 改成 `- [x]`"。同时**把该段单独导出**（如 `ISSUES_ARCHIVE_SECTION`），供"缺章节就补"逻辑使用。  
   verify: `grep "Issues 档案" packages/server/src/dev-docs-guidelines.ts` 命中；模板字符串闭合、无转义错误。

2. **同步仓库根 CLAUDE.md** — 把同一段粘贴到 `f:\KB\AIkanban-main\CLAUDE.md` 对应位置。  
   verify: 两处该章节 `diff` 无差异。

3. **CLAUDE.md 升级机制（缺章节就补）** — 修改 `packages/server/src/routes/projects.ts` 的 `appendDevDocsGuidelines`：
   - 若 CLAUDE.md **没有**主 anchor `# Dev Docs 工作流` → 沿用旧行为整段追加（`wrote:true`）；
   - 若有主 anchor 但**没有** `## Issues 档案` → 把 `ISSUES_ARCHIVE_SECTION` 插入到主守则段末尾、主 `---` 分隔符之前（`wrote:true`）；
   - 若两者都有 → no-op（`wrote:false`）。
   "主守则段末尾"定义：从主 anchor 起、到该段内**最后一个**顶级 `---` 分隔符之前，或 EOF。
   verify: 两个 fixture（老版只含旧守则 / 新版已含 Issues 档案）各跑一次，符合上述规则；再各跑一次确认幂等。

4. **后端 issues-service** — 新建 `packages/server/src/issues-service.ts`：`readIssues(projectPath)` 读 `dev/issues.md`；复用现有的路径 traversal 防护思路（比对 `docs-service.ts` 的 `assertContained`）；行正则 `^\s*[-*+]\s+\[( |x|X)\]\s+(.+)$` 解析 items；文件不存在返回 `{ path, content:'', items:[] }`。  
   verify: 手写一个 issues.md 跑一次 node REPL 调用，items 数正确。

5. **后端路由 issues** — 新建 `packages/server/src/routes/issues.ts`，`GET /api/projects/:id/issues`；在 `packages/server/src/index.ts` 里注册（参考 `registerDocsRoutes` 的注册方式）。  
   verify: `curl http://127.0.0.1:8787/api/projects/<id>/issues` 返回正确 JSON；错误场景（project 不存在）返回 404。

6. **前端类型 + api** — `packages/web/src/types.ts` 加 `IssueItem { line:number; text:string; done:boolean }` 和 `IssuesPayload { path:string; content:string; items:IssueItem[] }`；`packages/web/src/api.ts` 加 `listIssues(projectId)`。  
   verify: `tsc --noEmit` 通过。

7. **前端 store** — `store.ts` 加 `issuesData / issuesLoading / issuesError / refreshIssues(projectId)`；切换到问题 tab 或 project 变更时触发加载。  
   verify: 浏览器 DevTools 看 network 面板，切到问题 tab 触发一次 GET。

8. **DocsView 顶部切换** — 在 project 标题栏下方加一个 2 段的 segmented 按钮：「任务 / 问题」。本地 `view: 'tasks' | 'issues'` state（默认 tasks）。搜索框只在 tasks 视图出现。  
   verify: 截图肉眼确认切换工作。

9. **问题列表渲染** — 问题视图里每条一行：左侧 checkbox 图标（只读，对应 done 状态）+ 文本（单行 truncate）+ 右侧两个悬浮按钮：「打开 issues.md」「派 Claude」（已处理项不显示"派"）。空状态文案："还没有问题。AI 在执行期发现无关死代码/问题时会自动追加到这里。"  
   verify: 手写 issues.md 含混合状态，UI 显示符合。

10. **派单 S1 行为** —  
   a. `api.createSession({ projectId, agent:'claude' })` 拿到 new session；  
   b. store action 选中该 session（复用既有"选中/聚焦 session"的机制——context 阶段要具体确认 action 名字）；  
   c. `navigator.clipboard.writeText(prompt)`；失败捕获 → 降级用 `alertDialog` 显示 prompt 文本给用户自己复制；  
   d. 成功后 `alertDialog` / toast："已新建 Claude 终端，请在终端里 **Ctrl+V + 回车** 发送 prompt"。  
   verify: 单条 + 一键全部 各手测一次；拔网/禁用剪贴板权限时降级路径走通。

11. **Prompt 模板** —  
    单条：  
    ```
    请处理 dev/issues.md 里的这条问题：

    <text>

    处理完成后：在 dev/issues.md 里把这条的 [ ] 改成 [x]，然后简述改动。
    ```
    多条：  
    ```
    请依次处理 dev/issues.md 里以下未处理的问题，每处理完一条就把对应行的 [ ] 改成 [x]：

    1. <t1>
    2. <t2>
    ...
    ```
    verify: 剪贴板内容肉眼确认。

12. **回归测试** — 既有任务 tab 的展开、归档、搜索、⚙应用守则全部再走一遍；`tsc --noEmit`；`eslint`（若仓库跑）。  
    verify: 全绿。

## 边界情况

- **`dev/issues.md` 不存在**：后端正常返回空 items；前端显示空态文案（见步骤 8）。
- **条目跨多行**：当前解析按**行**切，不支持折行续写。守则里**显式约束** AI 追加时必须单行（长内容写进附近括号或用分号压扁），并在 plan 里注明这是已知限制。
- **Unicode / emoji / 中文**：原样保留到剪贴板、原样显示。
- **剪贴板 API 被拒（权限/非安全上下文）**：捕获异常，走降级 dialog 展示 prompt + 内置复制按钮。
- **Claude 未在 PATH / 未登录**：`createSession` 或 agent crash → 沿用既有错误提示路径；不额外处理。
- **两次快速点击"派"**：每次独立新建 session，不做去重防抖（边界不值得）。
- **问题文件被人工 / 其它 AI 编辑**：前端只读，不覆盖；刷新按钮重新解析。
- **任务归档**：`dev/issues.md` 是全局文件，不受归档影响。
- **已处理条目可见性**：全部渲染，但不显示"派"按钮；用户想清理就打开 md 文件删。不做自动折叠。

## 风险与注意

- **假设**：`store.ts` 里已有"选中某个 session"的 action。若没有则需要新增——context 阶段第一件事就是确认。
- **假设**：`navigator.clipboard.writeText` 在 Electron/Vite dev 下可用（HTTPS 或 localhost 应该都行）。若不可用就走 dialog 降级，不阻塞主流程。
- **可能波及"关键文件"之外的模块**：`store.ts`、`types.ts`、`api.ts`、`index.ts`（路由注册）、可能 `DialogHost` 需要一个支持复制按钮的 info 对话框。context 阶段把这些全部列入关键文件。
- **CLAUDE.md 升级策略的边界**：采用"缺章节就补"（按 `## Issues 档案` anchor 判重），不整段覆盖用户手改。代价是——若用户把章节标题改了名字（例如改成 `## 问题档案`），升级逻辑会判定"缺"从而**重复追加**一份。这是已知边界，不做模糊匹配兜底；必要时用户手动清理。
- **终端启动失败时的清理**：createSession 成功但 agent 立刻 crash，session 会进 ended 状态，剪贴板仍保留 prompt。不做额外清理。
- **守则镜像维护负担**：`dev-docs-guidelines.ts` 和仓库根 `CLAUDE.md` 是两份互为镜像的 source-of-truth；这个负担已经存在（见 `dev-docs-guidelines.ts` 头部注释），本任务**沿用同一范式**，不重构成单源。
