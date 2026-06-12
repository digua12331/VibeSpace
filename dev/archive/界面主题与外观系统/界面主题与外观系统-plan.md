# 界面主题与外观系统 · plan

## 大哥摘要

现在 VibeSpace 整体是**纯黑底（颜色代码 `#202020`）+ 纯白字（`#ffffff`）**，对比度太高，盯久了眼睛累。本次任务做三件事，**只换皮肤、不动你现有的项目/会话/记忆/Issues 任何数据**：

1. **换默认配色**：把"纯黑底 + 纯白字"换成"柔和深灰底 + 浅灰字"——看起来不刺眼但仍是深色风格。
2. **加"外观"开关**：左侧活动栏（最左边那一列图标）加一个"调色板"图标，点开是侧边面板，**下拉切换 3 套预设主题**——
   - `柔和深灰`（新默认）
   - `亮色护眼`（白天用）
   - `黑色玻璃拟态`（chrome 层半透明 + 背景模糊，类似 macOS Big Sur / Windows 11 Acrylic 风格）
3. **支持自定义 CSS（Obsidian 级别）**：面板下半部分有一个文本框，你可以**粘贴自己写的 CSS**（一段浏览器认识的样式代码）来完全自定义——不只是颜色，**圆角、阴影、字体、边框、表面材质（实色 vs 玻璃）全都能改**。

### 自定义 CSS 能改什么（贴一行就生效）

| 想做的事 | 贴这段 CSS | 效果 |
|---|---|---|
| 改背景色 | `:root { --color-bg: 17 34 51; }`（注：RGB 三个数字 = 蓝灰） | 全屏背景变蓝灰 |
| 按钮从圆角改方角 | `:root { --radius-md: 0; --radius-win: 0; }` | 所有按钮变方角 |
| 切玻璃拟态 | `:root { --surface-blur: 24px; --surface-bg: 20 20 30 / 0.55; }` | 所有卡片/弹窗/侧栏头变半透明+背景模糊 |
| 全 UI 换字体 | `:root { --font-sans: 'JetBrains Mono', monospace; }` | 全屏字体跟着变 |
| 加重阴影 | `:root { --shadow-dialog: 0 40px 80px rgba(0,0,0,0.6); }` | 弹窗阴影更厚重 |
| 改边框粗细 | `:root { --border-width: 2px; }` | 所有 chrome 层边框变粗 |

### 全部组件都跟着主题走

不只是背景和终端：

- 主背景、边框、滚动条、所有侧栏面板（项目/会话/Logs/Memory/Inbox/Files/Jobs/Usage/Performance ...）
- 所有按钮（普通 / hover / 激活 / 禁用）
- 所有徽章和状态标签
- 所有弹窗、上下文菜单、对话框
- **终端窗口**（xterm 背景、字色、光标色）
- **代码高亮**（shiki 渲染的代码块——DocsView / MarkdownView / DiffView 全包）
- 所有小图标、Popover、CommentPanel、GitGraph、ChangesList ...

### 关于"玻璃拟态"的覆盖范围（请你心里有底）

切到 `黑色玻璃拟态` 时，**chrome 层（弹窗、侧栏头部、对话框、卡片这种"层"）会半透明 + 背景模糊**——这也是 Obsidian / macOS / Windows 11 玻璃风格的实际做法。**内嵌的细节**（一行 list item 的背景、一个 tag 的底色、状态点）**保持实色但用配套深色，视觉协调**——不会出现"整个 list 每一行都模糊"那种因为过度玻璃化反而看不清的混乱感。

如果你的期望就是"chrome 层玻璃 + 细节实色协调"，那这版方案直接命中。如果你期望"每一行都半透明模糊（Glassmorphism Pro Max）"，那要再扩展，告诉我。

### 验收的地方

左侧活动栏最下方会多一个"调色板"图标，点开就能切。切到 `亮色护眼` 时所有组件一起变浅；切到 `黑色玻璃拟态` 时弹窗/卡片/侧栏头变半透明 + 背景模糊；贴 CSS 改 `--radius-md: 0` 全屏按钮立刻变方角。

---

## 目标

把 UI 改成"长时间使用不刺眼"的配色，并提供 **Obsidian 级别的全维度可主题化**（颜色 / 圆角 / 阴影 / 字体 / 边框 / 表面材质）。

### 验收标准（浏览器里能观察到的）

