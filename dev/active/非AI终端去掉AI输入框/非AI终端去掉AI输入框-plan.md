# 非AI终端去掉AI输入框 · plan

## 大哥摘要
现在不管是 AI 终端还是普通 cmd/PowerShell 脚本页签，底部都挂着一个给 AI 用的输入框和一排彩色按钮（清除/历史对话/ok/继续/提交 github 等）。这次把**非 AI 终端**（cmd、PowerShell、shell、一键启动脚本的 bat 页签）底部那一套全部去掉，让它们变回普通命令行窗口——点一下黑色终端区域就能**直接敲命令、回车执行**（脚本中途问 Y/N 也能直接按），跟系统自带的 cmd 窗口一样。AI 终端（claude/codex/gemini 等）完全不动。不会动到任何数据或现有 AI 终端的用法。

## 目标
- 非 AI 终端（agent ∈ {shell, cmd, pwsh}）：
  1. 底部悬浮输入框（`> type to send` 那个长条）不再渲染。
  2. 输入框上方那排彩色快捷按钮不再渲染。
  3. 终端画面本身可直接键盘输入（打字、回车、方向键、退格、Ctrl+C 中断都走真实终端）。
  4. 终端区域占满整个高度（不再给已删掉的输入框留底部空白）。
- AI 终端（其余 agent）：行为 100% 不变（保留只读 xterm + 悬浮输入框 + 按钮 + TUI 透传）。

### 验收标准（浏览器可观察）
1. 用「+」菜单起一个 **cmd / PowerShell** 终端：底部**没有**输入框和彩色按钮；点一下终端黑区，直接键入 `echo hello` 回车，能看到输出。
2. 项目列表点「一键启动脚本」起的 bat 页签：底部同样没有输入框/按钮，终端占满高度。
3. 起一个 **claude** 终端：底部输入框和彩色按钮**照旧都在**，打字/斜杠菜单/@文件/Enter 发送都正常。
4. 非 AI 终端里 Ctrl+C 能中断正在跑的命令，Ctrl+V 能粘贴，选中文本右键能复制。

## 非目标
- 不改后端 PTY、createSession、agent 种类定义。
- 不改 AI 终端的任何输入/按钮/TUI 透传逻辑。
- 不为非 AI 终端做"发送到 session""提示词库"这类 AI 专属入口的适配（它们对普通终端没意义，缺了不算 bug）。

## 实施步骤
1. SessionView 里算一个 `isShellAgent`（agent 是否属于 BUILTIN_SHELL_AGENTS）。验证：类型检查过。
2. xterm 构造时 `disableStdin: !isShellAgent`——非 AI 终端放开直接键盘输入。验证：cmd 终端能直接打字。
3. 自定义键盘 handler 里，shell 分支在处理完粘贴/复制/Ctrl+C 后 `return true`，让其余按键直达 xterm，不走"转发到悬浮输入框"那套。验证：方向键/退格/回车在 cmd 里正常。
4. JSX：快捷按钮行和悬浮输入框两块都加 `!isShellAgent` 条件；termHost 底部留白对 shell 设为 0。验证：cmd 页签底部干净、终端占满。
5. 进入 active 时对 shell 终端自动 focus，省去每次手点。验证：切到 cmd 页签直接能打字。
6. `pnpm -F @aimon/web build` 通过。

## 边界情况
- 已结束（stopped/crashed）的非 AI 终端：本来就没东西可输入，去掉输入框后保持只读展示即可，不报错。
- 文件右键「发送到 session」指向一个非 AI 终端时：无输入框，pendingInput 注入会静默 no-op（已有 `if (!el) return` 守卫），不崩。
- IME 中文输入：shell 走 xterm 原生隐藏 textarea 的 IME 路径，不受影响。

## 风险与注意
- 唯一能打字的入口从"悬浮输入框"切到"xterm 直连"，必须保证 `disableStdin:false` + 既有 `term.onData → sendInput` 链路对 shell 生效，否则非 AI 终端会变成完全打不了字。验收第 1 条专门覆盖。
- 不能误伤 AI 终端：所有改动都用 `isShellAgent` 网关隔离。

## 多模型 Plan 会审
小档任务（改动集中在单文件 SessionView.tsx，方向已与大哥当面确认），按工作流跳过双模型会审。
