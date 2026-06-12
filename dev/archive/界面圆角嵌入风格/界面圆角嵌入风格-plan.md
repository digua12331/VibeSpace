# 界面圆角嵌入风格 · plan

## 大哥摘要

把 VibeSpace 从"铺满整个浏览器窗口、四角直角"改成"圆角嵌入面板"：界面四周留一圈 ~10px 窄边距，整体套 12px 圆角 + 一条细边框 + 柔和阴影，看起来像一块精致的面板浮在浏览器窗口里。**纯外观改动**——不动任何功能、不动数据、所有按钮和操作位置不变。已确认风格档位：精致细边。

## 目标

- VibeSpace 主界面四周出现均匀窄边距，整体四角变圆角，有细边框 + 柔和阴影。
- 验收（浏览器可观察）：打开 VibeSpace，界面不再贴满窗口边缘——四周能看到一圈约 10px 的背景留白，界面四个角都是圆的；弹窗（设置 / 新建项目 / 右键菜单）仍能正常弹出、不被圆角裁掉。

## 非目标

- 不改任何功能、布局结构、面板拖拽行为。
- 不改主题配色、不新增主题。
- 不动各内部面板（侧栏 / 终端 / 编辑区）自身的圆角。

## 实施步骤

1. `packages/web/src/index.css`：给 `#root` 加 `padding`（约 10px）做出四周留白；新增 `.app-frame` 规则（12px 圆角 + 1px 细边框 + 柔和阴影 + `overflow:hidden`）。验证：构建后界面四周有留白。
2. `packages/web/src/components/layout/Workbench.tsx`：根 div 加 `app-frame` class。验证：四角变圆、有阴影。
3. web 类型检查通过。

## 边界情况

- `overflow:hidden` 只裁剪普通流内容，`position:fixed` 的弹窗（DialogHost / SettingsDialog / ContextMenu / StartSessionMenu）仍相对视口定位、不被裁——`.app-frame` 不引入 `transform/backdrop-filter`，不会把 fixed 变成被裁的包含块。
- `#root` 用 `box-sizing:border-box`（全局 `* { box-sizing }` 已有），加 padding 后 Workbench `h-full` 仍正确填满内容区。
- 极小视口下 20px 总边距可忽略，不做响应式特判。

## 风险与注意

- 唯一风险点：`overflow:hidden` 若误裁了某个本该溢出的浮层。已分析 fixed 浮层不受影响；focus ring（`outline-offset:2px`）在贴边元素上可能被裁一点点，属可接受的极小视觉瑕疵。
- memory / ARCHITECTURE 扫过无相关条目。

## 多模型 Plan 会审

> 跳过：小档任务（纯样式、1–2 文件、已确认唯一视觉分叉），按 CLAUDE.md 不调外部模型。
