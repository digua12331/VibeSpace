# AI终端多开卡顿优化

## 大哥摘要

验收位置：左侧侧边栏的「+ 启动 AI / 终端」连续打开 5-6 个 claude/codex/gemini 终端，然后来回切换、滚动、输入文字，应该明显比现在顺，不再因为后台终端太多一起抢资源而卡。
这次只优化"同时开很多 AI 终端"的体感，不动你的项目数据、不改现有界面布局、不动现有终端整体保活方式（保活＝项目切换后旧终端不被销毁、回来就能接着用）。
唯一可能看得见的小变化：隐藏的终端再切回来时，偶尔需要 1-2 帧重新绘制画面，这是为了减少后台消耗主动做的取舍，不影响内容。
本 plan 已对照 `dev/memory/manual.md` 的"大哥只看大方向和验收"偏好，以及 `dev/ARCHITECTURE.md#2.2 WebSocket`、`#3.1 操作日志`、`#前端布局 / view` 的项目结构。

## 目标

1. **多 AI 终端场景降卡顿**：同时启动 6 个 AI 终端，只保留 1 个 active（active = 当前正在看的那个终端，其余隐藏在后台），浏览器里切换、滚动、输入没有明显卡顿；隐藏终端不再持续占用 WebGL（浏览器用显卡加速画字的能力）和 resize（窗口尺寸变化引发的页面重排）资源。
   - 验收：用浏览器打开应用，在左侧侧边栏「+ 启动 AI / 终端」连续打开 6 个 claude/codex/gemini 终端，观察切换、滚动、输入延迟。
   - 验收：用 `vibespace-browser-tester`（项目里跑浏览器真点真测的验收工具）跑同样场景，并记录 PASS/FAIL。

2. **降低 WS（WebSocket，网页和后端之间的长连接通道，专门收发终端输出）高频回调压力**：同一个 session（一次 AI 终端会话）的 output/replay/status/exit 消息走"按 session 精准订阅"；无 sessionId 的 hello/log/error/error-pattern-alert 仍走全局消息通道。
   - 验收：打开 6 个终端时，非当前终端有输出时不再触发所有终端的 UI 回调；hello/log/error-pattern-alert 仍能正常显示。
   - 验收：`pnpm -F @aimon/web build` 通过。

3. **合并终端输出 chunk（chunk = 后端分多次发来的小段输出）时不破坏终端内容**：16ms（一帧）内按原顺序拼接，不重排、不截断、不跨 session；遇到 exit/status/error 边界强制 flush（flush = 立刻把已经攒下的内容吐出去）。
   - 验收：长输出、彩色输出、TUI（终端里跑的交互界面，比如 claude 的菜单）输出、bracketed paste（终端粘贴模式专用协议）不乱序、不丢颜色、不吞字符。
   - 验收：后端相关类型检查/构建命令通过。

4. **日志降噪但不删审计**：input-submit（每次按 Enter 提交输入）这类用户输入日志不再高频刷屏，只在 IME composing（输入法组词中）异常组合、失败、payload（payload = 一次请求里夹带的数据）超过阈值时记录；新增或调整的 mutation（mutation = 会改状态/数据/文件的操作）仍保持 logAction/serverLog 起止配对。
   - 验收：LogsView（日志面板）能看到必要的开始/成功/失败日志；故意触发一次失败分支时能看到 ERROR。
   - 验收：`packages/server/data/logs/YYYY-MM-DD.log` 有对应 JSONL 落盘记录。

5. **每一批改动独立可验收**：P0/P1/P2（优先级一、二、三，P0 性价比最高最先做）各自完成后都必须跑类型检查，并有浏览器可观察结论。
   - 验收：每批结束时记录命令结果、浏览器观察项、实际 changed files 是否在该批白名单内。

## 非目标

- 不拆 `SessionView.tsx` 这个大型组件，不做"顺手重构"。
- 不改 `TerminalHost.tsx` 的全局保活策略，不改变当前终端页面的布局和操作入口。
- 不引入新的查询库；stale-while-revalidate（stale-while-revalidate = 先把上次缓存的旧数据显示出来，后台再去拉新数据替换）只放进现有 zustand store（zustand store = 前端的全局状态仓库）并参考 ChangesList/GitGraph 模式。
- 第一版不做"隐藏期间暂停 `term.write` 再靠 replay 补回输出"，这个风险太大，单独作为后续任务。

## 实施步骤

### P0（性价比最高，先做）

1. **P0-1**：在 `packages/web/src/ws.ts` 新增 `onSessionMessage(sessionId, cb)`，只负责 output/replay/status/exit；保留全局 `onMessage` 处理 hello/log/error/error-pattern-alert。
   - verify：打开终端后 output/replay/status/exit 能按 session 分发；LogsView 的 log 和 error-pattern-alert 仍正常出现；`pnpm -F @aimon/web build` 通过。

