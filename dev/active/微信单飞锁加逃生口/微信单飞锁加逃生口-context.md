# 微信单飞锁加逃生口 · Context

## 关键文件

- `packages/server/src/wechat/inbound.ts`（唯一改）：
  - `pending` 单飞锁 L36；`handleInbound` L126；pending 闸口 L162-170；resolveWechatReply L68（成功清 pending）。
  - import 现有 statusManager（L4）；新增 `import { getHubSessionId } from "../hub-session.js"`。
- 只读参考：
  - `status.ts`：`statusManager.get(id)` 返回 SessionStatus；继承 EventEmitter，`emit("change", sessionId, status, detail)`（L51）。状态：starting/running/working/waiting_input/idle/...，idle = Stop hook（AI 一轮答完，L146），working = 生成中（L133）。
  - `hub-session.ts`：`getHubSessionId()` 返回活的 hub 会话 id 或 null（L26）。

## 决策记录

- 三道防线叠加而非择一：逃生指令（owner 主动）+ 即时孤儿判定（owner 下条消息触发）+ idle 事件定时器（无人动也自动解，且通知 owner）。即时判定与定时器都靠"hub 非 working + pending 超宽限"同一判据，逻辑一致。
- 宽限期常量 `ORPHAN_IDLE_GRACE_MS = 8000`：覆盖 Claude Stop hook 异步滞后（status.ts 注释提到 D2≈800ms 窗口，8s 留足余量）。
- 不引队列：单飞 + 逃生口是最小修复；排队是另一个量级的设计（多轮上下文、顺序、超时各自处理），无需求不做。
- 逃生词集合 `取消/重置/解锁/清空 / /cancel /reset /clear`：覆盖中文直觉 + 命令习惯；用 stripControls 后的 text 精确匹配（整条等于其一才触发，避免"取消订阅项目"被误判）。
- idle 定时器在 working/starting 事件到来时清除（AI 又开始干活，不该解锁）；resolveWechatReply 成功时也清（正常回传，定时器无意义）。

## 依赖与约束

- statusManager 是单例 EventEmitter，inbound 模块加一个 'change' 订阅（registerWechatInbound 里挂一次，模块级单订阅，不重复挂）。
- 类型检查：`pnpm -F @aimon/server build`。
- 操作日志：逃生解锁 / 孤儿即时放行 / idle 定时器放行各记一条 serverLog（scope=wechat），失败回传走 best-effort。
- 冒烟脚本 import dist 产物或直接对 inbound 的纯逻辑做 mock——inbound 依赖 ptyManager/wechatClient/statusManager，冒烟用轻量 mock 覆盖三条断言路径（不起真实 PTY/微信）。
