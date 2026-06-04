# 终端输出背压防护 · Plan

## 大哥摘要

现在的问题:当某个终端(AI 或命令)疯狂刷屏、而你的浏览器一时收不过来(比如标签页切到后台、或者你是远程访问网络慢),后端会把发不出去的数据**无上限地堆在内存里**,堆到最后可能把后端拖垮、整个页面卡死。这次给后端加一道"刹车"(backpressure,背压):某个浏览器连接堆积的待发数据超过上限时,后端就**主动断开这一个慢连接**,前端会自动重连并把终端最近一屏内容重新画出来(这套重连+重画的机制现在就有,不用改)。改完只动后端一个文件,**不动你的任何数据、不改界面长相**,其它正常的终端也完全不受影响。

诚实提醒:在你自己这台机器上(localhost,本地回环)网络太快,几乎堆不到上限,所以**本机很难"看到"卡死被治好**——这道刹车主要是给"远程访问 / 后台标签页 / 服务器内存防爆"兜底的保险,平时不该触发。

## 目标

给 WebSocket(浏览器和后端之间的长连接管道)输出加两道内存上限,堵住"输出洪峰把后端内存堆爆 / 一个慢连接拖垮所有人"的隐患。

**可验证的验收标准:**
1. 后端构建 + 类型检查通过:`pnpm -F @aimon/server build`(TypeScript 编译,既是构建也是类型检查)成功、无报错。
2. 代码层面可核查:`safeSend` 的 fan-out(一对多广播)路径在发送前都会检查 `bufferedAmount`(浏览器连接里"已塞进去但还没发出去"的字节数);超 8MB 的连接被 `close()` 且只记一条 warn 日志。
3. 浏览器可观察(给大哥按图验收):开一个会话,跑狂刷屏命令(如 shell 里 `while true; do echo xxxx; done`),页面**不冻死**;正常情况下终端持续滚动。若极端到触发了断开,会看到终端短暂"重连一下又恢复",不是白屏卡死。
4. 日志可观察:真触发慢连接断开时,LogsView(浏览器里的日志面板)能看到 `scope=ws` 的一条 warn 条目,并落盘到 `packages/server/data/logs/YYYY-MM-DD.log`。

## 非目标 (Non-Goals)

