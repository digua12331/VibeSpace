# 微信单飞锁加逃生口 · Plan

> memory 扫过无直接相关条目。源头问题来自截图：微信"一次一问"锁死，后续消息（含解锁指令）全被挡。

## 大哥摘要

微信机器人现在"一次一问"，但有个死结：你问一句，总控台 AI 如果在终端里答了却没把答案回传到微信（或答完就空闲了），微信这边就一直显示"上一条还在处理中"，**连你想发"取消"解锁都被挡回去**——只能干等 10 分钟。这次修三处：(1) 加逃生指令，你发"取消/重置/解锁"能立刻解锁；(2) 系统自动判断总控台 AI 到底还在不在干活——它答完空闲了几秒还没回传，就自动解锁并告诉你"上一条没回传，已解锁"；(3) 真在生成时的"还在处理中"提示后面补一句"卡住了发取消"。验收：微信里发问后若卡住，发"取消"立即能继续；或等几秒系统自动解锁。

## 目标

- 只改 `packages/server/src/wechat/inbound.ts`，接 `statusManager`（会话状态机）+ `getHubSessionId`。
- 验收标准：
  1. `pnpm -F @aimon/server build` 通过（类型检查）。
  2. 逻辑断言（写一个 node 冒烟，mock statusManager/wechatClient）：
     - owner 发"取消"时，无论有无 pending 都清锁并回提示；
     - pending 占用 + hub 状态=idle + 超过宽限期 → 下一条消息触发即时放行（不再回"处理中"）；
     - pending 占用 + hub 状态=working → 仍回"处理中（卡住发取消）"。
  3. 真机可观察（大哥手动验）：微信发问卡住后，发"取消"立即回"已解锁"，再发新问能正常进总控台；日志面板有 `scope=wechat` 的"逃生解锁/孤儿放行"条目。

## 非目标

- 不把单飞改成消息队列（排队多轮）——那是更大的设计变更，本次只给单飞锁加逃生口，过度设计留待真实需求。
- 不动飞书通道、不动 hub-session/状态机本身。
- 不做消息去重（截图里重复是 owner 手动双发，非系统问题）。

## 实施步骤

1. inbound.ts 顶部加常量 + import getHubSessionId；加 CANCEL_WORDS 逃生指令处理（owner 校验后、pending 闸口前）。→ verify: build 通过。
2. 加状态感知：pending 闸口处即时判孤儿（hub idle/waiting_input/不存在 且 pending 超宽限 → 放行）；拒绝话术补解锁提示。→ verify: build。
3. 加 statusManager 'change' 订阅：hub 转 idle 且有 pending → 宽限后自动解锁并回传 owner 提示；working 时取消该定时器。registerWechatInbound 里挂订阅。→ verify: build。
4. 写 scripts/wechat-deadlock-smoke.mjs（mock 依赖跑三条断言），挂 smoke:wechat-deadlock。→ verify: pnpm smoke:wechat-deadlock 通过。

## 边界情况

- AI 正常调回传工具：pending 立即清，idle 定时器到点见 pending=null 空跳，不误报。
- 写 PTY 后状态短暂仍是 idle（hook 滞后）：靠宽限期（约 8s）避免误判为孤儿。
- hub 会话已死：getHubSessionId 返回 null，status 取不到 → 视为孤儿可放行（本就该解锁）。
- waiting_input（AI 在终端等输入但没经微信问）：微信 owner 无法应答 → 一并视为可解锁。
- 逃生指令大小写/全半角：先 trim，匹配中文词 + /cancel /reset；不做复杂归一，够用即可。

## 风险与注意

- 宽限期太短会把"正在生成但刚好瞬时 idle"误判放行 → 取 8s，且只在 status 确为 idle/waiting_input 时放行，working 一律不放。
- 自动解锁的回传依赖 pending 里存的 contextToken（微信回话凭证有时效）——失败走 best-effort 不影响解锁。
- stable 是编译产物，改完需重新构建同步才对日常实例生效（handoff 指引，不擅自动其服务）。

## 多模型 Plan 会审

跳过：小档（单文件行为补强，易回滚，方向由截图明确），不调外部模型。
