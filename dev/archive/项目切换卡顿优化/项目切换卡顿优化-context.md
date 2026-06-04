# 项目切换卡顿优化 · context

> 给 AI 自己的执行上下文，大哥不审。归档后给评审产出 auto.md 用。

## 关键文件（边界 = 改动只能落在这里）

### 必改

- `packages/web/src/store.ts` — `selectProject` (行 462–494) 入口加埋点 + 维护 `recentProjectOrder` + 内存阈值检测；新增 `projectChangesCache` / `projectGraphCache` slice 与 setter / getter。
- `packages/web/src/components/layout/Workbench.tsx` — 在 `<Group>` 之外、Workbench 顶层挂 `<TerminalHost />`（不在 Panel 内，否则会跟 EditorArea 一起被 Panel 重排）。实际放在 `<DialogHost />` 旁边即可，反正 SessionView 用 `position:absolute` 自己定位，DOM 层次只影响 z-index 不影响布局。
- `packages/web/src/components/editor/EditorArea.tsx` — 删掉 行 301–310 的 `visibleSessions.map(...) <SessionView>`，但保留 `visibleSessions` 数组本身（tab 头还要用它渲染标签）。`activeSessionId` 共享出去：当前已经写到 zustand `activeSessionIdByProject`，`<TerminalHost>` 直接读即可，无需新加 props。
- `packages/web/src/components/ChangesList.tsx` — `load` (行 56–67) 改成 SWR：先读 store cache → setData → 同时 fetch → 写回 cache + setData。
- `packages/web/src/components/GitGraph.tsx` — `load` (行 150–161) 同上 SWR + 在 useEffect (行 163–165) 里把 `void load()` 包成 `requestIdleCallback(() => void load(), { timeout: 500 })`。

### 新增

- `packages/web/src/components/terminal/TerminalHost.tsx` — 新文件。从 store 读 `sessions` + `selectedProjectId` + `activeSessionIdByProject` + `activeTabKind` + `keepAliveDegraded` + `recentProjectOrder`；按策略过滤要 mount 的 sessions；map 渲染 `<SessionView>` 全集，每个的 `active` prop 由 selectedProjectId / activeSessionId / activeTabKind 决定。`React.memo` 包一层。
- `packages/web/src/perf-marks.ts`（小工具）— 暴露 `markProjectSwitchStart()` / `markProjectSwitchEnd(meta)`，里面跑 `performance.mark` + `performance.measure` + `pushLog({ scope: 'perf', ... })`。把 raf 双层 + 兜底 setTimeout 这种细节封在这里，调用方一行干净。

### 只读 / 参考

- `packages/web/src/components/terminal/SessionView.tsx` — 不改组件本身，但确认 `active=false` 的隐藏路径已经现成（行 935–945 visibility:hidden + pointerEvents:none + aria-hidden）。`useEffect [session.id]` (行 277–452) 是 xterm 创建/销毁的核心，我们绕开它（不让 SessionView 卸载就不会触发 cleanup）。
- `packages/web/src/logs.ts` — `pushLog` 签名（已有 scope/action/meta），perf-marks.ts 直接用。

## 决策记录

### 1. 为什么不改 SessionView 内部，而是改它的 mount 位置

SessionView 内部 1000+ 行涉及 xterm/IME/TUI 透传/剪贴板/通知/重启 等强耦合逻辑，动它的依赖数组或 ref 极易出回归。**只改它的容器**就能拿到 90% 的收益（避免 dispose+rebuild），ROI 最高且最外科式。资深视角：这就是 React 里"提升 children 到稳定父级"的标准模式，不属于过度设计。

### 2. 为什么不引入新 hook 库 / 新状态管理

zustand + React.memo 已足够。引入 react-query / TanStack Query 来做 SWR 是只用一次的"灵活性"，违反 CLAUDE.md。直接在 store 加两个 cache 字段。

### 3. 为什么 perf-marks.ts 单独成文件

被 store.ts、TerminalHost、可能的其他切换路径调用。1 个 30 行小文件 vs 散落 3 处复制粘贴 raf 逻辑——前者更干净，且未来加切换其它 measure（如 sidebar activity 切换）时复用。**资深视角：是不是过度抽象？** 否——它有明确的 ≥ 2 个调用点，且封装了"双 raf 测稳定时机"这一**非平凡**逻辑（不抽出来后续重复写错的概率高）。

