# 终端输出背压防护 · 任务清单

- [x] 步骤 1：常量 + ClientCtx.closing + OutputQueue.bytes + import serverLog → verify: `pnpm -F @aimon/server build` 通过
- [x] 步骤 2：新增 sendFanout(ctx,data) 助手 + 四处 fan-out(broadcast/flushSessionOutput/exit/status)改用它,控制回复与 onClose 不动 → verify: `tsc` 通过;grep 确认 4 处 sendFanout + 控制回复仍 safeSend
- [x] 步骤 3：enqueueOutput 累加 Buffer.byteLength + 超 SESSION_QUEUE_FLUSH_BYTES 提前 flush;flushSessionOutput 清 bytes → verify: `tsc` 通过;flush 里 clearTimeout+timer=null 已有、bytes 归零、提前 flush 后 return 防二次空 flush
- [x] 步骤 4：构建验收 + 边界自查 → verify: `pnpm -F @aimon/server build` 成功;`git diff --name-only HEAD` 只含 packages/server/src/ws-hub.ts
