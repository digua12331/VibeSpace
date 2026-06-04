# 飞书双向任务桥 · Plan（修订版 · 总控台架构）

## 大哥摘要（先看这段）

这次做一个「飞书 ↔ 总控台 AI」的桥。**总控台 AI**（项目里已有的「📊 总控台」，是个能指挥其它 AI 终端的调度 AI）就是你在飞书里的对话对象：

1. **你在飞书发一句话 → 送进总控台 AI**，它来理解、决定开哪些终端干活（开终端、盯进度这些它本来就会，工具现成）。
2. **总控台 AI 想跟你说话 / 拿主意 / 报完成 → 它主动给飞书发消息**（给它配一个"发飞书"的工具，不靠猜它屏幕）。
3. **它开的那些干活终端（worker）需要你拿主意或干完了 → 飞书也会自动收到一条带标签的提醒**（如"⚙️ 任务X 需要输入""✅ 任务X 完成"），你不会两眼一抹黑。
4. **你想操作某个干活终端 → 在飞书跟总控台说"回复任务X：继续"即可**，由总控台去替你操作，你只跟总控台一个对象打交道。

私聊机器人、群里@机器人都支持，配置（机器人密钥、谁能用的白名单、绑哪个 AI 当总控台）做一个**网页设置界面**，你点点填填就行。

要你拍板/知情的点：
- **安全**：能在飞书指挥 = 能在你电脑上跑命令，所以只有白名单里的飞书账号/群能用，**名单为空=谁都不行**。
- **一个总控台对话**：你在飞书面对的是同一个总控台 AI。好处是简单不乱；代价是如果某个活把总控台 AI 卡很久/它的记忆满了，飞书这边的对话会被拖慢——遇到我会让它自动重开一个（重开会丢之前的对话记忆，届时飞书会提示你"总控台已重启"）。
- **明文密钥**：机器人密钥先以明文存在你本机一个文件里（已设为不进 git、不上传），v1 不做加密，纯本地。

---

## 目标与验收标准

打通「飞书 ↔ 总控台 AI ↔ 它管理的 worker 终端」闭环。验收都能在「飞书 App + 浏览器（设置界面 / LogsView 日志面板）+ 落盘日志」观察。

**阶段 0：长连接 + 配置 + 设置界面 + 常驻总控台**
- 浏览器可观察验收：打开「设置 → 飞书」面板，填入 App ID/Secret + 白名单 + 选总控台 agent，点"测试连接"显示成功；保存后机器人在飞书后台显示在线。
- LogsView 见 `scope=feishu action=connect` 起止配对；密钥错误时见 `connect 失败` ERROR（人工触发验证过）。
- 总控台 session 不存在时被自动拉起（在 `__hub__` 项目里），死掉后下一条飞书消息能重新拉起并发"总控台已重启"提示。

**阶段 1：入站（飞书 → 总控台）**
- 验收：飞书私聊机器人发"列一下当前项目"，文本被写进总控台 session，总控台 AI 开始处理。群里@机器人同样生效。
- LogsView 见 `scope=feishu action=inbound` 起止配对。
- 失败分支：白名单外账号发消息 → 飞书回"无权限"且**不**写入总控台，见 `inbound 拒绝` WARN（人工验证过）。

**阶段 2：出站（总控台 → 飞书，主通道）**
- 验收：总控台 AI 调用新工具 `send_feishu_message`，飞书收到它发来的消息（如它的回答、它在问你的问题）。
- LogsView 见 `scope=feishu action=outbound` 起止配对。
- 失败分支：飞书发送失败（断网）见 `outbound 失败` ERROR（人工验证过）。

**阶段 3：worker 反馈汇聚（干活终端 → 飞书）**
- 验收：让总控台开一个 worker 任务并把它跑到 `waiting_input`，飞书自动收到"⚙️ 任务X 需要输入"；worker 结束收到"✅ 完成"或"⚠️ 异常结束"（区分 idle/crash）。
- LogsView 见 `scope=feishu action=notify` 起止配对；同一状态短时间不刷屏（限流去重验证过）。

**阶段 4：控制 worker（经总控台）**
- 验收：worker 处于 `waiting_input` 时，你在飞书对总控台说"回复任务X：继续"，总控台调用新工具 `send_input_to_session` 把"继续"写进那个 worker，它接着跑。
- LogsView 见 `scope=feishu/hub action=send-input` 起止配对。
- 失败分支：对一个已结束/不在 waiting_input 的 worker 操作 → 工具拒绝并回明确原因（人工验证过）。