1. **默认外观**：启动应用后默认看到**柔和深灰背景**（约 `#1f1f23`）+ 浅灰文字（约 `#d4d4d6`），不再是纯黑 + 纯白。
2. **入口可见**：左侧活动栏最下方多一个"调色板"图标；点开是 `AppearanceView` 侧边面板。
3. **三套预设可切**：面板里"主题"下拉三个选项：`柔和深灰` / `亮色护眼` / `黑色玻璃拟态`。点击任一项，**全屏 1 秒内变色**。
4. **全组件覆盖（颜色维度）**：切到 `亮色护眼` 时，下列**全部**变浅色——
   - 主背景 + 三列布局壳（ActivityBar / PrimarySidebar / ProjectsColumn / EditorArea）
   - 全部 10 个 sidebar 视图（Scm/Docs/Perf/Logs/Inbox/Output/Memory/Files/Jobs/Usage）+ 新增的 AppearanceView
   - 编辑区：EditorArea tab 栏 / ChecklistEditor / SessionView 顶栏 / InputMenu
   - 终端（xterm）背景从深变浅
   - 代码块（shiki）从深色高亮主题切到浅色高亮主题
   - 所有按钮 / 徽章 / 状态点 / Popover / 弹窗 / GitGraph / ChangesList / CommentsPanel / StatusBadge
   - 滚动条（webkit 接管的那层）
   - **不允许出现某个按钮、某个徽章仍是深色的"半亮半暗"现象**
5. **玻璃拟态可切（新增维度）**：切到 `黑色玻璃拟态` 时——
   - 全部 `.fluent-acrylic / .fluent-mica / .fluent-card / .surface` 元素**半透明 + 背景模糊**（backdrop-filter blur 24px+）
   - 弹窗、对话框、上下文菜单、Popover、侧栏头部、对话框 layer 都是玻璃感
   - 主背景为更深的 base 色（约 `#080810`）以衬托半透明叠层
6. **自定义 CSS 即时生效（5 个维度都要验）**：
   - 颜色：贴 `:root { --color-bg: 17 34 51; }` → 背景变蓝灰
   - 圆角：贴 `:root { --radius-md: 0; --radius-win: 0; }` → 全屏按钮、卡片变方角
   - 字体：贴 `:root { --font-sans: 'JetBrains Mono', monospace; }` → 全 UI 字体变
   - 阴影：贴 `:root { --shadow-dialog: 0 40px 80px rgba(0,0,0,0.6); }` → 打开任一对话框，阴影变厚
   - 表面材质：贴 `:root { --surface-blur: 24px; --surface-bg: 20 20 30 / 0.55; }` → 弹窗/卡片立刻半透明 + 模糊
7. **持久化**：刷新页面，上次选的主题 + 自定义 CSS 仍生效。
8. **无 FOUC**：硬刷新（Ctrl+F5）不出现"先黑底后变色"的瞬间闪烁。
9. **操作日志**：LogsView 能看到 `scope=theme action=switch` 和 `scope=theme action=apply-css` 的起止配对，至少一条人工触发的 ERROR。
10. **无视觉回归**：在 `柔和深灰` 默认主题下，布局/间距/圆角/阴影/字体与升级前的纯黑主题一致——尤其带半透明修饰符（如 `bg-bg/50`）的元素不能变全不透明。

---

## 非目标（本轮明确不做）

- **不做磁盘文件主题导入导出**（如 `~/.aimon/themes/<name>.css`）——只能在面板 textarea 里粘贴 CSS。磁盘文件留二轮。
- **不新增后端 themes 路由**：localStorage（浏览器本地存储）就够了。
- **不做"分模块独立配色"**：不允许"终端单独一套色 + 代码高亮单独一套色 + 主面板再一套"。本轮三者统一跟随全局主题。
- **不做内嵌细节（list 行 / tag / 状态点）的半透明化**：玻璃只覆盖 chrome 层。"Glassmorphism Pro Max（每行都模糊）"不在本轮范围。
- **不做主题市场 / 主题分享 / 在线下载**。
- **不跟随系统 `prefers-color-scheme`**：用户手动选主题。
- **不做打印模式 / 高对比度系统偏好 / 色盲友好模式**。
- **不做主题之间的过渡动画**（避免切换时全屏 fade，反而眩晕）。

---

## 实施步骤

> 每步带 `verify`，AI 自查通过才算完成。所有面向用户的写操作必须配 `logAction` 起止日志。

### A. Token 层全维度改造（决定能否"全可定制"）

