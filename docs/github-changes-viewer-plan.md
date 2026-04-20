# 源代码更改列表 & 文件预览方案（GitHub-style Changes Viewer）

## 1. 需求与上下文

aimon 的每个 project 已经是一个本地目录（[packages/server/src/routes/projects.ts:16-19](../packages/server/src/routes/projects.ts#L16-L19)），因此最低成本的形态是：

- 在选中某个 project 时，侧栏 / 抽屉里展示该目录的 **源代码更改列表**（Git working tree + 最近提交）。
- 点击列表中的任意文件，右侧打开预览：
  - `*.md` → 按 GitHub 风格渲染（GFM、代码块、链接、checkbox、表格、mermaid 可选）。
  - 源码文件 → 语法高亮 + 可切到 diff 视图（unified / split）。
  - 二进制 / 图片 → 基础占位或缩略图。
- 可选第二阶段：拉取 **GitHub 远端** 的 PR / Compare / Commit 列表（Octokit），用同一套 UI 渲染。

关键约束：
- 纯本地模式必须能跑（大量用户只是本地仓库，没有推到 GitHub）。
- 服务端只读，不做 `git commit / push / reset`，避免破坏用户工作树。
- 性能敏感：大仓库 `git status` 可能几百 ms，需要缓存 + 增量刷新。
- 安全：限制读取范围必须在 `project.path` 下（防 path traversal）。

---

## 2. 开源选型（已调研，给出推荐 + 备选）

### 2.1 服务端：Git 读取

| 候选 | 评估 | 推荐度 |
| --- | --- | --- |
| **`simple-git`** | 纯 Node，封装 `git` CLI；API 覆盖 `status / diff / log / show / revparse`，稳定、依赖系统 git。 | ★★★★★ 主力 |
| `isomorphic-git` | 纯 JS 实现，不依赖系统 git；但大仓库 status 慢 2–5×，且 `diff` 需自己拼。 | 备选（无 git 环境时降级） |
| `nodegit` | 原生绑定快但安装容易翻车，Windows 常年有编译问题。 | ❌ 不选 |

**选 `simple-git`**。用户本地跑 claude/codex，系统肯定有 git。

### 2.2 服务端：GitHub 远端（阶段二）

- **`@octokit/rest`**：官方 GitHub REST SDK，覆盖 PR / Compare / Contents；附带 rate-limit header 处理。
- 认证：GitHub Personal Access Token（写在 `~/.aimon/github.json`，只读 `repo` scope）。
- 目前不是 MVP，不做。

### 2.3 前端：Markdown 渲染

| 候选 | 评估 | 推荐度 |
| --- | --- | --- |
| **`react-markdown` + `remark-gfm` + `rehype-highlight` (或 `rehype-shiki`) + `rehype-raw`** | 组合积木，安全（默认不 eval HTML），支持 GFM（表格 / 任务列表 / 删除线）。 | ★★★★★ 主力 |
| `@uiw/react-markdown-preview` | 一行引入、GitHub 皮肤、带 mermaid，但样式强耦合、覆盖麻烦。 | 备选 |
| `marked` / `markdown-it` | 非 React 原生，需要自己包一层 + 手动 sanitize。 | ❌ 不选 |

**选 `react-markdown`** 组合 —— 和现有 React 19 / Tailwind 样式体系最契合。

### 2.4 前端：语法高亮

| 候选 | 评估 | 推荐度 |
| --- | --- | --- |
| **`shiki`** (or `shikiji`) | VS Code 同款 TextMate 语法，效果最接近 GitHub；支持 dark+ 主题；WASM 约 300KB，可按需加载 grammar。 | ★★★★★ 主力 |
| `prismjs` + `react-syntax-highlighter` | 更轻量（~30KB），支持语言多；但 JS/TS/TSX 的高亮精度弱于 shiki。 | 备选 |
| `highlight.js` | 同上，精度不及 shiki。 | 备选 |

**选 `shiki`**，渲染后直接输出字符串 HTML，可喂给 `react-markdown` 的 code 块，也能给 diff viewer 用。

### 2.5 前端：Diff 渲染

| 候选 | 评估 | 推荐度 |
| --- | --- | --- |
| **`@git-diff-view/react`** | 新，主动维护；支持 split / unified、语法高亮 hook、折叠大 hunk；TS 定义完整。 | ★★★★★ 主力 |
| `react-diff-view` | 老牌，功能全但维护频率低；`parse-diff` 工具链成熟。 | 备选（若 `@git-diff-view` 出坑） |
| `diff2html` | HTML 字符串输出、GitHub 皮肤，但非 React 组件、事件接入麻烦。 | ❌ |
| `react-diff-viewer-continued` | 只做字符串对比，不理解 unified diff 语义。 | ❌ |

**选 `@git-diff-view/react`**，服务端直接给 `git diff --no-color file` 的 unified patch，前端解析渲染。

### 2.6 前端：文件树

- **`@headlessui/react` + 自绘 tree**（更贴现有 Fluent-ish 主题），或
- **`react-arborist`**（虚拟化、几千节点也不卡），适合大仓库。

MVP 先做扁平列表（按 `staged / working / untracked` 分组），仓库大了再引入 arborist。

---

## 3. 整体架构

```
 Browser
  └── ChangesDrawer (新组件)
       ├── ChangesList     ←→ GET  /api/projects/:id/changes
       │                        GET  /api/projects/:id/commits?limit=30
       │                        GET  /api/projects/:id/commits/:sha
       │   点击文件 ↓
       ├── FilePreview
       │   ├── <MarkdownView/>   (react-markdown + shiki)
       │   ├── <CodeView/>       (shiki)
       │   └── <DiffView/>       (@git-diff-view/react)
       │     ↑ 依次调用
       │       GET /api/projects/:id/file?ref=HEAD&path=...
       │       GET /api/projects/:id/diff?from=HEAD&to=WORKTREE&path=...
       └── Toolbar (ref 选择、搜索、刷新)
```

服务端新加一个 `git-service.ts`，对 `simple-git` 做薄封装 + 安全校验；路由集中到 `routes/git.ts`。

---

## 4. 服务端 API 设计（新增）

全部挂在 `/api/projects/:id/…` 下，要求 project 存在；否则 404。

### 4.1 工作树状态（Changes）

```
GET /api/projects/:id/changes
→ {
    branch: "main",
    ahead: 2, behind: 0, detached: false,
    staged:    [{ path, status: "M"|"A"|"D"|"R"|"C", renamedFrom? }],
    unstaged:  [...],
    untracked: [{ path }]
  }
```

实现：`simpleGit(cwd).status()`，映射到上面的 shape。

### 4.2 最近提交

```
GET /api/projects/:id/commits?limit=30&branch=main
→ [{ sha, shortSha, author, email, date, subject, body, parents: [sha...] }]
```

实现：`git log --pretty=format:... -n 30`，simple-git `.log()`。

### 4.3 单个提交的文件列表

```
GET /api/projects/:id/commits/:sha
→ {
    sha, parents, author, date, subject, body,
    files: [{ path, status, additions, deletions }]
  }
```

实现：`git show --stat --name-status <sha>`。

### 4.4 文件内容（按 ref）

```
GET /api/projects/:id/file?path=src/a.ts&ref=HEAD
→ { path, ref, size, encoding: "utf8"|"base64", content, language }
```

- `ref=WORKTREE` 时直接读磁盘。
- 否则 `git show <ref>:<path>`。
- `size > 1MB` 只返回元数据 + 截断标记，前端显示 "文件过大，仅预览前 N 行"。
- `language` 用扩展名推断（`ts/tsx/md/py/...`），只是给 shiki 一个提示；不认识就返回 `plaintext`。

### 4.5 单文件 diff

```
GET /api/projects/:id/diff?path=src/a.ts&from=HEAD&to=WORKTREE
→ { path, from, to, patch: "<unified diff>", isBinary: false }
```

- `to=WORKTREE` 且 `from=HEAD` ⇒ `git diff HEAD -- <path>`。
- `to=INDEX` ⇒ `git diff --cached -- <path>`。
- 普通 `from=<shaA>&to=<shaB>` ⇒ `git diff <a> <b> -- <path>`。

### 4.6 安全与错误

- **Path traversal 防护**：服务端对 `path` 做 `path.resolve(project.path, p)`，断言 `startsWith(project.path + sep)`；失败返回 `400 path_outside_project`。
- **ref 白名单**：只允许 `HEAD`、`WORKTREE`、`INDEX`，或 40 位 hex sha；其他驳回。
- **非 git 目录**：调用 `git rev-parse --is-inside-work-tree` 失败时返回 `{ enabled: false }` 让前端隐藏入口。
- **大仓库**：`changes` 接口做 30s 内存缓存（key = `projectId + mtime(HEAD)`），被 FS watcher 失效。

### 4.7 依赖改动

```
# packages/server
pnpm --filter @aimon/server add simple-git
```

新建文件：
- [packages/server/src/git-service.ts](../packages/server/src/git-service.ts) — 一个 `SimpleGit` 单例 per project，外加 status / log / show / diff 封装。
- [packages/server/src/routes/git.ts](../packages/server/src/routes/git.ts) — 上述 6 个路由，zod 校验。
- 在 [packages/server/src/index.ts](../packages/server/src/index.ts) 的路由注册区加入 `registerGitRoutes(app)`。

---

## 5. 前端实现

### 5.1 依赖

```
pnpm --filter @aimon/web add \
  react-markdown remark-gfm rehype-raw rehype-sanitize \
  shiki @git-diff-view/react
```

（注意 shiki 要按需引入语言：`createHighlighter({ langs: ['ts','tsx','js','json','md','bash','py'] })`，避免一次全量。）

### 5.2 新组件与位置

- [packages/web/src/components/ChangesDrawer.tsx](../packages/web/src/components/ChangesDrawer.tsx) —— 右侧抽屉，顶级容器。
- [packages/web/src/components/ChangesList.tsx](../packages/web/src/components/ChangesList.tsx) —— 两段：Working changes（staged/unstaged/untracked 三个折叠组）+ Recent commits（分页 load-more）。
- [packages/web/src/components/FilePreview.tsx](../packages/web/src/components/FilePreview.tsx) —— 顶部 tab：`Diff` / `Source` / `Preview`（仅 md 显示）。
- [packages/web/src/components/MarkdownView.tsx](../packages/web/src/components/MarkdownView.tsx) —— `react-markdown` 封装，配置 `remark-gfm` + 自定义 code renderer（调 shiki）。
- [packages/web/src/components/CodeView.tsx](../packages/web/src/components/CodeView.tsx) —— 直接 shiki → 注入 `<pre><code>`，加行号。
- [packages/web/src/components/DiffView.tsx](../packages/web/src/components/DiffView.tsx) —— `@git-diff-view/react`，传 unified patch + lang 提示。

### 5.3 状态管理（zustand 已有）

在 [packages/web/src/store.ts](../packages/web/src/store.ts) 追加：

```ts
changesOpen: boolean
changesProjectId: string | null
selectedFile: { path: string; status?: string; ref?: 'HEAD'|'WORKTREE'|string } | null
openChanges(projectId: string): void
closeChanges(): void
selectFile(f: SelectedFile): void
```

### 5.4 入口

在 [packages/web/src/components/ProjectSidebar.tsx](../packages/web/src/components/ProjectSidebar.tsx) 每一行项目条目尾部加一颗按钮 `📂 更改`，或在选中 project 后的 session 栅格上方加一条工具条 `📂 查看代码更改`。

点击 → `openChanges(project.id)` → `ChangesDrawer` 从右侧滑出（复用 `LogDrawer` 的样式）。

### 5.5 Markdown 的 GFM + 安全

- `remark-gfm` 提供 table / strikethrough / tasklist / autolink。
- `rehype-sanitize` 默认白名单配置 + 允许 `className`（给 shiki 高亮用）。
- 不启用 `rehype-raw`（否则有 XSS 风险，除非你信任仓库）。如果用户要求原 HTML，再显式开，并接 sanitize。

### 5.6 Diff 的语言提示

- 文件扩展 → shiki 的 language id 映射一张小表（`lang.ts`）。
- `@git-diff-view/react` 接受 `highlighter` prop；把 shiki 实例传进去，它就按 hunk 同步高亮。

---

## 6. 分期实施路线图

### 阶段 0 — 基建 (0.5d)
- 加 `simple-git` 依赖。
- 写 `git-service.ts` + `routes/git.ts` 骨架 + path-traversal 守卫。
- 加 `/api/projects/:id/changes` 一条跑通。

### 阶段 1 — MVP（纯本地 Git）(1.5d)
- 实现 4.1–4.5 全部 6 个接口。
- 前端：`ChangesDrawer` + `ChangesList`（working changes + 最近 30 条 commits）。
- `FilePreview` 三个视图（Source / Diff / Preview）。
- Markdown 用 `react-markdown + remark-gfm`，代码块不高亮先跑通。
- 单文件 diff 用 `@git-diff-view/react` unified 模式。

### 阶段 2 — 观感提升 (1d)
- 接入 shiki，md 代码块 + CodeView + DiffView 三处共享 highlighter。
- 文件树分组折叠、搜索框、状态徽标（M/A/D/R 颜色沿用 Fluent 主题）。
- 大文件截断提示；二进制 / 图片占位。

### 阶段 3（可选）— GitHub 远端
- `@octokit/rest` + PAT 存在 `~/.aimon/github.json`。
- 新增 `/api/github/repos/:owner/:repo/pulls` 等，只读。
- 前端在 ChangesDrawer 顶部加 tab：`Local Git` / `GitHub PRs`。

### 阶段 4（可选）— 质量
- FS watcher（`chokidar`）→ 工作树变更推 WS 事件，前端自动刷 `changes`。
- 行级评论 / commit 搜索 / blame。

---

## 7. 风险与取舍

- **Windows 路径大小写**：`git status` 返回 `/` 分隔的相对路径；前端拼接时统一用 `/`，发到服务端后交给 `path.resolve`。
- **`simple-git` 输出依赖 locale**：用 `env: { LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' }`，避免本地化字符串 + 写 index 锁。
- **shiki bundle 大小**：按需 `loadLanguage` + 动态 import，避免首屏阻塞。
- **未初始化仓库**：全部接口先过 `isInsideWorkTree()` 短路，UI 展示 "此项目不是 git 仓库"。
- **保持只读**：即便后期加 GitHub，服务端也不要暴露写操作路由，防 prompt injection 让 agent 触发破坏性 git 命令。

---

## 8. 结论与下一步

**推荐组合**：`simple-git`（后端）+ `react-markdown` + `remark-gfm` + `shiki` + `@git-diff-view/react`（前端）。

可以先落阶段 0–1，约 2 人日出一个能看、能点、能 diff 的 MVP；之后再逐步补 shiki 高亮、GitHub 远端、文件树虚拟化。

如果同意这套方案，下一步具体要做的第一件事是：

1. 新建 `packages/server/src/git-service.ts` + `routes/git.ts` 骨架；
2. 在 [packages/server/src/index.ts](../packages/server/src/index.ts) 注册新路由；
3. 用 `scripts/` 里已有的 smoke harness 风格加一个 `scripts/git-smoke.mjs`，验证 `/api/projects/:id/changes` 能拿到正确 diff。
