# 右键菜单优化 · Plan

## 目标

修复三个右键菜单相关问题，让右键体验一致、可发现、信息完整。

### 验收标准（必须在浏览器里能看到/能点出来）

1. **项目菜单位置固定**
   - 在项目列表里分别右击项目名、路径字符串、空白处、以及项目行的右端小图标区，菜单**每次都出现在同一个位置**（相对当前项目行），不再随鼠标 x/y 漂移。
   - 菜单左端与项目行左端对齐，向右展开覆盖在项目列表栏内（**不**从行右边缘向外伸出到相邻栏），以适配较窄的项目列表宽度。
   - 窗口横向变窄到临近菜单宽度时，菜单不被裁剪（边缘保护仍然生效）。

2. **文件树右键菜单全覆盖**
   - 展开任意非根层级的文件夹，对其中的**文件**和**子文件夹**右击，都能弹出与根层级一致的文件/目录右键菜单。
   - 搜索结果（flat list）右击文件能弹出菜单（此路径已有，回归验证一遍即可）。

3. **源代码更改图标带未提交数红点**
   - 右键 git 仓库项目，菜单里"🌿 代码更改"行尾出现一个**小红底白字数字徽章**，数字 = **已跟踪**未提交文件数 = `staged.length + unstaged.length`（**不含 untracked**）。
   - 未提交数为 0 或项目非 git 仓库时，**不显示徽章**。
   - 数字 ≤ 99 原样显示；> 99 显示 `99+`（避免挤占菜单宽度）。
   - 菜单每次打开都会重新拉取一次，关掉 → 改一个已跟踪文件 → 再打开，数字能刷新；新建一个未跟踪文件（untracked）不影响数字。

## 非目标 (Non-Goals)

- 不改造 ContextMenu.tsx 通用组件的 API（本任务里项目菜单保留现有"内联菜单"实现，避免顺手迁移引起回归）。
- 不在项目列表行本身显示红点/未提交数（只在右键菜单里显示）。本轮不做"列表常驻徽章"。
- 不改文件树右键菜单的项（`fileContextMenu.ts` 内容不动），只修"递归渲染漏传 prop"的 bug。
- 不预拉取所有项目的 changes — 打开菜单时才拉一次。

## 实施步骤

1. **ProjectsColumn 菜单位置改为锚定项目行**
   - `openMenu` 不再用 `e.clientX/Y`，改为：菜单左上角 = 点击行 `getBoundingClientRect()` 的 `right + 4`（横向紧贴行右边）、`top`（纵向对齐行顶）。
   - 保留现有的视口边缘保护（超右则贴右边收回，超下则上翻）。
   - 从 `onContextMenu` 里拿到 `currentTarget`（即项目行 div）来测量 rect。
   - **验证**：在同一项目行的项目名、路径、右端图标区、空白处四个位置右击，截图对比菜单 x/y 一致。

2. **FilesView TreeRow 递归传 onContextMenu**
   - 在 `TreeRow` 内部，对 `node.isHeavyGroup = false / isHeavy = false` 的普通目录递归 children 的地方（~line 539-548），把 `onContextMenu` 也传下去。
   - 同时核对 `HeavyGroup` 分支里递归已经传了（line 474-485），不改。
   - **验证**：展开 `packages/web/src` 一层，分别右击其中的文件和子文件夹，菜单弹出。

3. **代码更改菜单项加红点徽章**
   - 在 `ProjectsColumn.tsx` 内，菜单打开时（`openMenu` 设置 state 的同时，或 `useEffect` 监听 `menu`）调用 `api.getProjectChanges(projectId)` 一次；未完成前徽章不显示（不显示 0）。
   - 结果处理：
     - `enabled: false` → 不显示徽章
     - `enabled: true` → `count = staged.length + unstaged.length + untracked.length`，>0 才显示
   - 徽章 UI：绝对定位在"🌿 代码更改"按钮右端，圆角小红底白字 `text-[10px] tabular-nums`。
   - **验证**：在 AIkanban-main 仓库当前未提交文件很多的状态下，右键该项目 → 菜单显示数字徽章；进入一个 clean 仓库项目或非 git 目录 → 无徽章。

4. **类型检查与 lint**
   - `pnpm -F @aimon/web typecheck`（具体命令确认）成功。
   - **验证**：命令退出码 0，无新增错误。

## 边界情况

- **行高度或滚动**：菜单定位基于 `getBoundingClientRect()`，行本身在视口内就安全；如果列表滚动，菜单会在 `scroll`/`resize` 上自动关闭（已有逻辑），不用特殊处理。
- **项目行右端空间不足**：视口右侧没有足够宽度时，回退把菜单翻到行左侧（`left - MENU_W - 4`），仍保证整块菜单可见。
- **非 git 仓库 / git 错误**：`getProjectChanges` 可能报错或返回 `enabled: false`；徽章 catch 掉只是不显示，不弹错。
- **切项目时旧菜单还在**：菜单打开后切项目基本不会发生（右键即当前项目）；但异步 fetch 回来时菜单可能已关或项目已切，用 `menu.projectId` 比对再 set，避免显示错项目的数字。
- **菜单关闭再打开**：每次打开都重新发 fetch，保证数字与实时状态一致，不做本地缓存（实现简单，项目数不多）。

## 风险与注意

- 假设 1：`ProjectsColumn.tsx` 的行 div（line 129-162 的那个 `<div>`）就是我们要锚定的 rect。✅ 确认过。
- 假设 2：`api.getProjectChanges` 已有且稳定。✅ 见 `api.ts:161-165`。
- 假设 3（已由用户确认）：未提交数口径 = **已跟踪改动**，只算 `staged + unstaged`，不含 untracked。
- 位置固定方案（已由用户确认并于执行阶段细化）：菜单**左端**对齐项目行**左端**、纵向对齐行顶；覆盖在项目列表栏内，不从行右缘外伸到相邻栏。原因：项目列表宽度有限，贴右外伸会越界，行左起点起展开才能让整张菜单在窄列表下完整可见。
- 不顺手动：`ContextMenu.tsx` 通用组件、`fileContextMenu.ts`、`ChangesList.tsx`、后端路由、store 都不改。
- 静态类型：项目是 TypeScript；步骤 4 的 typecheck 命令要先确认（看 `package.json` scripts），不能跳过。
