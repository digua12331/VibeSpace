# 飞书双向任务桥 · Context（AI 自用）

> 探查于 2026-06-03，集成点以当时代码为准。memory 扫过：`dispatch_to_idle_session`/`claimIdle` 模式（2026-05-02 多条）与本任务 `send_input_to_session` 同源，需 grep 引用图。

## 关键文件（边界 = 本任务只动这些）

### 后端 packages/server/src

**新增模块 `feishu/`（本任务主体，全新）**
- `feishu/config.ts` — 读写 `data/feishu.json`（gitignore）；`FeishuConfig` 类型；缺字段→功能整体关闭+日志，不拖垮启动。
- `feishu/client.ts` — 封装 `@larksuiteoapi/node-sdk` 的 WSClient（长连接、重连、token 由 SDK 内部刷新）+ Lark Client（发消息 / 拉机器人信息做"测试连接"）。单例 + start/stop/getStatus。
- `feishu/inbound.ts` — 订阅 `im.message.receive_v1` → 事件 id 幂等去重（落盘 `data/feishu-seen.json` + TTL）→ 白名单校验（open_id 私聊 / chat_id 群分判）→ 剥 @mention/富文本→纯文本 → 控制字符过滤 + 长度上限 → 经 hub-session 确保总控台活 → `ptyManager.write(hubSessionId, text+"\r")`。
- `feishu/outbound.ts` — `sendToOwner(text)` 主动发消息给配置里的 owner 会话；`statusManager.on('change')` 监听**非总控台** session 的 `waiting_input`/终止态 → 带标签系统通知 + 限流去重（同 session 同状态短时窗一条）。
- `feishu/hub-session.ts` — `ensureHubSession()`：保证 `__hub__` 里有一个活的 claude 总控台 session（无则 spawn，死则重起 + 发"总控台已重启"）；导出当前 hubSessionId 供 inbound/工具门禁用。

**新增路由 `routes/feishu.ts`（全新）**
- `GET/PUT /api/feishu/config`（读/存，Secret 掩码返回）、`POST /api/feishu/test`（测试连接）、`GET /api/feishu/status`（在线状态）。
- 注册：`index.ts` 顶部 import + `await registerFeishuRoutes(app)`（仿 :258-287 既有形态）。

**改 `mcp-hub/index.ts`** — 仿 `dispatch_to_idle_session`(:297) 新增两个工具：
- `send_feishu_message(text)` → POST `/api/feishu/outbound`（新端点，挂 feishu 路由或 hub 路由）。
- `send_input_to_session(sessionId, text)` → POST `/api/hub/send-input-to-session`（新端点，严格门禁）。

**改 `routes/hub.ts`** — 新增 `POST /api/hub/send-input-to-session`：门禁=目标 `waiting_input` + `ptyManager.has` + 白名单 agent(claude) + 最近 1s 无人类输入 + 短锁，再 `ptyManager.write(id, text+"\r")`。

### 前端 packages/web/src
- `components/SettingsDialog.tsx` — **已有未提交改动（terminalKeybindings，非本任务，勿动）**。仅追加一个 `<section>`「飞书」块：填 App ID/Secret（保存后掩码）、白名单编辑、选总控台 agent、测试连接按钮、在线状态。mutation 用 `logAction`。
- `api.ts` — 加 `getFeishuConfig / updateFeishuConfig / testFeishu / getFeishuStatus` 客户端函数（仿 `getAppSettings` :1078）。
- `types.ts` — 镜像 `FeishuConfig` / `FeishuStatus` wire 类型（**已有未提交改动，勿动既有行**）。

### 不在边界内（只读参考）
`pty-manager.ts`(write/has) · `status.ts`(on('change')/get) · `mcp-bridge.ts`(injectHubMcps) · `hub-project.ts`(HUB_PROJECT_ID) · `hub-workspace.ts` · `routes/sessions.ts`(startSession 形态) · `log-bus.ts`(serverLog)。

## 决策记录

- **总控台对话 = 直接 `ptyManager.write` 进 __hub__ session**，不另造抽象。复用 hub.ts:273 已验证的"spawn 后直接 write text+\r"套路（无独立 TUI-ready 判定，靠 statusManager 状态机）。资深视角：不过度设计，沿用现成路径。
- **send_feishu_message vs 扒屏幕**：让总控台 AI 主动调工具发飞书，绕开 ANSI 解析。兜底"读终端尾部补发"放到阶段 2 末，能不做先不做（YAGNI）。
- **幂等去重落盘**用最简 `data/feishu-seen.json`（Map<eventId, ts> + 启动清理过期），不引 sqlite 表、不引外部 KV。重启短期重复可接受用内存+落盘兜底。
- **配置存 `data/feishu.json` 明文 + gitignore**，v1 不加密（plan 已知会大哥）。仿 app-settings 原子 tmp+rename 写盘。
- **类型两边手写**（项目无 codegen），FeishuConfig 后端 config.ts 定义、前端 types.ts 镜像。
- **send_input_to_session 门禁从严**：这是高风险新工具（总控台可被提示词诱导乱写别的终端），必须 waiting_input + PTY 活 + agent 白名单 + 防抢人类输入。

## 依赖与约束
- `@larksuiteoapi/node-sdk`：需 `pnpm -F @aimon/server add`。长连接 WSClient 模式免公网端点（契合 loopback-only）。Node 版本/事件订阅权限范围阶段 0 先验。
- 企业自建应用需"已发布"且开通 `im.message.receive_v1` 事件 + 发消息权限（im:message）。大哥提供 App ID/Secret 才能跑真连接验收——**无凭证时只能验类型检查/构建，真连接留给大哥手动验**。
- 类型检查命令：server 侧 `pnpm -F @aimon/server build`（tsc），web 侧 `pnpm -F @aimon/web build`。
- `__hub__` session 自动 spawn 必须带 aimon-hub MCP（mcp-bridge 仅对 HUB_PROJECT_ID 注入）——阶段 0 实测确认。
