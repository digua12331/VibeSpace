# 界面圆角嵌入风格 · context

## 关键文件

- `packages/web/src/index.css:14-23` — `html, body, #root` 全局壳；给 `#root` 加 `padding`。
- `packages/web/src/index.css` — 新增 `.app-frame` 规则（圆角 + 边框 + 阴影 + overflow）。复用 token：`--radius-xl`(12px) / `--color-border` / `--border-width`。
- `packages/web/src/components/layout/Workbench.tsx:83` — 根 div `className="h-full flex flex-col bg-bg text-fg"`，追加 `app-frame`。

## 决策记录

- **inset 用 `#root` 的 padding 实现**，不另加 wrapper 组件——最小改动，`#root` 已是 `height:100%` + 全局 `box-sizing:border-box`，加 padding 即得四周留白且不破坏 `h-full`。资深视角：为一圈边距新建组件属过度设计。
- **frame 样式走 index.css 的 `.app-frame` 类**，不堆 Tailwind 任意值。圆角/边框/阴影/overflow 四件套放一处，复用现有 design token，主题切换自动跟随。
- **阴影自定义一条柔和值**（非 `--shadow-dialog` 的 32/64px 重阴影）——app 外框只需轻微浮起感，重阴影会越过 10px 边距显得突兀。

## 依赖与约束

- 改的是打包产物源码，dev 模式 vite HMR 即时生效；验收刷新浏览器即可。
- 纯样式、无行为变化 → 按 CLAUDE.md 操作日志规则属豁免项，不加 logAction。
- web 为 TypeScript，改完跑一次 `tsc -b`（虽只动 CSS + 一个 className，仍按硬性规则过类型检查）。
