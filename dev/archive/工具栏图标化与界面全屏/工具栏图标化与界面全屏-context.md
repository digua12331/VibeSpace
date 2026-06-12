# 工具栏图标化与界面全屏 · Context

## 关键文件

- `packages/web/src/components/editor/EditorArea.tsx`
  - 行 326：`<StartSessionMenu triggerLabel="+ 启动 AI / 终端" .../>`
  - 行 431：EmptyState 提示文案引用同一标签
- `packages/web/src/components/StartSessionMenu.tsx`
  - 行 283-285：📦 按钮内 `+{missingCount}` 文字 span
- `packages/web/src/index.css`
  - 行 33-49：`/* App frame */` 注释 + `#root{padding}` + `.app-frame{}`
- `packages/web/src/components/layout/Workbench.tsx`
  - 行 83：根 div className 含 `app-frame`

## 决策记录

- 启动按钮用裸「+」而非新引入图标库：按钮已有 `title` 提示，"图标即可" 取最简，无需引入资源。
- `missingCount` 信息未丢失：启动菜单内 "(N 项可装)" 仍在（StartSessionMenu 行 409）。
- 直接删 CSS 而非加开关：用户要的是固定全屏，不需可配置项（资深工程师视角：加开关属过度设计）。

## 依赖与约束

- `StartSessionMenu` 仅 EditorArea 一处使用，改 prop 值即可，无需改组件签名。
- 纯样式改动，行为不变 → 按操作日志规则属豁免项，不加埋点。
