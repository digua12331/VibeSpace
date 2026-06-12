# 右键菜单发送到输入框 · Plan

> memory 扫过无相关条目。相关前置任务：`浮动输入框命令增强`（确认"悬浮输入框"= SessionView 底部的 `<input>` + / 与 @ 悬浮菜单组合）。

## 背景（现状）

文件右键菜单 → "发送到 XXX"（`fileContextMenu.ts` L78-96）当前直接调 `aimonWS.sendInput(sessionId, text)`，文本作为 stdin 绕过前端 `<input>` 直接喂给后端 pty / Claude 进程。结果：

- 用户在浮动 `<input>` 里看不到这次发送的内容（已经"提交"了）。
- 如果目标 session 不是当前激活的 tab，右键发出去之后工作区不会切过去，用户要自己去点那个 tab 才看得见效果。

用户要的是："发送到 XXX" = 把格式化后的文本**注入到对应 session 的浮动 `<input>`**（而不是直接提交），同时**把工作区切到那个 session 的 tab**，让用户看到内容、可以补充 / 编辑 / 按回车发送。

## 目标

把右键菜单"发送到 XXX"的行为从 "绕过 UI 直接喂 stdin" 改成 "注入到目标 session 的浮动 `<input>` + 激活该 tab"。

**验收标准（UI 可观察）**：

1. 打开任一项目，确保有至少 1 个活跃 session，且当前工作区**不**显示该 session（例如正停在某个文件编辑 tab 上）。右键任意文件 → 点 "发送到 XXX"，浏览器里可见：
   - 工作区切到终端视图（`activeTabKind === 'session'`）
   - 若项目有多个 session，目标 session 的 tab 变为激活（标签样式 + 显示的终端视图是目标那个）
   - 目标 SessionView 底部的 `<input>` 里出现 `@<path> `（或 shell 的 `"<path>" `），光标在末尾，`<input>` 已聚焦
   - 按回车可以正常发送（沿用现有输入框提交逻辑）
2. 在同一 session 上连续右键"发送到 XXX" 两个不同文件，两个路径都**追加**进 `<input>`（而不是后者覆盖前者），光标在最末尾。
3. LogsView 可以看到一对 `scope=files action=send-to-session` 的起止日志，`meta` 含 `sessionId / path / kind / agent`。
4. 目标 session 状态已 stopped / crashed 时，菜单项照旧禁用（沿用现状）。

## 非目标 (Non-Goals)

- **不改** `aimonWS.sendInput` 本身，也不改终端内选中文本的"添加到终端聊天"（那条本来就走 `fillInput`，保持）。
- **不改** `/` 斜杠菜单、`@` 文件自动完成、`<input>` 的渲染结构。
- **不**在发送时自动按回车提交——用户要手动确认。
- **不**做"一键清空 `<input>` 重新输入"的 UI；覆盖 vs 追加的选择见下方说明。
- **不**给"复制路径 / 删除 / .gitignore / 在浏览器打开 / 执行 .bat" 这些同一菜单里的其他项加日志（本次只改"发送到 XXX"的路径）。

## 实施步骤

1. **store 里加跨组件注入通道**（`packages/web/src/store.ts`）
   - State 增字段：`pendingInputBySession: Record<string, string>`（初始 `{}`）。
   - Actions 增：
     - `queuePendingInput(sessionId: string, text: string)`：追加（当前值 + 新 text）而不是覆盖，见下方"追加 vs 覆盖"。
     - `consumePendingInput(sessionId: string)`：读出并清零。
   - 只在内存中，不持久化到 localStorage（这是瞬时注入，刷新不保留）。
   - **验证**：TypeScript 编译通过，`pnpm --filter web typecheck` 或项目实际脚本。

2. **SessionView 消费 pendingInput**（`packages/web/src/components/terminal/SessionView.tsx`）
   - 新 `useEffect`，依赖 `session.id` 和 `useStore((s) => s.pendingInputBySession[session.id])`：
     - 若 pending 值非空：调 `fillInput(prev + pending)`（其中 prev = `inputRef.current?.value ?? ''`；因为 store 侧已经追加了，这里再按 store 的最终值赋值即可——见"追加 vs 覆盖"细节）。然后 `consumePendingInput(session.id)` 清零。
     - `fillInput` 已有（L383），会聚焦并把光标放末尾。
   - 需要确认 xterm 初始化的 `useEffect` 与这个新 `useEffect` 执行顺序：`inputRef` 在 JSX 渲染后就可用，不依赖 xterm 初始化；首次渲染即可注入。
   - **验证**：手动测试——触发后 `<input>` 里有文本、聚焦。

