# 项目列表激活分页 · Context

## 关键文件

### 会改动的文件

**`packages/web/src/components/layout/ProjectsColumn.tsx`**（唯一改动文件）

| 符号 / 区域 | 行范围 | 说明 |
|---|---|---|
| `countFor(pid)` | L105–107 | 组件本地函数；当前 `sessions.filter(s => s.projectId === pid).length`；**执行阶段必须改为加 `&& s.ended_at == null` 过滤**（见决策 5） |
| 顶部标题栏 `<div>` | L142–147 | `h-9 px-3 flex items-center justify-between`，"项目" + 项目数；tab 条插入位置取决于候选 A / B（见决策 2） |
| chip "全部 sessions" `<button>` | L150–162 | `fluent-btn`、click → `select(null)`；span 显示 `sessions.length`；**不动** |
| `projects.length === 0` 全局空态 | L163–169 | "还没有项目 / 点击下方 + 新建"；保留不动，与 tab 空态条件互斥 |
| `projects.map(...)` 列表渲染 | L170–204 | 改为 `currentList.map(...)`；选中高亮 class `fluent-selection-indicator bg-white/[0.08]`（L175），非选中 `hover:bg-white/[0.04]`（L177） |
| `+ 新建项目` button | L206–210 | 固定底部，**不动** |

### 只读（确认行为，不改）

**`packages/web/src/store.ts`**

- `projects: Project[]` (L299)、`sessions: Session[]` (L300)：zustand state，selector 取，re-render 自动。
- `addSession` (L503–507)：前端发起 session 后同步写入 store。
- `removeSession` (L509–515)：用户关闭 tile 时调用，同步删条目。
- `markSessionExit` (L590–608)：WS `exit` 事件触发（`main.tsx` L33），**不删 session**，只设 `ended_at: Date.now()` + `status: 'stopped'`，session 仍留在数组里。
- `refreshSessions` (L485–501)：拉取后过滤 `ended_at == null` 为 alive 写回 store。

**`packages/web/src/main.tsx`**

- L32–33：`case 'exit'` → `markSessionExit`，全链路同步 re-render，无轮询。

**`packages/web/src/types.ts`**

- L103：`ended_at: number | null`，`null` 为存活，非 null 为已结束。

---

## 决策记录

### 决策 1：派生位置 — 组件内 `useMemo`，不在 store 加字段

```ts
const [activeTab, setActiveTab] = useState<'active' | 'inactive'>('active')

const { activeProjects, inactiveProjects } = useMemo(() => {
  const active: typeof projects = []
  const inactive: typeof projects = []
  for (const p of projects) {
    const count = sessions.filter(s => s.projectId === p.id && s.ended_at == null).length
    if (count >= 1) active.push(p)
    else inactive.push(p)
  }
  return { activeProjects: active, inactiveProjects: inactive }
}, [projects, sessions])

const currentList = activeTab === 'active' ? activeProjects : inactiveProjects
```

**资深工程师视角**：唯一消费者就是 ProjectsColumn，store 加派生字段是只用一次的抽象，否掉。

### 决策 2：tab 条放在哪（**待主理人在开工前拍板**）

**候选 A：标题栏下方独立一行**（多占约 32px 高度）

插在 L147 之后：

```jsx
<div className="flex gap-1 px-2 py-1 border-b border-border/30">
  {(['active', 'inactive'] as const).map((t) => (
    <button
      key={t}
      onClick={() => setActiveTab(t)}
      className={`flex-1 text-xs py-1 rounded-sm transition-colors ${
        activeTab === t
          ? 'bg-white/[0.08] text-fg font-medium'
          : 'text-subtle hover:text-fg'
      }`}
    >
      {t === 'active' ? '激活' : '未激活'}
    </button>
  ))}
</div>
```

**候选 B：与现有标题行合并为 pill**（标题"项目"在左，两个 tab pill 在右）

修改 L142–147 的 `<div>`，把右侧"项目数"替换为两个 pill 按钮（10px 字号）。不占额外垂直空间，但可点击区域更窄。

A 更易点 / 视觉更清晰，B 更省纵向空间。**context 不替主理人决定**。

### 决策 3：空态文案 inline，不抽组件

```jsx
{currentList.length === 0 && projects.length > 0 && (
  <div className="px-3 py-6 text-xs text-muted text-center">
    {activeTab === 'active' ? '当前没有运行中的终端' : '所有项目均已激活'}
  </div>
)}
```

只用一次、两句话，抽组件是无意义抽象。

### 决策 4：chip 语义不变

`全部 sessions (N)` 的 N 仍用 `sessions.length`（全局）、click 仍 `select(null)`，跨两 tab 都显示，位置不动。

### 决策 5：分组与 `countFor` 都加 `ended_at == null` 过滤（**新发现，需主理人在确认 context 时拍板**）

**现象**：`markSessionExit` 不删 session 只设 `ended_at`，用户必须手动关 tile 才走 `removeSession`。所以：

- 不过滤 `ended_at` → session 已 exit 但 tile 没关时，项目仍在"激活" tab，不符合 plan 验收 4。
- 过滤 `ended_at == null` → exit 瞬间立即迁移到"未激活"，与 plan 验收 4 一致，与 `refreshSessions` alive 语义一致。

**建议**：`useMemo` 分组里的 count 计算 + `countFor` 函数都加过滤。这条是为了让验收 4 真的可观察通过的硬性前提，不是可选项。

### 决策 6：`selectedProjectId` 跨 tab 不做兜底

场景：在"激活" tab 选中项目 P → 关掉 P 的最后一个 session → P 自动迁移到"未激活" → `selectedProjectId === P.id` 但当前 tab 不渲染 P。

**评估**：高亮 class 只在 `currentList.map` 里执行，P 不在列表就不渲染，无"孤高亮"。EditorArea 仍显示 P 的文件 / SCM —— 用户刚关 session，继续看到上下文是自然的，不是坏交互。chip（`select(null)`）随时可清。**处理成本 > 收益，不加兜底**。

---

## 依赖与约束

**上游订阅**

- `projects` / `sessions` 通过 zustand selector 订阅，引用变更时自动 re-render。
- `useMemo` 依赖数组：`[projects, sessions]`。selector 返回稳定引用，不会误 invalidate。

**实时性**

- session 新增：API → `addSession` → store set → re-render，无延迟。
- session 退出：WS exit → `main.tsx` L33 → `markSessionExit` → store set（`ended_at` 变非 null）→ re-render → useMemo 重算。全链路同步，无轮询。

**兼容性**

- chip 行为零退化（代码不动）。
- `projects.length === 0` 全局空态保留，与 tab 空态互斥。
- 右键菜单 / `openMenu` / `onDelete` 等不受 tab 影响，操作的是 `p.id` 不是列表位置。

**样式约束**

- 沿用 Fluent + Tailwind class（`fluent-btn`、`bg-white/[0.08]`、`text-fg`、`text-subtle`、`text-muted`、`border-border/40`），不引入新 CSS、不改 tailwind 配置。

**TypeScript**

- `activeTab` 类型 `'active' | 'inactive'`。
- `activeProjects` / `inactiveProjects` 类型 `typeof projects`，无额外类型声明。
- 完工跑 `pnpm -F web tsc --noEmit` 0 错误。
