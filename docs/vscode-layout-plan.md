# VSCode 风格布局重构方案

## 1. 现状（重构前）

```
┌─ Header (aimon · ws · 📂更改[全局] · 🔔 · +项目) ───────────────┐
│                                                                │
├── Sidebar 260px ──┬── Main ────────────────────────────────────┤
│  全部 sessions    │  SessionGrid (react-grid-layout)           │
│  [项目 A]         │   ┌─────┐ ┌─────┐                          │
│  [项目 B]         │   │Tile │ │Tile │  …                       │
│   …               │   └─────┘ └─────┘                          │
│                   │   (每个 tile = 一个 PTY session, xterm)    │
│   + 新建项目      │                                            │
├───────────────────┴────────────────────────────────────────────┤
│  LogDrawer (底部抽屉)                                          │
└────────────────────────────────────────────────────────────────┘
ChangesDrawer: 从右侧滑出的全屏 overlay, 占 90vw
```

三处不满：
- **全局「📂更改」按钮**：和 "当前选中项目" 绑定不直观；应当属于每个项目本身。
- **文件内容视图是 overlay**：点一次看一眼、再关掉，不是常驻工作区，无法一边看代码一边看终端。
- **终端是 grid 拼贴**：几个 session 并排展示，但 VS Code 用户期待的是"底部面板 + tab 切换"。

## 2. 目标布局（VSCode 风格）

```
┌─ ActivityBar 44px ─┬─ PrimarySidebar (可拖宽) ─┬─ Editor Area ─────────────┐
│  📁 Projects       │  〔当前活动的内容〕        │  [ tab:README.md ]        │
│  📂 SourceControl  │  e.g. 项目树 or           │  ┌──────────────────────┐ │
│  📋 Logs           │       ChangesList         │  │                      │ │
│  🔔 (权限 / 通知) │                           │  │   文件内容 / Diff    │ │
│  ⚙  Settings      │                           │  │   (MD / 代码 / Diff) │ │
│                    │                           │  │                      │ │
│  (底部)           │                           │  └──────────────────────┘ │
│  👤 账号           │                           ├──────────────────────────┤
│                    │                           │  TerminalPanel (可拖高)   │
│                    │                           │  [term-A][term-B][+][⌄] │
│                    │                           │  ┌──────────────────────┐ │
│                    │                           │  │  (xterm, 单 tab 活)  │ │
│                    │                           │  └──────────────────────┘ │
└────────────────────┴───────────────────────────┴──────────────────────────┘
                       ↑                            ↑
                       可折叠                       可隐藏 (ctrl+`)