1. **建立 RGB triplet 格式的 CSS 变量层（颜色 + 表面 + 圆角 + 阴影 + 边框 + 字体）**
   - 新建 `packages/web/src/theme/tokens.css`，包含五类变量：
     ```css
     :root {
       /* ── 颜色：RGB triplet（三数字空格分隔，不带 rgb()） ── */
       --color-bg: 32 32 32;            /* = #202020 默认 */
       --color-card: 43 43 43;
       --color-card-2: 50 50 50;
       --color-border: 58 58 58;
       --color-border-soft: 50 50 50;
       --color-fg: 255 255 255;
       --color-muted: 199 199 199;
       --color-subtle: 138 138 138;
       --color-accent: 96 205 255;
       --color-accent-2: 76 194 255;
       --color-accent-deep: 0 120 212;
       --color-xterm-bg: 28 28 28;
       --color-xterm-fg: 255 255 255;
       --color-xterm-cursor: 96 205 255;
       --color-placeholder: 138 138 138;
       --color-focus-ring: 96 205 255;

       /* ── 表面材质（surface = 卡片/弹窗/侧栏头等"层"的统一抽象） ── */
       --surface-bg: rgb(var(--color-card));         /* 默认实色 */
       --surface-fg: rgb(var(--color-fg));
       --surface-border: rgb(var(--color-border));
       --surface-blur: 0px;                          /* 玻璃 = 24px */
       --surface-saturate: 100%;                     /* 玻璃 = 140% */
       --surface-shadow: var(--shadow-tile);

       /* ── 圆角：覆盖 Tailwind 默认 borderRadius scale ── */
       --radius-none: 0;
       --radius-sm:   2px;
       --radius:      4px;       /* = rounded */
       --radius-md:   6px;       /* = rounded-md */
       --radius-lg:   8px;       /* = rounded-lg */
       --radius-xl:   12px;
       --radius-2xl:  16px;
       --radius-3xl:  24px;
       --radius-full: 9999px;
       --radius-win:  8px;       /* Fluent Win11 默认 */

       /* ── 阴影 ── */
       --shadow-tile:   0 2px 4px rgba(0,0,0,0.14), 0 0 1px rgba(0,0,0,0.28);
       --shadow-flyout: 0 8px 16px rgba(0,0,0,0.14), 0 0 1px rgba(0,0,0,0.28);
       --shadow-dialog: 0 32px 64px rgba(0,0,0,0.36), 0 0 8px rgba(0,0,0,0.28);

       /* ── 边框宽度 ── */
       --border-width: 1px;

       /* ── 字体 ── */
       --font-sans:    'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
       --font-display: 'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif;
       --font-mono:    'Cascadia Mono', Consolas, Menlo, monospace;

       /* ── shiki ── */
       --shiki-theme-name: 'github-dark-dimmed';
     }
     ```
   - 默认值 = 现在的硬编码 → 默认主题视觉零变化。
   - `tokens.css` 在 `index.css` 顶部 `@import`。
   - `verify`：`pnpm dev` 启动 → 浏览器视觉与主分支一致；devtools `:root` 能看到全部变量。

2. **改写 `tailwind.config.js`：colors / borderRadius / boxShadow / fontFamily 全部改为引用变量**
   - **关键**：`borderRadius` 段用 **`theme.borderRadius`**（**不是 `extend`**）全量重写——覆盖 Tailwind 默认 scale，让所有 `rounded-md / rounded-lg / rounded-2xl` 等自动跟随变量。
   - **关键**：colors 用 RGB triplet 写法支持 opacity 修饰符。
     ```js
     theme: {
       borderRadius: {
         none: 'var(--radius-none)',
         sm:   'var(--radius-sm)',
         DEFAULT: 'var(--radius)',
         md:   'var(--radius-md)',
         lg:   'var(--radius-lg)',
         xl:   'var(--radius-xl)',
         '2xl':'var(--radius-2xl)',
         '3xl':'var(--radius-3xl)',
         full: 'var(--radius-full)',
         win:  'var(--radius-win)',
       },
       extend: {
         colors: {
           bg:            'rgb(var(--color-bg) / <alpha-value>)',
           card:          'rgb(var(--color-card) / <alpha-value>)',
           'card-2':      'rgb(var(--color-card-2) / <alpha-value>)',
           border:        'rgb(var(--color-border) / <alpha-value>)',
           'border-soft': 'rgb(var(--color-border-soft) / <alpha-value>)',
           fg:            'rgb(var(--color-fg) / <alpha-value>)',
           muted:         'rgb(var(--color-muted) / <alpha-value>)',
           subtle:        'rgb(var(--color-subtle) / <alpha-value>)',
           accent:        'rgb(var(--color-accent) / <alpha-value>)',
           'accent-2':    'rgb(var(--color-accent-2) / <alpha-value>)',
           'accent-deep': 'rgb(var(--color-accent-deep) / <alpha-value>)',
         },
         boxShadow: {
           tile:    'var(--shadow-tile)',
           flyout:  'var(--shadow-flyout)',
           dialog:  'var(--shadow-dialog)',
         },
         fontFamily: {
           sans:    'var(--font-sans)',
           display: 'var(--font-display)',
           mono:    'var(--font-mono)',
         },
         borderWidth: {
           DEFAULT: 'var(--border-width)',
         },
       },
     }
     ```
   - `<alpha-value>` 是 Tailwind 3.4 内置占位符，`/50` 自动展开为 0.5。
   - `verify`：`pnpm build` 通过；浏览器视觉与主分支一致；grep 全仓 `bg-\w+/\d|text-\w+/\d|border-\w+/\d|ring-\w+/\d` 命中位置切主题前后视觉一致。

