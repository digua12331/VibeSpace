# 统一布局 / 启动入口 / CLI 工具栏 —— 方案

## 0. 你的诉求

1. **整体页面布局整理** —— 现在几个列的 header 样式不统一，没有全局顶栏。
2. **启动按钮缺失** —— 重构后旧 header 的「▶ 启动」没有等价入口。只有终端 tab 条里有一个 `+` 藏得很深。
3. **CLI 图标放侧边工具栏** —— ActivityBar 里额外一组 CLI 图标，点一下直接在当前项目起一个对应终端。

---

## 1. 现状扫描

| 区域 | 现状 | 问题 |
|---|---|---|
| 全局 | 没有 TopBar，只有 footer 状态条 | 品牌 / 项目名 / 全局操作无处安放 |
| ProjectsColumn header | "项目" 11px subtle 字 | 高度 36px |
| PrimarySidebar header | `{TITLES[activity]}` 11px | 高度 36px — **一致** |
| EditorArea | 无独立 header，只有 tab 条 | tab 条 36px — 视觉节奏不齐 |
| TerminalPanel | 直接是 tab 条，tab 条里混着 `+` | 无标题，不像"面板"，`+` 功能被淹没 |
| Footer | 6px 不到的文字，`⟳重置 / 🔔 / +项目` | 能用但偏隐蔽 |
| ActivityBar | 3 个 activity 图标 + 底部一颗通知指示灯 | CLI 启动入口完全缺失 |
| SessionMenu | `StartSessionMenu` 作为一个弹出组件，目前只在终端 tab 条里使用 | 用户要靠点 `+` 才能见到；项目选中后无显眼提示 |

---

## 2. 方案总览

```
┌─ TopBar 36px ─ aimon · {project} ·  ⸰  ⚙ 设置 · 🔔 perm ──────────────┐
├──────────────────────────────────────────────────────────────────────┤
│┌ProjectsColumn┐┌ActivityBar 44px┐┌PrimarySidebar┐┌Editor┐┌Terminal┐│
││ [head 32px]  ││ 📂 SCM          ││ [head 32px]  ││[tabs││[head +  ││
││ "项目"       ││ 📋 Logs         ││ scm/logs/..  ││ 32] ││ tabs 32]││
││              ││ 🔔 Inbox        ││              ││     ││         ││
││ 项目列表…   ││ ─── 分隔 ───     ││              ││ Edit││ xterm   ││
││              ││ 🤖 Claude (*)  ││              ││ area││         ││
││              ││ 🤖 Codex  (*)  ││              ││     ││         ││
││              ││ ✨ Gemini (*)  ││              ││     ││         ││
││              ││ 💻 shell        ││              ││     ││         ││
││              ││ 🪟 cmd          ││              ││     ││         ││
││              ││ ⚡ pwsh         ││              ││     ││         ││
││              ││                 ││              ││     ││         ││
││              ││ (flex-1 spacer) ││              ││     ││         ││
││              ││ ＋ 更多/安装     ││              ││     ││         ││
││              ││ 🔔 perm dot     ││              ││     ││         ││
│└──────────────┘└─────────────────┘└──────────────┘└─────┘└─────────┘│
├─ StatusBar 24px ── ws · version · reset · new-project ─────────────┤
└──────────────────────────────────────────────────────────────────────┘
```

### 2.1 新增 TopBar（32–36px）

- **Left**: `aimon` 品牌名；若有选中项目 → ` · {project.name} · 🌿 {branch}`（分支从 `/changes` 已有字段取）。
- **Right**: `🔔 {perm}` / `⚙ 设置`（下拉：安装 CLI / 重置布局 / 关于）。
- TopBar 用来安放**全局、位置固定**的信息与入口，不再把这些塞进 footer。
- Footer 只保留 WS 状态 + serverVersion，内容极简。

### 2.2 统一列 Header 规范

所有列（ProjectsColumn / PrimarySidebar / EditorArea / TerminalPanel）顶部一条 **32px 高、右对齐操作按钮** 的 header：

