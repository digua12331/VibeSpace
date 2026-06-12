# 弹框转微信选择 · 任务清单

- [x] hub-session.ts 新增 writeHubAnswer()（raw 文本 + 延迟独立 \r，给弹框答案用） → verify: pnpm -F @aimon/server build 通过 ✓
- [x] wechat/inbound.ts 加 stripAnsi/detectHubPrompt 纯函数 + 重新 import ptyManager → verify: build 通过 ✓；5 个真实弹框样例（权限框/信任框/y-n/中文/已完成）检测全部正确 ✓
- [x] PendingRequest 加 awaitingChoice / promptFingerprint 字段 → verify: build 通过 ✓
- [x] onHubStatusChange：waiting_input 且 pending 时判弹框→推送（指纹去重），否则保留孤儿解锁 → verify: build 通过 ✓（弹框/非弹框分流已单测；微信实推待 stable 重启验收）
- [x] handleInbound：cancel 后、闸口前插入答案分支，writeHubAnswer 写回，serverLog prompt-forward/prompt-answer 起止配对 → verify: build 通过 ✓（微信回数字→终端待实测）
