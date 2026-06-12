# 终端复制粘贴与右键菜单 · Plan

## 背景速查

- 文件：`packages/web/src/components/terminal/SessionView.tsx`
- 现状：
  - Ctrl+V 已拦截（行 200-211），走 `handleClipboardPaste`（图片上传或 `term.paste(text)`）。
  - Ctrl+C **未特殊处理**，xterm 默认将其作为控制序列（`0x03`）通过 `term.onData` 送到 `aimonWS.sendInput`，即 SIGINT。
  - 右键（`onContextMenu`，行 438-447）= 读剪贴板文本 + `term.paste`。
  - 底部"type to send"输入框：`inputValue` state（行 145、453-461），回车发送。
  - xterm 提供 `hasSelection() / getSelection() / clearSelection()`（`.d.ts` 行 1162-1178）。
- 已有统一菜单组件：`packages/web/src/components/ContextMenu.tsx`（`openContextMenu` + `ContextMenuItem`），`fileContextMenu.ts` 是现成用法样板。

## 目标

让终端显示区支持以下可在浏览器里直接复现的交互：

1. **Ctrl+C 智能化**
   - 有选区：复制到剪贴板 + 清选区；**不**发送 `0x03`。
   - 无选区：保持现有行为（继续发 SIGINT）。
2. **Ctrl+V 保持不变**（图片粘贴 / 文本粘贴逻辑已 OK）；仅审阅有无新菜单引入的回归。
3. **右键菜单**
   - 选区非空：弹出 `openContextMenu`，两项——
     - `复制`：写剪贴板 + 清选区。
     - `添加到终端聊天`：把选中文本**追加**到底部输入框 `inputValue`（若已有内容，前面加一个空格分隔；空内容直接填入）。聚焦输入框，光标落到末尾，不自动发送。
   - 选区为空：保持现有"读剪贴板 → `term.paste`"行为。

## 验收标准（可在浏览器点出来的行为）

启动 `pnpm dev:web`（或已有的 `pnpm dev:all`），在任意终端 session 里：

- [V1] 跑 `echo hello world`，鼠标选中 `hello`，按 Ctrl+C：
  - 系统剪贴板里是 `hello`（换个地方粘贴验证）；
  - 终端没有出现 `^C`/没有中断当前 shell（验证未发 SIGINT）；
  - 选区被清掉（高亮消失）。
- [V2] 在无选区状态下按 Ctrl+C：
  - 当前进程收到 SIGINT（跑一个 `ping 127.0.0.1 -t` 能被打断；shell 提示符换行）。
- [V3] 复制一段外部文本，在终端里按 Ctrl+V：依旧能粘贴；复制一张图片 Ctrl+V：依旧触发图片上传 + `@<path>` 注入（不回归）。
- [V4] 选中一段文本 → 右键：出现菜单，两项"复制" / "添加到终端聊天"（不是直接粘贴）。
- [V5] 菜单里点"复制"：剪贴板内容正确；选区清除。
- [V6] 菜单里点"添加到终端聊天"：
  - 底部输入框内容变成 `<原有内容 空格>选中文本`（或在空时直接 `选中文本`）；
  - 输入框获得焦点，光标在末尾；
  - 没有自动回车发送。
- [V7] 无选区状态下右键：保持老行为（从剪贴板直接粘贴到 xterm）。
- [V8] 类型检查：`pnpm --filter @aimon/web build` 一次成功（`tsc -b` 无报错）。

## 非目标 (Non-Goals)

- 不改其它地方（文件树、聊天历史、差异列表等）的右键菜单。
- 不引入"选中即复制"（Linux / tmux 风格）。
- 不触碰底部输入框的自身交互（它已有自己的 `onKeyDown`）。
- 不改 `fileContextMenu.ts` / 不扩 `ContextMenuItem` 的 API（直接复用）。
- 不加新依赖。

## 实施步骤（粗粒度）

1. 在 `SessionView.tsx` 顶部为底部输入框加一个 `inputRef`（`useRef<HTMLInputElement>`），便于"添加到终端聊天"后聚焦。
   - *验证*：类型检查通过；现有输入框行为不变。
2. 抽一个本地 helper `copySelectionToClipboard(term)`：读 `term.getSelection()`，走 `navigator.clipboard.writeText` 并带上和 `fileContextMenu.ts` 相同的降级路径（隐藏 `<textarea>` + `execCommand('copy')`），随后 `term.clearSelection()`。
   - *验证*：手工选中 + 调用（先接 Ctrl+C 再看效果）；V1 通过。