```

三列三行：
- **ActivityBar**（44px 最左）：图标切视图，永不隐藏。
- **PrimarySidebar**（可拖宽 200–500px，默认 300）：当前 activity 的内容。
- **EditorArea**（中间主区，文件查看器）+ **TerminalPanel**（底部，tab 式）
- 右上"+项目""🔔 通知权限"仍留在 ActivityBar 底部或顶部；Header 整排废弃。

### 2.1 ActivityBar 项

| 图标 | id | 打开的 Sidebar 视图 |
|---|---|---|
| 📁 | `explorer` | 项目列表 + 每个项目下列出它当前活动的 sessions（树状） |
| 📂 | `scm`      | **当前选中项目**的 Git Changes（ChangesList 已有） |
| 📋 | `logs`     | LogDrawer 内容挪进来（现在是底部抽屉） |
| 🔔 | `inbox`    | 通知权限按钮 + waiting_input 列表（即当前 `notifyingSessions`） |
| ⚙  | `settings` | 把「🔔 通知权限切换、CLI installer」聚合进一个 setting 视图 |

底部：`+ 项目`（把原 header 按钮放这里），账号 / 关于。

### 2.2 EditorArea

复用现在的 [FilePreview.tsx](../packages/web/src/components/FilePreview.tsx)，但改为常驻：
- 外层加多 tab（每个打开的文件一个 tab，支持关闭、切换）。
- 空状态：显示"从左侧选择一个文件"或简单的项目概览。
- 保留 `Diff / Source / Preview` 三子 tab。
- **不再用 overlay**。旧的 [ChangesDrawer.tsx](../packages/web/src/components/ChangesDrawer.tsx) 删掉或改名复用。

### 2.3 TerminalPanel（重点变化）

现状是 `react-grid-layout` 的多 tile 拼贴，允许自由排列。VSCode 风格则是：
- 底部水平一排 **terminal tabs**，每个 tab 一个 session。
- 活动 tab 的 xterm 全宽铺满整个 TerminalPanel。
- tab 条右侧有：`+`（唤出 StartSessionMenu）、`⌄`（下拉：终止 / 重启 / 分屏）、面板自身的最大化/隐藏。
- Tab 显示：`agent 图标 + 状态点 + 名字`，waiting_input 时用红点/闪烁。

两个取舍（请你定）：
1. **彻底去掉 grid**：最接近 VSCode。简单。但失去"一屏看多个 agent"的能力。
2. **Tab + 可选分屏**：tab 是主形态，但保留"水平/垂直分屏"按钮（VSCode 的 split terminal），一个 tab 页内部再切 2–4 路。折中。

我倾向 **#2**：terminal 默认 tab 切换，需要"并排盯两路 agent"时手动 split。`react-grid-layout` 可删；split 用简单的 flex + `react-resizable-panels` 或自绘。

### 2.4 每项目的「📂 更改」入口（问题 1 的具体落点）

全局 header 按钮下线。改为：
- ActivityBar 点「📂 SourceControl」时，PrimarySidebar 显示 **当前 selectedProjectId 的** ChangesList。若未选中项目，显示"请先在 Explorer 选一个项目"。
- 在 Explorer 视图的每条项目行：鼠标悬停时右侧露出一个小图标按钮 `📂`，点击 = `openChanges(projectId) + setActivity('scm')`。这样满足"每个文件夹独立"的诉求。
- 项目右键菜单保留「📂 代码更改」入口（已有）。

## 3. 文件层面的改动清单

### 3.1 新增组件（`packages/web/src/components/`）

| 文件 | 作用 |
|---|---|
| `layout/ActivityBar.tsx` | 44px 图标栏，props: `{ activity, onChange }` |
| `layout/PrimarySidebar.tsx` | 容器，根据 `activity` 渲染不同视图；内部用 `react-resizable-panels` 控制宽度 |
| `layout/Workbench.tsx` | 三列三行的顶层 Layout 组件，接管原 `App.tsx` 的结构 |
| `editor/EditorTabs.tsx` | 编辑器区顶部 tab 条，管理"打开的文件"状态 |
| `editor/EditorArea.tsx` | 容器：tabs + FilePreview |
| `terminal/TerminalPanel.tsx` | 底部面板：tab 条 + 活动 session 的 xterm |
| `terminal/TerminalTabBar.tsx` | 终端 tab 列表 + `+` / `⌄` 按钮 |
| `sidebar/ExplorerView.tsx` | 复用并重排现有 [ProjectSidebar.tsx](../packages/web/src/components/ProjectSidebar.tsx) 里项目树的部分 |
| `sidebar/ScmView.tsx` | 包一层，内部就是现有 [ChangesList.tsx](../packages/web/src/components/ChangesList.tsx) |
| `sidebar/LogsView.tsx` | 把现有 [LogDrawer.tsx](../packages/web/src/components/LogDrawer.tsx) 剖成 LogsView，不再是底部抽屉 |
| `sidebar/InboxView.tsx` | 通知权限 + `notifyingSessions` 列表 |

### 3.2 修改

| 文件 | 改动 |
|---|---|
| [App.tsx](../packages/web/src/App.tsx) | 替换内部结构：只渲染 `<Workbench />`，删除 header 全局按钮 |
| [ProjectSidebar.tsx](../packages/web/src/components/ProjectSidebar.tsx) | 拆分，逻辑挪到 `ExplorerView`；移除独立 `<aside>` 外壳 |
| [SessionGrid.tsx](../packages/web/src/components/SessionGrid.tsx) | 大改 / 拆为 `TerminalPanel`；若走"仅 tab + 可选 split"方案，删除 `react-grid-layout` 集成 |
| [SessionTile.tsx](../packages/web/src/components/SessionTile.tsx) | 保留 xterm 挂载 + 工具栏逻辑，外壳改为单个终端视图（不再是 tile） |
| [LogDrawer.tsx](../packages/web/src/components/LogDrawer.tsx) | 删外壳，内部 body 复用为 `LogsView` |
| [ChangesDrawer.tsx](../packages/web/src/components/ChangesDrawer.tsx) | 删除。ChangesList 由 `ScmView` 托管；文件预览由 `EditorArea` 托管 |
| [store.ts](../packages/web/src/store.ts) | 新增 `activity: 'explorer'\|'scm'\|'logs'\|'inbox'\|'settings'`、`openFiles: EditorTab[]`、`activeFileKey`、`activeSessionId`；删除 `logOpen`、`changesProjectId` 改语义（只保留"当前 scm 项目"可以直接用 `selectedProjectId`）|

### 3.3 依赖

- **新增**：`react-resizable-panels`（维护活跃，用于 ActivityBar | Sidebar | Editor | Terminal 四块的可拖动分隔条）。约 5KB gzipped。
- **删除**：`react-grid-layout`、`@types/react-grid-layout`（若选方案 #1 或 tab-only）。

## 4. 状态 / 持久化

- `localStorage` 新 key：`aimon_layout_v2 = { sidebarW, terminalH, activity, activeSessionIdByProject }`。
- 每项目持久化的不再是 `tiles[]`（拼贴坐标），而是 `activeSessionId + 可选的 split 配置`。
- 迁移策略：旧的 `ProjectLayout.tiles` 在重构后直接忽略；不做迁移，第一次启动即为全新 tab-only 布局。如需保留旧体验，留一个"经典拼贴模式"开关（不推荐，维护成本高）。

## 5. 渐进实施路线

**阶段 A — Workbench 骨架**（~半天）
- 加 `react-resizable-panels`。
- 新建 `Workbench / ActivityBar / PrimarySidebar / EditorArea / TerminalPanel`，用占位内容拼出三列三行。
- `App.tsx` 只挂 `<Workbench />`，老功能暂时并存（header 不删）以便回退对比。

**阶段 B — 迁移 Explorer & SCM**（~半天）
- `ExplorerView` = 当前 ProjectSidebar 内容；加 hover 露出的 `📂` 小图标。
- `ScmView` = 当前 ChangesList，读 `selectedProjectId`。
- 选择 SCM 里的文件时 `dispatch openFile({ projectId, path, ref, from, to })`。

**阶段 C — EditorArea tabs**（~半天）
- `openFiles` 状态 + `EditorTabs` + `EditorArea` 渲染当前激活 tab 的 `FilePreview`。
- 关闭 tab、切换 tab、中键关闭。
- 删除 ChangesDrawer。

**阶段 D — TerminalPanel**（~1 天）
- `TerminalPanel` + `TerminalTabBar`，每个 session 一个 tab，用 `react-resizable-panels` 横向 split（阶段 D2 再做分屏）。
- `SessionTile` 拆分：xterm 渲染主体保留为 `SessionView`；tile 外壳丢弃。
- 删除 SessionGrid、react-grid-layout。
- 新建 session = 在活动面板追加一个 tab 并聚焦之。

**阶段 E — Logs & Inbox & 收尾**（~半天）
- LogsView / InboxView 接入。
- 删旧 header 全排按钮，`App.tsx` 只剩 `<Workbench />` + 必要的对话框。
- localStorage 迁移键；布局重置按钮。

总工作量 ~2.5 个人日。阶段之间互不阻塞——每阶段完成都能编译、能用、能回退。

## 6. 主要风险 & 决策点

1. **是否保留 grid 拼贴模式**：推荐**不保留**，工作量和心智负担都大；若用户强烈需要可以用"split terminal"覆盖 80% 场景。
2. **EditorTab 和 TerminalTab 的取舍**：VSCode 里二者独立。我们一开始也独立两套状态（`openFiles` 和 `sessions`），不共用 tab 条。
3. **右键菜单位置**：ActivityBar 不做右键菜单；项目 / 终端 tab 上保留（和 VSCode 一致）。
4. **小屏兼容**：<1024px 时 ActivityBar 仍显示、PrimarySidebar 折叠为 overlay，TerminalPanel 最大化。不是 MVP 首选，但留下 CSS hook。

## 7. 问题 1 明确回答

- **移除**：`App.tsx` 里 header 上的「📂 更改」全局按钮。
- **新增**：ActivityBar 的「📂 SCM」图标（全局 activity 切换器），行为上**依赖 selectedProjectId**——谁被选中就显示谁的 changes。
- **新增**：Explorer 视图里每条项目行 hover 时露出 `📂` 小按钮，`onClick = select(projectId) + setActivity('scm')`。这样"每个文件夹有自己的入口"。
- 右键菜单的「📂 代码更改」继续保留作为第二入口。

## 8. 问题 2/3 明确回答

- **布局**：严格三列（ActivityBar | PrimarySidebar | 右侧主区），右侧主区再纵向两行（EditorArea 上 / TerminalPanel 下），全部用 `react-resizable-panels` 控制拖动与折叠。
- **终端页签**：`TerminalPanel` 底部唯一可见活动 tab 的 xterm；新建会话 = 追加 tab 并激活；废弃 `SessionGrid + react-grid-layout`。保留可选的"split"（VSCode 式 horizontal/vertical split），阶段 D2 再加。

---

请确认：
1. 同意按上面的方案推进吗？
2. 终端是 **tab-only**（方案 #1）还是 **tab + 可选 split**（方案 #2，推荐）？
3. 旧的 grid 布局要不要留一个开关可以退回？（推荐：不留）

确认后我建任务列表并按阶段 A→E 逐步开工。