- **不改前端**:断开后的恢复(重连 + 重新拉取终端缓冲 replay)用现有逻辑,不动 `ws.ts` / `SessionView.tsx`。
- **不暂停 PTY、不做限速、不做丢帧**:这些会暂停真实进程或污染终端显示,扩大用户可见行为,本轮不做。
- **不引入测试框架**:packages/server 目前**没有任何测试基建**(无 vitest/jest、无 test 脚本、零测试文件)。Codex 建议补的单元测试本轮不做(等同 dev/issues.md 里 #6"给 server 加测试"那条——引入测试框架是独立的项目级决定),验收靠构建 + 人工。
- **不改 pty-manager 的 200KB ring buffer 大小**。

## 实施步骤

只动 `packages/server/src/ws-hub.ts` 一个文件。

1. **加两个常量 + ClientCtx 加 closing 标志**
   - `const CLIENT_BUFFER_HARD_CAP_BYTES = 8 * 1024 * 1024;`(慢连接断开阈值,8MB)
   - `const SESSION_QUEUE_FLUSH_BYTES = 256 * 1024;`(单 session 合并队列提前 flush 阈值,256KB;PTY ring buffer 只有 200KB,队列堆到这量级再等 16ms 没意义)
   - `interface ClientCtx { socket; subs; closing?: boolean }`
   - verify:`tsc` 通过。

2. **新增 `sendFanout(ctx, data)` 助手,fan-out 路径统一改用它**(采纳 Codex 评审 #2/#3)
   - 逻辑:`if (ctx.closing) return;` → `if (ctx.socket.bufferedAmount > CLIENT_BUFFER_HARD_CAP_BYTES) { ctx.closing = true; serverLog('warn','ws',\`slow client disconnected: bufferedAmount=…\`, {meta:{bufferedAmount, cap}}); try{ctx.socket.close()}catch{}; return; }` → 否则 `safeSend(ctx.socket, data)`。
   - 顺序必须是 set closing → serverLog → close(Codex #5),且 closing 的连接在所有 fan-out 路径都跳过(Codex #6)。
   - 把 `flushSessionOutput`、exit 循环、status 循环、module-level `broadcast()` 四处的 `safeSend(c.socket, ...)` 改为 `sendFanout(c, ...)`(Codex #14/#18:log-bus 的 broadcast 和 exit/status 边界消息也要受 cap)。
   - **保持不变**:`handleClientMsg` 里给单个请求方的回复(error/hello/replay 响应)继续走 `safeSend`——一次性小响应,不是洪峰源(Codex #19:replay 一次约 200KB,远低于 8MB,接受)。
   - **保持不变**:`onClose`(关服)里的 `c.socket.close()` 不走 sendFanout,正常 shutdown 不打 warn(Codex #16)。
   - serverLog 从 log-bus 引入:扩展现有 `import { persistClientLog, handleClientLogRoundtrip } from "./log-bus.js"` 加 `serverLog`(log-bus 与 ws-hub 本就互相 import,运行时调用不触发循环依赖问题,Codex #15 已核查)。
   - verify:`tsc` 通过;人工读代码确认四处 fan-out 已替换、控制回复未动。

3. **`enqueueOutput` 加队列字节上限 → 提前 flush**(修 B)
   - OutputQueue 加 `bytes: number` 字段;每次 push 用 `Buffer.byteLength(data, 'utf8')` 累加(Codex #9:不能用 `data.length`,中文/ANSI 会低估字节)。
   - push 后:`if (q.bytes >= SESSION_QUEUE_FLUSH_BYTES) flushSessionOutput(sessionId);` 立即吐出,不等 16ms。
   - `flushSessionOutput` 里清空 chunks 时同步把 `q.bytes = 0`,并照旧清 timer(Codex #10/#11:提前 flush 后 timer 必须清掉,避免 16ms timer 二次 flush 空队列;flush 对空队列保持 no-op)。
   - verify:`tsc` 通过;人工确认 timer 不残留(flush 里已有 `clearTimeout`+`timer=null`)。

4. **构建验收**
   - `pnpm -F @aimon/server build` 成功。
   - `git diff --name-only HEAD` 只含 `packages/server/src/ws-hub.ts`。

## 边界情况

- **同 session 一快一慢两个 client**:慢的被断开,快的继续收完整输出(Codex #12,预期行为,写成验收边界)。
- **慢 client 断开期间输出 > 200KB**:重连后只能 replay 最近 200KB,更早的会被 ring buffer 裁掉——这是**现有的数据影响**(不是本次引入),属可接受(Codex #13)。
- **断开日志自身会广播**:`serverLog('warn','ws',...)` 经 log-bus → `broadcast()` → 又走 sendFanout 检查同一个慢 client,但此时它 `closing===true` 被跳过,不会二次 close、不会日志风暴。
- **session 退出 / disposeSessionQueue 时序**:dispose 前 flush/清 timer 照旧;提前 flush 不改变 dispose 路径(Codex #17)。
- **exit/status 边界消息**:flush 之后这两条本身也过 cap 检查(已超限的 client 不再硬塞,Codex #18)。

## 风险与注意

- **本机难复现**:localhost 回环极快,`bufferedAmount` 几乎到不了 8MB,所以本机人工验收主要验"页面不死 + 重连重画链路通",真正的"压到上限触发断开"很难自然触发(Codex #20)。这点已在大哥摘要里向大哥讲明。
- **8MB / 256KB 是经验值**:8MB 偏保守,避开普通网络抖动误杀;256KB 略高于 PTY 的 200KB ring。若日后发现误杀或仍堆积,调这两个常量即可。
- **假设**:前端 `ws.ts` 重连 + `SessionView` 的 `onConnectionChange→requestReplay→term.reset()+write` 链路按现状工作(已读代码确认)。本次不改前端,把它列为"依赖现状",不是本轮验证主体(Codex #21)。

## 多模型 Plan 会审

> [Codex 评审] "只在 ws-hub.ts 做背压、复用现有重连+replay 是最小改动路径";建议抽 `sendFanout(ctx,data)` 只给广播/输出/exit/status 用、控制回复留 safeSend;`socket.close()` 在 for...of clients 里安全(异步关闭);字节数用 `Buffer.byteLength` 不用 `.length`;提前 flush 要清 timer 防二次空 flush;8MB/256KB 量级合理;不需要引入丢帧/限速/暂停 PTY/前端改造。
> [Codex 综合主笔] 本轮由 Claude 综合主笔(未二次派 Codex 定稿):Codex 的 25 条评审已足够具体,逐条采纳了 #2/#3(抽 sendFanout)、#5/#6(closing 顺序与全路径跳过)、#9(Buffer.byteLength)、#10/#11(flush 清 timer)、#13(数据影响写入风险)、#14/#18(log-bus broadcast 与 exit/status 也受 cap)、#16(shutdown 不打 warn)、#24(常量带 _BYTES);**未采纳** #20/#22/#23(补单元测试)——因 packages/server 无测试基建,引入测试框架超出本轮外科式范围,与 issues #6 同一理由,改为构建+人工验收。
> [Claude 白话化兜底] 大哥摘要重写为"加刹车、断慢连接、自动重连重画、不动你数据界面"白话,并诚实补上"本机网络太快很难触发,这是给远程/后台标签兜底的保险",避免给大哥造成"本机就能看到卡死被治好"的错误预期;全文术语(backpressure/bufferedAmount/fan-out/ring buffer/PTY/replay)均加括号白话。
