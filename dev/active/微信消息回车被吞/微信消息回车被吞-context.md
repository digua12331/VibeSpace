# 微信消息回车被吞 · Context

memory 扫过：auto.md 相关——"需要点一下立即在终端执行……`sendInput` + 等待"（同一 ink TUI 提交语义问题的前端版）；"终端方向键直通 PTY：非打印键必须显式映射成 ANSI 序列"。

## 关键文件

- `packages/web/src/components/terminal/SessionView.tsx:1038-1051` — 参照实现（不改）：bracketed paste + 16ms 后独立 `\r`。
- `packages/server/src/hub-session.ts` — 新增 `writeHubInput()`。
- `packages/server/src/wechat/inbound.ts:298` — 改用 writeHubInput。
- `packages/server/src/feishu/inbound.ts:154` — 同款 bug，同步修。

## 决策记录

- **共享函数放 hub-session.ts**：该模块本就是"通道无关、供飞书/微信共用"，且已 import ptyManager；不放各通道各留一份（这是行为修复不是文案工具，必须两边一致）。
- **延迟取 50ms 而非前端的 16ms**：后端写入发生在会话刚 spawn 后，ink 状态机更迟钝些；50ms 仍远低于用户感知阈值。
- 不引入"探测输入框是否就绪"的复杂机制——截图证明正文已能落进输入框，问题只在 \r 语义。

## 依赖与约束

- claude (ink) 启用 bracketed paste 模式，`\x1b[200~ ... \x1b[201~` 是终端粘贴标准序列。
- hub 会话 agent 强制 claude，不存在"shell 不识别 bracketed paste"的分支（前端需要分支是因为面向任意 agent）。
- 类型检查：`pnpm -F @aimon/server build`。
- 运行中的部署在 `AIkanban-stable`，修复需同步过去才生效。
