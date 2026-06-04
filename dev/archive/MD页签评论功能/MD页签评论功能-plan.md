# MD页签评论功能 · Plan

> memory 扫过 `dev/memory/auto.md` / `manual.md`：无与本任务相关的条目。

## 用户选择的方向

- **位置**：B. 整个文件 tab —— 评论面板贯穿 Diff/Source/Preview 三个子 tab，不是 Preview 专属
- **粒度**：b. 绑定到段落 / 标题 / 代码块（block 级，不到划词）
- **存储**：i. 旁路 JSON 文件 —— `<path>.comments.json` 与 md 同目录，跟着 git 走
- **作者**：① 本地单人 —— 不记作者字段（或统一写"local"），无权限、无通知、无 @mention

## 目标（可验证的验收标准）

核心体验："打开一个 md 文件 → 给里面的某一段文字写条评论 → 关掉重开/刷新后评论仍贴在原段落旁"，不污染 md 源文件。

浏览器可观察的验收项（UI 改动硬性要求）：

1. 打开 `.md` 文件 tab，切到 **Preview** 子 tab：每个 block（h1/h2/h3、段落、代码块、有序/无序列表项、blockquote）右侧 hover 出现 💬 图标；点击弹出 popover 输入框 + "保存"。
2. 保存后在项目同目录生成 `<filename>.comments.json`，刷新页面该 block 旁显示 💬 角标 + 计数（如 `💬 2`）。
3. 切到 **Source** 子 tab：评论不消失（因为 B=整个文件 tab），以"flat 评论列表"形式在文件 tab 底部/右侧面板展示，每条带"跳到 Preview 的该段落"的定位按钮。
4. 切到 **Diff** 子 tab：评论面板仍在，条目不变（diff 是另一种视图，不重新锚定）。
5. 修改 md 源文件让某段内容变化导致 hash 不匹配：该评论自动进入"孤儿评论"分组，展示"原段落预览文本"，用户可手动删除或保留。
6. 删除评论：`<filename>.comments.json` 对应条目消失；如果文件最终变成空数组，sidecar 文件可保留（不自动清空文件）。
7. LogsView 里能看到起止配对：
   - `scope=comments action=create` info 起止（创建）
   - `scope=comments action=update` info 起止（编辑）
   - `scope=comments action=delete` info 起止（删除）
   - 至少人工触发过一次失败分支（如后端 500 或非法 path），LogsView 里有对应 ERROR 条目
8. `pnpm --filter @aimon/web typecheck` 和 `pnpm --filter @aimon/server typecheck`（或项目对应的类型检查命令，以 `package.json` 为准）全部通过。

## 非目标（本次不做）

- **不做** 多人协作：不引入作者字段、不引入已读/未读、不引入 @mention、不广播 WS
- **不做** 划词批注（c 选项）：只到 block 级，不处理行内选区
- **不做** 跨 commit / 历史版本的评论（`ref` 是 HEAD 时也只对 WORKTREE 生效，不为 `commitSha` tab 启用）
- **不做** 评论中的 markdown / emoji 渲染：评论正文当纯文本存储和展示（避免递归渲染），后续需要再加
- **不做** 评论回复 / 线程结构：扁平列表，每条独立
- **不做** 非 md 文件（.ts/.py/...）的评论：本轮仅 `.md/.markdown/.mdx`
- **不做** 文件重命名/移动时 sidecar 自动跟随：移动后 orphan（在 context 里会写进"已知边界情况"）
- **不做** 打通 `dev/issues.md` 或"派 Claude"按钮等衍生能力

## 实施步骤（粗粒度）

1. **后端：sidecar JSON 读写服务**
   - 新文件 `packages/server/src/comments-service.ts`：定义 `CommentEntry` 类型 + `readComments(projectPath, filePath)` / `writeComments(...)`。
   - 路径安全校验：复用/仿照 `docs-service.ts` 里的"禁止越出项目根"逻辑，避免 `../` 穿越。
   - 验证：写单测或 curl 手测——往 `xxx.md.comments.json` 写一条，能读回；传 `../etc/passwd` 被拒。

2. **后端：路由 `packages/server/src/routes/comments.ts`**
   - `GET /api/projects/:id/comments?path=...` 返回 `{ comments: CommentEntry[] }`
   - `POST /api/projects/:id/comments` body `{ path, anchor, body }` 追加一条
   - `PATCH /api/projects/:id/comments/:cid` body `{ path, body }` 编辑
   - `DELETE /api/projects/:id/comments/:cid?path=...` 删除
   - 每个 mutation 包 `serverLog('info', 'comments', '<action> 开始/成功/失败', {...})` 起止配对。
   - 在 `packages/server/src/index.ts` 里注册路由。
   - 验证：curl POST/GET/DELETE 各跑一次，`<filename>.comments.json` 内容符合预期；LogsView 看到日志。

3. **前端：API client + 类型**
   - `packages/web/src/api.ts` 加 `listComments / createComment / updateComment / deleteComment`。
   - `packages/web/src/types.ts` 加 `CommentEntry` / `CommentAnchor` 类型。
   - 验证：`tsc --noEmit` 通过。

4. **前端：anchor 生成工具**
   - 新文件 `packages/web/src/commentAnchor.ts`：给定 markdown 源，产出 block 列表 `{ anchorId, blockType, index, contentHash, textPreview }`。
     - `anchorId` 策略：`<blockType>-<index>-<shortContentHash>`（e.g. `h2-3-a7f2`），三要素任一变化都会断。匹配时优先按 `contentHash` 找，找不到再按 `blockType+index` 降级匹配，都失败就 orphan。
     - 使用现成的 markdown AST：`remark-parse` + `unified`（已通过 `react-markdown` 的传递依赖在 web 包里；如未直接依赖需补 `remark-parse`）。
   - 验证：单测覆盖"新增段落让 index 变化但 hash 保留"、"改 heading 文本让 hash 变化"两条路径。

