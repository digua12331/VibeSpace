# 终端方向键直通PTY · 任务清单

- [x] 步骤 1 在 `packages/web/src/components/terminal/SessionView.tsx` 加 `passthroughLoggedRef = useRef(false)` 幂等标记，紧挨现有 ref 群（约 196–204 行）→ verify: `pnpm -F @aimon/web build` 通过（确认 ref 类型正确）
- [x] 步骤 2 在同文件 `attachCustomKeyEventHandler` 内、`isPrintable` 分支之前，插入"TUI passthrough"分支：守卫（IME → 焦点 → textarea 为空 → 白名单 12 键）+ `aimonWS.sendInput(session.id, ANSI 序列)` + 首次触发幂等 `pushLog(level=info, scope=session, action=tui-passthrough-enabled)` → verify: `pnpm -F @aimon/web build` 通过（无 TS 报错、无新 warning）
- [ ] 步骤 3 浏览器验收 A：`pnpm -F @aimon/web dev` 启动，开任意 session 跑出一个 TUI 选项菜单（最简：在该 session 里跑 `npm init`，停在 "package name" 这种 prompt，或在 Claude Code session 跑 `/codex:setup` 触发 4 选项菜单），按 ↑/↓ 看到高亮项移动，按 Enter 选中推进 → verify: 视觉确认菜单响应键盘
- [ ] 步骤 4 浏览器验收 B/C/D：B 在悬浮 textarea 里输入 "abc" 保持焦点按 ↑/↓，光标在 textarea 内移动不进 PTY；C 焦点切回终端区打字 "hello" 进入悬浮框（forwardCharToInput 路径仍 work）；D 中文 IME compose 状态下方向键不透传 → verify: 三种 case 逐一手动复现观察
- [ ] 步骤 5 浏览器验收 E：开 LogsView，触发一次方向键透传，看到一条 `scope=session msg=tui-passthrough-enabled 开始` INFO；连按多次方向键，LogsView 里**只有一条**该消息（幂等） → verify: LogsView 截屏/计数确认
