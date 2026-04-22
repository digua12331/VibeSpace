# 右键菜单优化 · Context

## 关键文件

（本次改动的边界 = 下面这份清单；如执行时发现必须溢出，先回来补这里。）

### 会修改

- [packages/web/src/components/layout/ProjectsColumn.tsx](packages/web/src/components/layout/ProjectsColumn.tsx)
  - `openMenu` (line 78-86)：改为基于"项目行 div"的 `getBoundingClientRect()` 定位，而不是 `e.clientX/Y`。
  - `ContextMenuState` (line 7-12)：已有 `x/y` 字段直接复用即可；无需新增。
  - 菜单 `<div>`（line 171-242）的"🌿 代码更改"按钮（line 179-189）：加一个 `<span>` 红点徽章（绝对定位在按钮右端）。
  - 组件顶部 `useState`：新增一个 `changeCount: number | null` state（null = 未拉取/不可用）。
  - `useEffect`：监听 `menu` 变化；`menu != null` 时异步 `api.getProjectChanges(menu.projectId)` 并 set count；用一个 "stale" 比对保证异步回来时菜单仍指向同一个 projectId（否则丢弃）。

### 会修改（bug 修复）

- [packages/web/src/components/sidebar/FilesView.tsx](packages/web/src/components/sidebar/FilesView.tsx)
  - `TreeRow` 内部的目录递归分支 (line 513-551)：`isOpen && (...)` 里 `map` 出的子 `TreeRow` 漏传 `onContextMenu`（line 539-548）。补上就完事。
  - 同位置的 HeavyGroup 分支（line 452-488）里递归已经传了 (line 474-485)，不动。

### 只读参考

- [packages/web/src/api.ts](packages/web/src/api.ts:161) — `getProjectChanges(projectId)` 已存在。
- [packages/web/src/types.ts](packages/web/src/types.ts:220) — `ChangesResult { enabled: true, staged, unstaged, untracked, ... }` 与 `NotGitRepoResult { enabled: false }`。
- [packages/web/src/components/ChangesList.tsx](packages/web/src/components/ChangesList.tsx:230) — 现有 `totalChanges = staged + unstaged + untracked` 口径供对比，但我们本轮用 `staged + unstaged`，不复用该变量。
- [packages/server/src/routes/git.ts](packages/server/src/routes/git.ts:85) — `/api/projects/:id/changes` 路由，验证后端确实返回 `enabled: false` 给非 git 目录。

### 不改

- `packages/web/src/components/ContextMenu.tsx`（通用组件）：项目菜单沿用 ProjectsColumn.tsx 里的内联实现，不迁移。
- `packages/web/src/components/fileContextMenu.ts`：菜单项内容不动，本轮只修触发点。
- 后端任何路由。
- `ChangesList`、`GitGraph`、`ScmView`。

## 决策记录

### D1. 项目菜单"位置固定" → 锚定项目行（方案 A）

- **做法**：`openMenu(e, ...)` 里 `e.currentTarget.getBoundingClientRect()` 拿到项目行 rect；`x = rect.right + 4`，`y = rect.top`，然后沿用现有的视口边缘保护（过右→翻到 `rect.left - MENU_W - 4`，过下→往上收回）。
- **不选方案 B（全局固定点）**：看不出菜单对应哪个项目。
- **"资深工程师会不会觉得过度设计？"**：不会。就是换一个坐标来源，复用现有菜单组件和关闭逻辑。没有新抽象、没有配置项。

### D2. 红点数据来源：菜单打开时拉一次，不预拉、不缓存

- **做法**：`useEffect(() => { if (!menu) return; void fetchCount(menu.projectId) }, [menu])`。fetch 完成时如果当前 `menu?.projectId` 已经变了，就丢弃结果（避免把 A 项目的数字显示在 B 项目的菜单上）。
- **不选"项目列表上持续显示未提交数"**：违反非目标；且要在每个项目上轮询，开销大。
- **不选"全局 store 缓存"**：缓存会导致"改了文件但数字没刷新"，需要额外失效机制；而菜单打开本身就是最自然的 trigger。
- **"过度设计？"**：不会，就是一个 state + 一个 effect + 一个 try/catch。

### D3. 徽章口径：`staged + unstaged`（已跟踪），不含 untracked

- 用户已确认。实现：`enabled === true ? staged.length + unstaged.length : null`。
- `count == null` 或 `count === 0` → 不渲染徽章 DOM。
- `count > 99` → 显示 `"99+"`。

### D4. 项目菜单保留"内联实现"，不迁 ContextMenu.tsx

- `ContextMenu.tsx` 是全局单例（只能同时存在一个 open 菜单）；本轮不改文件菜单的消费方式，避免影响文件右键。
- 顺便省掉一次迁移 + 回归测试。

### D5. 不引入新工具函数 / 不抽 helper

- `count > 99 ? '99+' : count`、rect 计算几行都直接写在组件里。不抽 `renderBadge`、不抽 `positionMenu`。
- 只改必须改的。

## 依赖与约束

- **TypeScript**：`packages/web` 用 TS，必须过类型检查；项目没单独 `typecheck` 脚本，用 `pnpm --filter @aimon/web exec tsc -b` 做项目引用式编译校验（比 `build` 快，免得跑 vite bundle）。
- **React 19 + Zustand 5**：`ProjectsColumn` 本地组件 state 已经用 `useState`；不要为徽章去搞 store。
- **样式**：用项目 Tailwind 约定（`text-[10px]`、`bg-rose-500`、`tabular-nums`…），与现有菜单同类；不要引入新全局 CSS。
- **后端 API 并发**：菜单打开 → fetch。用户快速右键不同项目会多次发请求；每次以 `menu.projectId` 比对丢弃 stale，不用 AbortController（简单即可）。
- **编码问题**：本任务文件名是中文 "右键菜单优化"，git status 里显示为转义形式；不动 core.quotepath 等设置。