3. 扩展 `attachCustomKeyEventHandler`：在现有 Ctrl+V 分支之前加 Ctrl+C 分支——`(ctrlKey || metaKey) && !altKey && !shiftKey && (key === 'c' || 'C')` 且 `term.hasSelection()` 时执行复制 helper 并 `preventDefault` + 返回 `false`；否则保持现有默认（xterm 发 `0x03`）。
   - *验证*：V1、V2 通过。
4. 新增本地函数 `buildTerminalSelectionMenu(selection)` 返回 `ContextMenuItem[]`（两项，不放在 `fileContextMenu.ts` 里，属于终端局部菜单）。"添加到终端聊天"的 handler 用一个 ref 化的 setter（用 `useRef` 包一个 `{ append(text: string): void }`，在组件里用 `useEffect` 填实现），避免 stale closure。
   - *验证*：类型检查通过。
5. 改写 `onContextMenu`：
   - 阻止默认；
   - 如果 `termRef.current?.hasSelection()` 为真：`openContextMenu({ x: e.clientX, y: e.clientY, items: buildTerminalSelectionMenu(term.getSelection()) })`；
   - 否则：保留原"读剪贴板粘贴"的逻辑。
   - *验证*：V4、V7 通过。
6. 实现"添加到终端聊天" handler：`setInputValue(prev => prev ? prev + ' ' + sel : sel)`，然后 `queueMicrotask` 里 `inputRef.current?.focus()` + 将光标移到末尾（`setSelectionRange(len, len)`）。
   - *验证*：V6 通过。
7. 实现"复制"菜单项 handler：复用第 2 步的 helper。
   - *验证*：V5 通过。
8. 跑 `pnpm --filter @aimon/web build`，拿到 V8。在浏览器里过一遍 V1-V7。

## 边界情况

- **Ctrl+Shift+C**：不拦截（VS Code 里是 Dev Tools 打开；xterm 也不会有 'c' key 事件冲突），仍让默认行为生效。只识别无 Shift 的 Ctrl/Cmd+C。
- **剪贴板 API 不可用**（HTTP 非 localhost、iframe 里等）：helper 走 `<textarea> + execCommand` 降级，与 `fileContextMenu.ts` 一致；失败静默，不 alert（避免复制时弹框打断）。
- **选区跨行包含换行**：`getSelection()` 本身就返回文本带 `\n`；"添加到终端聊天"时，换行会被原样追加到 input。不处理（浏览器 `<input>` 会把 `\n` 展示为空格或截断，这是已知限制，在 Non-Goals 里不管）——如验收时看到不合理再回来改为替换 `\n` 为空格。
- **选区极大**：不截断；剪贴板原生就支持大文本，`inputValue` 也只是 React 受控 state，不做保护。
- **右键时菜单还没关就再右键**：`ContextMenu.tsx` 的 `openContextMenu` 是覆盖式的（`sequence++`），原生支持连续调用。
- **Ctrl+C 但选区空**：既不清选区也不碰剪贴板，直接让 `attachCustomKeyEventHandler` 返回 `true`（xterm 会发 `0x03`）。
- **输入框里 Ctrl+C / 右键**：`attachCustomKeyEventHandler` 只作用于 xterm 焦点；`onContextMenu` 也只绑在 termHost 上。不会影响 `<input>` 原生右键。

## 风险与注意

- **假设**：Ctrl+V 的 `attachCustomKeyEventHandler` 注册顺序跟 Ctrl+C 加进去的新分支之间不会互相吞事件——因为它们是 if-else 分支，只拦截各自匹配的组合。
- **假设**：`term.hasSelection()` 在 WebGL 渲染器下正常（早期 xterm 有过 WebGL + selection 的 bug，应该已修复）。若 V1 失败，回退到 DOM 渲染器再测一遍确认。
- **潜在回归**：当前"右键即粘贴"是 Windows Terminal 风格，改成"有选区弹菜单"是**行为变化**——若用户边选边复制，又想立刻粘贴，需要先按 Esc 或点别处清选区再右键。已在 plan 中接受此变化（与 VS Code 终端一致）。
- **不碰**：`fileContextMenu.ts`、`ContextMenu.tsx`——这次只消费它们。
- **不顺手**：不清理无关代码；如果看到死代码按 CLAUDE.md 追加到 `dev/issues.md`。
