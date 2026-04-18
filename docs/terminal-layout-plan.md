# 终端 CLI 界面布局 · 可拖拽 / 可调尺寸 / 按项目记忆 · 落地方案

> 面向 aimon（浏览器版 AI CLI 监控面板）当前项目的落地方案。
> 目标：把 [SessionGrid.tsx](../packages/web/src/components/SessionGrid.tsx) 的静态 CSS Grid 改造成**按项目独立记忆**的可拖拽、可调尺寸终端工作台；
> 点击"保存布局"后，下次打开该项目时**自动按保存的长宽还原**每个终端；
> 同时让项目里的"错误终端"（stderr / waiting_input / crashed 等异常输出）与其对应的 session 窗口强绑定，一眼能对上。

---

## 1. 现状与问题

当前实现：

- **布局**：[SessionGrid.tsx:39](../packages/web/src/components/SessionGrid.tsx#L39) 硬编码 `grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4`，所有 tile 自动排。
- **尺寸**：[SessionTile.tsx:156](../packages/web/src/components/SessionTile.tsx#L156) 固定 `h-[460px]`，由 ResizeObserver（[SessionTile.tsx:58-67](../packages/web/src/components/SessionTile.tsx#L58-L67)）驱动 xterm 的 FitAddon，拉动父容器能自动 `fit.fit()` 并回传 `aimonWS.sendResize()` 给 PTY —— **xterm 已经是"响应式"的，缺的只是一个可交互的容器**。
- **持久化**：[packages/server/data/projects.json](../packages/server/data/projects.json) 是项目主存，SQLite（[db.ts:80](../packages/server/src/db.ts#L80)）是影子表。**目前没有任何布局字段**。
- **错误终端**：`session.status = 'crashed' | 'stopped' | 'waiting_input'` 已经在 [SessionTile.tsx:145](../packages/web/src/components/SessionTile.tsx#L145)（`isDead`） + store 的 `notifyingSessions`（[store.ts](../packages/web/src/store.ts)）里区分，但视觉上只有红色描边 + 退出码，没有"错误输出流单独窗口"的概念。

**要解决的硬伤**：

| 问题 | 根因 |
|---|---|
| 所有 tile 一个尺寸 | `h-[460px]` 硬编码 + CSS Grid 无拖拽 |
| 换项目后布局重置 | 没有按 `projectId` 存 layout |
| 多屏/大屏浪费空间 | 无法自由拉宽、分栏、叠 tab |
| 错误流和终端分离（如果以后加 stderr 窗口） | 没有"group by sessionId"的面板概念 |

---

## 2. 方案总览

| 方案 | 库 | 能力 | 改造量 | 推荐度 |
|---|---|---|---|---|
| **A. react-resizable 单轴** | react-resizable (~5KB) | 每个 tile 自带右下角拖手柄，只能拉尺寸不能拖位置 | 1 小时 | ⭐⭐（最小步） |
| **B. react-grid-layout** | react-grid-layout (~60KB) | 拖拽 + 调尺寸 + 响应式断点 + 内置序列化 | 3–4 小时 | ⭐⭐⭐⭐⭐（本文主推） |
| **C. dockview / flexlayout-react** | dockview-react (~200KB) | IDE 风格面板：可叠 tab、可上下分栏、停靠 | 1 天 | ⭐⭐⭐（功能最全但学习成本高） |
| **D. allotment（VSCode 风 Split Pane）** | allotment | 纯分栏，类似 VSCode 的 Sash | 半天 | ⭐⭐（只适合 2–4 个终端） |

**推荐组合**：**方案 B（react-grid-layout）+ 按项目存 layout 到 projects.json**。
- 拖 / 调尺寸 / 响应式 一套搞定；
- 序列化是 `{ i, x, y, w, h }[]` 纯数据，存 JSON 天然合适；
- xterm 的 FitAddon 已经绑到 ResizeObserver，格子一变它自动 refit + sendResize，**不用写额外胶水**。

dockview 功能更强（可以把"错误终端"做成 tab 叠在主终端上），但若只是想快速落地"可拖拽 + 记尺寸"，RGL 性价比最高。本文主流程用 B，最后附 C 的平滑升级路径。

---

## 3. 方案 B 落地（推荐主干）

### 3.1 安装

```sh
pnpm --filter @aimon/web add react-grid-layout
pnpm --filter @aimon/web add -D @types/react-grid-layout
```

在 [packages/web/src/main.tsx](../packages/web/src/main.tsx) 顶部 import 它的 CSS：

```ts
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
```

### 3.2 数据模型

给 [packages/web/src/types.ts](../packages/web/src/types.ts) 加：

```ts
export interface TileLayout {
  i: string        // sessionId
  x: number        // 列起点（0–11）
  y: number        // 行起点（无单位，RGL 用 rowHeight 换算）
  w: number        // 列跨度
  h: number        // 行跨度
  minW?: number
  minH?: number
}

export interface ProjectLayout {
  projectId: string
  cols: number              // 默认 12
  rowHeight: number         // 默认 40px
  tiles: TileLayout[]
  updatedAt: number
}
```

### 3.3 后端持久化（projects.json 扩展）

[packages/server/src/db.ts](../packages/server/src/db.ts) 已经把 `projects.json` 当 authoritative store（[db.ts:108-117](../packages/server/src/db.ts#L108-L117)）。直接在 `Project` 记录上**内嵌 `layout` 字段**，不新建文件：

```jsonc
// packages/server/data/projects.json
[
  {
    "id": "abc123",
    "name": "my-app",
    "path": "C:\\code\\my-app",
    "createdAt": 1713400000000,
    "layout": {
      "cols": 12,
      "rowHeight": 40,
      "tiles": [
        { "i": "sess_xxx", "x": 0, "y": 0, "w": 6, "h": 12 },
        { "i": "sess_yyy", "x": 6, "y": 0, "w": 6, "h": 12 }
      ],
      "updatedAt": 1713400000000
    }
  }
]
```

在 [packages/server/src/routes/projects.ts](../packages/server/src/routes/projects.ts) 追加两个路由（跟在现有 DELETE 后面）：

```ts
// GET /api/projects/:id/layout
app.get<{ Params: { id: string } }>(
  "/api/projects/:id/layout",
  async (req, reply) => {
    const proj = getProject(req.params.id);
    if (!proj) return reply.code(404).send({ error: "not_found" });
    return proj.layout ?? null;
  },
);

// PUT /api/projects/:id/layout
const LayoutSchema = z.object({
  cols: z.number().int().min(1).max(48),
  rowHeight: z.number().int().min(10).max(200),
  tiles: z.array(z.object({
    i: z.string(),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1),
    h: z.number().int().min(1),
    minW: z.number().int().optional(),
    minH: z.number().int().optional(),
  })),
});
app.put<{ Params: { id: string }; Body: unknown }>(
  "/api/projects/:id/layout",
  async (req, reply) => {
    const parsed = LayoutSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", detail: parsed.error.issues });
    const ok = updateProjectLayout(req.params.id, { ...parsed.data, updatedAt: Date.now() });
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return reply.send({ ok: true });
  },
);
```

在 [db.ts](../packages/server/src/db.ts) 补一个 `updateProjectLayout(id, layout)`：读 projects.json → 改目标记录 → `saveProjectsJson(...)`。SQLite shadow 表不用动（它只是为了 session 级外键 cascade）。

### 3.4 前端 API 客户端

[packages/web/src/api.ts](../packages/web/src/api.ts)：

```ts
export async function getProjectLayout(projectId: string): Promise<ProjectLayout | null> {
  const r = await fetch(`/api/projects/${projectId}/layout`)
  if (r.status === 404) return null
  return r.json()
}
export async function saveProjectLayout(projectId: string, layout: ProjectLayout): Promise<void> {
  const r = await fetch(`/api/projects/${projectId}/layout`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(layout),
  })
  if (!r.ok) throw new Error(`save layout failed: ${r.status}`)
}
```

### 3.5 Zustand 切片

[packages/web/src/store.ts](../packages/web/src/store.ts) 加字段：

```ts
layoutByProject: Record<string, ProjectLayout>,
layoutDirty: Record<string, boolean>,
setLayout: (projectId: string, layout: ProjectLayout) => void,
markLayoutDirty: (projectId: string, dirty?: boolean) => void,
```

`setLayout` 在 RGL 的 `onLayoutChange` 回调里调（**不直接写服务端**，避免拖动过程中几十次 PUT），只打 `layoutDirty = true`。保存按钮点击时批量 PUT。

### 3.6 SessionGrid 替换为 GridLayout

改写 [SessionGrid.tsx](../packages/web/src/components/SessionGrid.tsx)：

```tsx
import GridLayout, { type Layout } from 'react-grid-layout'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import * as api from '../api'
import SessionTile from './SessionTile'
import StartSessionMenu from './StartSessionMenu'

export default function SessionGrid() {
  const sessions = useStore((s) => s.sessions)
  const projects = useStore((s) => s.projects)
  const selectedProjectId = useStore((s) => s.selectedProjectId)
  const layoutByProject = useStore((s) => s.layoutByProject)
  const setLayout = useStore((s) => s.setLayout)
  const markLayoutDirty = useStore((s) => s.markLayoutDirty)
  const layoutDirty = useStore((s) => !!s.layoutDirty[selectedProjectId ?? ''])

  const hostRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1200)

  // 观测外层宽度，RGL 必须显式给 width
  useEffect(() => {
    if (!hostRef.current) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(hostRef.current)
    return () => ro.disconnect()
  }, [])

  // 切项目 → 拉该项目 layout
  useEffect(() => {
    if (!selectedProjectId) return
    if (layoutByProject[selectedProjectId]) return // 已缓存
    void api.getProjectLayout(selectedProjectId).then((lay) => {
      if (lay) setLayout(selectedProjectId, lay)
    })
  }, [selectedProjectId])

  const visible = useMemo(
    () => sessions.filter((s) => !selectedProjectId || s.projectId === selectedProjectId),
    [sessions, selectedProjectId],
  )

  // 为新 session 合成默认 tile（靠墙堆放）
  const layout: Layout[] = useMemo(() => {
    const saved = selectedProjectId ? layoutByProject[selectedProjectId]?.tiles ?? [] : []
    const savedIds = new Set(saved.map((t) => t.i))
    const cols = 12
    const defaults = visible
      .filter((s) => !savedIds.has(s.id))
      .map((s, idx) => ({
        i: s.id,
        x: (idx * 6) % cols,
        y: Infinity,      // RGL 会把 Infinity 塞到底部
        w: 6,
        h: 12,
        minW: 3,
        minH: 6,
      }))
    return [...saved, ...defaults]
  }, [visible, layoutByProject, selectedProjectId])

  function onLayoutChange(next: Layout[]) {
    if (!selectedProjectId) return
    setLayout(selectedProjectId, {
      projectId: selectedProjectId,
      cols: 12,
      rowHeight: 40,
      tiles: next.map(({ i, x, y, w, h, minW, minH }) => ({ i, x, y, w, h, minW, minH })),
      updatedAt: Date.now(),
    })
    markLayoutDirty(selectedProjectId, true)
  }

  async function save() {
    if (!selectedProjectId) return
    const lay = layoutByProject[selectedProjectId]
    if (!lay) return
    await api.saveProjectLayout(selectedProjectId, lay)
    markLayoutDirty(selectedProjectId, false)
  }

  const projectName = selectedProjectId
    ? (projects.find((p) => p.id === selectedProjectId)?.name ?? selectedProjectId)
    : '全部项目'

  return (
    <div className="p-4" ref={hostRef}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-xs text-muted">当前视图</div>
          <div className="text-base font-medium">{projectName}</div>
        </div>
        <div className="flex items-center gap-2">
          {selectedProjectId && (
            <button
              onClick={() => void save()}
              disabled={!layoutDirty}
              className="px-3 py-1 text-xs rounded border border-border disabled:opacity-40 hover:border-fg/30"
            >
              {layoutDirty ? '💾 保存布局' : '已保存'}
            </button>
          )}
          <StartSessionMenu projectId={selectedProjectId} />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg py-20 text-center text-muted">
          {selectedProjectId ? '此项目还没有 session' : '还没有任何 session'}
        </div>
      ) : (
        <GridLayout
          className="layout"
          layout={layout}
          cols={12}
          rowHeight={40}
          width={width}
          margin={[12, 12]}
          draggableHandle=".drag-handle"     // 只有标题栏能拖
          resizeHandles={['se', 'e', 's']}   // 右、下、右下 三个手柄
          onLayoutChange={onLayoutChange}
          compactType={null}                 // 自由位置不自动上推
          preventCollision={true}
        >
          {visible.map((s) => (
            <div key={s.id} className="overflow-hidden">
              <SessionTile session={s} />
            </div>
          ))}
        </GridLayout>
      )}
    </div>
  )
}
```

### 3.7 SessionTile 的两处小改

1. **去掉硬编码高度**：[SessionTile.tsx:156](../packages/web/src/components/SessionTile.tsx#L156) 的 `h-[460px]` 改为 `h-full`，让格子决定高度，内部 flex 自适应。
2. **加拖拽手柄**：给顶部标题栏（[SessionTile.tsx:158](../packages/web/src/components/SessionTile.tsx#L158)）的最外 `div` 追加 `drag-handle cursor-move`，按钮区用 `onMouseDown={(e) => e.stopPropagation()}` 防止误拖。

**xterm 已经有 ResizeObserver**（[SessionTile.tsx:58](../packages/web/src/components/SessionTile.tsx#L58)），RGL 改尺寸触发外层盒子变化 → observer 回调 → `fit.fit()` + `aimonWS.sendResize()` **自动同步给后端 PTY**，这条链路不用任何改动。

### 3.8 CSS 微调（防止 RGL 默认样式冲突）

[packages/web/src/index.css](../packages/web/src/index.css) 追加：

```css
.react-grid-item.react-grid-placeholder { background: rgba(95,168,255,0.15); border-radius: 8px; }
.react-grid-item > .react-resizable-handle { z-index: 5; }
```

---

## 4. 错误终端与终端强绑定

需求："**项目报错终端界面数据跟终端**" —— 让错误输出与它所属的 session tile 视觉和操作上绑在一起。两种做法：

### 4.1 做法 1：同 tile 内切 tab（轻量，推荐）

在 [SessionTile.tsx](../packages/web/src/components/SessionTile.tsx) 内部加 tab 切换：`stdout` / `stderr` / `status log`。底层用两个 xterm 实例或一个共享实例 + 过滤。数据源上，[ws-hub.ts](../packages/server/src/ws-hub.ts) 可以新增 `stream: 'stdout' | 'stderr'` 字段（PTY 合并流时可以用 ANSI OSC 序列或在 [pty-manager.ts](../packages/server/src/pty-manager.ts) 再起一个 stderr 专用的管道）。

MVP 做法：**不拆物理流**，改为把带 `ERROR|Error|failed|Traceback` 的行高亮并在顶部 badge 计数；点击 badge 弹出"本 session 的错误快照" drawer。数据就是 xterm 的 selection buffer，**零后端改动**。

### 4.2 做法 2：错误流独立 tile（重量）

升级到 **dockview-react**（方案 C）：主 session tile 和 "error log tile" 是两个 panel，可以 tab 叠也可以拆出。layout 序列化 dockview 原生支持 `panel.toJSON()`，保存/还原和 RGL 思路一致，只是 schema 变成 dockview 的 grid 树。

建议：**先做 4.1**，真的需要独立错误窗口再上 4.2。

---

## 5. 打开项目自动还原

**已经自然成立**：3.6 里 `selectedProjectId` 变化 → `useEffect` 拉 `/api/projects/:id/layout` → 写入 Zustand → RGL 用该 layout 渲染。

只要补两个细节：

1. **应用启动时预热**：[App.tsx](../packages/web/src/App.tsx) 或 [main.tsx](../packages/web/src/main.tsx) 在加载项目列表后，顺便把每个项目的 layout 批量拉一次（可选，节省第一次切换的闪烁）。
2. **LocalStorage 兜底**：服务端 PUT 失败 / 离线时，把 `layoutByProject` 持久化到 `localStorage.aimon_layouts_v1`，下次启动优先 merge 服务端响应（服务端的 `updatedAt` 更新则覆盖）。

```ts
// store.ts 里
const LS_KEY = 'aimon_layouts_v1'
const bootLayouts = JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')
// 每次 setLayout 后：
localStorage.setItem(LS_KEY, JSON.stringify(get().layoutByProject))
```

---

## 6. 边界与陷阱

| 场景 | 处理 |
|---|---|
| 保存的 tile `i` 指向已删除的 session | `onLayoutChange` 里过滤掉 `!visible.some(s => s.id === t.i)` 的项；保存时再去一次脏数据 |
| 新 session 加入 | 3.6 的 `defaults` 逻辑：未在 saved 里的 session 追加 `y: Infinity`，RGL 自动填到底部空位 |
| 终端拖动时 xterm 频繁 refit 卡顿 | 给 `ResizeObserver` 回调加 `requestAnimationFrame` 节流；或仅在拖拽**结束**（`onResizeStop`）时才调 `sendResize` |
| 大屏 / 4K 上 cols=12 太密 | RGL 支持 `Responsive` 变体 + 断点 `{ lg: 12, md: 10, sm: 6, xs: 4 }`，每个断点独立存 layout（projects.json 里的 `tiles` 改成 `tilesByBreakpoint` map） |
| 拖动时误触发按钮 | 所有按钮 `onMouseDown={(e) => e.stopPropagation()}`；RGL 用 `draggableHandle=".drag-handle"` 限定只有标题栏能拖 |
| 多个浏览器 tab 并发编辑同一项目布局 | PUT 带 `If-Match: updatedAt` 或简单用 "last write wins"，UI 上在保存成功回调里把新 `updatedAt` 同步回 store |
| xterm fit 前容器高度为 0 | 3.7 已经改成 `h-full`，但首次渲染 RGL 还没量好宽度时容器可能瞬时为 0 —— 现有 SessionTile `try { fit.fit() } catch` 已兜了（[SessionTile.tsx:46-50](../packages/web/src/components/SessionTile.tsx#L46-L50)）|

---

## 7. 推荐落地顺序

| # | 步骤 | 预计工作量 | 文件 |
|---|---|---|---|
| 1 | 装 react-grid-layout 依赖 + 引入 CSS | 10 分钟 | [package.json](../packages/web/package.json), [main.tsx](../packages/web/src/main.tsx) |
| 2 | 后端加 `/api/projects/:id/layout` GET/PUT + `updateProjectLayout` | 1 小时 | [projects.ts](../packages/server/src/routes/projects.ts), [db.ts](../packages/server/src/db.ts) |
| 3 | 前端 `types.ts` / `api.ts` / `store.ts` 加 layout 字段和 CRUD | 1 小时 | [types.ts](../packages/web/src/types.ts), [api.ts](../packages/web/src/api.ts), [store.ts](../packages/web/src/store.ts) |
| 4 | **SessionGrid 替换为 GridLayout**（本文 3.6） | 2 小时 | [SessionGrid.tsx](../packages/web/src/components/SessionGrid.tsx) |
| 5 | SessionTile 去死高 + 加 `.drag-handle` + 按钮 stopPropagation | 30 分钟 | [SessionTile.tsx](../packages/web/src/components/SessionTile.tsx) |
| 6 | localStorage 兜底 + 切项目自动拉 layout | 30 分钟 | store.ts |
| 7 | 错误高亮 / 计数 badge（方案 4.1） | 1 小时 | SessionTile.tsx |
| 8 | （可选）Responsive 多断点 layout | 1 小时 | 同上 |
| 9 | （可选）升级到 dockview，支持 panel tab 叠加 | 1 天 | 新 `DockLayout.tsx` 替代 SessionGrid |

---

## 8. 验收清单

- [ ] 拖拽任意 tile 到新位置，松手后位置保留；点击"💾 保存布局"，刷新页面布局依旧；
- [ ] 切到另一个项目再切回来，布局与保存时一致；
- [ ] 拖拽改变 tile 宽高时，xterm 内光标和行数立即随容器变化（`stty size` / `tput lines` 输出新值）—— 证明 `sendResize` 到 PTY 链路正常；
- [ ] 有 N 个已保存 tile，再启动一个新 session —— 新 tile 自动补在底部，不覆盖已有；
- [ ] 删除 session 后再保存布局，projects.json 的 `tiles` 不残留废 id；
- [ ] 关闭服务端、刷新页面 —— 前端用 localStorage 兜底仍能还原上次布局（降级可用）；
- [ ] session 产生 `Error`/`Traceback` 行时，tile 顶部 badge 计数 +1，点击可跳到错误行。