3. **fileContextMenu.ts 改写"发送到 XXX"行为**
   - 两个分支（单 session / 多 session 子菜单）的 `onSelect` 都改成：
     ```ts
     const st = useStore.getState()
     const text = formatForSession(agent, path, kind)
     st.setActiveTabKind('session')
     st.setActiveSession(projectId, sessionId)
     st.queuePendingInput(sessionId, text)
     ```
   - 用 `logAction('files', 'send-to-session', fn, { projectId, sessionId, meta: { path, kind, agent } })` 包起来。
   - **移除** `aimonWS.sendInput(...)` 这次的调用（这是核心行为变更）。
   - **验证**：点一下菜单项；LogsView 里出现起止配对。

4. **菜单标签文案微调**
   - 现状标签：`发送到 ${agent}·${shortTail(id)}`。
   - 文案保持不变——含义仍是"发送"，只是语义从"直接提交"变成"注入到输入框"。若用户觉得会误导，再改（例：`填到 ${agent}·${xxxxxx}`），但这不在本次默认范围内。

5. **跑类型检查 + 浏览器手动验证**
   - `pnpm --filter web typecheck`（或项目实际命令，先看 package.json）。
   - 启动 dev 开浏览器跑一遍验收标准里的 4 条。

## 追加 vs 覆盖（关键设计决策）

选 **追加**（append），不是覆盖。理由：

- 常见用例是"帮我一起看这 3 个文件的关系"——用户需要把多个文件路径都塞进去，再加一句提示词一次性回车。覆盖会打断这个流程。
- `formatForSession` 的返回值末尾已有空格（`@foo.ts `），追加后天然分隔，不需要额外处理。
- 如果用户不想追加，手动 Ctrl+A 删掉重来，成本低；反向（想要追加但被覆盖掉）更恼人。

**实现**：`queuePendingInput` 是**追加语义**——它把新 text 追加到 store 里的 pending buffer（`prev + text`）。SessionView 消费时用 `inputRef.current.value + pending`（即 input 现有内容 + store 里攒着的 pending）。

边界：如果 SessionView 还没挂载（不可能发生，因为活跃 session 都 mounted），pending 会留在 store 里直到 SessionView 挂载后消费；不会丢。

## 边界情况

- **多个 session 的子菜单**：子菜单里点任意一项，走相同的三连动作（切 tab / 设 activeSession / queuePendingInput），目标 session 各自独立。
- **同一 session 快速连点两次**：store 的 `queuePendingInput` 会把两次 text 追加到 pending，SessionView 的 useEffect 再一次性 flush 到 input。由于 React state 合并 + useEffect 依赖变化触发——两次快点可能触发两次 effect 各追加一次，也可能被合成一次，两种结果等价（都能看到两个路径拼接在一起）。
- **目标 session stopped/crashed**：菜单项本来就 disabled（见 `aliveSessions` 过滤），这条不受影响。
- **项目没有任何 session**：菜单项 disabled，不受影响。
- **跨 project**：右键菜单展示的 `sessions` 已经被 FilesView 的 `aliveSessions()` 按 `projectId` 过滤过，只会看到当前项目的 session，跨项目不会出现在子菜单里。
- **pending 已经在 store 但目标 SessionView 尚未首次渲染**：SessionView 组件对所有未 stopped session 都是挂载的（`active={false}` 时只是隐藏），useEffect 会触发。不存在"丢注入"的风险。

## 风险与注意

