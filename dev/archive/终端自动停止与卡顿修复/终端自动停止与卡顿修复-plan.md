# 终端自动停止与卡顿修复 · plan

## 大哥摘要

查清楚了，你说的两个毛病各有真凶，**都不是插件**：

1. **"终端放着不动也会停"** —— VibeSpace 里有个 5/13 加进来的功能：终端闲置 15 分钟就被自动关掉（叫"休眠"，sweeper 每 30 秒扫一遍）。你离开一会儿回来，终端就"没了"。这就是你说的"之前优化导致终端停止"。
2. **"整个电脑都会卡"** —— 主因有两个：(a) VibeSpace 会把你**开过的每一个终端**都在后台留着不放（哪怕你早就不看了），开多了就一直耗内存/CPU；(b) 你电脑上现在跑着 **26 个后台小程序、占 1.8 GB 内存**，每开一个 AI 会话都会带上 8 个插件和一堆配套服务。插件是其中一个加重因素，但**不是终端停止的原因，也不是卡顿的主因**。

打算分三步修：① 把"闲置自动关终端"默认关掉，你的终端不会再自己消失；② 让 VibeSpace 只保活你正在用的少数几个终端，其余收起来省资源；③ 帮你把用不到的插件关掉，减轻每次开会话的负担。

**不会动你的项目数据、不会动 AI 会话里跑过的内容、不会动代码仓库。** 关掉的插件随时能在「技能」面板点回来。

## 目标

修复两个用户可感知的问题，验收标准如下（UI 改动，含浏览器可观察项）：

- **P1 终端不再自己停**：在 VibeSpace 开一个 AI 会话，**放置 16 分钟不操作**，回来后会话仍在、状态不是"已休眠"；「日志」面板里不再出现 `scope=session action=hibernate-auto` 的条目；「设置」对话框里"闲置自动休眠"开关默认显示为**关**。
- **P2 前端保活减负**：开 ≥8 个跨 2 个以上项目的会话，切到其中一个项目时**切换流畅不卡顿**；「性能」面板里观察，开很多会话后前端内存不再无限增长（非当前项目的终端不再常驻 xterm 实例）。
- **P3 插件瘦身**：按确认的清单关掉若干插件后，**新开一个 Claude 会话明显比之前快**；任务管理器里 node 进程数较修复前下降。

## 非目标 (Non-Goals)

- 不重写终端架构 / 不动 `pty-manager` 的进程模型。
- 不动 AI 会话本身（不改 Claude/Codex/Gemini 的启动参数、不动会话历史数据）。
- 不做 Codex 评审里提到的"WebSocket 输出 backpressure（输出洪峰限流）"——那是另一类问题（疯狂刷屏时卡），与本次"稳态卡顿 + 终端停止"不同。单独记进 `dev/issues.md`，不在本轮。
- 不删除"休眠"功能本身（保留设置项，只改默认值），用户想省资源仍可手动开。

## 实施步骤

### 步骤 1 — 终端不再自动停（P1）
- 改 `packages/server/src/app-settings.ts` 的 `DEFAULTS.hibernation.enabled` → `false`。当前磁盘上的 `data/app-settings.json` 没写 `hibernation` 段，读取时会回落到默认值，改默认即刻生效。
- 确认 `SettingsDialog` 里休眠开关读的是同一份设置，关态能正确展示、用户手动开仍可用。
- 验证：服务重启后，sweeper 每 tick 在 `hibernation.enabled === false` 处提前 return，不再 kill 任何会话。

### 步骤 2 — 前端只保活在用的终端（P2）
- 改 `packages/web/src/components/terminal/TerminalHost.tsx`：把"渲染全部 sessions 的 SessionView"改成"有预算的保活"——常驻当前项目 + 当前 active 会话 + 最近少量会话的真实 xterm；其余会话只留标签，点开时再挂载并 replay 历史。
- 现有的 2GB 内存兜底（`keepAliveDegraded`）保留，作为极端情况的二道防线。
- 不动 `SessionView` 内部生命周期（参见 memory：xterm/IME/TUI 优先靠稳定挂载层保活，不改组件内部）。

