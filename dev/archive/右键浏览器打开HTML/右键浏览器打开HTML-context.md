# 右键浏览器打开HTML · Context

> 本次用户明确说"一次确认，以后小功能直接改不用走流程"——plan+context 合并一次确认后进入 tasks，且已把这条偏好沉淀到 `dev/memory/manual.md` + 用户 memory（下次会话 hook 自动注入）。

## 关键文件（本次改动边界 = 这三个）

- **`packages/server/src/routes/fs-ops.ts`** — 新增 `POST /api/projects/:id/fs/open-in-browser` 路由，紧挨现有 `open-vscode` 之后。复用 `PathBody`/`loadProjectOr404`/`safeResolve`/`existsSync`。新增一个内部 `openWithDefaultApp(abs)` 函数（Windows `cmd.exe /c start "" <abs>`、macOS `open`、Linux `xdg-open`），fire-and-forget 风格同 `revealInSystemExplorer`。后缀白名单 `/\.(html?|xhtml)$/i`。失败 → `serverLog('warn'/'error', 'fs', ...)`。成功 → `serverLog('info', 'fs', ...)`。
- **`packages/web/src/api.ts`** — 在 `openInVscode`（第 442 行附近）之后追加 `openInBrowser(projectId, path)`。
- **`packages/web/src/components/fileContextMenu.ts`** — 在 `isBatch` 旁加 `isHtml = kind === 'file' && /\.(html?|xhtml)$/i.test(path)`；构造 `browserItem`；注入位置：`return` 数组里「打开所在文件夹」之后、`execItem` 之前。点击用 `logAction('fs', 'open-in-browser', async () => { await api.openInBrowser(projectId, path) }, { projectId, meta: { path } })` 包住；catch 后 `alertDialog`。

（`FilesView.tsx` / `ChangesList.tsx` 无需动，都通过 `buildFileContextItems` 自动继承。）

## 决策记录

1. **只加一个 html 后缀白名单，不扩到 pdf/svg/md** — 用户说"不加"。避免菜单噪声；未来想扩随时加正则。
2. **菜单位置：「打开所在文件夹」下方** — 用户"ok"；与该项同属"外部应用打开"归类。
3. **不做"选浏览器"选项** — 用户"不做"；没要求就不写，按"不做投机性代码"原则。
4. **前后端都埋日志** — 按 CLAUDE.md「操作日志规则」强制：前端 `logAction('fs','open-in-browser',...)`，后端 `serverLog('info','fs',...)`。成功/失败自动起止配对。
5. **后端后缀白名单重复前端** — 前端是 UX（不显示菜单项），后端是安全（防止手工 `curl` 跳过）。别省。
6. **`start "" <abs>`** 的空串是 `start` 的 title 占位，避免吞路径。和 `revealInSystemExplorer` 是同类 fire-and-forget 风格，但调用的不是 `explorer.exe /select,` 而是默认应用。

**过度设计自检**："资深工程师会不会觉得过度设计？" — 不会。每个文件各加一个函数、一个菜单项，没有抽象层、没有可配置项、没有"以后扩展"的占位。

## 依赖与约束

- **API 契约**：`POST /api/projects/:id/fs/open-in-browser` body `{ path: string }`，成功 `{ok:true}`，失败走既有 `sendErr` / 400 白名单错误。
- **Path 安全**：`safeResolve(proj.path, path)` 已经处理越界；`existsSync` 处理不存在；后缀白名单处理非 html。三件套同 `openInFolder`。
- **日志字段**：`scope='fs'`、`action='open-in-browser'`；`meta.path` 传相对路径（不传绝对路径以免日志泄漏机器布局）。
- **无新增 npm 依赖**。
- **类型检查命令**：`pnpm -r build`（或 `pnpm -C packages/server build && pnpm -C packages/web build`）。
