# 项目切换卡顿优化 · 任务清单

> 顺序串行：第 1 步先拿基线，第 2-3 步是核心，第 4-5 步并行皆可。每完成一项立即勾选并同步 tasks.json。

## 第 1 步：埋点拿基线

- [x] 1.1 新建 `packages/web/src/perf-marks.ts`，导出 `markProjectSwitchStart()` / `markProjectSwitchEnd(meta)` + 内存阈值常量 `KEEPALIVE_MEM_THRESHOLD` / `KEEPALIVE_LRU_LIMIT` + `readUsedJSHeapSize()` → verify: typecheck 过 ✓
- [x] 1.2 `store.ts` `selectProject` 入口加 `markProjectSwitchStart()`；末尾 `markProjectSwitchEnd(...)` 带 from/to/sessionsCount/degraded/usedJSHeapSize → verify: typecheck 过 ✓
- [ ] 1.3 启动 dev，浏览器开 LogsView 切几次项目，**记录现状基线 ms** → verify: 待大哥验收（我无法在浏览器里点击）

## 第 2 步：终端跨项目不拆（核心）

- [x] 2.1 新建 `packages/web/src/components/terminal/TerminalHost.tsx` → verify: typecheck 过 ✓
- [x] 2.2 决策：直接在 EditorArea 内的"flex-1 min-h-0 relative"容器里挂 TerminalHost（不挂 Workbench 顶层）。理由：SessionView 用 position:absolute inset:0 定位，需要一个 relative 锚点；EditorArea 已经有；TerminalHost 在 EditorArea 内只要它本身不卸载，子 SessionView 也不会卸载，效果等同于挂 Workbench 顶层。改动更小。 → verify: build 过 ✓
- [x] 2.3 删 `EditorArea.tsx` 的 SessionView 渲染块 + 清理不再用的 import (`Session` type) / 变量 (`addSession`, `handleRestart`)（按 CLAUDE.md 外科式原则：自己引入的孤儿要清掉） → verify: typecheck + build 过 ✓
- [ ] 2.4 浏览器手动验：开 5+ 个终端，切走再切回，终端内容完整、滚动位置保留、IME 中文输入正常、Ctrl+C 仍能中断 → verify: 待大哥验收
- [ ] 2.5 看 LogsView 的 `project-switch` ms 数据：在 ≥5 终端时第二次切到同一项目应 ≤ 150ms → verify: 待大哥验收

## 第 3 步：A→B 自适应保活策略

- [x] 3.1 `store.ts` State 新增 `recentProjectOrder: string[]` + `keepAliveDegraded: boolean` + 初始化 → verify: typecheck 过 ✓
- [x] 3.2 `selectProject` 中：维护 recentProjectOrder（id≠null 时移到最前去重）；未降级时读 `readUsedJSHeapSize()`，超 2GB 时置 degraded=true 并 `pushLog warn keepalive-degraded` → verify: typecheck 过 ✓
- [x] 3.3 `TerminalHost.tsx` 用 `liveProjectFilter` useMemo 实现：degraded 时只渲染 `recentProjectOrder.slice(0,3) ∪ {selectedProjectId}` 包含的项目 → verify: typecheck 过 ✓
- [ ] 3.4 降级后切回被淘汰的老项目：触发 SessionView 一次重建，终端 replay 历史能正确回放 → verify: 待大哥验收

## 第 4 步：ChangesList / GitGraph 项目级缓存（SWR）

- [x] 4.1 `store.ts` 加 `projectChangesCache: Record<string, ChangesResponse>` + `projectGraphCache: Record<string, GraphCommit[]>` + 两个 setter → verify: typecheck 过 ✓
- [x] 4.2 `ChangesList.tsx` 的 `data` 直接派生自 store cache，`load` 改成：有 cache 走 refreshing 标志、无 cache 走 loading；fetch 完写回 cache → verify: typecheck 过 ✓
- [x] 4.3 `GitGraph.tsx` 同 4.2，commits 派生自 cache，无 cache 时返回稳定 EMPTY_COMMITS（避免 selector 引用抖动） → verify: typecheck 过 ✓
- [x] 4.4 ChangesList 在分支按钮旁、GitGraph 在标题栏，用缓存渲染时显示 `⟳ 刷新中`（amber + animate-pulse-soft） → verify: typecheck 过；待大哥肉眼验

## 第 5 步：GitGraph 重活延后

- [x] 5.1 `GitGraph.tsx` 的 useEffect 用 `requestIdleCallback`（fallback `setTimeout 50ms`）包 load + cleanup 取消 → verify: typecheck 过 ✓

## 第 6 步：收尾

- [x] 6.1 `npx tsc -b --noEmit` → verify: 0 错误 ✓
- [x] 6.2 `npm run build` → verify: 构建成功 940ms ✓
- [ ] 6.3 浏览器最终验收（基线、降级、行为无回归三项） → verify: 待大哥验收
- [x] 6.4 给大哥写 handoff 摘要 → verify: 摘要将在本轮回复末尾发出 ✓

---

## 基线数据（第 1 步填写）

> 待第 1 步完成后填入

- 现状切项目耗时基线（5 终端，N=10）：median ___ ms / p95 ___ ms

## 第 2 步实测

> 待第 2 步完成后填入

- 第二次切到同一项目（保活生效）：median ___ ms
- 第一次切到新项目：median ___ ms

## 最终验收

> 待第 6 步完成后填入