### 步骤 3 — 插件瘦身（P3）
- 已与大哥确认：`~/.claude/settings.json` 的 `enabledPlugins` **保留 `codex` / `github` / `superpowers`**，其余 5 个置 `false`：`frontend-design`、`context7`、`code-review`、`code-simplifier`、`skill-creator`。（`ralph-loop` / `feature-dev` 本就是 `false`，不动。）
- 这是 Claude Code 全局配置，影响所有项目，但随时可在 VibeSpace「技能」面板点回来。
- **说明"按需加载"**：Claude Code 的插件是全局的，没有"这个任务才加载这个插件"的官方机制——所以"按需加载插件"做不到，能做的就是关掉冗余项。VibeSpace 自己的"技能"（`.aimon/skills`）倒已经是按任务名匹配的按需加载，那部分无需改。

## 大哥确认记录

- 休眠功能：**默认关掉**（保留设置项，`DEFAULTS.hibernation.enabled` 改 `false`）。
- 插件保留清单：**codex / github / superpowers**；关闭 frontend-design / context7 / code-review / code-simplifier / skill-creator。

## 边界情况

- 用户**已经手动**在设置里开过休眠（`data/app-settings.json` 出现 `hibernation` 段）→ 改默认值不影响他，尊重其显式选择。
- 步骤 2：当前 active 会话必须永远在保活集合里，否则正在看的终端被卸载会闪烁/丢历史。
- 步骤 2：从保活集合移出某会话只卸前端 xterm，**后端 PTY 与会话数据不受影响**，重新点开能 replay。
- 步骤 3：`codex` 插件被 dev-docs 工作流（codex:rescue）依赖，关掉会让多模型会审失效——需在清单里保留或明确告知。

## 风险与注意

- 步骤 2 是本任务最大改动面，TerminalHost 是跨项目终端宿主，改错会导致"切项目终端丢历史/闪烁"。需开多会话多项目实测。
- 步骤 3 改的是机器级全局配置（`~/.claude/settings.json`），不在本仓库内——属"破坏性变更协议"里的敏感操作，**必须先与大哥确认保留清单**再动手。
- 假设：26 个 node 进程主要来自 AI 会话的 CLI + MCP 服务进程。若实测发现是 VibeSpace 服务本身泄漏，步骤 3 收益有限，需回头补查（届时回 plan 修订）。

## 多模型 Plan 会审

> [Codex 评审] "两个问题都不是某一行写错，而是资源没有设硬边界：终端保活、输出转发、浏览器渲染都在会话数和输出量上继续线性增长。" —— Codex 独立指出 TerminalHost 全量保活无预算（高置信），与 Claude 的休眠器发现互补。
> [Codex 评审] "WS 输出缺少 backpressure，输出洪峰会拖垮浏览器或后端" —— 采纳为已知问题但移出本轮范围（见非目标），单列 issues。
> [Codex 综合] Codex 聚焦"卡顿"侧（保活预算 + backpressure），未覆盖"终端放着就停"；Claude 补上根因 = hibernate-sweeper 默认 15 分钟。最终 plan 取 Claude 的休眠器诊断 + Codex 的保活预算诊断，backpressure 因属另一类问题（洪峰 vs 稳态）放弃纳入本轮。
> [Claude 白话化兜底] 重写大哥摘要为 3 段白话；术语（休眠 / sweeper / xterm / backpressure / MCP）均括号或换说法翻译；核对 manual.md/auto.md：memory 有"xterm 优先靠稳定挂载层保活、不改组件内部生命周期"一条，已写入步骤 2 约束。
> 跳过：Gemini —— 大哥本轮明确只点名 Codex 会诊，未跑 Gemini。
