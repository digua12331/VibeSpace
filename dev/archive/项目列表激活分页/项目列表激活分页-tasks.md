# 项目列表激活分页 · 任务清单

- [x] 1. ProjectsColumn 顶层加 `activeTab` state + `useMemo` 派生 `activeProjects` / `inactiveProjects` + `countFor` 加 `&& s.ended_at == null` 过滤 → verify: `pnpm -F web tsc --noEmit` 0 错误
- [x] 2. 在标题栏 `</div>`（L147 后）插入候选 A tab 条 JSX（独立一行，flex-1 两按钮，激活态 `bg-white/[0.08] text-fg font-medium`） → verify: 浏览器项目列顶部见两个 tab 按钮，点击可切换高亮
- [x] 3. `projects.map(...)` 改为 `currentList.map(...)`（`currentList = activeTab==='active' ? activeProjects : inactiveProjects`） → verify: 切到"激活"只见有数字徽标的项目；切到"未激活"只见数字为 0 的项目
- [x] 4. 在 `currentList.length === 0 && projects.length > 0` 条件下渲染空态文案（激活："当前没有运行中的终端"；未激活："所有项目均已激活"） → verify: 关掉所有终端，激活 tab 显示对应文案
- [ ] 5. 浏览器跑 plan 验收 1–6：① 默认激活高亮 ② 切换无闪烁 ③ 启动新 session 项目立即从未激活迁移到激活 ④ 关最后一个 session 立即从激活迁移到未激活 ⑤ "+ 新建项目"按钮跨 tab 都在 ⑥ 两侧空态文案正确 → verify: 6 项浏览器实操通过 — 等主理人浏览器验收
- [x] 6. 全量类型检查 `pnpm -F web tsc --noEmit` → verify: 0 错误，输出 clean
