# 终端方向键直通 PTY · Context

## 关键文件

- `packages/web/src/components/terminal/SessionView.tsx`
  - **唯一源码改动点**：`attachCustomKeyEventHandler`（第 265–301 行）。在 `isPrintable` 分支（第 289 行注释处）**之前**新增 "TUI passthrough" 分支；其它分支不动。
  - 守卫要用到的 ref：`inputRef`（第 196 行，已存在）。
  - 新增一个组件级 ref `passthroughLoggedRef = useRef(false)`，做"首次透传打 INFO"的幂等标记。位置紧挨现有 ref 群（第 196–204 行）。
- `packages/web/src/logs.ts`
  - 复用 `pushLog`（第 21 行）。**不用 `logAction`** —— 按键不是 async mutation，套 logAction 会强行配 start/end 起止对，语义不符。
- `packages/web/src/ws.ts`（不改，仅引用）
  - `aimonWS.sendInput(sessionId, data)` 已是 fire-and-forget 入口，把字符串原样发到后端 PTY。
- 边界外（绝不动）：xterm 构造选项（`disableStdin: true`）、Ctrl+V/C 处理、`forwardCharToInput`、`onInputKey` / `onInputChange` / `onInputPaste` 这些 textarea 内部交互。

## 决策记录

> 每条都过了一遍 "资深工程师会不会觉得过度设计" 的尺。

1. **手写 12 键 ANSI 白名单，不调 xterm 内部 keymap。**
   - 理由：xterm 没把 `evaluateKeyboardEvent` 公开导出，hack 内部模块属于"未要求的灵活性"。当下 TUI 场景固定（菜单导航、Enter 选择、Esc 取消、Tab 切换、Backspace 删字），12 键足够。要支持 Shift+Tab / Ctrl+Arrow / F1–F12 时再扩。
   - 不做：`evaluateKeyboardEvent` 反射调用、动态从 xterm option 读 keymap、自己实现 Application Cursor Mode 切换。

2. **守卫顺序：IME → 焦点 → textarea 为空 → 白名单。**
   - IME 优先是因为 compose 期间任何 `key` 含义都不可信；
   - 焦点其次是用户意图最强的信号（焦点在 textarea 就明确归 textarea）；
   - 内容为空是辅助护栏（焦点不在但用户刚打了字想用 ↑ 翻光标？这种行为本来就没有，留着是为了"宁可不透传也别误触"）。
   - 任一环 false 直接走原 `return false` 全屏蔽，**不能 fallthrough 到 `forwardCharToInput`**（那条只接可打印字符）。

3. **不支持 Application Cursor Mode。**
   - 当前已知 TUI 场景（Claude Code AskUserQuestion、codex setup、npm prompts 这类 inquirer 系）默认 Normal Mode；vim / less / btop / fzf 这种重 TUI 才会切 App Mode。本仓库没人在 session 里跑那些。
   - 真碰上再补：加一个 ref 跟踪 PTY 输出里的 `\x1b[?1h` / `\x1b[?1l` 模式切换序列，按当前模式选 `\x1b[A` 或 `\x1bOA`。本轮不做。

4. **日志策略：每 session 实例首次透传打一次 INFO，幂等；不打逐键日志；不打 ERROR。**
   - 幂等：组件内 `passthroughLoggedRef.current` 第一次为 false → `pushLog` + 翻 true。session 重启会换新 ref（组件重挂），自然重置。
   - 不逐键：键盘事件高频，逐键打会瞬间淹没 LogsView 的 500 条上限；属于 CLAUDE.md 操作日志规则里"轮询/心跳"豁免性质。
   - 不打 ERROR：`aimonWS.sendInput` 是 fire-and-forget 不抛错（已读 ws.ts 确认），**plan 里"故意触发 ERROR 验证"的验收 E 写过头了，删掉**；验收 E 改为"LogsView 看到一条 `tui-passthrough-enabled` INFO，多次按键不会重复打"。
   - scope 用 `'session'`（与 SessionView 已有 logAction 调用一致），action 用 `'tui-passthrough-enabled'`，meta 带首次触发的 `key` 名称。

5. **不改 `disableStdin: true`。**
   - 改 false 会让 xterm 自己产生 `onData` 事件 → 已挂的 `term.onData` 把所有打字直送 PTY，绕开 `forwardCharToInput`。"打字进悬浮框"的核心不变量会塌。
   - 透传分支显式 `aimonWS.sendInput(...)` + `return false`，路径单一互斥，回滚干净。

6. **关于 plan 里那个"已知未知"——不再做 disableStdin 临时实验。**
   - 判断：Claude Code 的 `AskUserQuestion` 菜单一定吃 PTY stdin。证据：截图里它是 ANSI 文本（不是 DOM/React 组件）和 `codex setup --json` 的 stdout 同处一片输出区，`"Enter to select · ↑/↓ to navigate"` 字样是 inquirer/prompts 系 TUI 标志；xterm 里的内容只能来自 PTY，对应它读的 stdin 也只能是 PTY。
   - 实施第一步做完直接进浏览器验 A；万一不通过再回头查 —— 比"先做实验再做 plan"省一轮。

## 依赖与约束

- **xterm v6.0.0** + `@xterm/addon-*` 一系列：`attachCustomKeyEventHandler` 在 v3 后稳定，本轮调用方式不变。
- **WS 协议**：`aimonWS.sendInput(sessionId: string, data: string)` 已存在，后端原样写 PTY；不需要协议改动。
- **类型检查 / 构建命令**：仓库根 `package.json` 没找到 `typecheck` 单独脚本；`packages/web/package.json` 有 `"build": "tsc -b && vite build"`，类型检查走构建。
  - 验收命令：`pnpm -F @aimon/web build`（含 tsc 类型检查），退出码 0 视为通过。
  - 开发预览：`pnpm -F @aimon/web dev`，浏览器 http://localhost:5173 打开。
- **不引入新依赖**。
- **不改 React/store/zustand 状态形状**，组件级 ref 即可。
- **TS 严格模式**：`ev.key` 是 `string`，`ev.isComposing`/`ev.keyCode` 在 `KeyboardEvent` 上类型已有；不需要 cast。
- **isComposing 的浏览器差异**：Chrome/Edge `isComposing === true` + `keyCode === 229` 双保险；Firefox 同。Safari 已知偶尔 `isComposing` 为 false 但 `keyCode === 229`，所以保留 keyCode 兜底。

## 改动边界

本轮**只改 `SessionView.tsx` 一个文件**：

- 新增一行 `useRef`（≤ 3 行）；
- 在 `attachCustomKeyEventHandler` 内插入透传分支（≤ 25 行）；
- 不动其它任何代码、注释、格式。

预算超出（要溢出到第二个文件）就回头补 context。
