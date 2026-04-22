# 文件右键菜单 · 上下文

## 关键文件

### 新建

- **`packages/web/src/components/ContextMenu.tsx`**
  全局菜单宿主，模仿 [`DialogHost`](packages/web/src/components/dialog/DialogHost.tsx) 的"模块级监听器 + 命令式 API"模式：
  ```ts
  export function openContextMenu(opts: { x: number; y: number; items: ContextMenuItem[] }): void
  export default function ContextMenu(): JSX.Element  // 挂一次
  ```
  内部处理外部点击 / Escape / resize / scroll 时关闭；位置超出视口时向内收。item 有 `submenu` 时 hover 展开侧边子菜单（给 session picker 用）。

- **`packages/server/src/routes/fs-ops.ts`**
  新路由模块，三个端点：
  - `POST /api/projects/:id/fs/open-folder`  body `{ path }` → `spawn` 启系统资源管理器，返回 `{ ok: true }`
  - `POST /api/projects/:id/fs/gitignore-add`  body `{ path }` → 追加到 `.gitignore`，返回 `{ added: boolean }`
  - `DELETE /api/projects/:id/fs/entry?path=...` → `fs.rm(resolved, { recursive: true, force: false })`
  所有路径都先走 [`git-service.safeResolve`](packages/server/src/git-service.ts#L194-L207)（已导出）防路径逃逸；再拿 `toRepoRelative` 做相对化。

### 修改

- **[`packages/server/src/index.ts`](packages/server/src/index.ts#L126-L131)**
  加一行 `await registerFsOpsRoutes(app)`，放在 `registerPerfRoutes` 之后。

- **[`packages/web/src/api.ts`](packages/web/src/api.ts)**
  在 git 相关一段末尾追加：
  ```ts
  export function openInFolder(projectId, path): Promise<{ ok: boolean }>
  export function gitignoreAdd(projectId, path): Promise<{ added: boolean }>
  export function deleteEntry(projectId, path): Promise<void>
  ```

- **[`packages/web/src/store.ts`](packages/web/src/store.ts)**
  加一个单调递增的刷新信号：
  ```ts
  filesRefreshTick: number
  bumpFilesRefresh: () => void
  ```
  用于给 `FilesView` 的 `useEffect` 做外部触发。不走事件总线、不走轮询。

- **[`packages/web/src/components/layout/Workbench.tsx`](packages/web/src/components/layout/Workbench.tsx)**
  在 `<DialogHost />` 旁边挂 `<ContextMenu />`。

- **[`packages/web/src/components/sidebar/FilesView.tsx`](packages/web/src/components/sidebar/FilesView.tsx)**
  两个改点：
  1. 行容器加 `onContextMenu`。`TreeRow` 里 dir 分支 ([L363-L400](packages/web/src/components/sidebar/FilesView.tsx#L363)) 和 file 分支 ([L402-L433](packages/web/src/components/sidebar/FilesView.tsx#L402)) 各加一个，传参时区分 `kind: 'file' | 'dir'`。`SearchResults` 里 ([L454-L480](packages/web/src/components/sidebar/FilesView.tsx#L454)) 也加一个。
  2. `useEffect` 里订阅 `filesRefreshTick`，变化时调用 `load()` 重新扫描。

- **[`packages/web/src/components/ChangesList.tsx`](packages/web/src/components/ChangesList.tsx)**
  `FileRow` ([L405-L458](packages/web/src/components/ChangesList.tsx#L405)) 的根 div 加 `onContextMenu`。组 menu items 时拿到 `entry.path`。ChangesList 本来就在每次 git 操作后调 `load()` 刷新，删除/gitignore 成功后我们也调一次 `load()` 就够了。

### 已有可复用

- **[`packages/web/src/components/dialog/DialogHost.tsx`](packages/web/src/components/dialog/DialogHost.tsx)** — `confirmDialog(danger)` / `alertDialog`
- **[`packages/web/src/ws.ts`](packages/web/src/ws.ts#L108-L110)** — `aimonWS.sendInput(sessionId, data)` 直发 PTY stdin
- **[`packages/server/src/git-service.ts#L194-L211`](packages/server/src/git-service.ts#L194-L211)** — `safeResolve` / `toRepoRelative`
- **[`packages/web/src/store.ts#L151-L153`](packages/web/src/store.ts#L151-L153)** — `activeSessionIdByProject` + `setActiveSession` / `setActiveTabKind` 用于"发送到对话"后顺手切到目标 session

## 决策记录

1. **全局 `ContextMenu` 宿主** vs 每视图内联：选宿主。和 `DialogHost` 风格一致，易共享到以后的其他视图（比如 Perf 行、Docs 行）。**已确认**。
2. **子菜单 hover 展开** vs 点击展开：hover。符合 OS 原生右键菜单直觉；ESC / 外部点击会整个关掉，代价小。
3. **"发送到对话"格式**：AI agent → `@<path> `（尾部加空格方便继续打字）；shell 类 (`shell` / `cmd` / `pwsh`) → `"<path>" `（双引号防空格）。**已确认**。
4. **"复制路径"**：单项，复制相对 POSIX 路径。不给绝对路径二级菜单。**已确认**。
5. **"打开所在文件夹"**：
   - Win: `explorer.exe /select,"<abs>"`（高亮选中该文件）
   - macOS: `open -R "<abs>"`
   - Linux: `xdg-open "<dirname(abs)>"`（xdg-open 无 select 语义，退化为只开目录）
   - 用 `spawn` 不等待，失败仅记 log；用户会自己发现没打开。
6. **".gitignore 添加"**：
   - 对 **文件** → 写 `<相对路径>`
   - 对 **目录** → 写 `<相对路径>/`（尾斜杠表示目录规则）
   - 追加前检查已有行，完全等值则 `{ added: false }`，不重复写
   - `.gitignore` 不存在则新建
7. **"删除"**：
   - DialogHost `confirmDialog(danger)`，措辞 "删除 `<path>`? 此操作不可撤销。"；dir 的措辞加 "目录下所有内容会被一并删除。"
   - 后端 `fs.rm(resolved, { recursive: true, force: false })`；`force: false` 让不存在的文件返回错误，防止"静默成功"错觉
   - 成功后 `bumpFilesRefresh()` + `ChangesList.load()`（后者 ChangesList 自己 watch git 状态，我们只需触发一次）
8. **FilesView 刷新走 store tick**：加 `filesRefreshTick: number` / `bumpFilesRefresh()`。FilesView 的 `load` useEffect 里把 tick 加进 deps。**已确认**。
9. **菜单对 dir 行适用性**：dir 也能"发送到对话"（发 `@dirname/`）、"复制路径"、"打开所在文件夹"（打开其父目录，高亮此 dir）、"添加到 .gitignore"、"删除"（递归）。所有 5 项都保留。

## 依赖与约束

- **无新增 npm 依赖**。全部用 Node 内置 `node:fs/promises`、`node:child_process`、`node:path`。
- **跨平台"打开文件夹"**：已在上面记录。Linux 无 select 语义是既定限制，不追加其他参数。
- **与现有 git 操作的交互**：删除 / gitignore 会让 `getChanges` 返回新结果。ChangesList 有 1.5s 的 status cache（[git-service.ts#STATUS_CACHE_TTL_MS](packages/server/src/git-service.ts#L137)）。`deleteEntry` / `gitignoreAdd` 在服务端内部调 `bustStatusCache(projectPath)` ([git-service.ts#L542-L546](packages/server/src/git-service.ts#L542)) 使缓存立即失效，客户端 `load()` 马上拿到新状态。
- **安全性**：所有路径输入都过 `safeResolve`。删除额外保护：禁止删项目根本身（`relative === ''` 直接 400）。
- **xterm 输入**：`aimonWS.sendInput` 只是 WS `{type:'input'}` 的薄封装；服务端 `ws-hub` 收到后调 `ptyManager.write` 给 PTY。没额外流控。

## 非目标（再次明确）

- 拖放排序 / 移动文件（rename / move）
- 批量选中 + 批量菜单
- 子菜单深度 > 1 层
- 自定义菜单项（插件式）
- "发送到对话"后自动按 Enter（显式让用户确认后自己敲）

---

确认无误（回一句）就进 Tasks 阶段开写。
