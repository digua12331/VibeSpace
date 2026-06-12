# 非AI终端去掉AI输入框 · 任务清单

- [x] 1. 组件内算 `isShellAgent`，xterm 构造 `disableStdin: !isShellAgent` → verify: 类型检查过，cmd 终端能直接打字回车
- [x] 2. 键盘 handler shell 分支：粘贴/复制/Ctrl+C 之后 `return true` 放行其余按键 → verify: cmd 里方向键/退格/回车/Ctrl+C 正常，AI 终端不受影响
- [x] 3. JSX：快捷按钮行 + 悬浮输入框加 `!isShellAgent`；termHost bottom 对 shell 设 0 → verify: cmd 页签底部无输入框/按钮且终端占满，claude 页签照旧
- [x] 4. active 时对 shell 终端 `term.focus()` → verify: 切到 cmd 页签直接可打字
- [x] 5. `pnpm -F @aimon/web build` → verify: 构建/类型检查成功