3. **新建 3 套预设主题文件**
   - 新建 `packages/web/src/theme/themes.css`，每套 `[data-theme="<name>"]` 块覆写 tokens：
     - `soft-dark`（默认）：
       ```css
       [data-theme="soft-dark"] {
         --color-bg: 31 31 35;
         --color-fg: 212 212 214;
         --color-card: 38 38 44;
         --color-card-2: 46 46 52;
         --color-border: 58 58 64;
         --color-border-soft: 46 46 52;
         --surface-bg: rgb(var(--color-card));
         --surface-border: rgb(var(--color-border));
         --color-xterm-bg: 28 28 32;
         --color-xterm-fg: 212 212 214;
         --shiki-theme-name: 'github-dark-dimmed';
       }
       ```
     - `light-soft`：
       ```css
       [data-theme="light-soft"] {
         --color-bg: 244 244 245;
         --color-fg: 42 42 46;
         --color-card: 255 255 255;
         --color-card-2: 248 248 250;
         --color-border: 220 220 224;
         --color-border-soft: 232 232 236;
         --color-muted: 90 90 96;
         --color-subtle: 130 130 136;
         --color-accent: 0 120 212;
         --surface-bg: rgb(var(--color-card));
         --surface-border: rgb(var(--color-border));
         --color-xterm-bg: 250 250 252;
         --color-xterm-fg: 42 42 46;
         --color-xterm-cursor: 0 120 212;
         --shiki-theme-name: 'github-light';
         /* 亮色下重设阴影更柔和 */
         --shadow-tile:   0 2px 4px rgba(0,0,0,0.06), 0 0 1px rgba(0,0,0,0.10);
         --shadow-flyout: 0 8px 16px rgba(0,0,0,0.08), 0 0 1px rgba(0,0,0,0.10);
         --shadow-dialog: 0 32px 64px rgba(0,0,0,0.16), 0 0 8px rgba(0,0,0,0.10);
       }
       ```
     - `glass-dark`（黑色玻璃拟态，新预设）：
       ```css
       [data-theme="glass-dark"] {
         --color-bg: 8 8 14;            /* 极深 base */
         --color-fg: 226 226 230;
         --color-card: 20 20 30;
         --color-card-2: 28 28 38;
         --color-border: 60 60 75;
         --color-accent: 138 180 255;
         /* 表面材质改半透明 + 模糊 */
         --surface-bg: rgb(var(--color-card) / 0.55);
         --surface-border: rgb(255 255 255 / 0.08);
         --surface-blur: 24px;
         --surface-saturate: 140%;
         --color-xterm-bg: 12 12 18;
         --color-xterm-fg: 226 226 230;
         --shiki-theme-name: 'github-dark';
       }
       ```
   - `themes.css` 在 `index.css` 紧跟在 tokens.css 后 `@import`。
   - `verify`：浏览器 devtools 把 `<html>` 的 `data-theme` 改成 `"soft-dark"` / `"light-soft"` / `"glass-dark"`，全屏跟随变色 + 弹窗/卡片在玻璃主题下半透明 + 模糊。

4. **新增 `.surface` 语义 utility class，重写 `.fluent-*` 三件**
   - 在 `packages/web/src/index.css` 里新增：
     ```css
     /* surface: 任何"层"（卡片/弹窗/侧栏头）的统一表面 */
     .surface {
       background-color: var(--surface-bg);
       color: var(--surface-fg);
       border: var(--border-width) solid var(--surface-border);
       border-radius: var(--radius-lg);
       box-shadow: var(--surface-shadow);
       backdrop-filter: saturate(var(--surface-saturate)) blur(var(--surface-blur));
       -webkit-backdrop-filter: saturate(var(--surface-saturate)) blur(var(--surface-blur));
     }
     /* 现有 fluent-acrylic / fluent-mica / fluent-card 改成走 --surface-* */
     .fluent-acrylic {
       background-color: var(--surface-bg);
       backdrop-filter: saturate(var(--surface-saturate)) blur(max(var(--surface-blur), 30px));
       -webkit-backdrop-filter: saturate(var(--surface-saturate)) blur(max(var(--surface-blur), 30px));
       border: var(--border-width) solid var(--surface-border);
     }
     .fluent-mica {
       background-color: var(--surface-bg);
       backdrop-filter: saturate(var(--surface-saturate)) blur(max(var(--surface-blur), 60px));
       -webkit-backdrop-filter: saturate(var(--surface-saturate)) blur(max(var(--surface-blur), 60px));
     }
     .fluent-card {
       background-color: var(--surface-bg);
       border: var(--border-width) solid var(--surface-border);
       border-radius: var(--radius-lg);
       box-shadow:
         inset 0 1px 0 rgb(255 255 255 / 0.04),
         var(--shadow-tile);
       backdrop-filter: blur(var(--surface-blur));
       -webkit-backdrop-filter: blur(var(--surface-blur));
     }
     ```
   - 默认主题 `--surface-blur: 0px` → backdrop-filter 等同无效，性能零开销。
   - `verify`：默认主题下 `.fluent-card` 视觉与主分支一致；切到 `glass-dark` 主题，`.fluent-card / .fluent-acrylic / .fluent-mica` 立刻半透明 + 模糊。

