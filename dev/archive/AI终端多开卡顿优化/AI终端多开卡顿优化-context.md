# AI终端多开卡顿优化 · Context

## 关键文件

### 会改（write）

| 文件 | 改动 | 批次 |
|---|---|---|
| `packages/web/src/ws.ts` | 新增 `onSessionMessage(sid, cb)` 路由方法；保留全局 `onMessage` | P0-1 |
| `packages/web/src/components/terminal/SessionView.tsx` | 接入 `onSessionMessage`；WebGL 仅 active；ResizeObserver 仅 active；隐藏 scrollback 1000；input-submit 日志降噪 | P0-2, P0-4, P1-1, P1-2 |
| `packages/server/src/ws-hub.ts` | broadcast 入口加 16ms 合并 + exit/status/error 强制 flush | P0-3 |
| `packages/server/src/log-bus.ts` | `appendJsonl` 改 batching（1s 窗口 / 100 条阈值） | P1-3 |
| `packages/web/src/store.ts` | 新增 `slashCommandsCache` slice（stale-while-revalidate） | P2-1 |
| `packages/web/src/perf-marks.ts` | 新增终端数硬上限常量 + 提示 hook | P2-2 |
| `packages/web/src/components/StartSessionMenu.tsx` | 启动前查上限，超限给 toast/alert 提示 + 关闭旧终端建议 | P2-2 |

### 会读（read，不改）

- `packages/web/src/main.tsx`（全局 onMessage 路由的真源，确认 hello/log/error-pattern-alert 路径不破）
- `packages/web/src/components/terminal/TerminalHost.tsx`（保活策略，**只读不改**）
- `packages/web/src/components/ChangesList.tsx` / `GitGraph.tsx`（stale-while-revalidate 范例）
- `packages/web/src/api.ts`（`listSlashCommands` 签名）
- `packages/web/src/types.ts`（ServerMsg / ClientMsg 不动）
- `packages/server/src/pty-manager.ts`（emit('output') 起点；合并放 ws-hub 不动 pty-manager）

## 决策记录

### 决策 1：WS 路由用"新增"而非"替换"
不把 `onMessage` 整体改成按 sessionId 路由，新增 `onSessionMessage(sid, cb)` 只负责 output/replay/status/exit。
**为什么**：`main.tsx:23` 是 hello/log/error/error-pattern-alert 这类无 sessionId 消息的唯一处理点；整体路由化会让连接状态、日志面板、错误循环提示静默失效。Codex 评审 #1+#2 已明确警告。
**资深工程师过度设计检查**：✅ 不过度——增量加一个方法，原有调用点不动。

### 决策 2：chunk 合并放在 `ws-hub.ts` 而非 `pty-manager.ts`
PtyManager 保持事件语义不变（一个 chunk 一个 emit），合并发生在 server→client broadcast 起点。
**为什么**：`pty-manager.ts:198` 的 `proc.onData` 同时维护 200KB ring buffer 和 `lastOutputAt`，这些时间戳要按 chunk 实时更新；如果把合并塞这里，buffer 还是要按 chunk 累加。合并的目标是减 ws 消息数，不是减 buffer 写次数。放 ws-hub 改动最小、语义最清。
**资深工程师过度设计检查**：✅ 不过度——单点改动，没引入新模块。

### 决策 3：合并窗口 16ms / 一帧
不上 100ms。
**为什么**：ink-based TUI（Claude/Codex/Gemini 的菜单）依赖逐帧重绘的体感连续性，>16ms 用户能感知到刷新变钝；Codex 评审 #6 直接点过这条。
**资深工程师过度设计检查**：✅ 数值是 60fps 一帧的自然单位，不是拍脑袋。

### 决策 4：边界消息强制 flush 顺序
合并队列在收到 `exit`/`status`/`error` 时先 flush 已攒 output，再发边界消息。
**为什么**：进程结束前最后一屏内容必须先到，否则用户体验是"进程结束了但最后几行输出丢了"。Codex 评审 #5 已强调。

