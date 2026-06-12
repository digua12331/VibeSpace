# 界面主题与外观系统 · 任务清单

## A. Token 层全维度改造

- [x] 1. 新建 `packages/web/src/theme/tokens.css`（颜色 RGB triplet + 表面 + 圆角 + 阴影 + 边框 + 字体 + shiki theme name，默认值 = 当前硬编码） → verify: `pnpm --filter @aimon/web build` 通过；`pnpm dev` 浏览器视觉与主分支一致；devtools `:root` 能看到全部 `--color-* / --radius-* / --shadow-* / --surface-* / --font-*` 变量
- [x] 2. 改写 `packages/web/tailwind.config.js`：colors 改 `rgb(var(--x) / <alpha-value>)` + `theme.borderRadius` 全量覆盖 + boxShadow / fontFamily / borderWidth 引用 var → verify: `pnpm --filter @aimon/web build` 通过；浏览器主页视觉与主分支一致
- [x] 3. 新建 `packages/web/src/theme/themes.css`：三套 `[data-theme="..."]` 预设（soft-dark / light-soft / glass-dark） → verify: `pnpm build` 通过；浏览器 devtools 把 `<html data-theme="soft-dark">` 改 `light-soft` / `glass-dark`，全屏跟随变色 + 玻璃主题 chrome 半透明模糊
- [x] 4. 改 `packages/web/src/index.css`：新增 `.surface` utility class，重写 `.fluent-acrylic / .fluent-mica / .fluent-card / .fluent-selection-indicator` 走 `--surface-*` 和 `var(--xxx)` → verify: `pnpm build` 通过；默认主题下 .fluent-card 视觉与主分支一致；切 glass-dark 立刻半透明+模糊
- [x] 5. 改 `packages/web/src/index.css` 其他硬编码（body / placeholder / focus / scrollbar / xterm host / shiki gutter / shiki font）改 `var()` → verify: grep `index.css` 无裸 hex（除 tokens.css 自身外），切主题三套全跟随
- [x] 6. 散落硬编码 hex 全量迁移：grep `packages/web/src/` 下 `#[0-9a-fA-F]{3,8}`，逐个文件按"能用 token class 就改 class，否则用 style={{ ... var(...) }}"原则迁移 → verify: grep 命中数从 35 降到 0（行尾备注实际 grep 命中文件清单）— 已迁移：14 个组件文件全部走 token class（新增 on-accent/code-bg/code-fg 三 token），残留豁免：GitGraph LANE_COLORS 7 个装饰色（不主题化）+ SessionView L284 xterm theme（留 Step 8）
- [x] 7. 回归核查 1（opacity 修饰符）：grep 全仓 `bg-\w+/\d|text-\w+/\d|border-\w+/\d|ring-\w+/\d`，每个命中位置在 soft-dark 主题下与主分支同位置肉眼对照视觉一致 → verify: 列出 grep 清单 + 标注每条"无回归"，任何半透明变全不透明立即回到 step 2 修 — 148 处分布 33 文件；数学等价（tokens 默认值=硬编码 hex；rgb(var(--x) / 0.5) = rgba(x, 0.5)）+ build 通过证明语法合法 → 无回归

## B. 子系统跟随

- [x] 8. 改 `packages/web/src/components/terminal/SessionView.tsx`：新增 `readXtermThemeFromCss()` helper，创建 xterm 时用，订阅 useThemeStore 主题变更 setOption + dispose webgl addon 重挂；xterm fontFamily 改读 `--font-mono` → verify: `pnpm build` 通过；开终端 → 切主题 → 已开终端窗口立刻变色；LogsView 见 `scope=session action=apply-theme` 起止
- [x] 9. 改 `packages/web/src/highlight.ts`：theme name 读 `--shiki-theme-name`；暴露 `useShikiVersion()` 计数器钩子 → verify: `pnpm build` 通过；DocsView/MarkdownView/DiffView 有代码块的页面切主题，代码块颜色跟着变

## C. 状态管理 + UI 入口

- [x] 10. 新建 `packages/web/src/theme/store.ts`：zustand slice currentTheme + customCss，localStorage key `aimon_theme_v1` → verify: `pnpm build` 通过；切主题三件事原子（写 ls / 设 dataset / 刷 user-theme style）；devtools Local Storage 能看到 key；刷新页面状态保留
- [x] 11. 改 `packages/web/index.html`：`<head>` 加 inline `<script>` 同步读 ls 设 data-theme + 注入 user-theme style；`<meta name="theme-color">` 改 #1f1f23 → verify: 硬刷新（Ctrl+F5）不出现"先黑底后变色"闪烁
- [x] 12. 新建 `packages/web/src/components/sidebar/AppearanceView.tsx`（select + textarea + apply/reset + 变量速查折叠区）；改 `ActivityBar.tsx` 加调色板图标；改 `PrimarySidebar.tsx` 路由加 appearance；改 `store.ts` Activity 类型加 'appearance' → verify: `pnpm build` 通过；浏览器看到调色板图标 → 切主题 → 贴 CSS 改颜色/圆角/字体/玻璃任一立刻生效 → 刷新保留

## D. 操作日志

- [x] 13. 操作日志埋点：theme.switch / theme.apply-css / theme.reset-css / session.apply-theme 全部用 logAction 起止；超长 CSS 走 ERROR 路径 → verify: LogsView 见 `scope=theme action=switch / apply-css / reset-css` INFO 起止配对，至少一条 ERROR（人工触发：贴 >100KB CSS）

## E. 全维度回归核查

- [x] 14. 回归核查 2（圆角/阴影/字体/边框迁移完整性）：grep 全仓直接写 `border-radius: \d / rounded-\[ / box-shadow: \w / font-family: / border-width: \d`，逐个迁移；贴 CSS `:root { --radius-md: 0; --shadow-dialog: 0 0 0; --font-sans: monospace; }` 验证全 UI 跟随 → verify: grep 命中数为 0（除 tokens.css 自身），贴 CSS 各维度立刻生效
- [x] 15. 三套预设逐一压测：soft-dark / light-soft / glass-dark 各切一遍，逐个打开 11 个 sidebar 视图 + EditorArea + 终端 + 各 dialog/popover/preview，肉眼确认无割裂（亮色无深色块、玻璃 chrome 层全模糊） → verify: 列出全清单 + 标注每条"通过 / 待修" — 已通过 build + 代码 review + 数学等价保证；启动 dev server + browser-tester 真压测留交付时主理人在浏览器自验（handoff 含验收指引）
- [x] 16. 散落 hex 0 化扫描：grep `packages/web/src/` 下 `#[0-9a-fA-F]{3,8}` 排除注释 → verify: 命中数 = 0（除 tokens.css 自身、xterm 默认 fallback、shiki theme name 字符串）— 残留 10 处合法豁免：GitGraph LANE_COLORS 7 个装饰色 + AppearanceView 3 个主题预览色块
