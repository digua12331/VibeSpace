# 右键菜单发送到输入框 · Context

## 关键文件（边界 = 本次只碰这 3 个文件 + 读 1 个）

### 改动（3 个）

1. **`packages/web/src/store.ts`**
   - 新 state 字段（加在 `State` interface L134 附近；`sessions` / `liveStatus` 同一块）：
     ```ts
     /** Text queued to be injected into a session's floating input on next render. */
     pendingInputBySession: Record<string, string>
     queuePendingInput: (sessionId: string, text: string) => void
     consumePendingInput: (sessionId: string) => void
     ```
   - 初始值 `pendingInputBySession: {}`，在 `create<State>()` 里和其他字段并列。
   - `queuePendingInput` 实现（追加语义）：
     ```ts
     queuePendingInput: (sessionId, text) =>
       set((st) => ({
         pendingInputBySession: {
           ...st.pendingInputBySession,
           [sessionId]: (st.pendingInputBySession[sessionId] ?? '') + text,
         },
       })),
     consumePendingInput: (sessionId) =>
       set((st) => {
         if (!(sessionId in st.pendingInputBySession)) return st
         const next = { ...st.pendingInputBySession }
         delete next[sessionId]
         return { pendingInputBySession: next }
       }),
     ```
   - **不走** `persistWorkbench`（瞬时状态，刷新不保留，也不该保留）。

2. **`packages/web/src/components/terminal/SessionView.tsx`**
   - 已有的 `fillInput(text)` L383-390 **保持原样**，只改了一件事：它原本是无条件赋值——追加逻辑在调用处决定。但这里为了避免 fillInput 内含"追加语义"后污染现有调用方（L667 `fillInput(cmd)`、L749 `fillInput(text)` 都是覆盖语义），**新增一个 useEffect 自己做拼接**，不改 fillInput。
   - 新增 useEffect（放在 `fillInput` 定义之后，`ensureFilesLoaded` 之前比较贴合）：
     ```ts
     const pending = useStore((s) => s.pendingInputBySession[session.id])
     const consumePendingInput = useStore((s) => s.consumePendingInput)
     useEffect(() => {
       if (!pending) return
       const el = inputRef.current
       if (!el) return
       const prev = el.value
       fillInput(prev + pending)
       consumePendingInput(session.id)
     }, [pending, session.id, consumePendingInput])
     ```
   - 新 import：`useEffect` 已 import（文件顶上 L1），`useStore` 已 import。

3. **`packages/web/src/components/fileContextMenu.ts`**
   - 两处 `onSelect`（单 session 分支 L80-85、多 session 子菜单 L92-94）都改成同一段逻辑。抽一个局部 helper 以免重复：
     ```ts
     async function sendToSession(
       projectId: string,
       target: FileContextSession,
       path: string,
       kind: 'file' | 'dir',
     ): Promise<void> {
       await logAction(
         'files',
         'send-to-session',
         () => {
           const text = formatForSession(target.agent, path, kind)
           const st = useStore.getState()
           st.setActiveTabKind('session')
           st.setActiveSession(projectId, target.id)
           st.queuePendingInput(target.id, text)
         },
         { projectId, sessionId: target.id, meta: { path, kind, agent: target.agent } },
       )
     }
     ```
   - 两个分支都改成 `onSelect: () => { void sendToSession(projectId, session, path, kind) }`。
   - **移除** `aimonWS.sendInput(...)` 的两处调用（这是本次行为变更的核心）。顺带检查 `aimonWS` import 是否还被用 —— 如果不再使用就删掉 import，减少孤儿。
   - **保留** `formatForSession` 函数不变（同文件内还被 SessionView L484 的 `pickItem` 用 `import { formatForSession }` 引用，是公共 util）。

### 只读（1 个，只用来验证假设）

