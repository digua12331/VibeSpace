# 界面主题与外观系统 · context

> 这份是给 AI 自用的执行边界与决策记录。归档评审会读它产出 auto.md 记忆。

## 关键文件（本次改动的边界，原则上只动这里列的）

### 新增文件

- `packages/web/src/theme/tokens.css` ← 全部 design tokens（颜色 RGB triplet / 表面 / 圆角 / 阴影 / 边框 / 字体 / shiki theme name）
- `packages/web/src/theme/themes.css` ← 三套预设 `[data-theme="..."]` 块（soft-dark / light-soft / glass-dark）
- `packages/web/src/theme/store.ts` ← zustand slice：currentTheme + customCss + localStorage 持久化 + 三件事原子（写 ls / 设 dataset / 刷 user-theme style）
- `packages/web/src/components/sidebar/AppearanceView.tsx` ← 主题切换 + 自定义 CSS textarea + 变量速查 UI

### 修改文件

- `packages/web/src/index.css` （现状 190 行，已读完）
  - 顶部加 `@import './theme/tokens.css'` `@import './theme/themes.css'`（在 `@tailwind` 之前）
  - L18 `background:#202020; color:#ffffff` → `rgb(var(--color-bg))` / `rgb(var(--color-fg))`
  - L20-21 font-family → `var(--font-sans)`
  - L31-34 body radial-gradient → `rgb(var(--color-accent) / 0.04)` 等
  - L51 placeholder #8a8a8a → `rgb(var(--color-placeholder))`
  - L56 focus-visible #60cdff → `rgb(var(--color-focus-ring))`
  - L66 scrollbar-color #5a5a5a → `rgb(var(--color-subtle))`
  - L77, L83 scrollbar-thumb rgba(255,255,255,*) → `rgb(var(--color-fg) / 0.18)` 等
  - L95 .xterm background-color #1c1c1c → `rgb(var(--color-xterm-bg))`
  - L107-145 `.fluent-acrylic / .fluent-mica / .fluent-card / .fluent-selection-indicator` → 重写走 `--surface-*` + `var(--xxx)`
  - L167 `.shiki-wrap pre` font-family → `var(--font-mono)`
  - L187 line-numbers gutter color rgba → `rgb(var(--color-fg) / 0.25)`
  - 新增 `.surface` utility class

- `packages/web/tailwind.config.js` （现状 80 行，已读完）
  - colors 全部改成 `rgb(var(--color-x) / <alpha-value>)` 格式
  - **borderRadius 用 theme.borderRadius 全量覆盖**（不是 extend，否则 Tailwind 默认 scale 不跟随）
  - boxShadow 改引用 `var(--shadow-*)`
  - fontFamily 改引用 `var(--font-*)`
  - extend.borderWidth.DEFAULT 改引用 `var(--border-width)`

- `packages/web/index.html` （现状 14 行，已读完）
  - `<head>` 加 inline `<script>`（不带 defer/async，**早于** main.tsx）：try/catch 同步读 `aimon_theme_v1` 设 `dataset.theme` + 注入 `<style id="user-theme">`
  - `<meta name="theme-color">` 从 #202020 改为 #1f1f23

- `packages/web/src/store.ts` （现状已读至 L149）
  - `Activity` 类型加 `'appearance'`

- `packages/web/src/components/layout/ActivityBar.tsx`
  - 最下方加调色板图标按钮（lucide Palette 风格 svg，与现有图标风格一致）
  - onClick 切 activity → 'appearance'

- `packages/web/src/components/layout/PrimarySidebar.tsx`
  - activity 路由表加 `appearance → <AppearanceView />`

- `packages/web/src/components/terminal/SessionView.tsx` （xterm theme 在 L284）
  - 新增 helper `readXtermThemeFromCss()`：用 `getComputedStyle(documentElement).getPropertyValue('--color-xterm-*')` 读 RGB triplet → 转 `rgb(R G B)` 字符串
  - 创建 xterm 时用 helper
  - 订阅 useThemeStore，主题变更时 `term.options.theme = readXtermThemeFromCss()` + dispose webgl addon + 重挂
  - xterm `fontFamily` 改读 `--font-mono`

- `packages/web/src/highlight.ts` （shiki theme 在 L5）
  - theme name 读 `getComputedStyle(documentElement).getPropertyValue('--shiki-theme-name')`，去掉首尾引号
  - 暴露 `useShikiVersion()` 计数器钩子（zustand 内）

### 散落 hex 待迁移文件

待 Step 6 执行时 grep 全仓 `#[0-9a-fA-F]{3,8}` 后逐个文件迁移。预计 ~15 个文件 35 处。grep 结果列入 tasks.md Step 6 行尾备注。

## 决策记录

### D1：CSS 变量层 + Tailwind config 引用，不引第三方主题库

