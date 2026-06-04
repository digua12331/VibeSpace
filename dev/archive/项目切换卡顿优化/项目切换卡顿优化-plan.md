# 项目切换卡顿优化 · plan

## 大哥摘要

现在你在侧边栏点切到另一个项目时，会感觉到一下"卡"——白屏 / 转圈 / 终端区空一下。原因是程序当前的做法是：**把上一个项目所有终端窗口（xterm，浏览器里负责画黑底白字的组件）整个拆掉，再为新项目从零搭一遍**。开了 5 个终端就要拆 5 个、再建 5 个，每个建好后还要让后端把"这个终端从启动到现在打过的所有字"重新塞一遍（叫 replay 历史回放）。同一时间还会顺手发好几个查询请求（看看新项目有什么文件改了、git 历史长啥样）。这两件事撞在一起就是你感觉到的卡。

这次要做的事，**用大白话**：

1. **让终端跨项目不拆了**——切走时只把它"藏起来"（CSS `display:none`），切回来直接显示，不用重建。这是性能最大头。**默认全部保活（你定的 A 档），但浏览器内存超过 2GB 时自动降级到"只保最近 3 个项目"（B 档）防止机器变慢**。降级一次后，到你刷新页面才会回到 A 档，不会反复来回切（避免"为什么这次卡了"的体感不稳）。
2. **切项目时先用上次记得的数据撑住画面**（叫缓存 cache），后台再悄悄刷新一次，避免你盯着空白等。
3. **加一个秒表**（performance.mark / measure，浏览器内置的计时 API），把"从你点项目到画面稳定"这段时间记到 LogsView 里。这样优化前后能对比"是不是真的快了"，而不是凭感觉。降级触发时也会单独打一条日志（`action=keepalive-degraded`），你能看到为什么。

**你能在哪里看到效果**：完成后正常使用 VibeSpace（左侧栏点不同项目来回切），切换瞬间应该接近"不卡"。LogsView 里也会出现 `scope=perf action=project-switch` 的起止配对日志，每次切都有一个毫秒数。

**会不会动到现有数据/界面**：不会动数据库、不会动后端 PTY 进程（每个终端的 shell 还是同一个进程在跑，只是浏览器侧不再反复"重新连一遍画面"）。界面长相也不变，只是切换体感更顺。

---

## 目标

让"切换项目"从"明显卡顿"变成"接近瞬时"，且**用日志能量化**。

可验收标准（具体、能跑）：

1. **量化指标**：在 LogsView 里能看到 `scope=perf action=project-switch` 的起止日志，单次耗时 `meta.ms`：
   - 在已经打开 ≥ 5 个终端的情况下，**第二次及以后**切到同一项目（即保活生效时），`ms` ≤ **150ms**。
   - 第一次切到新项目（无缓存、需要建终端）≤ **现状的 50%**（先用埋点测出现状基线，写到 tasks 的 verify 里）。
   - 内存超 2GB 触发降级时，能在 LogsView 看到 `scope=perf action=keepalive-degraded` 单条日志，`meta` 包含 `usedJSHeapSize` 和被淘汰的项目 id 列表；降级后再切到被淘汰的老项目应正常重建（不报错、内容能 replay 回来）。
2. **行为不变**：
   - 切走再切回，终端里之前看到的内容**完全保留**（不出现"被截断"或"少了几行")。
   - 终端正在跑的命令、AI 会话状态、滚动位置都保留。
   - 终端输入仍然能正常打字、Ctrl+C、贴图、IME 中文输入。
3. **没有副作用回归**：现有的浏览器冒烟测试 / `pnpm typecheck` / `pnpm build` 全部通过。
4. **浏览器可观察验收项**（CLAUDE.md 强制要求）：
   - 打开 DevTools Performance 面板，录一次切项目，**没有**长任务（> 200ms）由 `term.dispose` / `Terminal()` 构造引起。
   - LogsView 里能筛到 `scope=perf` 的切换耗时记录，至少 3 条样本。

---

## 非目标

明确**不做**的事（容易顺手扯进来）：

1. **不**重写 SessionView 内部任何逻辑（xterm 配置、IME 处理、TUI 透传、剪贴板黏贴等都不动）。只挪它"挂在哪"。
2. **不**重构 ws-hub / PTY 进程模型 / 后端 session 路由。后端不动一行。
3. **不**优化 xterm 自身的 WebGL 渲染速度、不换终端组件库。
4. **不**触动 SessionStart hook、Dev Docs 工作流、记忆系统、Issues 面板等其他模块。
5. **不**做"卸载项目卡片"或"项目级懒加载"等更激进的架构调整。
6. **不**改 git 命令本身（GitGraph 的 `git log --all -200` 本次不优化命令本身，只优化"什么时候发"）。

---

## 实施步骤

> 粗粒度，细化到 tasks 阶段再拆。每步带"如何验证"。

