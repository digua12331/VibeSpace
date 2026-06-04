# 修复自定义CSS不生效 · 任务清单

- [x] 步骤 1：在 `packages/web/src/theme/store.ts` 顶部加纯函数 `bumpRootSpecificity(css: string): string`，用正则 `/:root\b(?![\[(])/g` 替换为 `:root[data-theme]`。→ verify: 函数签名是 `(css: string) => string`；空字符串原样返回；`:root[data-theme="x"]` 不被改。
- [x] 步骤 2：让 `applyUserCss(css)` 在 `el.textContent = css` 之前先 `css = bumpRootSpecificity(css)`。→ verify: 在浏览器粘贴问题里那段含 `:root { ... }` 的 CSS，DevTools 查 `<style id="user-theme">` textContent 已经是 `:root[data-theme] { ... }`；整个 UI 视觉立刻变（米黄底、深棕字、Georgia 衬线、方角）。
- [x] 步骤 3：在 `packages/web/index.html` 的 IIFE 里 `style.textContent = s.customCss` 之前同样跑一次正则转换。注释指向 store.ts 的 `bumpRootSpecificity`。→ verify: 刷新页面，UI 不闪一下预设主题再切回自定义；从一开始就是自定义 CSS 效果。
- [x] 步骤 4：跑项目类型检查（`pnpm -C packages/web typecheck` 或仓库根 `pnpm typecheck`）。→ verify: 退出码 0，无报错。**实际执行 `npx tsc -b` in packages/web，EXIT_CODE=0。**
- [ ] 步骤 5（**待主理人手动验收**）：LogsView 验收 + 失败分支回归。→ verify: 浏览器 LogsView 看到 `scope=theme action=apply-css` 起止配对；故意粘贴 110KB 长 CSS，LogsView 出现 `scope=theme` 的 ERROR `apply-css 失败: CSS 长度 ... 字节超过上限`。代码侧未动这两个日志埋点，理论上行为不变；但 CLAUDE.md 要求人工验收类不算自动通过，留给主理人在浏览器里跑一遍。
