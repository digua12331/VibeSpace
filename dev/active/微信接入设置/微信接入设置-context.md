# 微信接入设置 · Context

## 关键文件（= 本次改动边界）

### 新建（server）
- `packages/server/src/hub-session.ts` —— 从 `feishu/hub-session.ts` 平移成通道无关模块 + ensureHubSession 单飞保护
- `packages/server/src/wechat/config.ts` —— `data/wechat.json`：`{enabled, botToken, baseUrl, getUpdatesBuf, ownerUserId}`；masked 输出 hasToken；baseUrl 校验 https + *.weixin.qq.com
- `packages/server/src/wechat/client.ts` —— 单一 WechatClient：取码（代次+AbortController）、扫码轮询、登录恢复、getupdates 长轮询（单飞）、sendReply（带 client_id=uuid）、stop；四态 `idle|scanning|logged_in|error`
- `packages/server/src/wechat/inbound.ts` —— 绑定口令流程、owner 白名单、串行 pending 请求、`[微信 requestId=...]` 前缀写总控台 PTY
- `packages/server/src/wechat/index.ts` —— startWechatBridge / stopWechatBridge
- `packages/server/src/routes/wechat.ts` —— GET config/status、POST login / bind-start / logout / reset-binding、PUT config
- `scripts/wechat-smoke.mjs` —— mock ilink 服务器驱动 WechatClient 生命周期测试

### 修改（server）
- `packages/server/src/feishu/hub-session.ts` —— 删除（内容迁往 ../hub-session.ts）
- `packages/server/src/feishu/inbound.ts` —— import 路径改指共享 hub-session
- `packages/server/src/feishu/outbound.ts` —— 同上（setHubRestartNotifier）
- `packages/server/src/routes/hub.ts` —— 新增 POST `/api/hub/send-wechat-reply`（requestId + text）
- `packages/server/src/mcp-hub/index.ts` —— 新增 `send_wechat_reply` MCP 工具
- `packages/server/src/hub-workspace.ts`（若总控台指引文案在此）—— 补微信回复指引
- `packages/server/src/index.ts` —— registerWechatRoutes + startWechatBridge + 关机 stop

### 修改（web）
- `packages/web/src/api.ts` —— wechat 段封装
- `packages/web/src/types.ts` —— WechatConfigMasked / WechatStatus 等
- `packages/web/src/components/SettingsDialog.tsx` —— 'wechat' 页签「微信机器人」
- `packages/web/package.json` —— 新增 `qrcode`（+ @types/qrcode）依赖，前端渲染登录链接为二维码

### 不碰
- 飞书桥行为（client/outbound/inbound 逻辑零变化，仅 import 路径）
- 数据库 schema、现有路由

## 决策记录

- **hub-session 平移而非复制**：飞书/微信共用一个总控台会话保证器；单飞 = 模块级 in-flight Promise 复用（10 行内）。重启通知钩子保留单订阅、归飞书所有（微信不注册，避免覆盖；微信通道收不到重启提醒是可接受的小损失——它本来就只做即时问答）。不是过度设计：不抽通道接口、不做订阅者数组。
- **协议细节全部来自试点实测**（dev/active/微信ilink可行性试点/）：请求头三件套、qrcode_img_content 是链接、35s 长轮询 hold、**sendmessage 必带唯一 client_id**（否则出站 10-15 分钟无声死亡，第四轮已验证带上即修复）、-14=会话过期需重扫码、成功响应是空对象 `{}` 无送达回执。
- **绑定口令而非首条消息抢绑**：扫码后设置页点「开始绑定」生成 6 位口令（2 分钟窗口），微信里发口令完成绑定。防任意人抢绑；实现量小（内存里一个 {code, expiresAt}）。
- **串行单请求**：内存里最多一个 pending {requestId, fromUserId, contextToken}；新消息在 pending 期间直接回"处理中"。消除回错人问题，免去队列设计。
- **运行态不落盘**：二维码、状态、绑定窗口、pending 请求全内存；config 文件只有凭证/开关/游标/owner。重启丢 pending 可接受（owner 重发即可）。
- **游标提交顺序**：处理完一批 msgs 再落 getUpdatesBuf；按消息稳定 ID 去重（实现时确认 msg 字段里有无 msg_id，没有就用 context_token 兜底）——崩溃重启最多重复不丢失。
- **测试形态 = smoke 脚本**：仓库无 vitest，惯例是 scripts/*-smoke.mjs（见 package.json smoke:* 系列）。wechat-smoke 用本地 mock HTTP 服务器假扮 ilink，覆盖：重复取码单飞、长轮询单飞、stop 中止在途请求、-14 处理、游标提交与去重、重启恢复。
- **二维码前端渲染**：`qrcode` npm 包 toDataURL；后端不产图片文件。
- **MCP 工具走既有 hubFetch 模式**：send_wechat_reply(requestId, text) → POST /api/hub/send-wechat-reply，与 send_feishu_message 同构。

## 依赖与约束

- ilink 接口契约见 `dev/active/微信ilink可行性试点/weixin-bot-api-参考.md` + 试点 context.md 实测补充。
- 总控台拉起链：ensureHubSession → createSession + injectMcpForAgent + ptyManager.spawn（hub-session.ts 现成，勿改逻辑只搬家）。
- 入站写 PTY 前必须 stripControls（feishu/inbound.ts:70 同款，防 TUI 注入）。
- serverLog scope 统一 `wechat`；前端 logAction scope 同。
- 类型检查：`pnpm -F @aimon/server build` + `pnpm -F @aimon/web build`。
- 交付门槛（manual.md 2026-06-03）：构建+类型检查过即交付，UI 大哥手动验，不派浏览器测试 agent。
- 破坏性变更涉及：删除 feishu/hub-session.ts（平移）。引用图：feishu/inbound.ts:9、feishu/outbound.ts:12（grep `hub-session` 全仓确认）。plan 步骤 1 已写明此事并经大哥确认；迁移后 verify 必须 grep 旧路径无残留。