### 第 1 步：先加埋点（基线）

在 `packages/web/src/store.ts` 的 `selectProject` 入口打 `performance.mark('project-switch:start')`；在所有相关副作用完成后（用 `requestAnimationFrame` 双层 + 等下游组件 useEffect 完成的近似方案）打 `end`，跑 `performance.measure`，结果通过 `pushLog({ scope: 'perf', action: 'project-switch', meta: { ms } })` 落 LogsView 和磁盘日志。

**验证**：手动在浏览器里切几次项目，LogsView 出现 `scope=perf action=project-switch` 起止配对，每条 `meta.ms` 是合理数字（不是 0、不是 NaN）。**这一步先于优化**完成，目的是拿到"现状基线 ms"，写进后续步骤的 verify。

### 第 2 步：把 SessionView 提到全局挂载层

在 `EditorArea` 之上（实际位置：`Workbench.tsx` 内、所有项目共享的层）建一个 `<TerminalHost>` 容器，挂载**全部** sessions 的 SessionView，按 `selectedProjectId === session.projectId && id === activeSessionId` 决定显示，其余 `display:none + visibility:hidden + pointerEvents:none + aria-hidden`（沿用同项目内 tab 切换的隐藏方案，见 `SessionView.tsx:939-942`）。

`EditorArea` 自己不再渲染 SessionView，只渲染 tab 头 + 文件预览 + 选中态控制；`activeSessionId` 通过 zustand 共享给 `<TerminalHost>` 读。

**验证**：
- 打开 5 个终端 → 切走再切回 → 终端内容完整保留、滚动位置保留、正在跑的进度条不闪。
- DevTools Components 面板（React DevTools）里同时存在 N 个 SessionView 实例，跨项目切换时**实例数不变**（不会从 5 掉到 0 再涨回 5）。
- 第 1 步的 `ms` 指标显著下降（具体目标见 §目标）。

### 第 3 步：A→B 自适应保活策略落地

默认全保活（A 档）。在 `selectProject` 入口检查 `performance.memory?.usedJSHeapSize`：超过 **2 GB（2 * 1024³ bytes）** 时切换为 LRU3（B 档），把"最近使用排序"末尾的项目（除当前 + 最近 2 个）的所有 sessions 一次性 dispose。

降级触发后写一个 `degraded` 标志位（不持久化，纯内存），后续 `selectProject` 都按 LRU3 跑。**不**自动升回 A——刷新页面才重置。

`performance.memory` 在非 Chromium 浏览器是 undefined，此时保持 A 档不降级（兜底无害，最坏退化到现状）。

**验证**：
- 开 8 个项目共 30+ 个终端，每个项目都切一遍，再切回最早那个，仍是瞬时（A 档生效）。
- 在 DevTools Console 手动注入 `performance.memory = { usedJSHeapSize: 3 * 1024 ** 3 }` 后切项目（或临时把阈值改成 100MB 复现降级）→ LogsView 出现 `keepalive-degraded` 日志、被淘汰项目的 SessionView 实例从 React Devtools 中消失。
- 降级后再切到被淘汰的老项目 → 看到 SessionView 一次正常重建（耗时与"第一次切"基线相当），终端历史能 replay 回来。

### 第 4 步：项目级数据缓存（stale-while-revalidate）

在 `packages/web/src/store.ts` 加 `projectChangesCache: Record<projectId, ChangesPayload>`、`projectGraphCache: Record<projectId, GraphPayload>`。`ChangesList` / `GitGraph` 切到某项目时：

1. 立刻渲染缓存（如果有）；
2. 后台静默 fetch，拿到新数据后更新缓存 + 触发重渲染。

**只做 ChangesList 和 GitGraph 这两个**——它们是切项目时最贵的两个请求；其他视图（FilesView/PerfView/DocsView/MemoryView）按 activity tab 触发，本身只在用户主动打开时才发，不在切换关键路径上，**不动**。

**验证**：网络面板看到切回老项目时 ChangesList/GitGraph **先**渲染出来（用缓存）、**再**有一次后台 XHR 完成；切到全新项目（无缓存）则保持现状（loading → fetch → render）。

### 第 5 步：GitGraph 重活延后

在 GitGraph 的 useEffect 里把 fetch 包一层 `requestIdleCallback`（或 fallback `setTimeout(fn, 50)`），把它从切换关键路径上摘掉。

**验证**：第 1 步的 `ms` 进一步下降；切项目瞬间 ChangesList 已经 ready，GitGraph 在 200~500ms 内补齐（不阻塞）。


---

## 边界情况

