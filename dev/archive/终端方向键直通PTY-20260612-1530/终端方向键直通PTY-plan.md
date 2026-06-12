# 终端方向键直通 PTY · Plan

> memory 扫过：auto.md 仅一条 hook 冒烟（无关）；manual.md 的"小功能跳流程"我判断不适用（涉及键盘事件分发核心、影响所有 session 所有按键、错了会让打字交互断掉）。

## 背景

`packages/web/src/components/terminal/SessionView.tsx` 在 xterm 上挂了 `attachCustomKeyEventHandler`：

- xterm 构造时 `disableStdin: true`，PTY 不再直接收键（第 229 行）。
- 可打印单字符（`isPrintable`，第 291–297 行）→ `forwardCharToInput`，进悬浮 textarea，焦点切走。
- **其他键（↑/↓/←/→/Enter/Tab/Esc/Backspace/Function …）一律 `return false` 屏蔽**（第 298–300 行）。
- PTY 唯一进数据通道 = 悬浮 textarea 按 Enter 提交，`aimonWS.sendInput(session.id, payload + '\r')`（第 662–667 行）。

后果：xterm 区域里跑的 TUI 程序（Claude Code 自身的 `AskUserQuestion` 菜单、`codex:setup` 选项菜单、未来可能的 less / nano / npm prompt 等）拿不到导航键，鼠标也不参与，菜单就成了"摆设"。今天用户跑 `codex:setup` 选项菜单选不动，根因就是这个。

## 目标

让终端区在**悬浮输入框为空且不被 focus** 的状态下，把一组"TUI 导航键"透传给 PTY（通过 `aimonWS.sendInput` 发对应 ANSI 序列），让 TUI 菜单能用键盘控制；同时保持现有的"打字进悬浮框"行为不被破坏。

### 可验证的验收标准（含浏览器可观察项）

- **A · 关键路径**：在浏览器里打开任意 session（claude / codex 都行），让它跑出一个交互式选项菜单（最简的：让 Claude 自己在那个 session 里跑 `/codex:setup` 触发 `AskUserQuestion`，或运行 `npm init` 类有 prompt 的命令）。能：
  - 按 ↑/↓ **看到菜单里高亮项移动**（DOM/canvas 视觉确认，不只是控制台没报错）；
  - 按 Enter **选中当前高亮项**，菜单按预期推进。
- **B · 输入框里 ↑/↓ 不被劫持**：在悬浮 textarea 里输入 "abc"（不为空），把焦点保持在 textarea，按 ↑/↓ → 光标在 textarea 内部移动（浏览器原生行为），**不会**被发到 PTY。
- **C · 退化保护**：把焦点放回终端区（点一下终端正文），打字 "hello"，依旧进入悬浮 textarea（不应改动 `forwardCharToInput` 路径）。
- **D · IME 兼容**：开中文输入法在终端区敲拼音，候选词的方向键选择不会异常发到 PTY。
- **E · 操作日志**：在 LogsView 里能看到 `scope=session action=tui-passthrough` 的 INFO（首次透传时一次性记录，不要逐键打）；故意触发一次失败分支（见下方"日志规则"）能看到 ERROR。

A、B、C、D 全部通过才算 verify 通过。

## 非目标 (Non-Goals)

- 不做 UI 切换按钮（先前讨论过的方案 B），保持自动判定。
- 不改 `disableStdin: true`，避免一刀切让所有打字旁路 `forwardCharToInput`。
- 不动 Ctrl+V / Ctrl+C 现有处理。
- 不支持 xterm 的 Application Cursor Mode（`\x1bOA` 那套）—— 当前 TUI 场景（Claude Code menu、npm prompt）默认 Normal Mode 够用；真遇到再补。
- 不实现"在终端按 ↑ 翻 textarea 输入历史"之类新功能。

## 实施步骤

1. **在 `SessionView.tsx::attachCustomKeyEventHandler` 加 TUI 透传分支**：
   - 在 `isPrintable` 分支**之前**插入"TUI key passthrough"判断；
   - 守卫条件全部满足才透传：
     - `!ev.isComposing && ev.keyCode !== 229`（IME 不在 compose）；
     - `inputRef.current?.value === ''`（悬浮框为空）；
     - `document.activeElement !== inputRef.current`（焦点不在悬浮框）；
     - 按键命中下表（白名单）。
   - 命中则 `ev.preventDefault()` + `aimonWS.sendInput(session.id, seq)` + `return false`；不命中走原来的 `return false` 全屏蔽。
   - **白名单与 ANSI 序列**（Normal Mode）：

     | key            | seq        |
     | -------------- | ---------- |
     | ArrowUp        | `\x1b[A`   |
     | ArrowDown      | `\x1b[B`   |
     | ArrowRight     | `\x1b[C`   |
     | ArrowLeft      | `\x1b[D`   |
     | Enter          | `\r`       |
     | Tab            | `\t`       |
     | Escape         | `\x1b`     |
     | Backspace      | `\x7f`     |
     | Home           | `\x1b[H`   |
     | End            | `\x1b[F`   |
     | PageUp         | `\x1b[5~`  |
     | PageDown       | `\x1b[6~`  |

   - **verify**：浏览器跑 `codex:setup` → ↑/↓ 高亮项移动 + Enter 选中（验收标准 A）。
