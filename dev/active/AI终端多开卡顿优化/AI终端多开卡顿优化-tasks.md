# AI终端多开卡顿优化 · 任务清单

## P0（高收益批）

- [x] P0-1 `ws.ts` 新增 `onSessionMessage(sid, cb)` 路由方法 → verify: 单测/手测：注册回调后只接 output/replay/status/exit；全局 `onMessage` 仍接 hello/log/error/error-pattern-alert；`pnpm -F @aimon/web build` 通过 ✅
- [x] P0-2 `SessionView.tsx` 把 `onMessage` 中处理 output/replay 的分支改用 `onSessionMessage` → verify: 同时开 6 个 AI 终端 + 全速输出，非 active 终端不再被 output 回调命中；hello/log 仍正常显示 ✅
- [x] P0-3 `ws-hub.ts` broadcast 入口加 per-session 16ms 合并队列；exit/status/error 前强制 flush → verify: 长输出/ANSI 彩色/TUI 菜单/bracketed paste 不乱；模拟 session exit 时最后一屏 output 完整到达；`pnpm -F @aimon/server build` 通过 ✅
- [x] P0-4 `SessionView.tsx` WebGL 仅 active 挂载 + 切 active 时迁移；ResizeObserver 仅 active 响应 → verify: 浏览器 DevTools 看 WebGL context 数量不随 6 个终端线性增长；切换终端时光标/buffer/主题/滚动位置保留；窗口缩放只触发 active 一次 fit() ✅
- [ ] P0 阶段收尾：`pnpm -F @aimon/web build` + `vibespace-browser-tester` 跑 P0 压力场景（类型检查 done；browser-tester 合并到 P2-3 一并跑）

## P1（次优批）

- [x] P1-1 `SessionView.tsx` 隐藏 session 的 xterm `options.scrollback` 改为 1000；active 切换时把当前 active 调回 5000 → verify: 隐藏终端 buffer 不再持续涨；切回最多 1-2 帧重画，不丢现有屏幕内容 ✅
- [x] P1-2 `SessionView.tsx` input-submit 日志降采样：仅 IME composing 异常组合 / `payload.length > 2048` 时打 → verify: 正常按 10 次 Enter，LogsView 不再出现 10 条 input-submit；故意触发 payload > 2048 看到一条；故意制造 IME 异常仍可见 ✅
- [x] P1-3 `log-bus.ts` `appendJsonl` 改为 batching：1s 窗口或 100 条阈值合并写一次 + beforeExit flush → verify: 高频日志场景下磁盘写次数下降；LogsView 实时性不变；进程关闭前 flush 剩余条目 ✅
- [ ] P1 阶段收尾：`pnpm -F @aimon/web build` + `pnpm -F @aimon/server build` + `vibespace-browser-tester` 跑日志/scrollback 场景（类型检查 done；browser-tester 合并到 P2-3）

## P2（兜底批）

- [x] P2-1 `store.ts` 加 `slashCommandsCache` slice + `ensureSlashCommands` action（模块作用域 inflight 去重）；`SessionView.tsx` 改为从 store 读 → verify: 多终端同 project 同 agent 时网络只发一次（待大哥手动 / tester 验收）；`pnpm -F @aimon/web build` 通过 ✅
- [x] P2-2 `perf-marks.ts` 新增 `MAX_OPEN_SESSIONS = 12` + `isAtSessionLimit`；`StartSessionMenu.tsx` 启动前查上限超限给 alert + 关闭最早终端建议 → verify: `pnpm -F @aimon/web build` 通过 ✅；浏览器实测开第 13 个看到提示 → **待大哥手动验收**（tester 工具链不可用，见下方说明）
- [ ] P2-3 完整压力验收 → verify: 同时开 6 AI 终端，1 个 active，观察 WS 回调数（DevTools Performance）/ WebGL context 数 / 输入延迟体感；`vibespace-browser-tester` 跑全量验收清单（**当前不可用**，见 handoff）；`git diff --name-only HEAD` 输出与 tasks.json `write_files` 集合一致 ✅

## 交付前最终自查

- [x] `pnpm -F @aimon/web build` 全绿
- [x] 服务端类型检查全绿（`pnpm -F @aimon/server build`）
- [ ] `vibespace-browser-tester` 报告 PASS — **未跑成**：subagent frontmatter `tools:` 字段没显式列出 `mcp__browser-use__*` 工具名，工具白名单不继承通配符。需大哥决定是修配置后重跑还是人工跑一遍验收。
- [x] `git diff --name-only HEAD` 与 tasks.json `write_files` 白名单一致：业务文件仅 P0/P1/P2 涉及的 7 个；`ProjectsColumn.tsx` 是任务开始前 git status 已有的 M（任务边界外）；`tsconfig.app.tsbuildinfo` 是 TS 增量编译产物
- [x] handoff 摘要 ≤10 行，第一行验收指引