5. **`index.css` 其他硬编码迁移到 CSS 变量**
   - 把 `index.css` 里其他 hex 颜色（`#8a8a8a / #60cdff / #1c1c1c / #2b2b2b / #3a3a3a / rgba(255,255,255,*)`）改成 `rgb(var(--xxx)) / rgb(var(--xxx) / 0.18)` 等格式。
   - 重点改 `body / placeholder / focus-visible / scrollbar / xterm host / fluent-selection-indicator / shiki line numbers gutter`。
   - body 的 radial-gradient（蓝/紫 4% alpha）也改成 `rgb(var(--color-accent) / 0.04)`，让玻璃主题下点缀色跟着变。
   - `verify`：grep `index.css` 确认无裸 hex；切主题时全部跟随。

6. **散落硬编码 hex 全量迁移（决定"全组件覆盖"是否真成立）**
   - grep 全仓 `packages/web/src/` 下直接写 hex 的位置（约 35 处散落 15 个文件）。每处判断：
     - 能用现有 token class（如 `bg-card / text-fg`）替代 → 改 class
     - 实在不行 → `style={{ background: 'rgb(var(--color-xxx))' }}` 或在 tokens 新增专用变量
   - **特别处理点**：
     - `SessionView.tsx:284` xterm theme（Step 8 单独处理）
     - `highlight.ts:5` shiki theme（Step 9 单独处理）
     - 其它散落点逐一迁移
   - `verify`：grep `packages/web/src/` 下 `#[0-9a-fA-F]{3,8}` 命中数从 35 降到 0（除注释、文档字符串、测试 fixture 外）。

7. **回归核查 1：opacity 修饰符**
   - grep 全仓 `bg-\w+/\d|text-\w+/\d|border-\w+/\d|ring-\w+/\d|placeholder-\w+/\d|divide-\w+/\d`，列出所有命中文件。
   - 每个命中位置在 `soft-dark` 主题下与主分支同位置肉眼对照 → 视觉一致（除颜色柔和外）。
   - 任何"半透明变全不透明"列入修复，回到 Step 2 调整。
   - `verify`：grep 出的所有位置切主题前后无视觉异常。

### B. 子系统跟随（xterm + shiki）

8. **xterm 终端跟随主题切换**
   - 改 `packages/web/src/components/terminal/SessionView.tsx`：
     - 新增 helper `readXtermThemeFromCss()`：用 `getComputedStyle(document.documentElement).getPropertyValue('--color-xterm-bg')` 读 RGB triplet，转 `rgb(R G B)` 字符串塞给 xterm theme。
     - xterm 实例创建用 helper；订阅 `useThemeStore().currentTheme` 变更时调 `term.options.theme = readXtermThemeFromCss()` + **dispose webgl addon 后重新挂载**（不重建 Terminal 实例，buffer 不丢）。
   - `verify`：开终端 → 切主题 → **已打开的终端窗口**立刻变色。日志 `scope=session action=apply-theme` 起止配对。

9. **shiki 代码高亮跟随主题切换**
   - 改 `packages/web/src/highlight.ts`：把 `'github-dark-dimmed'` 常量改为读 `getComputedStyle(...).getPropertyValue('--shiki-theme-name')` 决定 theme name。
   - 切主题时触发已渲染代码块 re-highlight：暴露 `useShikiVersion()` 计数器钩子，主题变就 +1，所有调 `codeToHtml` 的组件 deps 包含它。
   - `verify`：DocsView / MarkdownView / DiffView 里有代码块的页面，切主题后代码块颜色跟着变。

### C. 主题状态管理 + UI 入口

10. **主题状态管理 + localStorage 持久化**
    - 新建 `packages/web/src/theme/store.ts`：zustand slice，字段 `currentTheme: 'soft-dark' | 'light-soft' | 'glass-dark'` + `customCss: string`。
    - localStorage key：`aimon_theme_v1`（值是 JSON `{ theme, customCss }`）。
    - 切主题时三件事原子完成：(a) 写 localStorage；(b) `document.documentElement.dataset.theme = newTheme`；(c) 刷新 `document.getElementById('user-theme')!.textContent = customCss`。
    - `verify`：浏览器 devtools → Application → Local Storage 能看到 `aimon_theme_v1`；刷新页面主题保留。

