# 窄面板看板适配 · Context

## 关键文件

- `packages/web/src/components/hub/HubProjectCard.tsx`
  - L84–137 是 header 单行布局，所有截断/裁剪问题集中在这里；
  - L85 外层 `<div className="px-4 py-3 flex items-center gap-3">` 不允许换行；
  - L93–96 项目名块 `flex-1 min-w-0`（保留）；
  - L97–111 状态/内存/时间组 `shrink-0`（保留，加 ml-auto 视情况）；
  - L112–136 按钮组 `flex items-center gap-1 shrink-0`（加 ml-auto）。
- `packages/web/src/components/sidebar/HubDashboardView.tsx`：宿主，不动。
- `packages/web/src/components/layout/Workbench.tsx` L131–140：PrimarySidebar Panel `minSize="8%"`，意味着用户可拖到很窄；这是本任务窄面板场景的根因。

## 决策记录

- **方案选 flex-wrap 而不是固定双行 / 容器查询**：
  - flex-wrap 改动最小（外层 className + 内层加 ml-auto），宽屏保留单行体验；
  - 固定双行宽屏浪费高度；
  - 容器查询要引入 plugin 或写 inline CSS，复杂度对单点问题过头。
  - 资深工程师视角：这是一次最小、合目的的调整，没有为不存在的需求引入抽象。
- **不引入响应式断点**：sidebar 宽度由用户拖动控制，跟视口断点无关，flex-wrap 直接靠容器自身宽度自适应正合适。
- **basis-[180px] 任意值类**：项目里多处使用任意值 className（如 `w-[3px]`），Tailwind 配置支持，没问题。
- **不动 SessionRow**：它在展开后才显示、没有溢出问题。

## 依赖与约束

- Tailwind 配置见 `packages/web/tailwind.config.*`，支持 arbitrary values；
- `fluent-btn` 是项目自定义按钮基类，不要替换；
- 颜色变量 `accent` / `rose-700` / `border` 全部保留，不引入新色。
