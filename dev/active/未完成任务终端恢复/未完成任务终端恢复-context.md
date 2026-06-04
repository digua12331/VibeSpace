# 未完成任务终端恢复 · Context

> 给 AI 自己看的执行边界与决策记录。大哥不审。

## 关键文件（边界——本任务原则上只动这里）

### 会改的（5 处）

1. **`packages/web/src/store.ts`**
   - `selectProject(id)` 函数 (line 514-598)：在末尾追加 fire-and-forget 刷新，让切项目后 docs/sessions 立即同步当前项目，避免 EmptyState/DocsView 拿到旧数据。`refreshDocs` / `refreshSessions` 已存在（line 600+），这次只是在新地点调用。

2. **`packages/web/src/components/StartSessionMenu.tsx`**
   - 加 `defaultTask?: string` prop (line 33-43 props 区)
   - `taskName` state 初始化从 `defaultTask ?? ''` 而不是 `''`（line 54）
   - 这是一个小扩展，让 DocsView/EmptyState 能预填任务名后唤起这个菜单。

3. **`packages/web/src/components/sidebar/DocsView.tsx`**
   - 任务行 (line 588-657)：在 StatusPill 之后、archive 按钮之前，新增"终端入口"区域：
     - 有 alive owner（`findOwnerOfTask` 已在 line 337-339）→ 现有 🔗 owner 徽章 (line 615-622) 改成可点击的按钮，点击 = `setActiveSession(projectId, owner.id)` + `setActiveTabKind('session')`
     - 无 alive owner 且 task.status !== 'done' → 在同位置渲染 `<StartSessionMenu defaultTask={t.name} compact triggerLabel="▶ 启动终端" onStarted={...} />`，预填任务名，用户挑 agent + isolation
   - `setActiveSession` / `setActiveTabKind` 通过 `useStore` 取（已经被 EditorArea 在用，line 36-46）

4. **`packages/web/src/components/editor/EditorArea.tsx`**
   - `EmptyState` (line 341-355) 当前只显示 📄 占位文案。改成：
     - 当 `projectId != null` 且 `docsTasks[projectId]` 中有 status !== 'done' 任务时，在原占位下方插入"未完成任务"卡片区，按 `updatedAt` 倒序取前 3 条，每条卡片同 DocsView 行的 chip + 启动逻辑
     - 当无未完成任务时保持原样（避免空 UI 噪声）
   - 需要在 EditorArea 里读 `docsTasks` from store（已经有 `useStore((s) => s.docsTasks)` at line 41）

5. **`packages/web/src/index.css` 或不动**
   - 如果 StartSessionMenu 的 dropdown 在行内/EmptyState 卡片里弹出位置错乱，可能要小调样式。优先不动；只有目视确实错位才碰。

### 会读但不改的

- `packages/server/src/routes/sessions.ts` — 确认 POST /api/sessions 接受 task 入参，确认无需后端改动
- `packages/server/src/db.ts` — `Session` 类型 + `findSessionBoundToTask` (alive only) + `createSession` 接受 task
- `packages/web/src/api.ts` — `createSession({task})`、`bindSessionTask`、`restartSession` 现成
- `packages/web/src/logs.ts` — `logAction(scope, action, fn, ctx)` 现成，不要重新造
- `packages/web/src/components/layout/Workbench.tsx` — 启动时全量 refresh，不动
- `packages/web/src/components/layout/ActivityBar.tsx` — **不动**（plan 非目标里明确说不加 ActivityBar 徽章）

## 决策记录

### 1. **不做后端改动**

事实校验：
- POST /api/sessions 路由（sessions.ts:119-131）→ 调 startSession → 调 db.createSession，**全程不检查 task 占用**
- 占用检查（findSessionBoundToTask + 409）只在 PATCH /api/sessions/:id/task 路径触发（sessions.ts:152-170）
- 我们这次的"启动新终端绑定到任务"用 POST + task 入参一次完成，**不走 PATCH**
- 因此 Codex 评审说的"dead session 仍挂 task_name 时 PATCH 409"在我们的路径下根本不会发生

**资深工程师视角自查**："为了清理 dead session 的 task_name 是不是过度设计？"——是。dead session 在前端 store 里被 `refreshSessions` 过滤掉，UI 看不见；后端 `findSessionBoundToTask` 只查 alive；没有任何代码路径会因为 dead 行的 task_name 出错。**不做这个清理**。

### 2. **alive 跳转 vs no-alive 启动 = 两条路径**

- alive: `setActiveSession` + `setActiveTabKind('session')`，纯前端 store 操作，**无操作日志**（参考 manual.md 偏好：纯前端视图切换不埋点）
- no-alive: 通过 `StartSessionMenu` 走 `api.createSession`（StartSessionMenu.tsx:131-156 已包了 logAction('session','start')），**复用现有埋点，不重复埋**

### 3. **不做 ActivityBar 徽章**

plan 非目标已明确。Codex 评审："会引入全局计数同步问题"。即使技术上简单，2 个落点已足够覆盖：
- DocsView 默认是 sidebar 三个 tab 之一，用户切到 docs view 就能看到新行为
- EditorArea EmptyState 在用户开项目无 tab 时居中显示

如果实现完发现 2 个落点不够"扎眼"，再加 ActivityBar 徽章作为一次性补丁，不在本轮做。

### 4. **不复用 dead session 的 worktree**

