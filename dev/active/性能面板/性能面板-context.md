# 性能面板 · 上下文

## 关键文件

### 服务端

- **[`packages/server/src/pty-manager.ts`](packages/server/src/pty-manager.ts)**
  - `class PtyManager` 单例导出 `ptyManager`，`sessions: Map<sessionId, SessionEntry>`，`SessionEntry.proc.pid`。
  - 已有 [`listAlive(): string[]`](packages/server/src/pty-manager.ts#L259-L261) 返回活跃 session id 列表。
  - 需新增 `getPid(sessionId): number | null`（或 `getPids(): Map<id, pid>`）。实现就一行 `return this.sessions.get(id)?.proc.pid ?? null`。

- **[`packages/server/src/db.ts`](packages/server/src/db.ts)**
  - [`listSessionsByProject(projectId): Session[]`](packages/server/src/db.ts#L362-L368) 已存在，但返回的是 DB 快照（含已退出的）。
  - 方案里 perf-service 不用 DB 读 pid，而是直接查 `ptyManager.sessions` —— 原因：**DB 的 pid 是启动时写的快照，不同步退出**；pty-manager 的内存表是真源（只要 session 还在就一定在这表里）。context 层对 projectId 的过滤靠 DB `listSessionsByProject` 得到该项目下活着的 session id 集合，再用 pty-manager 的 pid 查活体。

- **[`packages/server/src/index.ts`](packages/server/src/index.ts#L126-L128)** — 路由注册处，加一行 `await registerPerfRoutes(app);`。

- **[`packages/server/src/routes/git.ts`](packages/server/src/routes/git.ts#L67-L77)** — 抄 `loadProjectOr404` 模式用于 `routes/perf.ts`，保持和现有路由一致。

- **[`packages/server/package.json`](packages/server/package.json#L11-L21)** — 加依赖 `pidusage`。MIT 许可、无原生依赖、Win/Mac/Linux 均支持。会通过 `pnpm install`（或 npm / yarn）安装。

### 前端

- **[`packages/web/src/store.ts`](packages/web/src/store.ts)**
  - [`type Activity = 'scm' | 'docs' | 'logs' | 'inbox'`](packages/web/src/store.ts#L27) → 加 `'perf'`。
  - [持久化](packages/web/src/store.ts#L55-L63) 已经接受 `activity?: Activity`，向前兼容，无需迁移 localStorage。
  - 无需新增 store 状态：性能数据只在 `PerfView` mount 期间存在，用组件本地 `useState` 足够（不跨组件共享、不跨 activity 切换保留）。

- **[`packages/web/src/components/layout/ActivityBar.tsx`](packages/web/src/components/layout/ActivityBar.tsx#L21-L35)**
  - `items: Item[]` 数组里加 `{ id: 'perf', icon: '📊', label: '性能' }`，位置排在 `docs` 之后、`logs` 之前。

- **[`packages/web/src/components/layout/PrimarySidebar.tsx`](packages/web/src/components/layout/PrimarySidebar.tsx)**
  - `TITLES` 加 `perf: '性能'`。
  - `switch (activity)` 加 `case 'perf': body = <PerfView />`。

- **[`packages/web/src/types.ts`](packages/web/src/types.ts)** — 新增：
  ```ts
  export interface SessionPerfSample {
    sessionId: string
    agent: string
    pid: number | null
    cpu: number              // 百分比，0-100（多核可 >100）
    memRss: number           // bytes
    sampledAt: number        // epoch ms
    error?: string           // 如 'pid_gone' / 'denied'
  }
  export interface ProjectPerf {
    projectId: string
    sessions: SessionPerfSample[]
    totalCpu: number
    totalRssBytes: number
    sampledAt: number
  }
  ```

- **[`packages/web/src/api.ts`](packages/web/src/api.ts)** — 新增：
  ```ts
  export function getProjectPerf(projectId: string): Promise<ProjectPerf> { ... }
  ```

### 新文件

- `packages/server/src/perf-service.ts` — 懒采样：导出 `sampleProject(projectId): Promise<ProjectPerf>`。
  - 内部 `cache: Map<sessionId, { sample, ts }>`；若 `Date.now() - ts < 1000` 就直接用缓存，避免 2s 间隔的多次轮询重复采样。
  - 调用 `pidusage(pidArray)` 一次拿多个，比逐个调用快。
- `packages/server/src/routes/perf.ts` — `GET /api/projects/:id/metrics`。
- `packages/web/src/components/sidebar/PerfView.tsx` — 组件本地 `useEffect` 起 `setInterval(2000)`，clean up 时清掉。

## 决策记录

1. **不走 WS 推**。v1 REST 轮询足够，逻辑简单，断线重连自动恢复；改 WS 要扩协议、处理多订阅者，代价大收益小。v2 再看。
2. **懒采样 + 1s 小缓存**，不要常驻循环。无人在看面板时 CPU 开销 = 0。
3. **Pid 来源走 pty-manager 而不是 DB**，理由见上文"关键文件/db.ts"。
4. **不递归孙进程**。用户确认 v1 只测直接 pid；UI 需要一条小字注明"仅主进程，AI 派生子进程未计"。
5. **state 不放 store**，只存 PerfView 本地。切走组件 → 采样停 → 状态丢，下次切回重新拉——这也是懒采样的前提。
6. **pidusage 第一次采样返回 cpu=0**（需要两次差分）。第一次 UI 显示 `0.0%`，用户看到 `…` 或直接数字都行；我选直接显示 `0.0%`，首帧后就变正常。

## 依赖与约束

- **新增 npm 依赖**：`pidusage`（最新稳定版 `^3.0.2`）。安装后 `npx tsc --noEmit` 需要 `@types/pidusage`——其实 pidusage 自带类型声明文件，不需要额外。
- **Windows 兼容**：`pidusage` 在 Win10 用 wmic，Win11 部分环境 wmic 被移除会回退到 PowerShell（pidusage v3+ 已内置）。开发机若装了 Win11 24H2 建议跑一下验证。
- **与 Dev Docs 守则的关系**：本任务本身是走 plan→context→tasks 流程的样本任务，顺便验证 CLAUDE.md 规则生效。
- **不影响现有功能**：不改任何已有 API / store 字段 / UI 路径；新图标排进去后布局无须重算。

## 非目标（再次明确）

- 历史曲线 / sparkline（v2）
- 告警 / 阈值 / 通知
- 孙进程递归求和（v2，上 `pidtree`）
- 磁盘 / 网络 IO
- 跨项目聚合视图（当前面板只看"选中的那个项目"）

---

确认以上无误就回一句，我进入 Tasks 阶段落地。
