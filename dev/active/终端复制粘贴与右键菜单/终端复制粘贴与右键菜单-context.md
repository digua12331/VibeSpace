# 终端复制粘贴与右键菜单 · Context

## 关键文件

唯一需要改的文件：

- **`packages/web/src/components/terminal/SessionView.tsx`**（顶级组件默认导出）
  - L142-149：既有 refs + states（`termHostRef`, `termRef`, `fitRef`, `inputValue`）。**需要新增**：`inputRef: useRef<HTMLInputElement | null>(null)`。
  - L200-211：`term.attachCustomKeyEventHandler` —— 当前只处理 Ctrl+V。**需要新增 Ctrl+C 分支**（放在 Ctrl+V 分支之前或之后都行，互斥 key）。
  - L328-334：`onInputKey` —— 不动。
  - L436-449：`termHostRef` 绑定的 `<div>`，`onContextMenu` 是"读剪贴板 → `term.paste`"。**需要改写** 为：有选区弹菜单；无选区保持原行为。
  - L453-461：底部输入框 `<input>`。**需要新增** `ref={inputRef}`。
- **新增** 两个模块级 helper（写在 `SessionView.tsx` 里 `handleClipboardPaste` 附近，不放到 `fileContextMenu.ts`）：
  - `copySelectionToClipboard(term: Terminal): Promise<void>`：读 `term.getSelection()`；空串 no-op；`navigator.clipboard.writeText` 失败时走 `<textarea>+execCommand('copy')` 降级（原样照抄 `fileContextMenu.ts` L38-55 的 8 行，不共享源）；最后 `term.clearSelection()`。
  - `buildTerminalSelectionMenu(selection, onCopy, onAppendToInput): ContextMenuItem[]`：返回两项。参数传 callback，不传 state setter，这样 helper 不绑死 React 层。

不碰的文件：

- `packages/web/src/components/ContextMenu.tsx` —— 直接消费 `openContextMenu` + `ContextMenuItem` 类型，不扩 API。
- `packages/web/src/components/fileContextMenu.ts` —— 不加 export，不改签名。剪贴板降级逻辑复制 8 行，低于"抽一个共享 util"的门槛（一次复用 ≠ 抽象）。

## 决策记录

### D1：helper 本地化，不抽共享 util

plan 曾提示"和 `fileContextMenu.ts` 相同的降级路径"。我选**复制 8 行 `<textarea>+execCommand` 代码**，不 export `copyToClipboard`。理由：

- 只两处调用（本文件的 Ctrl+C、菜单"复制"项），抽到公共模块属于"只用一次的抽象"。
- `fileContextMenu.ts` 的 `copyToClipboard(text)` 签名是"写任意文本"，终端这边写"读 term 选区 + 清选区"，语义已经不同，强行共享反而会把 clearSelection 这种终端特有逻辑塞进公共函数。
- 资深工程师视角：8 行 vs. 一次跨文件 export + import + 两侧心智成本，复制更便宜。

### D2：菜单项的回调用 closure，不做 ref 化 setter

plan 步骤 4 提到"用 ref 化的 setter 避免 stale closure"。复核后**放弃 ref 化**，理由：

- `onContextMenu` 是 JSX 内联 attribute → 每次 render 重建 → 每次右键调用 `buildTerminalSelectionMenu` 时 closure 是当轮最新的。
- `ContextMenu.tsx` 的 `invoke` 走 `queueMicrotask` 即刻触发 `onSelect`，在 menu 打开到点选之间 React 可能又 render 过，但 closure 捕获的 `setInputValue`（setter 身份稳定）和 `termRef.current` 都没有 stale 语义问题。
- 引入 ref 纯属防御不存在的场景，属于"没人要求的灵活性"，砍掉。

### D3：Ctrl+C 无选区时彻底不干预

`attachCustomKeyEventHandler` 里，只有 `ctrl/meta+c + !alt + !shift + hasSelection()` 全部满足才拦截并复制；任一条件不满足就 `return true`，让 xterm 原样处理（发 `0x03`）。**不**在 handler 里做 `clearSelection()` / `preventDefault()` 等"顺手动作"——会破坏 V2 验收（无选区按 Ctrl+C 应产生 SIGINT）。

### D4：菜单图标沿用 fileContextMenu 风格

"复制"用 `📋`（与 `fileContextMenu.ts` L129 一致）；"添加到终端聊天"用 `➕`。这是纯视觉一致性，不值得再开会议。

### D5：不处理选区中的 `\n`

追加到 `<input>` 时换行会被 DOM 规范化（多数浏览器替换为空格）。plan 已在 Non-Goals 里接受这一点，此处不做预处理。如验收时发现视觉违和再回来补一个 `.replace(/\r?\n/g, ' ')`。

## 依赖与约束

- **xterm API**：`term.hasSelection()`, `term.getSelection()`, `term.clearSelection()` —— `@xterm/xterm` 5.x 内置，已在 `.d.ts` L1162-1178 确认。
- **剪贴板**：`navigator.clipboard.writeText` 在 localhost / HTTPS 可用；HTTP 非 localhost 降级 `execCommand('copy')`（已废弃但所有主流浏览器仍支持）。失败**静默**，不 alert。
- **React 受控 input**：`setInputValue(prev => prev ? prev + ' ' + sel : sel)` 保证并发多次点"添加到终端聊天"时不丢内容（函数式更新，不依赖闭包里的 `inputValue`）。
- **焦点时序**：`setInputValue` 触发 re-render 后 DOM 才有最新 value；`queueMicrotask` 里的 `focus()` 调用在 React 提交阶段之后执行（React 17+ 的 microtask 调度下成立），`setSelectionRange(len, len)` 时 `inputRef.current.value.length` 已经是新值。若观察到光标在更新前的末尾，改用 `requestAnimationFrame`。
- **无新依赖**。
- **改动体量预估**：SessionView.tsx `+60~70`/`-10` 行；单文件。
