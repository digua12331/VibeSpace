# 微信ilink可行性试点 · Context

## 关键文件

- `dev/active/微信ilink可行性试点/ilink-poc.mjs` —— 新建，试点脚本（唯一的代码产出）
- `dev/active/微信ilink可行性试点/weixin-bot-api-参考.md` —— ilink 接口文档快照（来自 hao-ji-xing/openclaw-weixin）
- `dev/active/微信ilink可行性试点/ilink-state.json` —— 运行期生成（token、游标、最近 context_token），**不进 git**
- `dev/active/微信ilink可行性试点/ilink-qr.png` —— 运行期生成（登录二维码），**不进 git**
- `.gitignore` —— 追加两行忽略上述运行期文件
- 产品代码（packages/**）一律不碰

## 决策记录

- **脚本放任务目录而非 scripts/**：这是一次性试验代码，不是项目工具；放 scripts/ 会让人误以为是长期维护的 smoke 脚本。试点结束后随任务归档。
- **单文件零依赖（Node 22 原生 fetch + crypto）**：不引 qrcode 库——接口直接返回二维码图片内容（qrcode_img_content），落成 png 让大哥用图片查看器打开即可。不装任何 npm 包，避免污染仓库依赖。
- **三个子命令而非交互式向导**：login / listen / push 分开，因为验收 3（主动推送）必须在"listen 已停、间隔多分钟"后独立运行，交互式流程做不了这个时间隔离。
- **state 文件明文存 token**：与现有飞书桥的明文密钥决策一致（纯本地、gitignore），试点不上加密。

## 依赖与约束

- 接口基址：登录用 `https://ilinkai.weixin.qq.com`，登录成功后改用响应里的 `baseurl`。
- 请求头硬性约定：`AuthorizationType: ilink_bot_token`、`X-WECHAT-UIN: base64(String(randomUint32()))` 每次随机、登录后 `Authorization: Bearer <bot_token>`。
- `getupdates` 长轮询服务端最多 hold 35 秒；`get_updates_buf` 游标必须持久化，丢了会重复收消息。
- `sendmessage` 报文：`message_type: 2`（bot 发出）、`message_state: 2`（完整消息）、`context_token` 按文档为必填——验收 3 专门测试它的边界。
- 未知项（试点要探明的）：bot_type=3 含义、是否需要 OpenClaw 注册、token 有效期、速率限制。

## 执行中发现（2026-06-12）

- `get_bot_qrcode` 无需任何注册即可 HTTP 200 + ret=0 —— 边界情况里担心的"OpenClaw 审核挡门"没有发生。
- **`qrcode_img_content` 不是图片 base64，是登录链接**（`https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=<32位hex>&bot_type=3`），与文档示意图 `{ qrcode, url }` 一致。需本地把链接转成二维码图片：脚本改用 `npx --yes qrcode -o <png> <url>`（一次性调用，不进仓库依赖）。
- Windows 坑：`execFileSync` 走 shell 跑 npx.cmd 时，链接里的 `&` 会被 cmd 当命令分隔符截断二维码内容——参数必须手动加引号。

## 实测时间线（出站通道行为，三轮）

- 轮 1：登录 → 2 条自动回复**送达** → 停监听 → 10min → 推送 A(旧令牌)/B(无令牌) 接口 200 但**未送达**，微信显示"暂无法连接" → 重启监听后推送 C/D/E 及新入站的秒回**全部未送达**。
- 轮 2：重新登录 → 自动回复**送达** → 监听保持在线 → 10min 静默 → 推送 H(旧令牌)/I(无令牌) **未送达** → 新入站秒回也**未送达**（出站整体猝死，入站始终正常）。
- 轮 3（甄别实验）：重新登录 → 秒回**送达** → 全程零推送，静置 15min → 秒回**未送达**。结论：出站会话 10-15 分钟自然死亡，与是否做过推送无关；入站不受影响。
- 共性：sendmessage 失败时仍返回 HTTP 200 + `{}`，**无任何错误信号**（无声失败）；错 token 才有 `errcode:-14 session timeout`。

## 外部调研结论（GitHub 协议拆解，2026-06-12）

- **架构上不支持主动推送**：iLink 是拉取式协议，sendmessage 必须挂在入站消息的 context_token 上；多个独立实现（epiral/weixin-bot、x1ah/wechat-ilink-demo、yarrow.ren 博客）一致确认"无入站触发就无法主动发消息"。
- `context_token` 是会话级状态非凭证，不需要持久化；缺失/过期 → "可能发送成功但不出现在对话窗口"（与我们的无声失败现象吻合）。
- `client_id`（客户端生成的去重 ID，如 `py-{uuid}`）多份文档列为 sendmessage 必填，我们的脚本没传——候选嫌疑之一。
- 工程界保活做法：每 5 秒发 `sendtyping`（status=1，需先 getconfig 拿 typing_ticket）；errcode -14 后建议停轮询、隔段时间再重新登录（有博客称需隔 1 小时防风控）。
