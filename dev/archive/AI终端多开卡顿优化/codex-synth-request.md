VibeSpace 多 AI 终端卡顿优化 plan 综合主笔——把 Claude 草案 + 你刚才的 28 条评审 + 项目记忆合并成最终 plan.md，**完整可落地**。Gemini 调用失败（gemini CLI 未安装 ENOENT），按项目规则跳过，plan.md 末尾"## 多模型 Plan 会审"段记一行原因。

【输出位置】
请直接把最终 plan.md 内容贴回给我（我会写到 `dev/active/AI终端多开卡顿优化/AI终端多开卡顿优化-plan.md`）。

【硬性 plan 结构（CLAUDE.md 规定）】
- # 标题
- ## 大哥摘要（3-5 行白话，第一行第一件事就是"用户能看到什么变化"，所有专业术语括号翻译，给非程序员看的）
- ## 目标（可验证的验收标准，能跑的命令/能观察的指标/能在浏览器看的现象）
- ## 非目标（1-3 行明确不做什么——别把"拆 SessionView 巨型组件、改全局保活策略、加新查询库"扯进来）
- ## 实施步骤（有序列表，分 3 批：P0/P1/P2，每条带 verify 小尾巴）
- ## 边界情况（必须覆盖：WebGL 切换时的光标/buffer/主题保留、合并 chunk 对 ANSI 状态机/bracketed paste 的影响、隐藏终端的 scrollback 降级、ws 路由对 hello/log/error 这类无 sessionId 消息的保留）
- ## 风险与注意（按你前面列的 28 条最危险的几条展开）
- ## 多模型 Plan 会审（按下方模板填）

【你前面 28 条评审里的硬约束（必须吸收进 plan）】
1. #2 不要整体路由化 onMessage，新增 `onSessionMessage(sessionId, cb)` 只负责 output/replay/status/exit，全局 `onMessage` 保留处理 hello/log/error-pattern-alert
2. #3 合并 chunk 必须保持原顺序拼接，不重排不截断不跨 session，exit/status/error 边界强制 flush
3. 16ms 合并窗口（一帧），不要上 100ms
4. #1+#6 WebGL 只挂在 active session 上，切换 active 时迁移而不重建 Terminal 本体
5. WebGL 后台不反复尝试恢复，只在成为 active 时尝试一次，失败本 session 降级
6. #4 第一版只做"隐藏终端 scrollback 降到 1000 + 隐藏期间禁 fit()/WebGL"，**不做**"暂停 term.write 靠 replay"——后者风险太大，单独后续任务
7. #5 active 才响应 ResizeObserver，跟 #1 同一个 isActive 判断，自然并进
8. #7 input-submit 日志不能完全删（违反 logAction 硬规则），改为只在 IME composing 异常组合 / 失败 / payload > 阈值时打——这是日志降噪不是删除审计
9. #8 batching 不解决 LogsView 噪音问题，必须先做 #7 减少源头再做后端批量落盘
10. #9 stale-while-revalidate 放 zustand store，不引新库，仿 ChangesList/GitGraph 模式
11. #10 硬上限兜底必须有明确 UI 提示和可恢复路径，不能 silently no-op
12. **P0 内顺序：#2 → #3 → #1+#6（#5 并进 #1）**
13. **不改 SessionView 全局保活策略**（TerminalHost 不动）
14. **单任务 3 批 commit，不拆 PR**
15. 每批独立验收：类型检查 + 浏览器观察项
16. 压力验收场景：同时开 6 个 AI 终端、只 1 个 active，观察 WS 回调数/Chromium WebGL context 数/输入延迟

【项目硬约束（CLAUDE.md + 记忆）】
- 所有用户可感知 mutation 必须 logAction 前端 + serverLog 后端起止配对
- 落盘 packages/server/data/logs/<date>.log
- TypeScript 严格，packages/web 用 `pnpm -F @aimon/web build` 类型检查兜底
- 路由文件统一 zod 校验 + try/catch + serverLog 起止
- packages/server NodeNext ESM 相对 import 必须带 `.js` 后缀
- 写 mutation 必须用 logAction，高频键盘事件用幂等日志只首次标记
- 终端方向键直通 PTY 那套已经做了，xterm `disableStdin: true` 不能动
- 验收涉及浏览器观察项必须 vibespace-browser-tester 跑

【关键文件】
- packages/web/src/components/terminal/SessionView.tsx（1300+ 行，单文件改动核心）
- packages/web/src/components/terminal/TerminalHost.tsx（不改全局保活策略）
- packages/web/src/ws.ts（AimonWS 新增 onSessionMessage 路由）
- packages/server/src/pty-manager.ts（保持事件语义不变）
- packages/server/src/ws-hub.ts（在 broadcast 入口加 16ms flush）
- packages/server/src/log-bus.ts（appendFile 改 batching）
- packages/web/src/main.tsx（保留全局 onMessage）
- packages/web/src/store.ts（加 slashCommandsCache slice）
- packages/web/src/perf-marks.ts（终端数上限 + 提示）

【大哥摘要要点（你自己组织语言，但必须覆盖）】
- 主要变化：同时开多个 AI 终端时浏览器不再明显卡顿（特别是 5 个以上）
- 在哪里看：「左侧侧边栏的「+ 启动 AI / 终端」打开多个 claude/codex/gemini 后，切换、滚动、输入都不卡」
- 风险面：不动数据、不动已有界面布局；可能感知到的变化是隐藏终端再切回时偶尔需要 1-2 帧重画

【多模型 Plan 会审段模板】
```md
## 多模型 Plan 会审

> [Gemini 评审] 跳过：Gemini CLI 未安装（spawn gemini ENOENT）
> [Codex 评审] <你前面 28 条里挑 3-5 句最关键的引用>
> [Codex 综合主笔] <一句话说明综合时的取舍：采纳了什么、放弃了什么、为何>
> [Claude 白话化兜底] 待 Claude 通读后补
```

请直接给最终完整 plan.md 内容。