11. **FOUC 防闪：`index.html` 内联同步脚本**
    - 在 `packages/web/index.html` 的 `<head>` 里加一段 inline `<script>`（不带 `defer / async`，**早于** `<script type="module" src="/src/main.tsx">`）：
      ```html
      <script>
        try {
          var s = JSON.parse(localStorage.getItem('aimon_theme_v1') || '{}');
          document.documentElement.dataset.theme = s.theme || 'soft-dark';
          if (s.customCss) {
            var st = document.createElement('style');
            st.id = 'user-theme';
            st.textContent = s.customCss;
            document.head.appendChild(st);
          }
        } catch (e) {}
      </script>
      ```
    - 同时把 `<meta name="theme-color" content="#202020" />` 改为 `#1f1f23`（新默认 soft-dark）。
    - `verify`：硬刷新（Ctrl+F5）页面，**不出现"先黑底后变色"的闪烁**。

12. **AppearanceView 侧边面板**
    - 新建 `packages/web/src/components/sidebar/AppearanceView.tsx`：
      - 上半截：标题"主题" + `<select>` 三个选项 + 每个选项右边一个小色块预览。
      - 下半截：标题"自定义 CSS" + textarea（`font-mono` 等宽字体，约 12 行高度）+ "应用" / "重置" 按钮 + 一行小字提示"如果应用后没效果，请打开浏览器 console 看是否有 CSS 警告"。
      - 应用按钮：调 `useThemeStore().setCustomCss(value)`，触发 `<style id="user-theme">` 内容刷新。
      - 输入超过 100KB 时拒绝并 ERROR 日志。
      - 在 textarea 上方放一段折叠的"可改的变量速查"，列出 tokens.css 全部变量名（颜色/圆角/阴影/字体/边框/表面）+ 每个变量一行简短说明，方便贴 CSS 时对照。
    - 改 `packages/web/src/components/layout/ActivityBar.tsx`：在最下方加一个"调色板"图标按钮（用现有 svg icon 风格，类似 lucide 的 Palette），点击切到 `appearance` activity。
    - 改 `packages/web/src/components/layout/PrimarySidebar.tsx` 的 activity 路由表：`appearance → AppearanceView`。
    - 改 `packages/web/src/store.ts`：`Activity` 类型加 `'appearance'`。
    - `verify`：浏览器里能看到调色板图标 → 点开 → 切主题立刻生效 → 贴 CSS 改颜色/圆角/字体/玻璃任一维度立刻生效 → 刷新页面保留。

### D. 操作日志

13. **操作日志埋点**
    - 切主题：`logAction('theme', 'switch', async () => {...}, { from, to })` 起止配对。
    - 应用自定义 CSS：`logAction('theme', 'apply-css', async () => {...}, { length })` 起止；超长拒绝走 ERROR。
    - 重置自定义 CSS：`logAction('theme', 'reset-css', async () => {...})`。
    - xterm apply-theme：`logAction('session', 'apply-theme', ..., { sessionId, theme })`。
    - `verify`：LogsView 里能看到 `scope=theme action=switch`、`scope=theme action=apply-css`、`scope=session action=apply-theme` 的 INFO 起止配对，至少一条 ERROR（人工触发——贴超过 100KB 的 CSS）。

### E. 全维度回归核查（决定 Obsidian 级别是否真成立）

14. **回归核查 2：圆角 + 阴影 + 字体 + 边框迁移完整性**
    - 圆角：grep 全仓 `border-radius: \d`、`rounded-\[`（任意硬编码 px 圆角），列出。每处判断是否需要替换为 `var(--radius-*)` 或 `rounded-md` token。
    - 阴影：grep 全仓 `box-shadow: \w` 直接写阴影的位置，迁移到 `var(--shadow-*)` 或 Tailwind `shadow-flyout` token。
    - 字体：grep 全仓 `font-family: ` 直接写字体栈的位置（除 tokens.css 自身外），迁移到 `var(--font-*)`。
    - 边框：grep 全仓 `border-width: \d`、`border-\d` 硬编码，迁移到 `var(--border-width)` 或 Tailwind `border` token。
    - `verify`：贴 `:root { --radius-md: 0; }` 全屏按钮变方角；贴 `:root { --shadow-dialog: 0 0 0; }` 弹窗无阴影；贴 `:root { --font-sans: monospace; }` 全 UI 字体变。