### 4. 为什么不做"可运行时切换的策略选择 UI"

大哥已敲定 A→B 自适应，没有"我今天要换 C 档试试"的需求。做 UI = 只用一次的"可配置性"，违反 CLAUDE.md。**写死阈值 2GB 即可**；如未来真要调，改一个常量重启。

### 5. 为什么阈值用 JS heap 不用别的

Chrome 里能在浏览器侧拿到的内存指标只有 `performance.memory.usedJSHeapSize`（非标准 API）。其他指标（GPU 显存、整进程 RSS）只有 Electron / Chromium DevTools Protocol 才有，VibeSpace 是普通浏览器，拿不到。这个指标**不准**（隔几分钟才更新、不含 GPU），但用作"超大阈值的兜底降级"够用——2GB JS heap 已经是异常状态。

### 6. 为什么不自动从 B 升回 A

降级触发后内存可能一直在阈值附近抖动，自动回切会让"切换有时快有时卡"，破坏体感稳定。降级是单向的（直到刷新），用户感觉到"咦怎么变慢了" → 看 LogsView 找到 `keepalive-degraded` 日志 → 知道原因 → 主动刷新或关项目。

### 7. 为什么先做埋点（第 1 步）再做主体改动

否则没有基线 ms 数据，第 2 步做完只能凭"我感觉快了"判断。CLAUDE.md 强调验收要可观测。

### 8. 为什么不把 cache 也做成 LRU

ChangesList / GitGraph 的 cache 单条 < 100KB，10 个项目也才 1MB 数量级，不构成内存压力。LRU 引入额外复杂度，违反 CLAUDE.md "不为不可能的场景写代码"。**项目数量永远小于几十**——VibeSpace 是开发工作台不是云盘。

## 依赖与约束

- `performance.mark/measure` API 是浏览器标准，IE11 都有。无依赖问题。
- `requestIdleCallback` 在 Safari < 16.4 不支持 → 用 `setTimeout(fn, 50)` 兜底。
- `performance.memory` 仅 Chromium 有 → undefined 时不降级（保持 A）。这是 plan 已说明的 fallback。
- React 18+ batching：`selectProject` 内的 set 是单次 batch，markEnd 用双 raf 已足够等其他 `useEffect` 跑完。
- `pushLog` 在 LogsView 全局可见，且 WS 落盘，无需额外管线。
- `aimonWS.subscribe/unsubscribe` 在 SessionView 内部已经按 `[session.id]` cleanup 管理。提到全局后由于 SessionView 不卸载，subscribe 一次维持终身——服务端 sub 集合会持续含全部 session，但 server 本来就按 sub 过滤推 output、PTY 该跑还是跑，**不会**增加服务端负载。

## 已经盘清的边界（重申，省得执行时再想）

- 关闭项目 → 该项目所有 sessions 也会被关（`removeSession` 路径），TerminalHost 自然不再渲染。无需额外清池逻辑。
- 删 session → `state.sessions` 减少，TerminalHost 重渲染时该项消失，触发 SessionView 卸载并跑 cleanup（这里**还是**会走原 dispose 路径）。这正是我们想要的：删的时候才 dispose。
- 全部 sessions 视图（selectedProjectId === null）→ TerminalHost 渲染全集 + 挑 active 的那个 visible，其它 hidden。沿用原逻辑。
- 内存降级触发时被淘汰 sessions：从 TerminalHost 渲染列表移除 → React 卸载 → 走 cleanup → xterm 释放。复用现有 dispose 路径，无新代码。

## 不做（执行时如果手痒了回来看一眼）

- 不重构 EditorArea tab 头部样式 / 排序 / 关闭按钮位置
- 不改 ChangesList 视觉（包括"刷新中"小标记的位置——找现有 Spinner 直接套）
- 不改 GitGraph 限额 200 / all=true 的 git 命令
- 不动 ws-hub / 后端任何文件
- 不动 PerfView（已有 RSS 监控，但不用它来做内存判定，因为 PerfView 只测后端 PTY 进程）
- 不为"将来要做项目级懒加载"埋接口