5. **前端：Preview 层挂锚点 + 💬 角标**
   - 改 `packages/web/src/components/MarkdownView.tsx`：
     - 在渲染 block 级节点（`h1-h6`、`p`、`pre/code`、`li`、`blockquote`）时注入 `data-anchor-id`。
     - 接收 `anchorMap` + `onBlockComment(anchorId)` prop，用 absolute 定位的 💬 图标悬浮在每个 block 右侧，hover 出现，常驻 count badge（当 anchor 已有评论）。
   - 验证：打开一个 md 文件，每个段落右侧 hover 出 💬；已写过评论的段落常驻角标。

6. **前端：评论面板 + popover**
   - 新文件 `packages/web/src/components/CommentsPanel.tsx`：一个可折叠的右侧抽屉 / 底部面板（默认右侧；宽度 ≥ 280px 可拖）。
     - 顶部 tab：`全部 N` / `孤儿 M`
     - 列表项：内容预览 + block 预览 + 编辑/删除按钮 + 定位按钮（点了之后在 Preview 里 `scrollIntoView` 对应 block）
   - 新文件 `packages/web/src/components/CommentPopover.tsx`：点 💬 后出现的输入框（多行 textarea + 保存/取消），保存时调 `createComment` 并 `logAction('comments', 'create', ...)`。
   - 改 `packages/web/src/components/FilePreview.tsx`：
     - 用 `isMarkdownPath(path)` 判断是否启用评论能力，启用时 wrap 一层 flex 容器，右侧放 CommentsPanel。
     - `ref/from/to` 都传，但仅当 `ref=='WORKTREE'` 或未指定时启用写入（历史 commit 只读）。
   - 验证：写一条、编辑、删除全跑一遍；切换 Preview/Source/Diff 评论面板不消失。

7. **前端：操作日志埋点**
   - 所有 mutation（create/update/delete）必须走 `logAction('comments', '<action>', () => api.xxx(...), { projectId, meta: { path, commentId } })`。
   - 列表 load 失败、popover 保存失败都触发 ERROR 日志。
   - 验证：LogsView 里看到起止配对；故意 kill 后端再点保存 → 看到 ERROR 条目。

8. **收尾：类型检查 + 视觉 smoke**
   - `pnpm typecheck`（或项目里对应脚本）通过。
   - 启动 dev server，在浏览器里至少覆盖上面"验收标准"第 1–7 条。

## 边界情况

- **md 被改到锚点全断**：所有评论都进 orphan 区，不报错；用户自行决定删/留。
- **sidecar json 手工损坏**：读失败时返回空数组 + 一条 ERROR 日志，不把文件 tab 炸掉；不自动覆盖，怕吞用户手工数据。
- **大文件**：md 如果超过 FilePreview 的 `truncated` 阈值，Preview 依然只渲染截断部分；评论面板仍可显示全量条目（按 anchor 匹配决定定位是否成功）。
- **空 md**：没有 block 就没有 💬 角标；面板展示"本文件暂无评论"。
- **同一 block 多条评论**：按时间顺序展示；角标显示 `💬 N`。
- **`/diff` 视图**：`from/to` 任一存在时，Preview 不渲染（原逻辑），但 CommentsPanel 还在 —— 评论面板不依赖 block 锚点定位，只按 anchorId 展示条目。
- **commitSha 打开的历史只读 tab**：评论面板进入只读模式（隐藏"新增评论"入口、popover 不可保存），避免用户误以为给历史版本加了评论。

## 风险与注意

- **remark-parse 依赖**：`react-markdown` 内部走 `mdast`，但把它独立暴露给我们自己解析 anchor 要确认 `remark-parse`/`unified` 在 `packages/web/package.json` 里是否已经有直接依赖；没有的话要补一条 —— 顺带检查现有 `react-markdown` 版本以免 peer 冲突。**这个假设需要在 context 阶段确认**。
- **anchor 策略会"部分失效"**：contentHash + index + blockType 三要素任一变化都可能 orphan，这是 MVP 的已知 trade-off。更健壮的方案（比如 CRDT 或 diff-based 重锚定）明显超配，按"资深工程师会不会觉得过度设计"标准本轮不做。
- **FilePreview 的 `useEffect` 依赖链里已经有 tab 切换的 auto-fallback 逻辑**，加 CommentsPanel 时要小心不要触发重新 fetch 或 tab 抖动——评论面板应该在 FilePreview 外层 wrap，**不参与** `didAutoFallbackRef` 那套逻辑。
- **路径穿越**：`POST /api/projects/:id/comments` 的 `path` 来自前端，要在后端做严格的 relative-path 校验（复用或抽出 `docs-service.ts` 的同类工具），否则可能读写项目根外的文件。
- **ref 语义**：CommentsPanel 写入只对 `WORKTREE` 打开的文件启用；`commitSha`/`from`/`to` 打开的只读。
- **只记一条的坑**：每个 mutation 必须起止配对；如果 `createComment` 失败只记开始没记终点，LogsView 会出现"永远显示进行中"的条目。`logAction` 已经处理了这个，不要手工 `pushLog`。
- **sidecar 会进 git**：用户如果不希望评论跟着提交，后续要考虑 `.gitignore` 规则或配置开关——本轮按"跟着 git"默认走，不加配置，避免过度设计。
