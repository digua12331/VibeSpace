# MD页签评论功能 · Context

## 关键文件

本次改动会读/会改的文件清单——**执行阶段原则上只动这里列的文件，要溢出先回来补**。

### 后端（新增）

- `packages/server/src/comments-service.ts`（新建）
  - 导出 `CommentEntry` / `CommentAnchor` 类型
  - `readComments(projectPath, relFilePath)` / `writeComments(projectPath, relFilePath, list)`
  - 路径安全：复用 `git-service.ts:194` 的 `safeResolve(projectPath, input)`（已有，不要自己再写一份）
  - 错误类型：参照 `docs-service.ts:DocsServiceError` 写一个 `CommentsServiceError { code, httpStatus, message }`

- `packages/server/src/routes/comments.ts`（新建）
  - `registerCommentsRoutes(app)` 形式，和 `docs.ts:44` 保持一致
  - 四个端点：GET 列表 / POST 新增 / PATCH 编辑 / DELETE 删除
  - 每个 mutation 用 `serverLog('info', 'comments', ...)` 起止配对
  - 入参 zod schema + `safeParse`，失败统一走 `send({ error, detail })`

### 后端（改动）

- `packages/server/src/index.ts:29-31`
  - 加 `import { registerCommentsRoutes } from "./routes/comments.js";`
- `packages/server/src/index.ts:139-153`
  - 在路由注册块里加 `await registerCommentsRoutes(app);`

### 前端（新增）

- `packages/web/src/commentAnchor.ts`（新建）
  - `type Anchor = { anchorId, blockType, index, contentHash, textPreview }`
  - `extractAnchors(markdown: string): Anchor[]`——用 `mdast-util-from-markdown` 跑一次 AST，过滤到 block 级（h1-h6 / paragraph / code / list-item / blockquote），按文档顺序编号，`contentHash` 用 FNV-1a 或简化的 32-bit hash（不需要加密强度）。
  - `matchAnchor(storedAnchor, freshAnchors): Anchor | null`——先按 `contentHash` 找，再按 `blockType+index` 降级，否则返回 null（orphan）。
- `packages/web/src/components/CommentsPanel.tsx`（新建）
- `packages/web/src/components/CommentPopover.tsx`（新建）
- `packages/web/src/rehypeAnchorIds.ts`（新建）
  - 一个 rehype 插件，遍历 hast 树，给 block 节点（按与 `commentAnchor.ts` 完全相同的枚举顺序）注入 `data-anchor-id` 属性。这是"mdast-anchor-id 和 hast DOM 节点"的桥。

### 前端（改动）

- `packages/web/src/types.ts`
  - 加 `CommentEntry` / `CommentAnchor` / `CommentsFile` 类型
- `packages/web/src/api.ts:~342`（`Dev Docs` 分隔块下方新开 `// ---------- Comments ----------`）
  - `listComments / createComment / updateComment / deleteComment`
- `packages/web/src/components/MarkdownView.tsx`
  - 在 `rehypePlugins` 里挂上新写的 `rehypeAnchorIds`
  - 扩展 `SCHEMA`（rehype-sanitize 的白名单）：允许 `data-anchor-id` 这个 attr（sanitize 默认会剥非标准 attr）
  - `components` 钩子里给 block 元素挂"hover 💬"角标；接收新 props：`anchorCounts: Record<anchorId, number>`、`onBlockCommentClick(anchorId, domNode)`
- `packages/web/src/components/FilePreview.tsx`
  - `isMarkdownPath(path)` 为 true 时，把渲染体外层从单列改成横向 flex：左边原内容，右边 `<CommentsPanel />`
  - 写入只读逻辑：只有 `ref === 'WORKTREE' || !ref` **且** `!from && !to` 时允许新增/编辑/删除
  - 组件拆分：把现有 `header + body` 抽成一个 inner，避免 JSX 缩进太深

### 前端（依赖）