- **假设**：所有非 stopped/crashed 的 SessionView 都保持挂载状态（从现有代码里 L164-168 的注释和父组件逻辑推断；若实际父组件是按 active 条件渲染而非隐藏，注入会丢）。**需要在步骤 2 动手前先扫一眼渲染父组件**（大概率是 `packages/web/src/components/terminal/` 下的 SessionsView 或 App）确认这点；如果假设错，fallback 是把 pendingInput 放在 store 里直到组件 mount 后的第一次 render 才消费（本方案已经是这样，自然兼容）。
- **假设**：`useStore.getState()` 在模块顶层访问 zustand store 是项目现有惯例（`fileContextMenu.ts` 本身已经 L127 这么用过，稳）。
- **日志规则**：按 CLAUDE.md 的"操作日志规则"——这次修改"影响用户行为的 UI 操作"，触发起止日志要求，必须包一层 `logAction`。原代码没包，是旧帐；本次顺手补上。
- **回归风险低**：只改了 3 个文件，没有动后端、没有动 WS 协议、没有动 xterm 配置。

## 相关文件索引

- `packages/web/src/components/fileContextMenu.ts`（改 L78-96）
- `packages/web/src/components/terminal/SessionView.tsx`（加 useEffect，约 L383 附近的 `fillInput` 保持不变）
- `packages/web/src/store.ts`（加 state 字段 + 2 个 action）
- `packages/web/src/components/sidebar/FilesView.tsx`（只读，不改；调用侧不变）

## 扩展范围（2026-04-24，用户追加）：Dev Docs 派 Claude 走同款路径

用户指出：Dev Docs 里"派 Claude 继续任务"等派发也应复用"在已有 claude session 里注入输入框"的路径——而不是当前的"无条件新开 claude + 剪贴板 + 弹对话框要求手动 Ctrl+V"。

**覆盖的 3 个入口**（全在 `DocsView.tsx`）：
1. 任务列表右键 → "派 Claude 继续任务"（L336）
2. 问题 tab 单条问题 🤖 按钮（L627）
3. 问题 tab "派全部 (N)" 按钮（L382）

这三处都走同一 `runDispatch → dispatchClaude`（`dispatchClaude.ts`）。改 `runDispatch` 即可一次覆盖三处。

**新行为**：
- 先在项目下找存活的 claude session：优先 `activeSessionIdByProject[projectId]`（若它恰好是存活 claude），否则第一个存活 claude
- 找到 → 走与 fileContextMenu 一致的 `sendToSession`（切 tab + `queuePendingInput`），**不弹对话框**（用户看到 input 聚焦 + 文本已填就明白了）
- 找不到 → **退回现有 `dispatchClaude`**（新开 + 剪贴板 + 对话框），不倒退体验

**同项目多 claude session 的选择**：自动选，不弹子菜单。理由：顶部"派全部"和单条 🤖 是普通按钮没有子菜单 UX，强行加子菜单三处实现会不一致；`activeSessionIdByProject` 提供了隐式控制——用户最近用的那个 claude 就是默认目标。

**HtmlPreview 的直发模式**（`HtmlPreview.tsx:106-130`）**不动**：那里是"把 HTML 喂 AI 分析"的专用路径，当前直接提交带回车是预期行为。

### 实施：抽 `sendToSession` helper 到新文件

两个 caller（fileContextMenu + DocsView）触发"抽公共 helper"的阈值。新建 `packages/web/src/sendToSession.ts`，导出：
- `sendToSession(projectId, target, text, opts?)` — 统一入口（切 tab + queuePendingInput + logAction 埋日志）
- `pickClaudeTarget(projectId)` — 找存活 claude session 的选择逻辑，返回 target 或 null

fileContextMenu.ts 删除本地 helper，改 import；DocsView.tsx 的 `runDispatch` 用 `pickClaudeTarget` + `sendToSession` / fallback `dispatchClaude`。

### 扩展的验收标准

同原验收外，补：

5. Dev Docs 问题 tab 下，有活跃 claude session 时点单条 🤖：不弹粘贴对话框，工作区自动切到那个 claude 的 tab，input 里填上问题 prompt。
6. 同上点"派全部 (N)"：所有问题拼成的大 prompt 填进 claude input（超长会触发 `PASTE_STASH_THRESHOLD` stash 机制）。
7. 任务列表右键"派 Claude 继续任务"，目标行为同 5。
8. **没有存活 claude session** 的项目下点上述 3 处入口：退回原体验——新开 claude session + prompt 进剪贴板 + 弹对话框提示 Ctrl+V。
9. LogsView 可见 `scope=docs action=send-to-session` 的起止配对（区分于 files 来源的日志）。