4. **`packages/web/src/components/editor/EditorArea.tsx`**
   - L266-274 `visibleSessions.map((s) => <SessionView ...active={...} />)`：所有 visibleSessions 都挂载，active 仅作为 prop。这是本方案"pending 注入不会丢"的依据。**不改它**。

## 决策记录

### 决策 A：用 store 字段做跨组件注入，而不是 event bus / imperative ref

- **备选**：在 SessionView 里 `forwardRef` 暴露 `fillInput` → 父组件持一个 `Record<sessionId, ref>`；或起一个 EventEmitter 通道。
- **选这个**：已有 `activeSessionIdByProject` / `openFiles` / `liveStatus` 等都是 zustand store 集中管，新字段 `pendingInputBySession` 刚好同构。fileContextMenu.ts 本身已经在用 `useStore.getState()`（L127），不需要引入新的通信机制。
- **资深工程师会不会觉得过度？**：不会——单个 `Record<string, string>` 字段 + 2 个 action，总共 < 20 行 store 代码，没有新抽象，没有新文件。

### 决策 B：`queuePendingInput` 在 store 侧做追加（`prev + text`），SessionView 也做一次拼接（`inputRef.value + pending`）

- **为什么两次拼接都保留**：
  - store 侧追加：处理"快速连点两次，SessionView 还没来得及消费第一次 pending"。避免后一次覆盖前一次。
  - SessionView 侧拼接：处理"用户已经在 `<input>` 里打了字，这时右键发送，要追加在已有内容后面"。
- 这两个场景语义不同（前者是 pending buffer 合并，后者是 input 已有内容 + pending），合起来才完整覆盖追加语义。

### 决策 C：不改 `fillInput(text)` 本身

- `fillInput` 现有两处调用（L667 custom button、L749 selection → append-to-input）都是覆盖语义。如果把它改成"自动追加"会改变那两处行为，引入回归。
- 所以追加逻辑放在新 useEffect 的调用处（`fillInput(prev + pending)`）里，`fillInput` 保持纯赋值。

### 决策 D：projectId 一致性

- EditorArea 用 `sessionKey = selectedProjectId ?? ALL_KEY` 作为 `activeSessionIdByProject` 的 key，而 fileContextMenu 只能拿到具体的 `projectId`（文件所属项目）。
- **为什么没问题**：右键菜单只在 FilesView 里触发（fileContextMenu.ts 唯一调用方，见 FilesView.tsx L249），FilesView 需要 `projectId` 才渲染（`if (!projectId || !project) return EmptyState`），而 FilesView 的 projectId 来自 `selectedProjectId`。所以触发菜单的那一刻 `projectId === selectedProjectId !== null`，等价于 `sessionKey`。
- ALL_KEY 模式下 FilesView 不显示文件树，右键菜单不会触发。不用特殊处理。

### 决策 E：埋日志走 logAction 包装一个**同步** fn

- `logAction` 能接受同步和异步 fn（看 L104-109 `openInBrowser` 是异步的，而这里 3 步 store 调用都是同步的）。
- 用 logAction 而不是手动两条 `pushLog`，因为它会自动算耗时 + 统一 scope / action / meta / error 结构。耗时对同步操作会是 ~0ms，无害。

## 依赖与约束

- **上游 API**：不依赖任何后端改动。`aimonWS.sendInput` 那条路径**不再被右键菜单调用**，但它本身保留（SessionView L266 仍在用它发送 xterm 的键盘输入）。
- **数据结构**：`AgentKind`、`Session` 类型都不动。
- **兼容性**：
  - 删除 fileContextMenu 的两处 `aimonWS.sendInput` 调用后，后端看到的"右键发送来的 stdin 消息"不再出现。后端没有任何逻辑依赖这类消息的来源标识（它只是纯 stdin 转发），所以后端无感知。
  - SessionView 的 `<input>` 现有提交逻辑（回车 → 调 `aimonWS.sendInput`）不变；用户在注入后按回车仍然走原路径。
