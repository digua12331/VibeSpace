# 微信单飞锁加逃生口 · 任务清单

- [x] 逃生指令：CANCEL_WORDS 处理（owner 校验后、pending 闸口前） → verify: build 通过
- [x] 状态感知：pending 闸口即时孤儿判定 + 拒绝话术补解锁提示（抽 classifyPendingGate 纯函数） → verify: build 通过
- [x] idle 事件订阅：自动解锁 + 通知 owner；working 取消定时器；resolve 清定时器 → verify: build 通过
- [x] scripts/wechat-deadlock-smoke.mjs 三条断言，挂 smoke:wechat-deadlock → verify: pnpm smoke:wechat-deadlock 20 项全过
- [x] 交付 handoff → verify: 首行为验收指引 + diff 清单
