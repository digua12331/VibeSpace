# 文件右键菜单 · 计划

## 目标

给 **文件列表（FilesView）** 和 **git 列表（ChangesList）** 里每一行（文件或文件夹）加统一的右键菜单，包含 5 个条目：

1. **发送到对话**（`→ session`）—— 把路径"喂"给一个活着的 AI / shell session 的终端输入。如果当前项目有多个活着的 session，这一项展开子菜单让用户挑；只有 1 个时直接发过去。
2. **复制路径** —— 复制到系统剪贴板。默认复制相对项目根的 POSIX 路径。
3. **打开所在文件夹** —— 在系统文件管理器里打开该文件的父目录（Windows `explorer /select`，mac `open -R`，linux `xdg-open`）。
4. **添加到 .gitignore** —— 往 `<project>/.gitignore` 追加该路径；已存在则无动作。
5. **删除** —— 用 DialogHost 的 `confirmDialog(danger)` 二次确认，然后后端删文件/递归删文件夹。删完刷新两个列表（FilesView 和 ChangesList）的缓存。

**验收标准**
- FilesView 和 ChangesList 的每行（文件 + 文件夹）都能右键出上面菜单
- 菜单在鼠标位置弹出，能被 ESC / 外部点击关闭
- "发送到对话"单 session 直接发、多 session 展开子菜单
- 删除、添加 .gitignore 在 server 端做，走现有 Fastify 路由模式
- 跨平台（Windows/mac/linux）"打开文件夹"都能正常调起系统资源管理器

## 实施步骤

1. **共享 ContextMenu 组件**
   新建 `packages/web/src/components/ContextMenu.tsx`。提炼 ProjectsColumn 已有的菜单模式（外部点击关闭、Escape 关闭、resize/scroll 关闭、clip 到视口）。API 是 imperative 调用 `openContextMenu({ x, y, items })`（类似 DialogHost），组件挂在 `Workbench` 里。理由：比起每个用到菜单的地方各自维护 state，一个全局宿主更干净。
2. **菜单项数据结构**
   ```ts
   interface ContextMenuItem {
     label: string
     icon?: string
     danger?: boolean
     disabled?: boolean
     onSelect?: () => void | Promise<void>
     submenu?: ContextMenuItem[]  // 简单 hover 展开
     divider?: boolean
   }
   ```
3. **新增 server 端路由 `routes/fs-ops.ts`**
   - `POST /api/projects/:id/fs/open-folder` `{ path }` → 调 `spawn` 启系统资源管理器。返回 `{ ok }`。
   - `POST /api/projects/:id/fs/gitignore-add` `{ path }` → 读 `<project>/.gitignore`，若无该行则追加（保证前后各一个换行），返回 `{ added: boolean }`。
   - `DELETE /api/projects/:id/fs/entry` `{ path }` → `fs.rm(resolved, { recursive: true, force: false })`。服务端前置校验 `safeResolve` 防路径逃逸（复用 `git-service.safeResolve`）。
   - 在 `index.ts` 注册。
4. **web api 客户端扩展**
   `api.ts` 加三个函数：`openInFolder(projectId, path)` / `gitignoreAdd(projectId, path)` / `deleteEntry(projectId, path)`。
5. **把菜单接进 FilesView**
   `TreeRow` 和 `SearchResults` 的 `<button>` 加 `onContextMenu` → 组装 menu items → `openContextMenu(...)`。dir 行和 file 行都用同一套 items（删除对 dir 递归生效，"添加 .gitignore" 对 dir 也合法 —— `<dirname>/` 作为规则）。
6. **把菜单接进 ChangesList**
   ChangesList 里每行（staged / unstaged / untracked）的行容器加 `onContextMenu`。逻辑同 FilesView。
7. **"发送到对话" 实现**
   - 用 `aimonWS.sendInput(sessionId, data)` 直接把 `data` 写进目标 PTY stdin
   - 格式化：agent 属于 AI（非 shell/cmd/pwsh）→ `@<path> `，shell 类 → `"<path>" `（含空格时引号保护）
   - 活着的 session = `sessions.filter(s => s.projectId === selectedProjectId && ptyManager-alive via liveStatus)` —— 注意从 store 的 `sessions` + `liveStatus` 推断；没必要新增接口
   - 子菜单项标签：`agent·<id短尾>`（跟现有 session tab 一致）
   - 发完同时把活跃 tab 切到目标 session + 高亮它（给个存在感）
8. **删除 / gitignore / 打开文件夹的错误处理**
   所有失败都走 `alertDialog(danger)`；成功的 gitignore-add 和 delete 调 `ChangesList.load()` + `FilesView.load()` 自动刷新。FilesView 没 store 化，需要暴露一个 refresh 触发口（最简单：派发一个 custom event，或把 refresh 扔进 store）。

## 决策点（需要你确认）

1. **"复制路径"格式**：默认相对项目根的 POSIX 路径（比如 `packages/server/src/index.ts`）。要不要加第二项"复制绝对路径"？我倾向**只做相对**，简洁；不然菜单太长。
2. **"发送到对话"的格式**：AI session 用 `@<path>`（Claude Code / Codex / Qoder 都认这个），shell 用 `"<path>"`。可以吗？若你只在意 Claude Code，全用 `@<path>` 也行（shell 收到 @ 会当文件名 glob，可能出警告但不致命）。
3. **ContextMenu 是全局单例还是每个视图自维护**：我倾向**全局单例**（像 DialogHost），`openContextMenu(opts)` 命令式调用。各视图只需在 `onContextMenu` 里 `e.preventDefault(); openContextMenu(...)`。如果觉得"太重"，可以改成在 FilesView / ChangesList 各自内联 state，代码量略翻倍。
4. **FilesView 的 refresh 触发**：它目前是本地 state。方案 A：新增一个 store action `filesViewRefreshTick: number`，`increment()` 时 FilesView useEffect 重拉；方案 B：派发 `CustomEvent('aimon:files-refresh')`，FilesView 监听。倾向 A（更 React 风格）。
5. **删除目录的递归确认措辞**：删文件夹走 `confirmDialog(danger)`，措辞 "确认递归删除 `<path>/`？目录下所有内容会被永久删除。"——够警告了吗？要不要二次确认（输入 "yes" 才能删）？我倾向**单次确认 + 明确措辞**，二次确认太重。

---

请确认 5 个决策点（回 "都 ok" 或改任意一条），我就进 Context 阶段。