---

## 非目标（v1 不做）

- **飞书直连 worker 的回复路由**：不做"在飞书里直接回某个 worker"。操作 worker 一律经总控台转达（省掉 per-worker 话题映射）。
- 飞书图片/文件/语音/卡片/撤回/编辑事件——只认纯文本，其余回"暂不支持"。
- App Secret 加密存储（v1 明文 + gitignore + 文档警示）。
- 多总控台 / 多机器人 / 多租户、长连接断线期间的事件补偿、历史消息同步。
- CLI（`@aimon/cli`）侧的飞书子命令。

---

## 实施步骤

> 顺序即依赖：阶段 0 是地基；1/2/3/4 依赖它，但各自可独立验收。

1. **飞书长连接 + 配置 + 设置界面（阶段 0）**
   - 依赖飞书官方 node SDK（`@larksuiteoapi/node-sdk`）WebSocket 长连接模式：机器人主动拨出连飞书，**免公网端点/内网穿透**，契合后端 loopback-only。
   - 新模块 `packages/server/src/feishu/`：`client.ts`（长连接、重连、token 刷新）、`config.ts`（读写 `data/feishu.json`，gitignore，缺字段→功能整体关闭+日志，不拖垮启动）。
   - 新后端路由 `routes/feishu.ts`：`GET/PUT /api/feishu/config`（读/存配置）、`POST /api/feishu/test`（测试连接）、`GET /api/feishu/status`（在线状态）。
   - 前端设置面板（`packages/web` 设置区新增「飞书」tab）：填密钥（保存后 Secret 以掩码显示）、编辑白名单、选总控台 agent、测试连接按钮、状态指示。前端 mutation 用 `logAction` 包裹。
   - 常驻总控台：`feishu/hub-session.ts` 确保 `__hub__` 里有一个活的总控台 session（无则 spawn，死则下条消息重起 + 通知飞书）。
   - 验证：见「阶段 0 验收」。

2. **入站（阶段 1）**
   - `feishu/inbound.ts`：订阅飞书消息事件 → 事件唯一 id 幂等去重（**落盘** + TTL，重启后不重复写）→ 白名单校验（`open_id` 私聊 / `chat_id` 群，两者分别判，群白名单≠群内人人有权）→ 剥 @mention/富文本噪声 → 控制字符过滤 + 长度上限 → 等总控台 TUI 就绪 → `ptyManager.write(文本+\r)`。
   - 验证：见「阶段 1 验收」。

3. **出站主通道：`send_feishu_message` MCP 工具（阶段 2）**
   - 在 `mcp-hub/index.ts` 新增工具 `send_feishu_message(text)` → 转调新后端端点 → `feishu/outbound.ts` 发到大哥的飞书会话。
   - 在 hub-workspace 的指引（`__hub__` 的 CLAUDE.md / 注入指引）里告诉总控台 AI："要跟大哥说话/问问题/报结果，调 `send_feishu_message`。"
   - 兜底：若总控台进入 waiting_input 但没调工具，feishu 桥读其终端尾部（ANSI 清洗 + 截断 ≤4KB + 脱敏）补发一条，附"(自动摘要)"标注。
   - 验证：见「阶段 2 验收」。

4. **worker 反馈汇聚（阶段 3）**
   - `feishu/outbound.ts` 监听 `statusManager.on('change')` 中**非总控台**的 session：`waiting_input` / 终止态 → 直发飞书带标签系统通知。措辞区分 完成(idle)/异常(crashed)/停止(stopped)。
   - 限流去重：同 session 同状态短时窗只发一条。文案强制引导："要操作请对总控台说『回复任务X：…』。"
   - 验证：见「阶段 3 验收」。

5. **控制 worker：`send_input_to_session` MCP 工具（阶段 4）**
   - 在 `mcp-hub/index.ts` + `routes/hub.ts` 新增工具/端点 `send_input_to_session(sessionId, text)`，**严格门禁**：目标必须 `waiting_input` + PTY 存活 + 白名单 agent + 最近 1s 无人类网页输入 + 短期锁（防总控台被提示词诱导乱写别的终端 / 防抢人类正在输入）。
   - 总控台收到"回复任务X：…"时调用它。
   - 破坏性变更协议：这是新增 MCP 工具 + 新 HTTP 端点 + 复用/类比 `claimIdle`，改前 grep `claimIdle` / `dispatch_to_idle_session` 调用图，改后 grep 确认无误用。
   - 验证：见「阶段 4 验收」。