- **持久化**：`pendingInputBySession` 不进 localStorage，不进 `persistWorkbench`。刷新页面丢失 = 期望行为。
- **类型检查**：仓库使用 TypeScript；按 CLAUDE.md 硬性规则，步骤完成时必须跑一次项目层面的类型检查。命令：`pnpm --filter @aimon/web exec tsc -b`（包没有独立 typecheck script，用 build 的前半段）。

---

## 扩展范围追加（2026-04-24）：Dev Docs 派 Claude

### 新增/改动文件

- **新建** `packages/web/src/sendToSession.ts`：
  - `export interface DispatchTarget { id: string; agent: AgentKind }`（结构与 `FileContextSession` 兼容）
  - `export async function sendToSession(projectId, target, text, opts?: { scope?: string; meta?: Record<string, unknown> })`：
    - 内含原 fileContextMenu 里的那段 `logAction` + `setActiveTabKind` + `setActiveSession` + `queuePendingInput`
    - `scope` 默认 `'files'`，DocsView 传 `'docs'`——LogsView 里能区分来源
  - `export function pickClaudeTarget(projectId: string): DispatchTarget | null`：
    - 从 `useStore.getState().sessions` 筛 `projectId` 匹配 + `agent === 'claude'` + 状态非 stopped/crashed
    - 优先返回 `activeSessionIdByProject[projectId]` 对应的那个（如果它是存活 claude）
    - 否则返回第一个存活 claude；都没有返回 `null`

- **改** `packages/web/src/components/fileContextMenu.ts`：
  - 删除本地 `sendToSession` 定义
  - 从 `../sendToSession` import `sendToSession`
  - 两处 `onSelect` 改成先 `formatForSession` 得到 text，再 `void sendToSession(projectId, s, text, { scope: 'files', meta: { path, kind } })`
  - `FileContextSession` 类型保留（ChangesList / FilesView 仍在用）；传入 `sendToSession` 时结构化兼容 `DispatchTarget`

- **改** `packages/web/src/components/sidebar/DocsView.tsx`：
  - 顶部 import 新增 `sendToSession`, `pickClaudeTarget`
  - `runDispatch` 前面加分支：
    ```ts
    const target = pickClaudeTarget(projectId)
    if (target) {
      await sendToSession(projectId, target, prompt, { scope: 'docs', meta: { kind: successTitle } })
      return
    }
    // fallback: 原 dispatchClaude 路径
    await dispatchClaude({ projectId, prompt, successTitle })
    ```
  - `successTitle` 继续作为 dispatchClaude 的对话框标题；新路径下不用它弹对话框。

- **不改** `packages/web/src/dispatchClaude.ts`（作为 fallback 保留原貌）
- **不改** `packages/web/src/components/HtmlPreview.tsx`（范围外）

### 扩展决策记录

- **为什么抽公共 helper 而不是复制？** 现有两个 caller（fileContextMenu / DocsView），`sendToSession` 共用逻辑（logAction + 3 个 store 调用）完全相同，函数提取是正收益，不算过度抽象。CLAUDE.md 的"不做只用一次的抽象"条款在这里不触发（n=2）。
- **为什么多 claude session 不弹子菜单？** 见 plan 扩展段；顶部"派全部"按钮不是菜单，强行加子菜单要改 UX 结构，不值得。用 `activeSessionIdByProject` 作隐式选择是"最近原则"，符合用户直觉。
- **scope 区分为什么重要？** LogsView 按 scope 过滤日志；`files` vs `docs` 让排障时能区分"文件派发"和"任务/问题派发"两条路径。
- **fallback 保留 `dispatchClaude` 而不是"新开 session 再 queuePendingInput"**：新开 session 需要时间启动 pty 和 CLI，此时 SessionView 可能还没挂载/`inputRef` 还没就绪，pending 注入时机难控。保留原路径是最稳的不倒退方案。用户先手动开一个 claude session 再派发，体验就是新路径。