### 决策 5：WebGL "迁移"而非"重建"
切换 active 时 `dispose()` 旧 active 的 WebglAddon，给新 active `loadAddon(new WebglAddon())`，**不重建 Terminal 本体**。
**为什么**：Terminal 重建会丢光标、buffer、滚动位置、theme 状态、输入焦点；记忆 `auto.md` 里"xterm 优先稳定挂载层和显隐控制保活"明确指出。WebGL 仅是渲染加速层，dispose/load 不影响 buffer 内容。

### 决策 6：WebGL 失败只在成为 active 时尝试一次
不在后台轮询恢复。
**为什么**：背景反复恢复会重蹈"WebGL context 数量爆炸"的覆辙，Codex 评审 #9 直接点过。失败后 session 永久走 DOM 渲染（直到下次完整重启）。

### 决策 7：隐藏 scrollback 降级而非暂停 write
第一版只把隐藏 session 的 `scrollback` 上限降到 1000；不做"隐藏期间暂停 term.write"。
**为什么**：暂停 write + 回切时 replay 大文本会撑爆 xterm writeBuffer，且改变"后台终端是否还能完整恢复"的用户感知契约，失败成本高。Codex 评审 #10、#11 评级最大风险项。后续可单独立项。

### 决策 8：input-submit 日志降采样而非删除
保留三类触发：IME composing 异常组合、提交失败、payload 长度超阈值（拍 2KB）。
**为什么**：CLAUDE.md 操作日志硬规则要求用户可感知 mutation 必须 logAction 起止配对；纯删违反规则。降采样既减噪又保审计。Codex 评审 #13 已点过。

### 决策 9：终端数硬上限放在启动入口
在 `StartSessionMenu` 启动前查 `sessions.length >= MAX_OPEN_SESSIONS`（拍 12 个）就提示并阻断，给"关闭最早终端"快捷动作。
**为什么**：非 Chromium 没有 `performance.memory` 兜底，没有任何机制阻止用户开 20 个终端拖死浏览器。Codex 评审 #16 强调必须有可见提示和恢复路径。

### 决策 10：单 PR 三批 commit
不拆 PR。每批一个 commit，每批结束跑类型检查 + 浏览器观察项 verify。
**为什么**：Codex 评审 #23、#24 建议；改动语义高度耦合，拆 PR 反而要重复跑同一份压力验收。

## 依赖与约束

- **NodeNext ESM**：`packages/server` 内相对 import 必须带 `.js` 后缀（含新增/修改的导入语句）
- **TypeScript 严格**：no `any`、no 隐式 `any`；新签名要带显式类型
- **ws-hub.ts 与 main.tsx 的契约**：ServerMsg 类型枚举不能改（`types.ts:192` 是手抄镜像，改一边要手动改另一边）；本次只在 hub 端做"按帧合并 output 字符串"，不新增消息类型
- **xterm `disableStdin: true` 不可动**：键盘相关 effect 即使附近改了，IME / textarea 焦点 / TUI 透传守卫顺序保持不变
- **logAction / serverLog 起止配对**：本次新增的 mutation 路径（如果有）必须满足；P1-2 的降采样要保留失败分支日志
- **类型检查命令**：`pnpm -F @aimon/web build` 是 web 包 verify 入口；server 包用 `pnpm -F @aimon/server build`（如有）或 `tsc -p packages/server/tsconfig.json --noEmit`
- **浏览器验收工具**：`vibespace-browser-tester` 子代理（manual.md 2026-05-06）；交付前 AI 自派一次，有问题汇总给大哥
- **读写白名单严格执行**：tasks.json `write_files` 列表外的文件改动视为越界，verify 时跑 `git diff --name-only HEAD` 比对
- **破坏性变更协议判定**：本任务新增 `onSessionMessage` 不算重命名/删除导出符号；`ws-hub.ts` 内部行为变化不动 ServerMsg 类型，不触发破坏性协议；其余改动均为函数内部行为调整，无需 grep 引用图