2. **P0-2**：在 `SessionView.tsx` 接入 `onSessionMessage`，避免所有终端都响应同一批 session 消息；不整体路由化 `onMessage`。
   - verify：同时开 6 个 AI 终端，只切换 active 终端，观察非 active 终端不再频繁触发 UI 更新；hello/log/error 无 sessionId 消息不丢。

3. **P0-3**：在 `packages/server/src/ws-hub.ts` 的 broadcast 入口做 16ms chunk 合并；保持原顺序拼接，不重排、不截断、不跨 session；exit/status/error 前强制 flush。
   - verify：连续输出、彩色输出、TUI 输出、bracketed paste 不乱；exit/status/error 到达前已攒 output 全部送出；后端构建/类型检查通过。

4. **P0-4**：WebGL 只挂在 active session 上；切换 active 时迁移 WebGL addon（xterm 的显卡加速渲染插件），不重建 Terminal 本体；active 才响应 ResizeObserver。
   - verify：切换终端时光标、buffer（buffer = 终端屏幕和历史滚动内容）、主题保留；Chromium 里 WebGL context 数量不随 6 个终端线性增长；输入延迟明显下降。

### P1

5. **P1-1**：隐藏终端 scrollback（scrollback = xterm 保留的历史滚动行数）降到 1000，并在隐藏期间禁止 fit()/WebGL 恢复尝试；WebGL 后台失败不反复恢复，只在 session 成为 active 时尝试一次，失败则该 session 降级到 DOM 渲染。
   - verify：隐藏终端不再持续触发布局和 WebGL 恢复；切回终端后最多 1-2 帧重画，内容可继续使用；失败降级时有明确日志，不崩页面。

6. **P1-2**：调整 input-submit 日志策略：不完全删除日志，只在 IME composing 异常组合、失败、payload 超阈值时记录；高频键盘事件只做幂等首次标记。
   - verify：正常输入不刷爆 LogsView；异常/失败/超大输入有日志；失败分支能看到 ERROR；落盘日志在 `packages/server/data/logs/YYYY-MM-DD.log` 可查。

7. **P1-3**：在 `packages/server/src/log-bus.ts` 对 `appendJsonl`（追加 JSONL 日志文件）做批量落盘，减少高频写文件压力；保持前端 log-from-client 仍能广播到 LogsView。
   - verify：LogsView 能实时看到日志；磁盘日志仍按日期落盘；meta（日志附带信息）保持 JSON 可序列化且小于 2KB。

### P2

8. **P2-1**：把 slashCommandsCache（斜杠命令缓存）放入 `packages/web/src/store.ts`，采用 stale-while-revalidate 模式，不引新库。
   - verify：再次打开相关命令列表时先显示旧数据、后台刷新；刷新中状态可见；`pnpm -F @aimon/web build` 通过。

9. **P2-2**：在 `packages/web/src/perf-marks.ts` 增加终端数量硬上限兜底和明确 UI 提示；超过上限不能 silently no-op（silently no-op = 用户点击没反应也没提示），必须告诉用户怎么恢复（例如关闭最早的终端）。
   - verify：达到上限时界面有清楚提示，并给出关闭旧终端/切换回收路径；不会无声点击无效。

10. **P2-3**：完整压力验收和收尾：同时开 6 个 AI 终端，只 1 个 active，记录 WS 回调数、Chromium WebGL context 数、输入延迟体感；跑类型检查和 `vibespace-browser-tester`。
    - verify：`pnpm -F @aimon/web build` 通过；浏览器验收 PASS；`git diff --name-only HEAD` 与 tasks.json `write_files` 白名单一致。

## 边界情况

- WebGL 切换 active 时必须保留光标位置、buffer、主题和滚动位置；迁移 WebGL addon 时不能重建 Terminal 本体，否则会造成闪烁、输入丢焦点或历史内容异常。
- WebGL 恢复失败时不能在后台反复重试；只在 session 成为 active 时尝试一次，失败后该 session 降级到普通渲染，并记录可排查日志。
- 16ms chunk 合并只能合并同一 session 的 output/replay，不允许跨 session 拼接；必须按收到顺序拼接，不能为了优化做重排。
- chunk 合并要考虑 ANSI 状态机（ANSI = 终端用 `\x1b[...` 开头的转义序列控制颜色、光标位置；状态机意思是一段控制序列不能被半截切开）和 bracketed paste；不能在半截控制序列处错误 flush 导致颜色串台或粘贴模式卡住。
- exit/status/error 到达时必须先 flush 已攒 output，再处理状态消息；否则用户会看到"进程结束了但最后几行输出丢了"。
- 隐藏终端 scrollback 降到 1000 后，隐藏期间太早的历史输出可能不完整；这是第一版性能取舍，不能靠暂停 term.write + replay 补偿。
- WS 路由必须保留 hello/log/error/error-pattern-alert 这类无 sessionId 消息的全局处理；否则连接状态、日志面板、错误循环提醒会失效。
- active 才响应 ResizeObserver，必须和 WebGL active 判断共用同一个 isActive 语义，避免出现"渲染没激活但 resize 还在跑"的半优化状态。
- xterm `disableStdin: true` 不能动；终端方向键直通 PTY（PTY = 后端的伪终端进程，AI 子进程就跑在它里面）已经有既定逻辑，任何键盘相关改动都必须保护 IME、textarea 焦点和 TUI 按键透传。
- 如果浏览器不是 Chromium，WebGL context 和内存指标可能不可用；验收记录要标明 unavailable，不把它误判为失败。

