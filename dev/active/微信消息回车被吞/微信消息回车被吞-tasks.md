# 微信消息回车被吞 · 任务清单

- [x] hub-session.ts 新增 writeHubInput()（bracketed paste + 延迟独立 \r） → verify: pnpm -F @aimon/server build 通过 ✓
- [x] wechat/inbound.ts、feishu/inbound.ts 改用 writeHubInput（顺带清掉两处不再使用的 ptyManager import） → verify: build 通过 ✓
