# 微信接入设置 · Claude plan 草案 + 事实包（供 Codex 会审）

> 这是会审中间产物，不是最终 plan。最终 plan 由 Codex 综合主笔后落 `微信接入设置-plan.md`。

## 用户需求原话

"把取码操作，连接这些做到设置上，然后开始看怎么跟总控台进行配置" —— 即：
1. VibeSpace 设置弹窗里加微信接入（取二维码、扫码连接、连接状态）。
2. 微信通道接入总控台（hub）：微信发话 → 总控台 AI 执行/回答 → 回复回微信。

## 前置事实（来自已完成的「微信ilink可行性试点」任务）

- 协议：微信 ilink Bot API（`https://ilinkai.weixin.qq.com`），HTTP/JSON，零 SDK 依赖可用。
- 登录：`GET /ilink/bot/get_bot_qrcode?bot_type=3` → 返回 `qrcode`（32 位 hex）+ `qrcode_img_content`（**实为登录链接**，需本地转二维码图）；`GET /ilink/bot/get_qrcode_status?qrcode=` 轮询，状态机 `wait → confirmed | expired`（约 3 分钟过期）；confirmed 返回 `bot_token`（58 字符）+ `baseurl`。
- 请求头硬约定：`AuthorizationType: ilink_bot_token`、`X-WECHAT-UIN: base64(随机uint32字符串)`、登录后 `Authorization: Bearer <token>`。
- 收消息：`POST /ilink/bot/getupdates` 长轮询（服务端最多 hold 35 秒），`get_updates_buf` 游标必须持久化。
- 发消息：`POST /ilink/bot/sendmessage`，必须带入站消息的 `context_token`（回信凭据）；建议带 `client_id`（唯一去重 ID）。
- **协议级死穴：不支持主动推送**。无入站触发不能发消息（9 次实测全部无声失败 + 5 个开源拆解一致确认）。通知功能必须留在飞书。
- **出站会话寿命问题**：不带 client_id 时出站通道 10-15 分钟无声死亡（接口仍返回 200 空对象，无错误信号），仅重新扫码恢复；加 client_id 后能否长寿**正在验证中**（试点第四轮，15 分钟计时进行中，plan 呈现前会有结果）。
- 错误形态：错 token → `{errcode:-14, errmsg:"session timeout"}`；正常成功 → `{}` 空对象。
- 腾讯条款 4.7 保留随时限速/拦截/封禁第三方 AI 接入的权利。

## 现有代码骨架（飞书桥 = 直接模板）

- `packages/server/src/feishu/config.ts` —— 配置存 `data/feishu.json` 明文（data/ 已 gitignore），`getFeishuConfig/setFeishuConfig/maskFeishuConfig`（secret 出前端打码为 `••••••尾4位`），原子写 tmp+rename，坏文件坍缩为安全默认不抛错。
- `packages/server/src/routes/feishu.ts` —— `GET /api/feishu/config`、`GET /api/feishu/status`、`PUT /api/feishu/config`（zod 校验 + serverLog 起止配对）、`POST /api/feishu/test`。
- `packages/server/src/feishu/inbound.ts` —— 入站链：幂等去重（event_id + 落盘 TTL）→ 白名单校验（不在名单回"⛔ 无权限"）→ extractPlainText（剥控制字符防 TUI 注入、8000 字上限）→ `ensureHubSession()` → `ptyManager.write(sessionId, text + "\r")` → 失败回错误给发送者。
- `packages/server/src/feishu/hub-session.ts` —— `ensureHubSession()`：复用活着的总控台 session 或拉起新的（`HUB_PROJECT_ID='__hub__'`，agent 固定 claude，注入 aimon-hub MCP）；重启时通知"记忆可能丢失"。**此文件逻辑与飞书无关，可被微信桥复用**。
- `packages/server/src/feishu/outbound.ts` —— `sendToOwner(text)` 出站 + worker 状态通知 + 30s 去重。
- 设置 UI：`packages/web/src/components/SettingsDialog.tsx`，页签 `'general'|'terminal'|'manager'|'feishu'`（56-63 行定义，533 行 tab bar，892 行飞书分区），弹窗高度固定 `h-[600px] max-h-[88vh]`（大哥硬性偏好：高度不随页签变，内容内部滚动）。
- 设置数据走 `/api/feishu/*` 独立路由（项目记忆约定：全机器级能力挂独立 `/api/<feature>/*`，不塞 `/api/projects/:id/*`）。
- 前端 API 封装在 `packages/web/src/api.ts`（1211-1225 为飞书段）。
- 路由注册入口 `packages/server/src/index.ts`。
- 前端日志包装器 `logAction(scope, action, fn, ctx?)`（packages/web/src/logs.ts）、后端 `serverLog(level, scope, msg, extra?)`（log-bus.ts），mutation 必须起止配对。
- 类型检查命令：`pnpm -F @aimon/web build`（web 无独立 typecheck 脚本）+ server 侧等价构建。

