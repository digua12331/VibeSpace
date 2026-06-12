# 终端输出背压防护 · Context

## 关键文件

**会改(本次边界,只此一个):**
- `packages/server/src/ws-hub.ts`
  - L11-14 `interface ClientCtx` → 加 `closing?: boolean`
  - L20-23 `broadcast()` → 内部 `safeSend(c.socket,data)` 改 `sendFanout(c,data)`
  - L37 `OUTPUT_FLUSH_MS` 附近 → 加 `CLIENT_BUFFER_HARD_CAP_BYTES`、`SESSION_QUEUE_FLUSH_BYTES`
  - L39-42 `interface OutputQueue` → 加 `bytes: number`
  - L46-60 `flushSessionOutput` → 清 chunks 时 `q.bytes = 0`;循环里 `safeSend`→`sendFanout`
  - L62-75 `enqueueOutput` → 累加 `Buffer.byteLength(data,'utf8')`;超 `SESSION_QUEUE_FLUSH_BYTES` 立即 flush
  - L113-126 exit 循环 / L128-140 status 循环 → `safeSend`→`sendFanout`
  - L292-298 `safeSend` 下方 → 新增 `sendFanout(ctx, data)`
  - L6 import → 加 `serverLog`
  - **不动**:handleClientMsg 里所有给请求方的单发回复(error/hello/replay 响应)保持 `safeSend`;onClose 关服 `c.socket.close()` 保持原样

**只读(参考,不改):**
- `packages/server/src/pty-manager.ts` L48 `MAX_BUFFER_BYTES=200*1024`、L209-223 ring buffer trim + emit、L291-293 `getBuffer`
- `packages/server/src/log-bus.ts` L6 `import { broadcast } from "./ws-hub.js"`(已存在的反向 import)、L164 `serverLog`
- `packages/web/src/ws.ts` L87-91 onclose→reconnect、L56-65 onopen 重订阅
- `packages/web/src/components/terminal/SessionView.tsx` L521-522 subscribe+replay、L534-544 replay→term.reset()+write、L548-556 onConnectionChange→requestReplay

## 决策记录

- **断开慢 client,不丢帧、不暂停 PTY**:xterm 状态是累积的(ANSI 转义跨 write),中途丢帧会污染显示且无恢复触发;暂停 PTY 会冻结真实进程、且这是 fan-out(多 client 订阅同一 session),暂停会拖累所有人。断开 + 复用现有 replay(server 有 200KB ring buffer)是唯一干净的恢复路径。资深工程师视角:这是 WS fan-out hub 的标准"slow consumer = disconnect"模式,不算过度设计。
- **抽 `sendFanout` 而非改 `safeSend`**:safeSend 同时服务"一对多广播"和"给请求方单发回复"两类;只有前者是洪峰源、需要 cap+断开。混在一起会让 replay/hello/error 也被卷进断开策略,语义变浑(Codex #3)。新增一个 ~8 行助手,边界清晰。
- **提前 flush 而非丢弃(修 B)**:超 256KB 立即 flush 不丢数据,只是早发;早发的字节若打到慢 client,由修 A 的 bufferedAmount cap 兜住。两道防线职责分离:B 管 server 端合并队列内存,A 管单 client socket 缓冲内存。
- **不写自动化测试**:packages/server 无测试框架(零 test 文件/无 test 脚本/未装 vitest)。引入测试基建是独立项目级决定(= issues #6),本轮外科式改动不夹带。验收 = 构建 + 人工。
- **常量量级**:8MB(偏保守,避开普通抖动误杀)、256KB(略高于 200KB ring)。经验值,可后调。

## 依赖与约束

- **serverLog 循环依赖**:log-bus 已 `import { broadcast } from ws-hub`,ws-hub 已 import log-bus 的 `persistClientLog` 等。再加 `serverLog` 不引入新环——ES module 循环只要不在加载期调用就安全,serverLog 在运行时(函数内)调用,与现有 persistClientLog 同模式。
- **前端恢复链路按现状工作**:reconnect(1s/2s/5s)→ onopen 重订阅 → onConnectionChange 触发 requestReplay → term.reset()+write 200KB。本次不改,列为"依赖现状"。
- **操作日志**:慢 client 断开是离散保护事件,记**单条** `serverLog('warn','ws',...)`(非起止配对);用 `closing` 标志保证每个慢 client 只记一次,防日志风暴。符合"轮询/心跳豁免、离散事件单条"的日志规则。
