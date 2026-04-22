# 文件右键菜单 · 任务清单

> 仅由 AI 维护。每完成一步立即把 `- [ ]` 改成 `- [x]`。

## 服务端

- [x] 1. 新建 `packages/server/src/routes/fs-ops.ts`，实现三端点：`POST fs/open-folder`、`POST fs/gitignore-add`、`DELETE fs/entry`；路径全部 `safeResolve`；写入/删除后调 `bustStatusCache`
- [x] 2. `packages/server/src/index.ts` 注册 `registerFsOpsRoutes`
- [x] 3. `git-service.ts` 补导出 `toRepoRelative` + `bustStatusCache`（`safeResolve` 本来已 export）

## Web 客户端基础

- [x] 4. `packages/web/src/api.ts` 加 `openInFolder` / `gitignoreAdd` / `deleteEntry`
- [x] 5. `packages/web/src/store.ts` 加 `filesRefreshTick: number` + `bumpFilesRefresh()`

## ContextMenu 组件

- [x] 6. 新建 `packages/web/src/components/ContextMenu.tsx`：模块级 `openContextMenu({x,y,items})` + 宿主组件；子菜单 hover 展开；外部点击 / ESC / resize / scroll 关闭；视口边界内收
- [x] 7. `packages/web/src/components/layout/Workbench.tsx` 挂 `<ContextMenu />`（紧挨 `<DialogHost />`）

## 接入两个视图

- [x] 8. `ChangesList.tsx` 的 `FileRow` 加 `onContextMenu` → 组装 items → `openContextMenu`；删除/gitignore 成功后调 `load()` + `bumpFilesRefresh()`
- [x] 9. `FilesView.tsx` 的 `TreeRow`（dir / file）+ `SearchResults` 加 `onContextMenu`；dir 的 items 里 "发送到对话" 发 `@<path>/`、"添加 .gitignore" 写 `<path>/`、"删除" 走递归；`load` useEffect 把 `filesRefreshTick` 加进 deps

## 校验

- [x] 10. 服务端 `npx tsc --noEmit` 通过
- [x] 11. 前端 `npx tsc --noEmit` 通过
- [x] 12. 前端 `npx vite build` 通过