## Claude 草案：实施设计

### 新增文件（镜像 feishu/ 结构）

- `packages/server/src/wechat/config.ts` —— `data/wechat.json`：`{ enabled, botToken, baseUrl, getUpdatesBuf, allowUserIds[], ownerUserId, lastContextToken, lastInboundAt }`。botToken 出前端打码。
- `packages/server/src/wechat/client.ts` —— ilink HTTP 封装 + 长轮询循环（start/stop，getupdates → 游标落盘 → 派发 handler；ret 非 0 退避重试）+ `sendReply(toUserId, contextToken, text)`（带 client_id=uuid）。
- `packages/server/src/wechat/login.ts` —— 取码（get_bot_qrcode → 返回登录链接给前端）+ 服务端轮询 get_qrcode_status → confirmed 后写 config 并自动 start 长轮询。
- `packages/server/src/wechat/inbound.ts` —— 平移 feishu/inbound.ts：白名单（from_user_id）→ stripControls → `ensureHubSession()`（从 feishu/hub-session.js 导入复用）→ 写总控台 PTY；**同时把 context_token 暂存**，供总控台回复时带上。
- `packages/server/src/routes/wechat.ts` —— `GET /api/wechat/config`、`GET /api/wechat/status`（disconnected | waiting_scan | connected | polling 状态）、`POST /api/wechat/login`（取码，返回登录链接）、`POST /api/wechat/logout`、`PUT /api/wechat/config`（白名单/开关）。
- 前端：SettingsDialog 加 `'wechat'` 页签「微信机器人」——取码按钮、二维码展示（前端把登录链接渲染成二维码）、连接状态徽标、白名单编辑、说明文案（明确写"微信只能即时问答，主动提醒仍走飞书"）。
- `packages/web/src/api.ts` 加 wechat 段封装。

### 关键决策点（待 Codex 评审）

1. **二维码渲染位置**：前端用 `qrcode` npm 包（约 40KB）把登录链接渲染成 canvas/dataURL，vs 后端生成 PNG base64 返回。草案倾向前端渲染（后端零新依赖，二维码本是前端展示问题）。
2. **总控台回复怎么回到微信**：飞书模式是 AI 主动调 MCP 工具 `send_feishu_message`。微信受 context_token 约束（只能"回"不能"推"），草案：在 aimon-mcp-hub 加 `send_wechat_reply` 工具，参数只有 text，server 端自动取最近一条入站消息的 context_token + from_user_id 发送；token 过期/发送失败时工具返回明确错误给 AI。
3. **owner 绑定流程**：微信 user_id 用户自己查不到。草案：扫码连接后，`ownerUserId` 为空时第一条入站消息的 from_user_id 自动绑定为 owner 并回复"已绑定"；之后非白名单一律拒。
4. **出站死亡的可观察性**：协议无声失败检测不了。草案：状态页只承诺"长轮询在线/离线 + 最近收发时间戳"，设置页文案明示"微信收不到回复时，重新取码连接"。不做自动探活（做不到）。
5. **client_id 验证结果的处理**：若试点第四轮证明 client_id 修复了出站寿命 → 风险降级；若没修复 → plan 须加"会话寿命短，需频繁重扫码"的红字警告，且建议大哥重新考虑值不值得做。

### 非目标（草案）

- 不做主动推送/通知（协议不支持）；通知继续走飞书。
- 不做媒体消息（图片/语音/文件）、群聊。
- 不动现有飞书桥任何行为。
- 不做 token 加密存储（与飞书明文决策一致）。

### 验收标准（草案，浏览器可观察）

1. 设置 → 「微信机器人」页签 → 点「取码连接」→ 页签内出现二维码；手机扫码确认后状态变「已连接」。
2. 用微信给机器人发"列出当前项目"→ 总控台终端（📊 总控台项目的 claude 会话）出现这句话 → AI 的回答出现在微信里。
3. 非白名单微信号发话 → 收到"无权限"回复，总控台无动静。
4. UI 日志面板看到 `scope=wechat` 的起止配对日志（login / inbound / reply）。
5. `pnpm -F @aimon/web build` + server 类型检查通过。

### 已知风险

- 出站会话寿命（待第四轮验证收尾，结果出来前 plan 不定稿）。
- 主动推送协议级不可能——用户期望管理：设置页文案必须写明。
- 腾讯可随时封禁该通道（条款 4.7）。
- 长轮询循环要处理：服务重启后游标恢复、-14 时停轮询置 disconnected 状态、退避防风暴。
