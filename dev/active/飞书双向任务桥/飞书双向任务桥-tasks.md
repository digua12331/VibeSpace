# 飞书双向任务桥 · 任务清单

> 顺序即依赖。阶段 0 是地基。真连接验收需大哥的飞书 App ID/Secret；无凭证时以"类型检查通过 + 代码就位"为该步完成判据，真连接项标注「待大哥验」。

## 阶段 0 — 长连接 + 配置 + 设置界面 + 常驻总控台

- [x] S0.1 装 SDK + 建 feishu 模块骨架（config.ts 读写 data/feishu.json + gitignore）→ verify: build 通过；data/ 整目录已 gitignore；缺文件返回 disabled 不抛 ✓
- [x] S0.2 feishu/client.ts 长连接客户端（WSClient start/stop/getStatus + Lark Client 测试连接）→ verify: build 通过；connect 起止/失败日志就位（真连接待大哥验）✓
- [x] S0.3 routes/feishu.ts（GET/PUT config、POST test、GET status）+ 注册 index.ts → verify: build 通过；隔离 harness 实测 GET 掩码/PUT 落盘/config-save 配对/test 真打飞书 API 拿到 code=10003 失败路径 ✓
- [x] S0.4 feishu/hub-session.ts 常驻总控台（ensureHubSession spawn/重起 + 发"总控台已重启"）→ verify: build 通过；spawn 逻辑镜像 startSession 核心（hub-ensure 起止日志就位）；活体 spawn+MCP 注入待大哥实测 ✓
- [x] S0.5 前端「飞书」设置 section（SettingsDialog 追加 + api.ts + types.ts）→ verify: `pnpm -F @aimon/web build` 通过；飞书块/Secret 掩码/测试连接/独立保存就位；config-save 起止配对（浏览器观感待大哥手验）✓

## 阶段 1 — 入站（飞书 → 总控台）

- [x] S1.1 feishu/inbound.ts（事件去重落盘 + 白名单 + 纯文本清洗 + 写入总控台 PTY）→ verify: build 通过；inbound 起止/失败日志就位；真消息流待大哥验 ✓
- [x] S1.2 白名单拒绝分支 → verify: isSenderAllowed 单测 6/6 PASS（含空名单全拒）；拒绝回"无权限"+WARN 就位 ✓

## 阶段 2 — 出站主通道（总控台 → 飞书）

- [x] S2.1 feishu/outbound.ts sendToOwner + `send_feishu_message` MCP 工具 + 新端点 → verify: build 通过；工具进 dist bin，端点 /api/hub/send-feishu-message 就位；outbound 起止/失败日志就位；真发送待大哥验 ✓

## 阶段 3 — worker 反馈汇聚（干活终端 → 飞书）

- [x] S3.1 outbound 监听 statusManager change（非总控台 session 的 waiting_input/终止态 → 带标签通知 + 限流去重）→ verify: build 通过；区分 ⚙️需要输入/✅完成(working→idle)/⚠️异常(crashed)/🛑停止(stopped)，30s 同状态去重，跳过 hub 自身与 shell；真通知待大哥验 ✓

## 阶段 4 — 控制 worker（经总控台）

- [x] S4.1 grep `claimIdle`/`dispatch_to_idle_session` 引用图（破坏性变更前置）→ verify: claimIdle/releaseIdleClaim 仅 hub.ts 用、dispatch 工具链 mcp-hub→hub→api；新增端点/工具纯追加，受影响既有符号=无 ✓
- [x] S4.2 POST /api/hub/send-input-to-session（严格门禁）+ `send_input_to_session` MCP 工具 → verify: build 通过；门禁=非hub+非shell+PTY活+必须waiting_input+1s无人类输入+短锁；7 种拒绝错误码；改后 grep 确认既有 dispatch 工具未动 ✓

## 收尾

- [x] Z.1 全量 build（server + web）+ `git diff --name-only HEAD` 比对白名单 → verify: server+web build 全绿；本任务改动全在白名单内，越界的 AGENTS/README/issues/subagent-runs/SessionView/.gitignore 经核对均为大哥并行未提交改动，本任务未碰 ✓
