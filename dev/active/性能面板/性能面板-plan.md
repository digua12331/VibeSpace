# 性能面板 · 计划

## 目标

在 Workbench 里新增一个**按项目聚合的性能监控面板**，实时显示当前项目下所有活跃 AI session（pty 子进程）的 **CPU 占用**和**内存占用（RSS）**，以及项目级汇总。

**验收标准**

- 活动栏出现新图标（📊），切到它能看到当前选中项目的性能面板；
- 面板列出该项目下每个活跃 session 的 CPU % + 内存 MB，单行展示；
- 面板顶部显示该项目的汇总：session 数、总 CPU %、总 RSS MB；
- 数据每 2 秒刷新一次；session 退出后自动从列表消失；
- 跨平台可用（Windows / macOS / Linux）；
- 停在这个面板不切换时才采样，切走就停（避免空转耗 CPU）。

## 非目标（v1 不做）

- 历史曲线 / sparkline（v2）
- 磁盘 IO、网络 IO（v2）
- 监控 AI 派生的**孙进程**（claude → node → …）。v1 只测 pty 直接子进程 pid 的指标，数字会偏低但够做趋势参考。v2 再考虑 `pidtree` 递归求和。
- 告警 / 阈值 / 通知

## 实施步骤

1. **服务端采样器**
   - 新增依赖 `pidusage`（跨平台、轻量）。
   - 新建 `packages/server/src/perf-service.ts`：
     - 周期性（每 2s）对 `ptyManager.listAlive()` 里的每个 session 取 pid 调用 `pidusage`；
     - 结果缓存成 `Map<sessionId, { cpu, memRss, ts }>`，有退出的自动清理；
     - 提供 `getProjectMetrics(projectId)` 返回该项目下所有活跃 session 的最近一帧 + 聚合。
   - `pty-manager` 暴露 `getPid(sessionId)` 方法。
2. **REST 路由**
   - 新增 `packages/server/src/routes/perf.ts`：
     - `GET /api/projects/:id/metrics` → 返回 `{ sessions: [{ sessionId, agent, cpu, memRss }], totalCpu, totalRssMb, sampledAt }`；
     - 在 `index.ts` 注册。
   - 采样器默认空转（不开新定时器）；前端轮询这个端点时才触发一次即时采样。改用"懒采样 + 小缓存（1s 内复用）"方案，省掉常驻循环。
3. **前端 store 扩展**
   - `Activity` 加 `'perf'`；
   - 加 `perfByProject: Record<projectId, ProjectPerf>` + `refreshPerf(projectId)`；
   - 不做全局轮询，由 `PerfView` 组件在 mount 时起自己的 `setInterval`，unmount 时清掉。
4. **UI**
   - `ActivityBar.tsx`：新增项 `{ id: 'perf', icon: '📊', label: '性能' }`，位置排在 Docs 之后、Logs 之前。
   - `PrimarySidebar.tsx`：新增 `case 'perf' → <PerfView />`。
   - 新建 `packages/web/src/components/sidebar/PerfView.tsx`：
     - 顶部项目名 + 汇总条（session 数、总 CPU%、总 RSS）；
     - 下方列表：每行 agent icon + session id 短尾 + CPU% + RSS（带进度条可视化，背景色按占用高低变深）；
     - 只在组件 mount 时起轮询（2s），切走立刻停。
5. **类型 & API 客户端**
   - `types.ts` 新增 `SessionPerfSample` / `ProjectPerf`；
   - `api.ts` 新增 `getProjectPerf(projectId)`。
6. **自测**
   - 启动 server + web，开 2 个 claude session，切到 📊 看数字合理；
   - session 停了之后面板自动少一行；
   - 切到别的活动后停止轮询（F12 → Network 看请求停掉）。

## 风险与注意

- **`pidusage` 第一次采样**：CPU % 需要两次采样做差分，第一次可能返回 0%。这是正常的，用户会看到第一个 tick 是 0。
- **孙进程问题**：Claude Code / Codex 本身是 node 进程，其子进程占大头。v1 的数字对比趋势有意义，绝对值偏低，UI 里要标注说明"仅主进程"。
- **Windows 上 `pidusage` 依赖 wmic**：较新 Win11 里 wmic 可能被移除，`pidusage` 已支持回退到 PowerShell。需在 Win11 机上验证。
- **权限**：如果 pty 子进程提权（不常见），`pidusage` 可能读不到。读不到就标 "—"。
- **频率**：2s 一次轮询 × N session，在常规项目（<5 session）下开销忽略不计。上百 session 才需优化。
- **内存单位**：`pidusage` 返回 bytes，UI 用 MB 展示（`/ 1024 / 1024`，保留 1 位小数）。

## 决策点（需要你确认）

1. **UI 位置**：活动栏新增 📊 → 侧边栏面板。OK 吗？不接受的话备选是"编辑区底部全局状态栏"或"ProjectsColumn 每行尾巴加个小 RAM 数字"。
2. **孙进程**：v1 只测直接 pid 够不够？若要求 v1 就递归求和，我加 `pidtree`，实现工作量 +30%。
3. **采样模型**：懒采样（前端轮询触发）→ 简单；还是 server 端常驻 2s 循环 → 更实时但空转时也在跑。我倾向懒采样。
4. **轮询还是 WS 推**：v1 HTTP 轮询够用，WS 改造留 v2。可以吗？

---

确认以上四点（一句话回复即可，或改任何一条），我就进入 Context 阶段。
