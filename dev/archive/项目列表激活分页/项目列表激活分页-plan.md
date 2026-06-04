# 项目列表激活分页 · Plan

> memory 扫过：auto.md 只有一条 `hook-smoke` 经验条目，与本任务无关；manual.md 无相关条目。

---

## 目标

将 `ProjectsColumn.tsx` 顶部改为两个 tab：**激活**（默认）/ **未激活**，按当前是否有运行中 session 自动分组，实时响应 session 增减。

### 可验证的验收标准（浏览器可观察）

1. **初次打开**：项目列表顶部出现两个 tab，"激活" tab 高亮，列表中只显示 `countFor(pid) >= 1` 的项目（截图里有数字徽标的 4 个）。
2. **切换 tab**：点"未激活" → 列表内容切换为 `countFor(pid) === 0` 的项目（截图里数字为 0 的 4 个），tab 高亮跟随，无页面刷新闪烁。
3. **0 → ≥1 自动迁移**：在"未激活" tab 右键某项目启动新 session → 该项目立即从"未激活"消失；切到"激活" tab 能看到它出现。
4. **≥1 → 0 自动迁移**：在"激活" tab 关掉某项目最后一个 session → 立即从"激活"消失；"未激活" tab 能看到它出现。
5. **新建项目按钮**：固定在底部，跨 tab 公用，行为不变。
6. **空态文案**：激活为空时显示"当前没有运行中的终端"；未激活为空时显示"所有项目均已激活"。
7. **操作日志判断**：tab 切换**不需要** `logAction`。理由：纯 UI 状态翻转，不调 mutation API，不改服务端状态，与 CLAUDE.md "轮询/心跳"条款同属豁免类。

---

## 非目标

- 不动后端任何文件，session 数据模型不变。
- 不在 store 里新增 `activeProjects` / `inactiveProjects` 派生字段——组件内 `useMemo` 局部派生即可。
- 不持久化 tab 选择到 localStorage——tab 是运行时视图而非用户偏好，刷新回到"激活"是预期。
- 不改排序——两个 tab 内项目保持 `projects` store 原序，不引入按 sessions 数 / 最近活跃排序，避免列表跳动。
- 不改右键菜单。
- 不改"全部 sessions (N)" chip 的语义和位置。

---

## 决策记录

### "全部 sessions (N)" chip 的处置

chip 的功能是 `select(null)` 显示全部 sessions tile 视图，独立于"项目分页"语义。**保留 chip，位置不变**（列表区顶部第一行），跨两个 tab 都显示，count 保持全局 `sessions.length`。理由：chip 不是项目行，是快捷入口，不是分页对象，砍掉属于功能退化。

### tab 切换持久化

**不持久化**。tab 表达"当前 session 视图过滤"，刷新后回到"激活"自洽（激活项目随 sessions hydrate 自然恢复）。

### 新建项目按钮

固定底部，跨 tab 公用，不动位置。

---

## 实施步骤

1. **新增 `activeTab` 本地状态** (`'active' | 'inactive'`，初始 `'active'`)，并 `useMemo` 派生 `activeProjects` / `inactiveProjects`。
   - verify：`pnpm -F web tsc --noEmit` 通过。
2. **渲染 tab 条**：在现有顶部标题栏下方插入两个 tab 按钮，高亮态用 `bg-white/[0.08] text-fg font-medium`，非高亮用 `text-subtle`。
   - verify：浏览器看到两 tab 可点击切换。
3. **按 `activeTab` 切换列表**：`{projects.map(...)}` 改为 `{currentList.map(...)}`，chip 仍在列表上方。
   - verify：切 tab 列表内容按 session 数正确分组。
4. **空态文案**：根据 `activeTab` 渲染对应空态文字。
   - verify：关掉所有终端后激活 tab 显示空态文案。
5. **端到端验证**（浏览器手动验收 3 / 4）。
   - verify：开/关 session 时项目在两 tab 间正确迁移。
6. **TypeScript 全量类型检查**：`pnpm -F web tsc --noEmit` 0 错误。

---

## 边界情况

- **项目列表为空**（`projects.length === 0`）：两个 tab 都显示空态。
- **所有项目都有 session**：未激活 tab 空态。
- **并发开关 session**：zustand 同步 set，`useMemo` 同步重算，无竞态。
- **刷新页面**：`refreshSessions` 拉到的 alive sessions hydrate 后正确分组；`activeTab` 重置为 `'active'`（无持久化，预期）。
- **selectedProjectId 跨 tab**：用户在"激活"选中某项目，切到"未激活"后该项目不渲染，不会出现"孤高亮"；切回时高亮恢复，符合直觉，不需特殊处理。
- **selectedProjectId 为 null**（"全部 sessions" chip 高亮）：chip 跨 tab 都在，与 `activeTab` 无关，不冲突。

---

## 风险与注意

- **假设 1**：`sessions` store 实时同步——session 新增走 `addSession`（WS push），删除走 `removeSession` / `markSessionExit`，两条路径都触发 zustand set → ProjectsColumn re-render。需在 context 阶段从 store.ts 确认。
- **假设 2**：`countFor(pid)` 用 `sessions.filter(s => s.projectId === pid).length`，已在 ProjectsColumn.tsx 现有代码中复用，无需新字段。
- **性能**：项目数 × sessions 数的 filter 每次 render 跑。常规规模 (<50 项目, <20 sessions) `useMemo` 完全够用，不必 store 层派生。
- **样式契合**：沿用现有 Fluent 风格 class（`fluent-btn`、`bg-white/[0.08]`），不引入新 CSS。
- **不确定点 — 需主理人确认**：tab 条是另起一行（多占约 36px 高度）还是与现有标题行合并为一行 pill 样式？视觉影响明显，建议确认后再动代码。