```css
高度        32px (h-8)
字号        11px uppercase tracking-[0.12em]
颜色        text-subtle
padding     px-3
border-b    1px border-border/40
```

内容：左边标题，右边可选 1–3 个图标按钮。

| 列 | 标题 | 右侧按钮 |
|---|---|---|
| ProjectsColumn | 项目 | `＋` 新建项目 |
| PrimarySidebar | 动态（SCM / 日志 / 通知） | 视情况（SCM 可放 commit-all / refresh） |
| EditorArea | 无文字标题，直接 EditorTabs 占满这 32px | `⋯` 关闭全部 tab |
| TerminalPanel | 终端 | 右侧仍是 tab 条 + `＋ 新终端` |

这样四列的纵向节奏统一（全部 32px header + 内容）。

### 2.3 ActivityBar 新布局：三段式

ActivityBar 仍宽 44px，从上到下分三段：

1. **Views 段**（切换 PrimarySidebar 内容）
   - 📂 SCM
   - 📋 Logs
   - 🔔 Inbox

2. **分隔** （`h-px mx-2 my-1 bg-border/40`）

3. **CLI Launchers 段**（点击 = 新建 session）
   - 从 `/api/cli-installer/catalog` + `/status` 拉安装列表
   - 每个已安装 CLI 一颗图标 + emoji（emoji 借用 StartSessionMenu 的 `EMOJI_BY_ID` 表）
   - **状态逻辑**
     - 未选中项目：灰化、tooltip「请先选中一个项目」
     - 已选中项目：亮色、可点击
     - 点击 → `api.createSession({ projectId, agent })` → `addSession` + `setActiveSession` + 自动切焦到终端 tab
   - 内置 shell 始终可点：`💻 shell` / `🪟 cmd` / `⚡ pwsh`
   - 未安装的 CLI 置灰（tooltip: "未安装，点击 📦 去安装"）且点击等价于开 CliInstallerDialog

4. **Spacer + bottom 段**
   - `flex-1` 撑开
   - 📦 安装器（打开 CliInstallerDialog）
   - 🔔 perm 指示点（只读，点击无动作；切换权限走 TopBar 的 🔔）

这样 CLI 直接在侧栏，一眼可见可点；`StartSessionMenu` 作为"更多选项"或干脆仅保留在 TerminalPanel 的 `+ 新终端` 菜单里。

### 2.4 启动按钮的多入口

用户熟悉的几个位置都放：

- **ActivityBar CLI 段**（最快、最显眼）—— #1 要求的入口
- **TerminalPanel tab 条右侧** 现有的 `+ 新终端` 下拉 —— 保留
- **项目无会话时的空态**：`TerminalPanel` 当 `sessions=0 且 project selected`，中央显示一组大号启动按钮（Claude / Codex / Shell / 更多…）。替换现在的"还没有会话..."空文字。

### 2.5 其他微调（和"界面优化"有关的小改）

- 所有 Separator 悬停色统一为 `hover:bg-accent/30`（现在有 `accent/40` 和 `accent/30` 混着）。
- 所有小徽标（status badge、branch chip、HEAD chip）统一 `text-[10px] px-1 py-0.5 rounded border bg-*/10 border-*/40`。
- 文件树 / SCM 列表里的 hover 操作按钮：`w-5 h-5 text-[12px]`，统一。
- 主色（accent）只用于：激活 tab 底部指示条、激活项的左竖条、主按钮（提交 / 启动）。

---

## 3. 改动清单

### 3.1 新增

| 文件 | 说明 |
|---|---|
| `components/layout/TopBar.tsx` | 全局顶栏 |
| `components/cli/CliCatalogHook.ts` | 共享 hook：`useCliCatalog()` 返回 `{ rows, loading, refresh }`，ActivityBar 和 StartSessionMenu 复用 |

### 3.2 修改