- `packages/web/package.json`
  - `dependencies` 加 `"mdast-util-from-markdown": "^2.0.3"`（版本跟 pnpm 已解析的版本对齐，避免重复落盘）
  - `pnpm install` 后 `pnpm --filter @aimon/web typecheck` 确认无 peer 冲突

## 决策记录

每条都答了"资深工程师看了会不会觉得过度设计？"的自检。

### D1. 用 `mdast-util-from-markdown` 而不是 `unified + remark-parse`

选它是因为 **只需要一次解析** → 取 mdast → 自己走树。不需要 unified 的 processor 链路，不需要 remark 插件生态。包本身 ~10KB，比 `unified + remark-parse` 的组合轻一半。**过度设计？否**——更小的依赖面。

### D2. anchor 策略：`blockType + index + contentHash` 三合一

- **primary match**：`contentHash` 相同（段落原文未变，即使前面插入了新段落也不受影响）
- **fallback**：`blockType + index` 相同（段落被改写但位置仍是"第 3 个 h2"）
- **都失败**：orphan，展示原 `textPreview`，让用户手工决定删/留

**过度设计？否**——两级匹配是最低限度稳健。再升级（语义相似度 / CRDT）就是明显超配，单人场景不值。

### D3. CommentsPanel 宽度固定 320px，不可拖拽

MVP 直接 `w-[320px]` + 折叠按钮。web 包里虽然有 `react-resizable-panels`，但引入到这里只会增加一条 `<PanelGroup>`/`<Panel>` 的嵌套，还要处理持久化宽度——**资深工程师会觉得过度设计**，砍掉。后续真有人嫌窄再加。

### D4. 评论不进 zustand store，放 CommentsPanel 本地 state

docs/issues/memory 进 store 是因为侧边栏和文件 tab 要共享；评论只在当前 FilePreview 里用。本地 state + 每次 open 文件时 `useEffect` 拉一次即可。**过度设计？否**——跨组件共享是引入 store 的唯一理由，这里没有。

### D5. 不做乐观更新，mutation 后 refetch 整份

节约复杂度（不用维护"待发送/已发送/冲突回滚"状态机）。单人本地网络基本是 127.0.0.1，延迟 < 10ms，看不出差别。**过度设计？否**——反过来说，做乐观更新才是过度设计。

### D6. sidecar 文件格式 v1

```json
{
  "version": 1,
  "comments": [
    {
      "id": "cmt_<8位随机>",
      "anchor": {
        "anchorId": "h2-3-a7f2c8d9",
        "blockType": "h2",
        "index": 3,
        "contentHash": "a7f2c8d9",
        "textPreview": "段落前 80 字符..."
      },
      "body": "评论正文（纯文本）",
      "createdAt": 1713899999999,
      "updatedAt": 1713899999999
    }
  ]
}
```

- 带 `version` 字段给未来预留（读到未知 version 返回空 + ERROR 日志）
- **没有** `author`、`replies`、`reactions`、`mentions`、`status`、`visibility` 字段（单人 / 扁平 / 本轮不做）
- ID 生成用 `crypto.randomUUID().slice(0, 8)`（node 和浏览器都有，不用引 nanoid）

### D7. 只读模式的触发条件

允许写入 = `(!ref || ref === 'WORKTREE') && !from && !to`。

- 打开 HEAD 只读视图（`ref='HEAD'`）：面板只读
- 打开 commit 历史视图（`ref=<sha>`）：面板只读
- Diff 视图（`from/to` 有值）：面板只读
- 当前工作树：面板可写

**过度设计？否**——评论只有一份（sidecar），跟着 worktree 走；历史 commit 不应该被当前评论污染。

### D8. 面板布局：右侧抽屉而非 Preview 内浮动或底部 drawer

- **右侧 320px 列**：不遮挡内容、可折叠，Diff/Source/Preview 都能共存
- **不选 Preview 内浮动**：Source/Diff 就看不见了，违背用户选择的 B=整个文件 tab
- **不选底部 drawer**：md 内容本身就是竖直长条，评论再挤底部上下都挤