6. **操作日志贯穿（每阶段同步）**
   - `serverLog`，`scope=feishu`（桥）/ `hub`（工具），覆盖 `connect / inbound / outbound / notify / send-input / config-save` 的起止配对，失败 ERROR + `meta.error`。

---

## 边界情况

- 飞书事件**至少投递一次** → 按事件 id 幂等去重，且**落盘**（重启后短期重复也不重复写总控台）。
- 私聊用 `open_id`、群用 `chat_id`，白名单两者分别判定。
- 群@时文本夹带机器人名/引用/富文本 → 取纯文本前剥离。
- 总控台 session 自动重起会丢对话记忆 → 重起后飞书发"总控台已重启，之前对话记忆可能丢失"。
- 单总控台是瓶颈：某任务把它卡久 / 上下文满 → 飞书交互被拖；v1 接受，文案提示，必要时引导大哥让它重开。
- `idle` ≠ 成功完成（可能 Stop/crash/CLI 退出）→ 通知措辞区分，拿不准别写死"完成"。
- `send_input_to_session` 决不允许任意 sessionId 任意写 → 仅白名单 agent + waiting_input + 锁。
- worker 输出可能含其它敏感任务内容 → 总控台读取/转发要意识到跨任务边界，外发飞书的内容截断脱敏。
- 首条飞书消息写入总控台前确认 TUI 就绪，否则可能丢；就绪/超时可观测 + 失败有飞书提示。

---

## 风险与注意

- **安全（最高）**：飞书触发 = 大哥电脑上执行命令（远程执行）。白名单是硬门槛，按稳定 ID（`open_id`/`chat_id`），**空名单默认全拒**。`send_input_to_session` 是高风险新工具，门禁从严。
- **数据外流**：发飞书的一切都流出本机。`send_feishu_message` 是 AI 主动发（可控）；兜底 buffer 摘要必须 ANSI 清洗 + 截断 + 脱敏。
- **上游依赖（阶段 0 先验，别拖后）**：飞书 SDK 的 Node 版本要求、长连接所需事件订阅权限范围（接收私聊/群@、发消息分属不同权限）、企业自建应用需"已发布"状态、token 刷新。
- **关键依赖验证**：自动 spawn 的总控台 claude 必须确实带上 `aimon-hub` MCP（`mcp-bridge.ts` 仅对 `__hub__` 注入）——阶段 0 实测确认。
- **配置界面扩范围**：密钥保存/掩码/清空/测试连接/失败提示都是用户可见，需各自浏览器验收项。
- **假设**：大哥能拿到企业自建应用凭证并开通长连接事件订阅（已确认）；总控台 agent 用 claude（hub 工具校验 claude-only）。

---

## 多模型 Plan 会审

> [大哥定向] 架构由"飞书绑死一个项目"改为"飞书只接总控台 AI，由总控台用现有 MCP 调度工具管理其它终端"——复用 `__hub__` + `aimon-hub` 现成能力，feishu 桥只需对接单一总控台 session。
> [Codex 评审·一轮] 采纳：去 UI 改配置文件（后又据大哥要求改回前端面板）、映射落盘、buffer 默认不外发只发 detail、idle≠成功、白名单稳定 ID、事件幂等、纯文本收窄、阶段拆分。
> [Codex 评审·二轮（总控台架构）] 采纳关键简化：新增 `send_feishu_message` MCP 工具让总控台**主动发**飞书，绕开"扒 TUI 屏幕"难题；`send_input_to_session` 严格门禁（waiting_input only + PTY 活 + 白名单 + 防抢人类输入 + 锁）；幂等去重落盘；总控台重启丢上下文要提示飞书；worker 通知限流去重 + 文案引导"经总控台操作"；单总控台瓶颈写入风险段。放弃/延后：飞书直连 worker、图片/文件、断线补偿、Secret 加密。
> [Claude 白话化兜底] 重写大哥摘要为 4 步白话并把总控台/worker/MCP 工具/RCE/上下文 等术语括号翻译；把"单总控台瓶颈 + 重启丢记忆 + 明文密钥"三个用户会感知的代价提到摘要里让大哥知情；对照 manual.md（2026 最新偏好）确认含前端 UI 故保留浏览器可观察验收项、但交付不自动派 browser-use（由大哥手动验，handoff 给「点哪里看」）。
