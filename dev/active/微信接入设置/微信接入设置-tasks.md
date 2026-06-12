# 微信接入设置 · 任务清单

- [x] 1. hub-session 抽成通道无关模块 + ensureHubSession 单飞 → verify: grep 全仓无 `feishu/hub-session` 旧引用（仅新文件注释提及）；`pnpm -F @aimon/server build` 过
- [x] 2. wechat/config.ts + wechat/client.ts（取码代次/扫码轮询/长轮询单飞/sendReply 带 client_id/-14 处理/stop 中止） → verify: server build 过
- [x] 3. wechat/inbound.ts（绑定口令/owner 白名单/串行 pending/写总控台）+ send-wechat-reply 路由 + MCP 工具 → verify: server build 过；grep 确认 mcp-hub 工具与路由对得上（hub-workspace 指引未动——工具描述本身已含使用指引，与 send_feishu_message 同模式）
- [x] 4. routes/wechat.ts + index.ts 注册/启动恢复/关机停桥 → verify: server build 过；curl /api/wechat/status 合并到步骤 7 端到端（需重启加载新代码）
- [x] 5. web 侧：types + api.ts + SettingsDialog「微信机器人」页签 + qrcode 依赖 → verify: `pnpm -F @aimon/web build` 过；页签挂在现有固定高度容器（h-[600px]）内，高度不随页签变
- [x] 6. scripts/wechat-smoke.mjs（mock ilink：重复取码单飞/长轮询单飞/stop 中止/-14/游标与去重/重启恢复） → verify: `pnpm smoke:wechat` 20 项全绿
- [ ] 7. 端到端真机验收（大哥扫码→绑口令→微信问→总控台答→微信收到）+ LogsView 起止配对 + 一次失败分支 ERROR + handoff → verify: 大哥确认收到回复；git diff 对照白名单
