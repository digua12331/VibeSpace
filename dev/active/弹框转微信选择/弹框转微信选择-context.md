# 弹框转微信选择 · Context

memory 扫过：auto.md 相关——"高频键盘事件不要逐条日志，只在关键状态首次触发幂等标记一次"（弹框推送要用指纹去重，避免 Notification 连发刷屏）；"非打印键必须显式映射成 ANSI 序列走 sendInput"（答案写回终端的键位问题）。

## 关键文件

- `packages/server/src/wechat/inbound.ts` — 主战场：
  - `PendingRequest`（L64-69）加 `awaitingChoice` + `promptFingerprint`。
  - `onHubStatusChange`（L96-124）：`waiting_input` 且 pending 时，先判弹框→推送，否则保留原孤儿解锁。
  - `handleInbound`（L214+）：cancel 判定后、pending 闸口前，插入"答案分支"。
  - 新增纯函数 `stripAnsi` / `detectHubPrompt`（放 L29 一带的纯判定区，便于单测）。
  - 需重新 `import { ptyManager }`（上个任务删过，这次要 getBuffer）。
- `packages/server/src/hub-session.ts` — 新增 `writeHubAnswer(sessionId, text)`：raw 文本 + 延迟独立 `\r`（不走 bracketed paste）。
- `packages/server/src/pty-manager.ts:291` — `getBuffer(sessionId)` 读 PTY 原始缓冲（含 ANSI，200KB 上限）。
- `packages/server/src/status.ts:135-143` — Notification → waiting_input 信号源（不改）。

## 决策记录

- **弹框检测用 PTY buffer 扫特征，不靠 Notification 文本**：Notification 的 message 是通用句（"Claude needs your permission"），不含选项；选项在终端缓冲里。扫尾部 20 行找 `❯`/`1. 2.`/`(y/n)`/`Do you want|trust`/`是否`。这是启发式，先覆盖最常见几种框，不追求全覆盖（资深视角：穷举所有 TUI 框样式属过度设计）。
- **答案写回用 raw + 延迟 \r，不用 bracketed paste**：bracketed paste 是给 claude 主输入框的文本提交修的；选择框（ink select）对"敲数字直接跳选项"更友好，paste 包裹反而可能被当文本。两条路径语义不同，各用各的。
- **指纹去重**：同一弹框 Notification 可能连发；用归一化的选项行做指纹，相同则不重复推。
- **只接微信，不接飞书**：微信有 pending 单请求闸口（天然知道"当前这条在等谁回答"），飞书没有同款结构。不为飞书顺手造一套（YAGNI）。
- **waiting_input 但非弹框 = claude 答完停在主输入框**：维持原"孤儿宽限自动解锁"，靠 PTY 特征排除，避免把正常结束误推成弹框。

## 依赖与约束

- claude 弹框/等待靠全局 `~/.claude/settings.json` 的 Notification hook（已配，指向 aimon-hook.mjs）→ `/api/hooks/claude` → `statusManager` 置 waiting_input。
- 推送复用 `wechatClient.sendReply(fromUserId, contextToken, text)`，contextToken 取自当前 pending（即触发本轮工作的那条 owner 消息）；过期则推送失败只记日志。
- 类型检查：`pnpm -F @aimon/server build`。
- 运行部署在 `AIkanban-stable`，需同步重启才生效。
