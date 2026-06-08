# 非AI终端去掉AI输入框 · context

## 关键文件
- `packages/web/src/components/terminal/SessionView.tsx`（唯一改动文件）
  - L29 已 import `BUILTIN_SHELL_AGENTS`。
  - L61-63 `supportsBracketedPaste` 已用同一集合判断 shell。
  - L366-570 mount effect：`new Terminal({ disableStdin: true })`（L386）、`attachCustomKeyEventHandler`（L414-493）、`term.onData → sendInput`（L495-497）。
  - L621-666 active 切换 effect：fit + WebGL 迁移，可在此加 shell 自动 focus。
  - L671-684 input bar 高度 → termHost.bottom 的联动 effect（bar 为 null 时早返回）。
  - L1273-1376 渲染区：termHost（L1274, 内联 `bottom:124`）、快捷按钮行（L1313 `!isDead &&`）、悬浮输入框（L1357-1375）。
- `packages/web/src/types.ts` L7 `BUILTIN_SHELL_AGENTS = ['shell','cmd','pwsh']`（只读，不改）。
- `packages/web/src/customButtons.ts`：默认按钮已对 shell 把 AI 指令映射成 ''，但本次直接整行隐藏，不依赖它。

## 决策记录
- **用 `isShellAgent` 单一网关**判定非 AI，而不是逐 agent 列举：复用已有 `BUILTIN_SHELL_AGENTS`，新增 shell 类型自动覆盖。资深视角看不过度。
- **shell 直接放开 xterm stdin（disableStdin:false）**而不是另写一个输入框：普通终端本就该直连键盘，复用 xterm 原生输入 + 既有 onData 链路，零新增输入逻辑。
- **Ctrl+C / Ctrl+V / 选区复制对 AI 和 shell 保持同一段代码**：这三个在两类终端语义一致，shell 分支放在它们之后再 `return true`，避免重复实现。
- 不做"发送到 shell 输入框"的兼容、不做 shell 版按钮——非目标，避免过度设计。

## 依赖与约束
- `session.agent` 在单个 SessionView 生命周期内稳定（key=session.id），可在 mount 时一次性决定 disableStdin。
- 高频键盘输入不打操作日志（工作流明确豁免），且本次无新增 mutation API，故不加 logAction/serverLog。
- 静态类型语言：收尾跑 `pnpm -F @aimon/web build` 作类型检查兼构建验收。
