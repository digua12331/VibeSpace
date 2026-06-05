# HTML页签就地编辑 · plan

## 大哥摘要

现在你在文件页签里打开一个 HTML（网页文件），它只能"看"——双击改不了字，要改只能派给 AI。这次让它多一个**"编辑"开关**：点开开关后，可以像改文档一样**直接在渲染出来的页面上双击改文字**，改完点"保存"就写回文件。

做完你能在哪里看到：打开任意一个 `.html` 文件 → 进 Preview（预览）页签 → 右上角多出一个「编辑」按钮 → 点它进入编辑、页面文字变成可改 → 改几个字 → 点「保存」→ 关掉重开文件，改动还在。

需不需要担心动到你现有东西：不会。只新增一个"编辑+保存"的能力，原来的"看"和"点元素派给 AI 改"两条路一个字不动。保存只允许写**当前工作区**里**完整加载**的文件（被截断的大文件、历史版本一律禁止编辑，防止把文件存坏）。带脚本的复杂网页会弹一条提醒"就地编辑可能改坏结构，建议还是派给 AI"，由你自己决定改不改。

> **专业名词白话**：iframe（把网页隔离在一个小框里跑，防它乱动主界面）；sandbox / 沙箱（给这个小框上的安全锁，限制它能干什么）；contentEditable（浏览器自带的"让这段网页能直接打字编辑"开关）；序列化（把屏幕上渲染好的网页，再翻译回 HTML 源码文字存盘）；worktree / 工作区（你当前正在改的那份代码副本）。

## 目标

让 HTML 文件能在预览页签里**就地编辑文字内容并保存回磁盘**，轻量档。

**可验证的验收标准**：

1. **能编辑能保存（核心）**：打开一个 `.html` 文件进 Preview 页签，点「编辑」→ 页面进入可编辑态 → 改一段文字 → 点「保存」→ 后端把新内容写回该文件 → 重新打开文件，改动仍在（用 `git diff` 能看到对应文字变化）。
2. **越界写文件被拦**：手工对写文件接口传一个项目目录外的路径（如 `../../etc/x`），后端拒绝并返回错误，不落盘。
3. **危险场景被禁用**：① 被截断（truncated）的文件，「编辑」按钮禁用/不出现；② 打开的是历史版本（非 WORKTREE 的 ref），「编辑」按钮禁用/不出现。
4. **操作日志起止配对**：在浏览器 LogsView 看到保存操作的 `scope=html-preview action=save-file`（或等价）起止配对；后端 `packages/server/data/logs/YYYY-MM-DD.log` 里有对应 `scope=fs action=write-file` 起止配对。失败分支（传非法路径）至少人工触发一次 ERROR 条目。
5. **类型检查 + 构建通过**：`pnpm -F @aimon/web build`（前端，含 TS 类型检查）成功；后端改动通过其类型检查/构建。

> 引用项目记忆（manual.md 2026-06-03「不再用 browser-use 自动验收」）：交付门槛=build+类型检查通过即可，不自动派浏览器测试 agent；上面第 1/3 条的"在浏览器里点出来"由大哥手动验，plan 保留这些可观察项作为他的验收图。

## 非目标 (Non-Goals)

- **不做**改颜色 / 改字号 / 拖拽布局 / 样式面板（GrapesJS 那种重型可视化搭建器）——结构与样式修改继续走现有"点元素 → 派给 AI 改"路径。
- **不做**新建文件 / 改文件名 / 删文件（保存只覆盖**已存在**的文件）。
- **不动** EditorArea 的页签数据模型（store 里的 `EditorTab`）——dirty（未保存）状态做成 HtmlPreview 组件内部局部状态，不引入跨组件的脏标记体系。
- **不碰** markdown / 图片 / Excel / 代码源码这些其它预览类型的编辑（本轮只给 HTML）。

## 实施步骤

1. **后端新增写文件路由**（`packages/server/src/routes/fs-ops.ts`，仿同文件现有 `gitignore-add` / `entry-delete` 模板）：
   - 新增 `PUT /api/projects/:id/fs/write-file`，body `{ path, content }`（zod 校验，content 设大小上限，如 ≤2MB）。
   - 守卫：`loadProjectOr404` → 拒绝 `HUB_PROJECT_ID` workspace → `safeResolve(proj.path, path)` + `toRepoRelative` 防越界/防写项目根 → **要求目标文件已存在**（`existsSync`，不存在返回 404，不新建）。
   - 写入用 `writeFile(abs, content, 'utf8')`；写后 `bustStatusCache(proj.path)`。
   - `serverLog('info','fs','write-file 开始'…)` / 成功 `(Nms)` / 失败 `error` + `meta.error`。
   - *验证*：起后端，curl PUT 一个真实文件改一个字 → 文件变了；传 `../` 越界路径 → 被拒；传不存在路径 → 404。
