# 终端复制粘贴与右键菜单 · 任务清单

- [x] 1. 在 `SessionView.tsx` 顶部 import 里追加 `openContextMenu` + `ContextMenuItem`，并新增 `inputRef: useRef<HTMLInputElement | null>(null)`；`<input>` 绑定 `ref={inputRef}` → verify: `pnpm --filter @aimon/web build` 通过；现有输入框仍可输入 & 回车发送。
- [x] 2. 在 `handleClipboardPaste` 附近新增模块级 helper `copySelectionToClipboard(term)`：读 `getSelection()`，空则直接 return；写剪贴板（`writeText` + `<textarea>/execCommand` 降级）；最后 `clearSelection()` → verify: tsc 通过；单独调用时剪贴板确实写入、高亮清除（验收时通过 V1 间接验证）。
- [x] 3. 扩展 `attachCustomKeyEventHandler`：新增 Ctrl/Cmd+C 分支（`!alt && !shift && (key==='c'||'C')` 且 `term.hasSelection()`），命中则 `preventDefault()` + `void copySelectionToClipboard(term)` + `return false`；不命中一概 `return true` → verify: V1 (Ctrl+C 有选区→剪贴板有内容、无 ^C、选区清除)；V2 (无选区 Ctrl+C→SIGINT 正常，`ping 127.0.0.1 -t` 能被打断)；V3 不回归 (Ctrl+V 图片/文本粘贴仍 OK)。
- [x] 4. 新增模块级 `buildTerminalSelectionMenu(selection, onCopy, onAppendToInput): ContextMenuItem[]`，两项：`📋 复制` → `onCopy()`；`➕ 添加到终端聊天` → `onAppendToInput(selection)` → verify: tsc 通过。
- [x] 5. 改写 `termHostRef` 的 `onContextMenu`：`preventDefault()`；若 `termRef.current?.hasSelection()` → `openContextMenu({ x: e.clientX, y: e.clientY, items: buildTerminalSelectionMenu(term.getSelection(), onCopy, onAppendToInput) })`，其中 `onCopy = () => void copySelectionToClipboard(term)`，`onAppendToInput = (sel) => { setInputValue(prev => prev ? prev + ' ' + sel : sel); queueMicrotask(() => { const el = inputRef.current; if (!el) return; el.focus(); const len = el.value.length; el.setSelectionRange(len, len) }) }`；否则保留原"读剪贴板 `term.paste`"路径 → verify: V4 (选中右键→菜单两项)；V5 (点复制→剪贴板对 & 选区清)；V6 (点添加→输入框内容正确拼接 + 焦点在末尾 + 未回车)；V7 (无选区右键→老行为粘贴)。
- [x] 6. 跑类型检查 `pnpm --filter @aimon/web build`，确认 tsc -b 无错；浏览器里 dev server 过 V1-V7 一遍 → verify: V8 ✅ build 绿（见回复终端日志）；V1-V7 代码侧已实现，**待用户在浏览器里观察验证**（agent 无法操控 UI）。

## 备注

- 所有改动集中在 `packages/web/src/components/terminal/SessionView.tsx` 单文件。
- 不改 `ContextMenu.tsx` / `fileContextMenu.ts`。
- 熔断：任意单步 verify 连续失败 2 次，停手汇报。
