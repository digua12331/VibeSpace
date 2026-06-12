# 微信消息回车被吞 · Plan

## 大哥摘要

你微信发消息后，总控台终端里文字进了输入框却没真正执行（截图所示）。原因：后端把"正文+回车"一次性塞给 claude 的终端界面，claude 把回车当成了文字里的换行，不当"提交"。前端早就修过同款问题（先标记成"一次粘贴"发正文，停一拍再单发回车），这次把微信、飞书两条通道的后端写入对齐成同样的修法。改完后微信发消息会直接执行，不再停在输入框。

## 目标

- 微信/飞书消息写入总控台后真正提交执行。
- 验收：重启服务后从微信发一条消息，总控台终端里消息被提交、claude 开始干活；`pnpm -F @aimon/server build` 通过。

## 非目标 (Non-Goals)

- 不动前端 SessionView 的发送逻辑（它已是正确实现）。
- 不改 waitForHubReady 的就绪判定（截图证明正文能进输入框，就绪判定够用）。

## 实施步骤

1. `hub-session.ts` 新增共享 `writeHubInput(sessionId, text)`：bracketed paste 包正文 → 等 50ms → 单发 `\r`。→ verify: build 通过
2. `wechat/inbound.ts` 与 `feishu/inbound.ts` 的写入行改用该函数。→ verify: build 通过

## 边界情况

- 第二次写 `\r` 时会话刚好死掉 → write 返回 false，按原有"PTY 写入失败"错误路径走。

## 风险与注意

- 截图里跑的是 `AIkanban-stable` 部署副本，本修复落在 `AIkanban-main`，需同步到 stable 并重启服务才见效。

## 多模型 Plan 会审

跳过：小档任务（3 文件、对齐既有已验证模式、易回滚）。