15. **全组件跟随核查：三套预设逐一压测**
    - 切 `light-soft` 主题：逐个打开下列页面/组件，确认**全部为浅色系无割裂**：
      - 主三列布局
      - 全部 11 个 sidebar 视图（含 AppearanceView）
      - EditorArea tab 栏 + ChecklistEditor + SessionView（含一个开着的终端）
      - 各 dialog（NewProjectDialog / CliInstallerDialog / PromptLibraryDialog）
      - 各 popover/menu（ContextMenu / StartSessionMenu / BranchPopover / CommentPopover / PermissionsDrawer）
      - 各预览（MarkdownView / CodeView / DiffView / FilePreview / ImagePreview / ExcelPreview / HtmlPreview / GitGraph / ChangesList / CommentsPanel / StatusBadge）
    - 切 `glass-dark` 主题：同上清单逐个打开，确认**所有 chrome 层（弹窗/卡片/侧栏头）半透明 + 背景模糊**；body 极深底色衬托；内嵌细节为协调深色。
    - 任何一处出现深色块、深色按钮、深色徽章、应该玻璃但是实色 → 回到 Step 6 / Step 14 补迁移。
    - `verify`：上述清单全部在三套主题下视觉自洽。

16. **散落 hex 0 化扫描**
    - grep `packages/web/src/` 下 `#[0-9a-fA-F]{3,8}` 排除注释，应该 0 命中（除 tokens.css 自身、xterm 默认 fallback、shiki theme name 字符串）。
    - `verify`：命中数 = 0。

---

## 边界情况

- **用户贴的 CSS 语法错误**：浏览器 `<style>` 标签自动忽略坏规则，不崩。AppearanceView 在 textarea 下方提示"如果应用后没效果，请打开浏览器 console 看 CSS 警告"。
- **用户贴超大 CSS（>100KB）**：前端预校验拒绝并 ERROR 日志。
- **xterm webgl addon 重挂时光标位置**：buffer 不动，光标位置由 xterm 内部 state 维持，重挂只重画屏幕，光标不丢。
- **localStorage 被禁用 / quota 满**：try/catch 兜底，主题回落到 `soft-dark` 默认，customCss 丢失但不崩。
- **首次启动的老用户**：localStorage 没有 `aimon_theme_v1`，自动落到 `soft-dark`——意味着**所有老用户首次升级后界面会从纯黑变成柔和深灰**。这是本任务的目的，不是 bug。如老用户想保持纯黑，可在 AppearanceView 切到 `glass-dark`（更暗）或贴 CSS 自定义。
- **shiki re-highlight 性能**：长 markdown 文档可能 20+ 代码块，re-highlight 一次约 100-300ms。可接受。
- **`backdrop-filter` 性能在低端机**：大量 backdrop-filter 元素同时显示会拖慢滚动。`glass-dark` 主题里 chrome 层数有限（弹窗/侧栏头/对话框，约 5-10 个同时显示），实测影响可控；如真出问题可在风险段降级（默认主题 blur=0 已是零开销）。
- **某些浏览器对 RGB triplet 空格语法兼容**：Electron / Chrome 90+ / Edge 90+ 完全支持。VibeSpace 跑在这些环境里，无忧。
- **用户贴 `[data-theme="..."]` 选择器**而非 `:root`：合法，正常工作（特异性更高反而更优先）。
- **改字体后 xterm 不跟随**：xterm 字体在 SessionView.tsx 创建时硬编码 `Cascadia Mono`——本轮顺手把 xterm `fontFamily` 也改成读 `--font-mono`，让字体改动也一致。

---

## 风险与注意

### 关键风险 1：Tailwind RGB triplet 重写带来的 opacity 回归

- **本质**：把 `colors.bg: '#202020'` 改成 `colors.bg: 'rgb(var(--color-bg) / <alpha-value>)'` 后，全仓 199 处 token class 里凡是带 `/数字` opacity 修饰符（如 `bg-bg/50`、`text-fg/30`）的位置，**渲染机制变了**——
  - 原来：Tailwind 生成 `background-color: rgba(32 32 32 / 0.5)`
  - 现在：Tailwind 生成 `background-color: rgb(var(--color-bg) / 0.5)`
- **正常工作的前提**：CSS 变量值必须是 RGB triplet 格式（`32 32 32`），不能是 hex 也不能带 `rgb()` 包装。Step 1 已按 triplet 定义。
- **缓解**：Step 7 的 opacity 回归核查步骤。

### 关键风险 2：Tailwind borderRadius scale 全量重写带来的视觉漂移

- **本质**：用 `theme.borderRadius`（不是 extend）覆盖 Tailwind 默认 scale 后，所有 `rounded-md / rounded-lg / rounded-2xl / rounded-3xl` 等的实际像素值由 `--radius-*` 变量决定。如果 tokens 默认值与 Tailwind 默认值（`md=6px / lg=8px / 2xl=16px`）有偏差，会导致全仓所有圆角微变。
- **缓解**：Step 1 的 tokens 默认值与 Tailwind 默认 scale 完全一致，确保升级前后默认主题视觉零变化。
- **验证**：Step 14 的圆角回归核查 + 把 main 分支某个圆角元素截图对比新分支默认主题。

