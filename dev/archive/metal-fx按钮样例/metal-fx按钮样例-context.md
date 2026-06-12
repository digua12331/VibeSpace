# metal-fx 按钮样例 · context

## 关键文件
- `packages/web/src/components/layout/ProjectsColumn.tsx:335-340` —— 「+ 新建项目」按钮,本次唯一改动点。包一层 `<MetalFx>`。
- `packages/web/package.json` —— 新增依赖 `metal-fx`(已由 pnpm add 写入)。
- `node_modules/metal-fx/dist/index.d.ts` —— API 参考(只读)。

## metal-fx API 摘要
- 主组件 `<MetalFx>`:包裹**单个**子元素(button/a/div),逐帧 ResizeObserver 测量子元素,在其上画金属环 + 发光。
- 关键 props:`preset`('chromatic'|'silver'|'gold',默认 chromatic)、`variant`('button'|'circle',默认 button)、`theme`('dark'|'light'|'auto')、`strength`(0..1)、`normalizeHostStyles`(默认 true,抹子元素 border/outline/box-shadow)、`className`/`style`(转发到 wrapper)。
- 全页共享一个 WebGL 渲染器,多实例复用,单按钮开销可忽略。

## 决策记录
- 选「+ 新建项目」按钮做样例:常驻可见(项目栏底部固定)、够显眼,大哥一打开就能看到,不用先点开任何弹窗。
- pin `theme="dark"`:本应用是深色界面(`text-fg`/`bg-white/[0.08]`),不跟随 OS 浅色,直接定深色调以保证金属调性正确。
- 不抽通用组件、不加开关:这是评估性样例,资深工程师看到会嫌过度设计。只在一处内联包裹。

## 依赖与约束
- React 19;metal-fx peerDeps 要求 react>=18,兼容。
- 原按钮的 `m-3` 外边距迁到 MetalFx wrapper,保持布局间距不变。