- **方案**：纯 CSS 变量（design tokens）+ Tailwind config 引用变量。zustand（已有依赖）管状态。
- **被拒**：next-themes / theme-ui / styled-system 等。
- **理由**：design tokens 是浏览器原生能力，零运行时开销；第三方库主要解决 SSR / 多框架场景，本任务（SPA + Electron 单壳）不需要。
- **过度设计自查**：✓ 不过度。最小化新增依赖。

### D2：`.surface` 是新增 utility，不重命名现有 `.fluent-*`

- **方案**：新增 `.surface` utility class（5-10 行 CSS），同时让 `.fluent-acrylic / .fluent-mica / .fluent-card` 内部改走 `--surface-*` 变量。
- **被拒**：把所有用 `.fluent-card` 的地方批量改成 `.surface`（语义化重命名）。
- **理由**：`.fluent-*` 历史命名只是字面，功能上就是 surface；让两者共享变量即可。重命名要扫几十个组件，diff 大且无新能力。
- **过度设计自查**：✓ 不过度。零侵入扩展。

### D3：Tailwind borderRadius 用 `theme.borderRadius` 全量覆盖（不是 extend）

- **方案**：覆盖 Tailwind 默认 scale，让所有 `rounded-md / rounded-lg / rounded-2xl` 等自动跟随 `--radius-*` 变量。
- **被拒**：`extend.borderRadius` 只新增 `rounded-win` 一个。
- **理由**：用户原话"按钮圆角改方角"——必须让默认 scale 也跟随变量，否则 `rounded-md` 永远 6px 不变。
- **过度设计自查**：✓ 必要。tokens 默认值与 Tailwind 默认值完全一致，零视觉漂移。

### D4：不做后端 themes 路由 / 不做磁盘文件主题

- **理由**：plan 已确认非目标。Obsidian 的"双击 .css 装主题"是 nice-to-have，本轮不做。
- **过度设计自查**：✓ 不过度。MVP 砍到最小。

### D5：xterm theme RGB triplet → rgb 字符串用本地 helper

- **方案**：写 `readXtermThemeFromCss()` helper（约 15 行）放 SessionView.tsx 内部。
- **被拒**：抽到独立 `theme/xterm-bridge.ts`。
- **理由**：只一处使用。预先抽公共模块 = 过度设计。
- **过度设计自查**：✓ 不过度。

### D6：shiki re-highlight 用全局 version 计数器

- **方案**：暴露 `useShikiVersion()` 钩子，主题变 +1，所有调 `codeToHtml` 的组件 deps 加这个计数器。
- **理由**：shiki theme 是全局的，re-highlight 必须全部一起做。

### D7：localStorage key 命名 `aimon_theme_v1`

跟现有 `aimon_workbench_v3` / `aimon_selected_project_v1` 风格一致。

### D8：AppearanceView 放 ActivityBar 最下方

UX 选择：常用功能（项目/会话/Logs）放上方，装饰类（外观）放下方。AI 自决。

### D9：默认主题 `--surface-blur: 0px` → backdrop-filter noop

浏览器对 `backdrop-filter: blur(0px)` 视为 noop，零性能开销。只在切到 `glass-dark` 才启用真实 blur。

### D10：xterm webgl addon 失败兜底

dispose+重挂可能 GPU 相关失败（context lost）；本任务暂不主动写 fallback——xterm 自身有内置 fallback 到 canvas。

### D11：不做主题切换 fade 过渡动画

切主题瞬间变色 OK；加 fade 反而眩晕。已在 plan 非目标。

### D12：自定义 CSS 输入 100KB 上限

前端预校验，超过拒绝并 ERROR 日志。理由：localStorage 单 key 5MB 上限里给主题留 100KB 是合理的；防恶意巨型粘贴拖慢 UI。

## 依赖与约束

- **新依赖**：无（zustand / lucide / react / xterm / shiki 全部已有）
- **后端**：无修改、无新增（无 settings 路由 / 无新表 / 无新文件）
- **数据结构变化**：localStorage 新增 key `aimon_theme_v1`，JSON 形如 `{ theme: 'soft-dark' | 'light-soft' | 'glass-dark', customCss: string }`
- **浏览器兼容**：Electron / Chrome 90+ / Edge 90+，RGB triplet 空格语法 / backdrop-filter / CSS 变量全支持
- **字体兜底**：Segoe UI Variable Text 在非 Windows 系统不存在 → 系统字体栈 fallback 已在 tokens.css fontFamily 里写
- **build 验证**：`pnpm --filter @aimon/web build`（含 `tsc -b`）必须通过
- **dev 启动**：`pnpm dev`（项目根）或 web 单跑 `pnpm --filter @aimon/web dev`
- **类型检查**：tasks 里每个 source 改动步骤的 verify 至少含一次 build 通过