### 关键风险 3：`.surface` / `.fluent-*` 在玻璃主题下叠加文字可读性

- **本质**：玻璃主题下 chrome 层 alpha=0.55 + blur=24px，如果 chrome 层背后是高对比度内容（如代码块），透出来的内容会让 chrome 层上的文字难读。
- **缓解**：`glass-dark` 主题里把 `--color-fg` 设得稍亮（`226 226 230`），并保留 `text-shadow: 0 1px 2px rgba(0,0,0,0.3)` 在风险位置（仅 dialog 标题、按钮文本）。
- **若真不可读**：兜底方案是降低 `--surface-blur` 到 16px + 把 alpha 提到 0.7。

### 其他风险

- **diff 大小**：约 30 文件改动。集中在 `tokens.css / themes.css / index.css / tailwind.config.js / 15 个散落 hex 文件 / SessionView.tsx / highlight.ts / theme/store.ts / index.html / AppearanceView.tsx / ActivityBar.tsx / PrimarySidebar.tsx / store.ts`。一次性 PR，做完后 handoff 按 "Token 改造 / 子系统跟随 / UI 入口 / 回归核查" 分组列出。
- **xterm webgl addon dispose+重挂**：失败兜底 fallback canvas renderer。
- **shiki 切主题的 re-highlight**：约 100-300ms，加 loading 微动效。
- **自定义 CSS 安全性**：localStorage + 同源 + 仅本机 server，无 XSS 风险。
- **未来引入第三方组件库**：若不吃 CSS 变量需单独适配；当前代码无此问题。

---

## 多模型 Plan 会审

> [Gemini 评审] **跳过**：本机未安装 gemini CLI（`spawn gemini ENOENT`），重试无意义不重试。
> [Codex 评审] **半跳过**：Codex 模型层调用失败（账户不支持当前可选模型），rescue 子代理回退后由 Claude 自审产出 ≤30 行结构性清单。**第一版采纳（已被本版反推翻）**：建议"不动 Tailwind config，散落 hex 留二轮"——第一版 plan 据此设计为"骨架变色 + 细节留二轮"。
> [主理人反馈触发的方案升级 1] 主理人原话"如果我想对应的组件的样式也会改变呢，基于css代码对应的组件样式也会变，还有终端背景颜色这些"——明确否决"半亮半暗"的范围裁剪，要求**本轮就让所有组件跟随主题与自定义 CSS**。Plan 据此重写为"Tailwind RGB triplet 全量改造 + 散落 hex 全量迁移 + opacity 回归核查"路径。
> [主理人反馈触发的方案升级 2] 主理人原话"现在只有颜色吗，比如按钮之前是圆角样式现在可以通过css修改为方角样式吗，如把现在的界面UI切换为黑色玻璃拟态的风格，现在支持吗"——AskUserQuestion 三档让主理人选，选了"彻底（Obsidian 级别）"。Plan 据此再次扩展：tokens 层从"颜色 + 字体"扩展到"颜色 + 字体 + 圆角 + 阴影 + 边框 + 表面材质（surface）"；Tailwind config 不只 colors，连 borderRadius scale 也全量改成引用变量；新增 `glass-dark` 第 3 套预设主题（黑色玻璃拟态）；新增 `.surface` 语义层 utility class，让 fluent-acrylic / fluent-mica / fluent-card 三件改走 `--surface-*` 变量。代价：diff 从 ~20 文件升到 ~30 文件；收益：主题能力等同 Obsidian。
> [Codex 综合主笔] **跳过**：Claude 自主综合三方输入并按主理人两次反馈连续迭代。
> [Claude 白话化兜底] 大哥摘要重写第三次，新增"自定义 CSS 能改什么"的 6 行表格让主理人一眼看到能力边界；明确"玻璃拟态的覆盖范围"（chrome 层玻璃 + 内嵌细节实色协调），避免主理人误以为"每行都模糊"；术语括号翻译（FOUC = 切主题瞬间闪一下白屏 / xterm = 终端模拟器 / shiki = 代码高亮库 / Tailwind = CSS 框架 / RGB triplet = 把颜色拆成红绿蓝三个数字 / opacity 修饰符 = 半透明颜色效果 / surface = 表面材质 / backdrop-filter = 背景模糊滤镜 / chrome 层 = 弹窗/侧栏头/对话框这些"层"）；对照 manual.md 偏好确认本方案符合"只在 plan 后停一次等确认、术语必括号、把'做了什么'翻译成'用户看得见的变化'"约束。
