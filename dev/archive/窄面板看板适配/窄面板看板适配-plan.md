# 窄面板看板适配 · Plan

## 大哥摘要

总控台看板（左下角 ActivityBar 里那个"总控台"图标点开后看到的项目列表）现在每个项目卡片右边都有「打开」「+ 派任务」两个按钮，有时还多一个「停所有」。问题是：当你把左侧栏拖窄一点，最右边的「+ 派任务」就被裁掉一半，只能看到 "+ 派"，按钮也点不全。

这次改动只让按钮在挤不下时自动换到下一行（仍然贴右显示），保证文字永远完整可读、可点。项目数据、按钮功能、刷新频率（每 5 秒）一律不动。

你能在哪里看到效果：左下角 ActivityBar 点"总控台"图标 → 用鼠标拖左侧栏右边缘把它拖窄一点 → 卡片右侧的按钮组应该整组掉到下一行，文字完整，而不是被切。

## 目标

- 让 `HubProjectCard` 的头部布局在窄宽度（sidebar 拖窄）下不再发生按钮文字截断 / 按钮被裁的情况。
- 验收标准（浏览器可观察）：
  1. 把 PrimarySidebar 拖到约 320 px，「总控台看板」卡片里的「+ 派任务」三个字完整可见；
  2. 同一卡片下「打开」「+ 派任务」（aliveCount>0 时还有「停所有」）按钮组整组贴右显示，不会被裁；
  3. 把 sidebar 拖宽到 600 px+，按钮组与状态/内存/时间仍在同一行（保留宽屏单行体验）；
  4. 项目名 / 路径仍然 truncate，不会顶飞布局。

## 非目标

- 不重做 Hub 看板信息架构（不改字段、不挪状态徽章、不改时间格式）。
- 不动 `HubDashboardView` 整体（poll 节奏、加载态、空态、refresh 逻辑）。
- 不调 `SessionRow`、`DetailBlock`（折叠展开后的二级行），它们当前不存在被裁问题。
- 不引入新的响应式断点系统、不引入容器查询库。

## 实施步骤

> **方案修订（2026-05-28）**：第一版用 `flex flex-wrap + ml-auto` 让按钮组在窄屏 wrap，实测在 sidebar ~295px 下未触发——shrink-0 的状态/按钮两组与父级 `overflow-auto` 列表配合，溢出直接被横向滚动吃掉，flex-wrap 没生效。改为下方"确定双行布局"方案。

1. 改 `packages/web/src/components/hub/HubProjectCard.tsx` header 布局：
   - 外层从 `flex items-center gap-3` → `flex flex-col gap-2`，确立"信息行 + 操作行"两段；
   - **信息行**：`flex items-center gap-2`，包含折叠按钮(shrink-0) + 项目名/路径块(`flex-1 min-w-0` truncate) + 元数据组(shrink-0)；元数据组去掉 `w-16 / w-20` 让其按内容收缩（数字短，对齐意义不大）；
   - **操作行**：`flex items-center gap-1 justify-end flex-wrap`，按钮组永远独立一行右对齐，flex-wrap 兜底极窄宽度；
   - 验证：任何 sidebar 宽度下「+ 派任务」文字完整、按钮组贴右；不再出现横向滚动条。

2. 浏览器验收：
   - 派 vibespace-browser-tester 在 http://127.0.0.1:8788（实际前端口）默认窗口下点 ActivityBar 进总控台看板，截图断言按钮文字完整、无横向滚动条。

## 边界情况

- aliveSessionCount === 0：按钮组只有「打开」「+ 派任务」两个按钮，宽度更窄，仍要不裁；
- aliveSessionCount > 0：按钮组三个按钮（多一个红色「停所有」），最宽场景，窄屏下整组换行；
- 项目名/路径超长：原本就 truncate，flex-wrap 后仍应 truncate（依赖 `min-w-0`）；
- 极窄（< 200px）：状态/内存/时间组也可能挤到第二行——这时按钮组会再被推到第三行，仍贴右；可接受，因为这种宽度本来就不实用。

## 风险与注意

- `flex-wrap` 会改变 flex 行为：行高、对齐、ml-auto 在 wrap 后的表现需要在浏览器里实测一遍，不能光看代码；
- `basis-[180px]` 是任意值类，确认 Tailwind 配置支持 arbitrary values（vite + tailwind 3+ 默认支持）；
- 不动按钮 className，避免与现有 `fluent-btn` / 颜色变量冲突。

## 多模型 Plan 会审

> 跳过：本任务属"小档"——单文件、纯 CSS 布局、无用户感知风险、无数据/行为变化。按 CLAUDE.md "小档任务"跳过条件，Claude 单独写 plan，不调外部模型。