技术上要新增"领养孤儿 worktree"接口（addWorktree 路径硬编码新 sessionId），不在本轮范围。
旧 worktree 目录在 `<server>/data/worktrees/<projectId>/<oldSessionId>/`，UI 不主动暴露——用户能从原 session tab 关闭时的"删除/保留"对话框看到 (EditorArea.tsx:127-135)。本轮不增强这个提示。

### 5. **不抽公共 helper**

DocsView 行的"终端入口"逻辑和 EmptyState 卡片的逻辑相似但不完全一样（行内 vs 卡片样式、上下文菜单 vs 简化交互）。两处各自实现，不抽 helper（外科式改动原则；只用一两次的抽象是过度设计）。

### 6. **EmptyState 触发条件保持 `!hasAnyTab`**

`hasAnyTab = openFiles.length > 0 || visibleSessions.length > 0`。如果有 alive session tabs 在，EmptyState 不会显示——但用户已经能从 session tab 上看到 📝 任务徽章 (EditorArea.tsx:227-234)，已有可达性。**不改 hasAnyTab 语义**，避免把"未完成任务卡片"塞到有 tabs 的页面里造成视觉噪声。

### 7. **selectProject 后 fire-and-forget 刷新**

现状：`selectProject` 是纯前端动作，不刷数据。DocsView 自己在 mount/projectId 变更时 refreshDocs（DocsView.tsx:137-142），但只在 sidebar Activity=docs 时才生效。

改进：`selectProject` 末尾追加 `void get().refreshDocs(id).catch(()=>{})` 和 `void get().refreshSessions(id).catch(()=>{})`，让数据立即跟项目走。

风险：DocsView 自己也 refresh → 切到 docs tab 第一次会有 2 次 GET。可接受（接口便宜，数据幂等）。资深工程师视角："优化双 fetch 是否值得？"——不值得，增加 idempotency token 比节省一次 GET 麻烦得多。

## 依赖与约束

### TypeScript 类型

- 项目用 TS，本任务**必须过 `pnpm -w typecheck`**（项目实际命令以 package.json 为准，下一步查）
- DocTaskSummary 在 `packages/web/src/types.ts` 有定义；不动
- StartSessionMenu props 加 `defaultTask?: string` 是非破坏性扩展

### 操作日志

- Switching tab：纯 UI，**不埋**（manual.md 偏好对齐）
- StartSessionMenu 内部已埋 `logAction('session', 'start', ...)`，**不重复埋**
- 失败分支：StartSessionMenu 已捕获错误并 `setError`，logAction 也会写 error 日志。**不再加层**。
- 验收时人工触发：把后端 sessions.ts 的 startSession 临时插入 `throw new Error('test')`，前端点击启动按钮 → LogsView 应该看到 `scope=session action=start 失败` 的 ERROR 条目

### 边界

- 项目无未完成任务 → DocsView 行无变化（done 任务不显示新按钮）；EmptyState 不插任何卡片
- 项目无任务 → 同上
- 任务 docs API 失败 → docsTasks[projectId] 为 undefined，DocsView 已有 error 兜底，EmptyState 走旧路径不显示卡片
- alive owner 多于一个（理论不该有，PATCH 有 409 防御）→ `find` 取第一个，行为已经如此，不动
- StartSessionMenu dropdown 在 DocsView 行内打开时，可能溢出 sidebar 宽度——StartSessionMenu 用 `absolute right-0 top-full` 定位，位置正常情况下应该 OK；目视检查时如果错位再调

### 数据形状（不变）

```ts
// types.ts 现有
interface DocTaskSummary {
  name: string
  status: 'todo' | 'doing' | 'done' | 'blocked'
  checked: number
  total: number
  updatedAt: number
}

// 来自 store 的 sessions（alive 已在 refreshSessions 里过滤）
type Sessions = Session[]  // ended_at == null only
```

派生数据计算（在组件里直接计算，不抽 store selector）：
```ts
function findOwner(taskName: string): Session | undefined {
  return sessions.find(s => s.projectId === projectId && s.task === taskName)
  // alive 已经被 refreshSessions 保证；liveStatus 兜底见 DocsView aliveSessionsForProject
}

function unfinishedTasks(): DocTaskSummary[] {
  return (docsTasks[projectId] ?? [])
    .filter(t => t.status !== 'done')
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
```

## 验收方式回顾（来自 plan）

1. ✅ DocsView 任务列表行 alive owner 出现可点击 🔗 按钮（旧徽章变按钮）
2. ✅ DocsView 任务列表行 no-alive 出现 ▶ 启动按钮（StartSessionMenu compact）
3. ✅ EditorArea 无 tab 时中间显示前 3 条未完成任务卡片
4. ✅ 点击 🔗 → 切到对应终端标签
5. ✅ 点击 ▶ → 弹 StartSessionMenu，task 名预填，选 agent → 新会话出现，自动切到新标签
6. ✅ LogsView 看到 `scope=session action=start` 起止配对（StartSessionMenu 现有埋点）
7. ✅ 失败分支 ERROR 人工触发可见
8. ✅ TypeScript 类型检查通过

## 上下文耗尽时的衔接

如果中途上下文吃满：

- 当前进度看 `tasks.md`（`- [ ]` → `- [x]` 进度可见）
- 决策已记录在本文件
- 新会话只需说"继续 未完成任务终端恢复"，先读 dev/active/未完成任务终端恢复/ 三个 md 即可接上