## 风险与注意

- **最大风险**是 WS 消息分发改错：如果把全局 `onMessage` 整体替换成按 session 路由，hello/log/error-pattern-alert 会丢，所以只能新增 `onSessionMessage(sessionId, cb)`，不能整体路由化。
- **第二大风险**是 chunk 合并破坏终端协议：ANSI、TUI、bracketed paste 都依赖字节顺序，合并窗口只能是 16ms（一帧），不能上 100ms，也不能跨 session 或截断半截输出。
- WebGL 优化必须"迁移而不是重建"：重建 Terminal 会导致光标、历史内容、主题、输入焦点风险扩大，违背本次"不改全局保活策略"的边界。
- 隐藏终端优化第一版只做 scrollback 降级和停 fit()/WebGL；不做暂停 term.write + replay，因为那会改变输出可靠性，风险超过本轮收益。
- 日志降噪不能变成删日志：项目规则要求用户可感知 mutation 有 logAction/serverLog 起止配对，input-submit 只能减少正常路径噪声，失败和异常必须保留。
- 后端日志 batching 只能降低落盘压力，不能解决 LogsView 噪音源头；必须先做前端 input-submit 降噪，再做后端批量写入。
- 硬上限兜底必须给用户看得见的提示和恢复路径，不能点击后无反应；否则会被误认为应用坏了。
- 本任务涉及前端 UI 和 WS 行为，交付前必须用 `vibespace-browser-tester` 做浏览器实测；不能只用类型检查代替人工可见验收。
- 关键文件边界要严格控制：核心应集中在 `SessionView.tsx`、`ws.ts`、`ws-hub.ts`、`log-bus.ts`、`store.ts`、`perf-marks.ts`；`TerminalHost.tsx` 只读不改全局保活策略。
- 参考记忆：`dev/memory/auto.md` 里"xterm/IME/TUI 优先稳定挂载层和显隐控制保活""高频键盘事件不要逐次打日志""stale-while-revalidate 直接放现有 store""Web 包用 pnpm -F @aimon/web build 兜底"都适用于本任务。

## 多模型 Plan 会审

> [Gemini 评审] 跳过：Gemini CLI 未安装（spawn gemini ENOENT）；按项目规则失败一次重试一次仍失败回退 Claude 单写，不阻塞 plan 交付。
> [Codex 评审] 不要整体路由化 onMessage，新增 onSessionMessage(sessionId, cb) 只负责 output/replay/status/exit，全局 onMessage 保留处理 hello/log/error-pattern-alert。合并 chunk 必须保持原顺序拼接，不重排不截断不跨 session，exit/status/error 边界强制 flush。WebGL 只挂在 active session 上，切换 active 时迁移而不重建 Terminal 本体。第一版只做隐藏终端 scrollback 降到 1000 + 隐藏期间禁 fit()/WebGL，不做暂停 term.write 靠 replay。input-submit 日志不能完全删，改为异常/失败/超阈值才打。
> [Codex 综合主笔] 采纳 P0 先收 WS 回调和 chunk 合并、再做 active-only WebGL 的顺序；放弃暂停 term.write + replay、拆 SessionView、引新查询库这几条扩范围方案，因为它们会改变终端可靠性或扩大任务面。
> [Claude 白话化兜底] 重写了大哥摘要把"在哪里验收"放到最前面；补充了 active / WebGL / WebSocket / chunk / flush / bracketed paste / ANSI 状态机 / TUI / payload / mutation / scrollback / buffer / stale-while-revalidate / zustand store / silently no-op / PTY 等术语首次出现的括号白话翻译；对照 `manual.md`（"大哥不懂代码只看大方向"、"完成 task 前自派 vibespace-browser-tester"）和 `auto.md`（保活策略不轻易动、stale-while-revalidate 放 store、高频键盘事件别打日志、`pnpm -F @aimon/web build` 兜底）已并入相关段落。