1. **关闭项目时**：保活池里属于该项目的 sessions 要立刻 dispose（避免 zombie）。
2. **删除某个 session**：从保活池移除并 dispose；当前已有 `removeSession` 路径，需对接。
3. **新建 session**：直接进保活池，立即可见。
4. **"全部 sessions" 视图**（`selectedProjectId === null`）：所有项目所有 sessions 都显示——这种情况本来就不卸载任何东西，无需特殊处理。
5. **WebGL context 上限**：Chrome 默认每 tab ~16 个 WebGL context。A 档全保活在大量项目时会 hit 上限——`SessionView.tsx:310-317` 已经有"WebGL 加载失败 → silently 退化为 DOM 渲染"的兜底，本次复用，不引入新分支。这同时也是 A→B 自适应降级的另一道兜底——即使内存阈值还没到，WebGL 先撑不住时单个 SessionView 自己会退到 DOM 渲染，整体仍可用。
6. **隐藏状态下 xterm 的 fit()**：`display:none` 容器拿不到尺寸，`fit()` 会写入 0×0。`SessionView.tsx:456-469` 已有"active 切换时 raf 重 fit"逻辑，沿用即可——只要 active 切到该 session 时再 fit 一次就对。
7. **WS 推送量不变**：因为 WS 是单连接，且即使 SessionView 卸载后 PTY 仍在跑、output 仍存在 server 端 buffer。改成全保活后**不会**让服务端推送量增加（subscribe 关心的是 onMessage 路由，不是 server 推不推）。
8. **缓存数据"骗了用户"风险**：ChangesList 用缓存时，如果用户基于旧的 changes 列表点了"创建会话/做 git 操作"，可能基于过期信息决策。**缓解**：缓存渲染时在视图右上角加一个 "刷新中..." 小标记（用项目里已有的 `<Spinner>` 或 LogsView 风格的小角标），后台 fetch 完成后消失。这条要写进 tasks 的 verify。
9. **首次打开应用**：sessions 数组是空的，没有保活对象，整套机制空跑——验证不报错即可。
10. **跨项目搜索 / 全局命令**：本次未触及，行为不变。

---

## 风险与注意

1. **React 渲染压力**：把所有 SessionView 提到顶层，意味着 Workbench 顶层组件持有更大的 children 树。React 重渲染 Workbench 时（如 dialog 打开、theme 切换）可能波及更多子树。**缓解**：用 `React.memo` 包 `<TerminalHost>` 和单个 SessionView 项；`SessionView` 已经按 `[session.id]` 做依赖管理，但要核对 props 是否稳定。
2. **内存持续上涨**：A 档在长会话下内存爬升不可避免。提前在 PerfView 里能看到 RSS / heap 增长曲线，必要时再加上限。**初期不做强制上限**，等 ms 数据稳了再决定。
3. **保活池 vs 已存在的 zustand sessions 数组的关系**：保活的对象其实就是 SessionView **组件实例**，不是新的状态。zustand 里的 `sessions` 数组保持不变，`<TerminalHost>` 只是不再受 `selectedProjectId` 过滤。换句话说**没有新数据结构**，只是渲染位置和可见性条件变了。
4. **手动 verify 走一遍 IME 输入**：中文输入法在 `display:none` 隐藏过的元素上偶有怪事，需要手动验。
5. **TUI 透传白名单逻辑**（`SessionView.tsx:357-380`）依赖 `inputRef.current` 焦点判断——隐藏时焦点会跑掉，切回来时要确保焦点能正确回到当前 active session 的输入框。**已有**"active 切换时聚焦"的代码（见 SessionView 内 active useEffect 部分），跨项目场景下应该自动覆盖，但要手验。
6. **熔断**：第 2 步（提到全局挂载）改完如果连续 2 次出现"切回来终端是空的 / 内容丢失 / 焦点错"，停手——可能是 React 状态共享或 ref 生命周期假设错了，回到原结构重新设计。

---

## 已敲定方案 = A→B 自适应

大哥定档：默认 A（全保活），浏览器 JS 堆超 2 GB 时自动降级为 B（LRU3）。AI 自决的内部细节：

- **测内存的 API**：`performance.memory.usedJSHeapSize`（Chrome / Edge / Electron 都有）。非 Chromium 浏览器 undefined → 保持 A 不降级。
- **降级后是否自动回 A**：**否**。一旦降级，到刷新页面前都按 B 跑。理由：自动来回切会让"什么时候快、什么时候卡"变得不可预期，体感反而不稳。
- **降级时给大哥一条日志**：`scope=perf action=keepalive-degraded`，`meta` 含 `usedJSHeapSize` 和被淘汰的 projectId 列表，这样大哥能在 LogsView 看到为什么变了。

---

## 多模型 Plan 会审

> 跳过：Gemini CLI 在本机未安装（`spawn gemini ENOENT`，`mcp__gemini-cli__ping` 同样失败），Codex 工具（`codex:rescue` 等）在本会话未注入工具列表。两者均按 CLAUDE.md 规则"重试一次仍失败 → 回退 Claude 单写 + 记录原因，不阻塞 plan 交付"处理。本 plan 由 Claude 单独产出。