2. **守卫退化测试**：
   - textarea 不为空 + 焦点在 textarea：验证 ↑/↓ 不透传（验收标准 B）。
   - 终端区打字依旧走悬浮框（验收标准 C）。
   - **verify**：手动在浏览器里复现以上三种 case，逐一观察。
3. **操作日志埋点**：
   - 由于键盘事件高频，**不要逐键打日志**（属于 CLAUDE.md 操作日志豁免名单里的"轮询/心跳"性质）。
   - 在每个 SessionView 实例的生命周期里，**首次触发透传时**记一条 INFO（用 ref 做幂等），格式：`serverLog/pushLog → scope='session', action='tui-passthrough-enabled', meta={ key }`。这样 LogsView 能看到"这个 session 在用 TUI 透传"，失败排障时知道走没走这条路径。
   - `aimonWS.sendInput` 自身一般不抛（它是 fire-and-forget），如果未来抛了用 try/catch 打 ERROR + 不阻断按键。
   - **verify**：浏览器开 LogsView，触发一次透传按键，看到 `tui-passthrough-enabled` INFO；多次按只打一次（幂等）（验收标准 E）。
4. **类型检查与本地构建**：
   - `pnpm -F @aimon/web typecheck`（或项目里实际命令）通过；
   - `pnpm -F @aimon/web build` 不引入新 warning。
   - **verify**：命令输出 0 退出码。

## 边界情况

- **IME 输入态**：Chrome 在 IME compose 时 `keydown` 的 `key` 可能是各种字符或空，`keyCode === 229` 是稳定标记；同时 `ev.isComposing` 也要检查。两者任一为真就**不透传**，让 IME 拿走。
- **textarea 已 focus 但内容为空**：守卫里"焦点不在悬浮框"先于"内容为空"判断。用户清空了输入但还停在 textarea 想打字，按 ↑/↓ 应该是 textarea 内部行为（虽然空内容里 ↑/↓ 没视觉效果），不应该被劫持去 PTY。
- **同时多 session**：每个 SessionView 是独立组件实例，`session.id` 闭包在 handler 里，事件路由正确。
- **xterm 选区**：透传 Enter 时不影响 xterm 的鼠标选区（xterm 的选区是渲染层状态，不依赖键盘事件）。
- **dead session**：`isDead` 时悬浮 textarea 已 `disabled`，但终端 handler 仍挂着。透传 Enter 给死掉的 PTY 没意义但也无害（`sendInput` 走 WS，会被后端忽略）。
- **codex/gemini 这类 AI 终端进了 Application Cursor Mode**：白名单走 Normal Mode 序列，可能 ↑/↓ 不被识别。本轮不修，留观察。

## 风险与注意

- **ANSI 序列正确性是首要风险**：手写 12 个映射，写错一个就一类按键不工作。要在浏览器里逐键实测一遍，不能只跑命令验证。
- **xterm 自有 keymap 被绕过**：我们没用 xterm 内置的 `evaluateKeyboardEvent`，而是手写映射。如果将来要支持 Application Mode、修饰键组合（Shift+Tab、Ctrl+Arrow）等，得替换成调用 xterm 的内部映射或自己扩白名单。本轮先小白名单。
- **守卫顺序**：先 IME → 焦点 → 内容为空 → 白名单。任意一环 false 就走"原全屏蔽"分支，不能误触发 fallthrough 到 `forwardCharToInput`（那条只接可打印字符）。
- **假设：Claude Code 的 `AskUserQuestion` 菜单跑在 PTY 子进程里、走标准 stdin。** 如果它实际是 Claude Code 渲染层自己拦截 stdin 之外的渠道（比如 IPC），那透传 PTY 也救不了它。这点开工前先在 codex:setup 那个具体场景里手动确认一下：用临时改一行 `disableStdin: false` 跑实验，看 ↑/↓ 是否能直接驱动菜单。这是 plan/context 之间的"已知未知"，写到 context 里去定夺。
- **回滚路径**：单点改动集中在 `SessionView.tsx::attachCustomKeyEventHandler` 内一个新增分支，回滚 = 删该分支即可，不影响其它路径。