**过度设计？否**——最少嵌套、最大兼容。

### D9. 评论正文纯文本，不渲染 markdown

- 展示用 `<div className="whitespace-pre-wrap">`
- 不做 markdown 渲染，不做 mention 高亮，不做 emoji picker
- 输入用原生 `<textarea>`，无 toolbar

**过度设计？否**——评论里套 markdown 是个兔子洞（sanitization、递归高度、嵌套评论？），先纯文本。

### D10. 不做 ref="WORKTREE" 的实时同步

两个浏览器 tab 同时编辑评论 → 后写覆盖先写。单人本地不太可能同时开两份；真发生了也是最小损失。**过度设计？否**——上锁 / 版本号 / OT 都超配。

## 依赖与约束

### 运行时依赖

- **后端**：`@fastify/*`、`zod`（已有）、`node:fs/promises`（标准库）——无新增依赖
- **前端**：新增 `mdast-util-from-markdown`；其它（`unified`、`mdast-util-*`）不单独引入，只用这一颗

### 类型检查与编译

- `pnpm --filter @aimon/web typecheck` 必须过（`tsc -b` 在 `build` 里，单独跑类型检查需要确认脚本；若没有则改为 `pnpm --filter @aimon/web exec tsc --noEmit -p tsconfig.json`，在 tasks 阶段具体确认命令）
- `pnpm --filter @aimon/server typecheck` 必须过（同上）

### 上游 API 行为约定

- FilePreview 现有的 `useEffect` fetch 链（path/ref/from/to/tab 变化重拉）**不能被 CommentsPanel 的存在触发重新执行**。具体做法：CommentsPanel 的 fetch 依赖只有 `projectId + path + 首次挂载`，不读 ref/from/to/tab；避开 FilePreview 的 `didAutoFallbackRef` 这套。
- MarkdownView 之前的 `rehypeSanitize` 配置不能放松——加 `data-anchor-id` 白名单只对 block 元素生效，`<script>` 之类照旧拦截。
- sidecar path 约定：给定 md 的相对路径 `foo/bar.md` → sidecar 为 `foo/bar.md.comments.json`（保留完整后缀比 `foo/bar.comments.json` 更安全——不会跟用户已有的 `bar.comments.md` 冲突）

### 兼容性与边界

- Node fs 层 **不自动创建中间目录**：sidecar 路径已经在 md 同目录，不需要建目录；只需 `writeFile` 时目录已经存在（md 文件都在那，目录必定存在）
- Windows 路径分隔符：服务端用 `safeResolve` 处理过了；前端 URL 始终用 POSIX `/`
- 字符编码：sidecar 一律 UTF-8，`JSON.stringify(obj, null, 2)` 写入（人类可读 + 对 git diff 友好）
- 并发：单进程，写入用 `writeFile`（非原子），丢风险极低；追求原子性要 `writeFile tmp + rename`，本轮不做

### 不在本任务范围但要记住的外部约束

- 归档任务时目前只打包 `dev/active/<task>/` 三件套，**不会**扫 sidecar json——也就是说打包 + 评审都跟评论无关，互不干扰
- `.gitignore` **不动**——sidecar json 按设计要进版本库。后续用户不想让评论进 git，自己加 ignore 规则

## 熔断边界复盘

执行阶段遇到以下任一，立刻停手、不硬修：

1. `mdast-util-from-markdown` 的 block 枚举结果和 `rehype` 插件看到的 hast 节点顺序**对不上**（比如 GFM table 的 cell 计数歧义）→ 停，回来改方案，可能要放弃"插件注入 anchorId"走纯 components 钩子计数
2. rehype-sanitize 升级白名单后**反而**把 `data-anchor-id` 剥掉了（配置不生效）→ 停，可能需要换 schema 写法
3. FilePreview 加 CommentsPanel 后 **老的 Diff/Source tab 切换出现渲染抖动或死循环** → 停，回到纯文件层外包一层 wrapper（而非改 FilePreview 内部结构）