| 文件 | 改动 |
|---|---|
| [ActivityBar.tsx](../packages/web/src/components/layout/ActivityBar.tsx) | 改为三段式；加 CLI 启动逻辑 |
| [Workbench.tsx](../packages/web/src/components/layout/Workbench.tsx) | 顶部挂 `<TopBar/>`；删除 footer 里的 `+ 项目` 和 `🔔` 按钮（移去 TopBar） |
| [ProjectsColumn.tsx](../packages/web/src/components/layout/ProjectsColumn.tsx) | header 高度改 32px；`+ 新建项目` 从底部移到 header 右侧 |
| [PrimarySidebar.tsx](../packages/web/src/components/layout/PrimarySidebar.tsx) | header 样式按规范对齐 |
| [EditorArea.tsx](../packages/web/src/components/editor/EditorArea.tsx) | 空态提示微调；确保 `EditorTabs` 高度 32px 对齐 |
| [editor/EditorTabs.tsx](../packages/web/src/components/editor/EditorTabs.tsx) | 从 h-9 改到 h-8 统一 |
| [terminal/TerminalPanel.tsx](../packages/web/src/components/terminal/TerminalPanel.tsx) | tab 条高度 32px；无 session 空态换成大号 CLI 启动网格 |
| [StartSessionMenu.tsx](../packages/web/src/components/StartSessionMenu.tsx) | 抽出 `useCliCatalog` hook；菜单本身保留（终端 `+` 仍用它） |

### 3.3 删除 / 合并

- 旧 footer 的 `🔔 perm` 按钮（逻辑挪到 TopBar）
- 旧 footer 的 `+ 项目` 按钮（挪到 TopBar 右侧或 ProjectsColumn header）

### 3.4 常量表（统一在一个地方）

建 `components/layout/constants.ts`：

```ts
export const HEADER_HEIGHT = 32
export const TOP_BAR_HEIGHT = 36
export const STATUS_BAR_HEIGHT = 24
export const ACTIVITY_BAR_WIDTH = 44
export const ICON_BTN = 'w-9 h-9 flex items-center justify-center rounded-md text-[16px]'
```

所有地方引用，避免 `h-8 / h-9` 混用。

---

## 4. 实施阶段

- **Phase 1 — 常量 & TopBar**（~0.5d）
  加 `constants.ts` + `TopBar.tsx`，Workbench 挂上。项目名 / 分支 / ⚙ / 🔔 迁移。footer 精简。

- **Phase 2 — ActivityBar CLI 段**（~0.5d）
  抽 `useCliCatalog`，ActivityBar 加 CLI launcher 段；点击 = 启动 session。未选中项目禁用。

- **Phase 3 — 列 Header 统一 & 终端空态**（~0.5d）
  四个列 header 32px、统一样式；TerminalPanel 无 session 空态换成大号启动网格。

- **Phase 4 — 微调 / 清理**（~0.25d）
  Separator 悬停色、徽标样式、主色约束；类型检查 + build。

总工作量 ~1.75d。每个阶段独立可编译可回退。

---

## 5. 风险 / 取舍

1. **ActivityBar 高度溢出**：若 CLI 太多（>8 个），CLI 段需要纵向滚动。给 `flex-1 overflow-y-auto`，上下段固定。
2. **启动失败提示**：点击 CLI 启动失败（e.g. 未安装）时，用 footer status bar 的错误栏闪一下；避免弹窗骚扰。
3. **CLI emoji 一致性**：新 CLI 没定义 emoji 时 fallback 到 `🤖`；若服务端后来加新 CLI，不会崩。
4. **TopBar 与 WS 重连条**：WS 断开横条仍显示在 TopBar 下方，不挤压 TopBar 高度。

---

## 6. 请确认

同意以下三点再开工：

1. **顶栏 + 四列 header 32px 统一** —— 推荐 ✅
2. **ActivityBar CLI 段点击直接起 session** —— 你要求的 ✅
3. **终端无会话时显示大号 CLI 启动网格** —— 顺手做的增强，可否?

如果都 OK，我建任务列表按 Phase 1→4 落地。