2. **前端 api 封装**（`packages/web/src/api.ts`）：加 `writeProjectFile(projectId, path, content)` → 调上面的路由。
   - *验证*：TS 类型通过；函数签名与后端 body 对齐。
3. **注入脚本加"编辑模式"**（`packages/web/src/components/htmlPreviewPicker.ts`，或新增一个 `htmlEditMode.ts` 注入脚本）：
   - 监听父窗 postMessage：`enter-edit`（`document.body.contentEditable='true'`，并**临时摘掉 picker 的 capture-phase click preventDefault**，否则光标无法定位）、`exit-edit`（还原）。
   - 收到 `request-save`：先把注入的脚本节点、`contenteditable` 属性、picker 残留的 inline outline 样式**清理干净**，再 `documentElement.outerHTML` 序列化，`postMessage({__aiSave__:true, html})` 回父窗。
   - *验证*：进入编辑后能点进文字打字；保存回传的 HTML 里**不含**注入脚本和 contenteditable 残留。
4. **HtmlPreview.tsx 接编辑 UI**（`packages/web/src/components/HtmlPreview.tsx`）：
   - 顶栏加「预览 / 编辑」切换 + 「保存」按钮；本地 `editing` / `dirty` 状态。
   - 进入编辑 → postMessage 通知 iframe；点保存 → postMessage 请求序列化 → 收到 HTML → `logAction('html-preview','save-file', () => writeProjectFile(...), ctx)` → 成功后 `dirty=false` 并刷新内容。
   - truncated 或非 WORKTREE 时不渲染「编辑」按钮（接收 props，见步骤 5）。
   - 含额外 `<script>` 的页面：进入编辑时显示一行警告条「此页含脚本，就地编辑可能改变结构，建议派 AI」（不阻断，仅提醒）。
   - *验证*：浏览器手动走通 编辑→改字→保存→重开仍在；LogsView 见起止配对。
5. **FilePreview.tsx 传只读信号**（`packages/web/src/components/FilePreview.tsx`）：
   - 给 `<HtmlPreview>` 多传 `editable`（= 是 WORKTREE 且 `!file.truncated`），让 HtmlPreview 决定是否给「编辑」入口。
   - *验证*：打开历史版本 / 截断文件时「编辑」按钮消失。
6. **收尾验收**：`pnpm -F @aimon/web build` 通过；`git diff --name-only HEAD` 比对只动了白名单内文件；手工触发一次失败分支（非法路径）确认 ERROR 日志。

## 边界情况

- **截断文件**：必须禁编辑——保存会用"加载到的（被截断的）内容"覆盖整个文件，丢掉尾部。靠步骤 5 的 `editable` 拦住。
- **历史版本（非 WORKTREE ref）**：只读，禁编辑。
- **注入脚本污染存盘**：序列化前必须剔除我们注入的 picker/编辑脚本与 `contenteditable` 属性，否则会把工具代码写进用户文件——步骤 3 的清理是硬要求。
- **picker 点击与编辑光标冲突**：编辑模式必须停掉 picker 的 capture click preventDefault。
- **磁盘文件在编辑期间被外部改动**：MVP 采用"最后写入者胜"（覆盖），不做冲突检测；在 context 记一句已知局限。
- **空文件 / 超大文件**：空可保存；超过大小上限后端拒绝（步骤 1 的 content 上限）。
- **相对资源（外链 css/img）**：sandbox 预览本就不解析相对资源（现状如此），编辑不改变这一点。

## 风险与注意

- **序列化保真**：把渲染后的 DOM 翻回 HTML 会改变原文件的缩进、引号风格、注释、属性顺序（浏览器归一化）。对 AI 生成的简单页面可接受；复杂页面靠警告条提示。这是本方案固有代价，不是 bug。
- **sandbox 安全权衡（关键决策）**：**不**给 iframe 加 `allow-same-origin`——它与 `allow-scripts` 同时存在会让沙箱形同虚设。改为让序列化发生在 iframe **内部**、只把 HTML 字符串 postMessage 回父窗，保持沙箱只有 `allow-scripts`。
- **写文件是高危 mutation**：路径守卫（safeResolve+toRepoRelative+拒绝 hub+要求已存在）是安全底线，必须有起止日志可回放。
- **破坏性变更协议自查**：本任务**新增**一个 HTTP 路由、**新增**前端导出函数、给 HtmlPreview/FilePreview **加** props，均为新增不删改，不触发"删源码/删≥5行/改已有导出符号/改已有路由/改表结构"红线。无需事前 grep 受影响清单。

## 多模型 Plan 会审

跳过：Codex CLI 未安装（codex:rescue 返回 "Codex CLI is not installed"），按 CLAUDE.md 规则失败即回退 Claude 单独写 plan，不阻塞交付。本 plan 由 Claude 单独产出。
