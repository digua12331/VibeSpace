# browser-use 按需注入 · plan

## 大哥摘要

这次把 **browser-use**（让 AI 能自己操作浏览器的小帮手程序，常驻就吃约 200MB 内存）从"每开一个 Claude 会话都默认塞进去"改成"**默认不塞、需要时在面板里手动开**"。
做完后大哥能在 **MCP 面板**（侧栏「技能」里管理 AI 工具开关的那块）看到 browser-use 默认是**关**的；点开它，**下次新开**的 Claude 会话才会真的启动浏览器帮手。已经开着的终端不受影响。
省下的是那 ~200MB；Claude 程序本身那 700MB 起步是 AI 自己的，这次省不了（之前已说明）。
**唯一需要大哥拍板的**：AIkanban 这个项目根目录里现在写死了 browser-use，要不要也一起清掉——清掉则本项目也省 200MB，但本项目以后跑"自动浏览器验收"要先手动开一下。

## 目标

把 browser-use 从"默认自动注入（opt-out，要禁用才不加载）"改为"默认不注入、手动开启（opt-in）"，**只针对 Claude 会话**，从而让不需要浏览器的会话每个省约 200MB。

**可验证的验收标准：**

1. **进程层面**：在一个"干净项目"（项目根 `.mcp.json` 不含 browser-use）里新开一个 Claude 会话，用任务管理器/进程树确认这棵 claude 进程树里**没有** `browser-use` / `uv` / `python` 子进程。
2. **UI 可观察（浏览器里看得到）**：打开侧栏「技能」→ MCP 面板：
   - browser-use 一栏默认显示 **OFF（关）**，即使它当前不在 `.mcp.json` 里也要能看到这一栏；
   - 点 **ON（开）** → 下次新开 Claude 会话，进程树里出现 browser-use 子进程；
   - 再点回 **OFF** → 该条从 `.mcp.json` 移除，下次新会话不再启动。
3. **日志**：在 LogsView 看到 `scope=mcp-toggle` 的 toggle 起止配对；ON 时新增"主动写入 .mcp.json"的起止日志，且至少人工触发一次失败分支（如把 .mcp.json 改成只读）看到 ERROR 条目。
4. **类型检查**：`npm run typecheck`（或项目等价命令）通过。

## 非目标 (Non-Goals)

- **不改 Codex**：`injectCodex` 写的是全局 `~/.codex/config.toml`，无法干净表达"项目级开关"，且大哥痛点是 Claude 会话——本轮不动 codex 路径。
- **不动 Hub 项目**：`injectHubMcps`（Hub 工作区的 browser-use + aimon-hub）保持常开，原样不动。
- **不改 codegraph**（全局 MCP，~60MB）：它是另一套全局配置，影响所有项目，本轮不碰。
- **不做内存上限/自动回收**等 claude.exe 本体的内存治理（那是 Claude Code 自身行为，VibeSpace 改不了）。

## 实施步骤

1. **mcp-bridge.ts — 翻转默认（停止自动注入）**
   - `injectClaude` 不再无条件把 browser-use 写进 `.mcp.json`。普通项目的"自动注入分支"去掉，改为：以 `<project>/.mcp.json` 里是否存在 browser-use 作为"该项目是否启用"的**真源**——存在就让 Claude Code 自己加载，不存在就不加载。
   - `injectHubMcps` / `injectCodex` 完全不动。
   - *验证*：grep 确认普通项目 spawn 路径不再调用写 browser-use 的逻辑；Hub 与 codex 分支无改动。
2. **抽一个"主动写入"函数 + toggle ON 调它**
   - 把"把 browser-use 写进 `<project>/.mcp.json`"抽成一个可复用函数（幂等：已存在且一致则不写）。
   - `PUT /api/mcp-servers/toggle` 当 `enabled=true` 且 `name=browser-use`：① 从 `disabledMcpServers` 移除（处理历史遗留）② 调用上面的写入函数主动注入。失败要走 ERROR 日志（补 ON 分支的失败日志，现状只有 OFF 分支记）。
   - `enabled=false` 维持现状（remove + add disabled）；browser-use 不在 `.mcp.json` 时 remove 要幂等不报错。
   - *验证*：toggle ON 后 `.mcp.json` 出现 browser-use；toggle OFF 后消失；重复点不报错。
3. **buildList — 让面板始终能看到 browser-use**
   - `GET /api/mcp-servers` 的 `buildList`：当 browser-use 既不在全局 MCP、也不在项目 `.mcp.json` 时，从 `cli-catalog` 合成一条 `scope=project / enabled=false / name='browser-use'` 的条目（name 必须与 toggle 期望的 key 一致），让面板仍显示、可开启。
   - 去重：已在 `.mcp.json` 则不再合成；`.mcp.json` 损坏/部分条目时不能让 buildList 崩或重复合成；同时存在于 `.mcp.json` 和 `disabledMcpServers` 时确定性渲染为 **OFF**。
   - *验证*：干净项目 GET 返回里有一条 enabled=false 的 browser-use；前端面板渲染出该行可点。
4. **（大哥拍板）本仓库已提交的根 `.mcp.json`**
   - AIkanban 根 `.mcp.json` 是 git 已提交、写死了 browser-use 的。是否一并清掉见下方"需大哥拍板"。
5. **browser-tester 偏好衔接（行为约定，不一定改代码）**
   - 默认关后，没开 browser-use 的项目里 AI 自动派 `vibespace-browser-tester` 会拿不到浏览器工具。约定 AI 的行为：**要么**先把 browser-use 开起来再测，**要么**在 handoff 明确告知大哥"本项目未开 browser-use，已跳过自动浏览器验收，原因 X"——**不许静默跳过**。把这条写进 `dev/memory/manual.md` 衔接已有 2026-05-06 偏好。
   - *验证*：在未开 browser-use 的项目交付时，handoff 里出现明确的"已跳过/已临时开启"说明。

## 需大哥拍板（唯一确认项）

**AIkanban 根目录 `.mcp.json` 里现有的 browser-use 要不要移除？**

- **保留**：AIkanban 继续默认启用 browser-use，自动浏览器验收不受影响，但本项目每个 Claude 会话仍多占约 200MB。
- **移除**：AIkanban 也变成"按需开"，省 200MB，但以后要在 MCP 面板手动开启才能跑自动浏览器验收。

推荐：如果近期还常让 AI 跑浏览器验收，**先保留**；更在意会话轻量就移除。（其它项目无论选哪个都已默认关。）

**【大哥已拍板 2026-06-02：一起清掉】** —— AIkanban 根 `.mcp.json` 移除 browser-use，本项目也按需开。

## 边界情况

- **历史遗留（grandfather）**：停止自动注入只防"新写入"；已经在 `.mcp.json` 里有 browser-use 的老项目仍会启动它，直到大哥在面板点 OFF（或手动删）。这是预期行为，不是 bug。
- **同时存在于 `.mcp.json` 和 `disabledMcpServers`**：确定性渲染为 OFF，避免歧义。
- **`.mcp.json` 损坏 / browser-use 条目残缺**：buildList 不崩、不重复合成；按现有"损坏就当空"的容错处理。
- **worktree 隔离会话**：MCP 配置仍写项目根（Claude Code 从 cwd 向上找），与现状一致。
- **toggle 幂等**：browser-use 不在 `.mcp.json` 时点 OFF 不报错；已一致时点 ON 不重复写。

## 风险与注意

- **面板可见性是成败关键**：默认关后若 buildList 不补合成条目，browser-use 会从面板消失，大哥就无从开启——步骤 3 必须和步骤 1 同批落地，不能只改默认不补面板。
- **toggle ON 现在要真正负责注入**：以前靠 mcp-bridge 下次 spawn 补写，改完后 mcp-bridge 不补了，ON 必须自己写 `.mcp.json`，否则点了开却不生效。
- **无数据库迁移**：OFF 状态由 `disabledMcpServers` / `.mcp.json` 存在性表达，不需要动 SQLite。
- **验收要换个干净项目验**：在 AIkanban 自身验"没注入"会被已提交的 `.mcp.json` 干扰（除非大哥选了移除），所以进程层面验收建议另起一个干净项目。

## 多模型 Plan 会审

> [Codex 评审] "停止 injectClaude 只防新写入，已有 `.mcp.json`/全局 codex 配置里的 browser-use 仍会启动（grandfather）；buildList 合成行的 name 必须与 toggle 的 key 一致且去重；痛点是 Claude 会话，建议初版不碰 Codex。"
> [Codex 综合主笔] 采纳"只改 Claude、砍掉 Codex 改动"——因 codex 配置全局无法表达项目级 opt-in 且非用户痛点，列入非目标降低范围与回归面；保留 grandfather/冲突/损坏等边界与"committed .mcp.json 让用户拍板"。（注：Codex 本轮只回了大哥摘要，未输出 plan 全文 body，故全文由 Claude 按其评审+大哥摘要补全。）
> [Claude 白话化兜底] 改了三处：① 用 Codex 的大哥摘要并压成 4 行白话、术语全部括号翻译；② 全文新出现术语（MCP / opt-in / grandfather / worktree）首次均加白话；③ 对照 manual.md 2026-05-06 browser-tester 偏好，新增步骤 5 的"不许静默跳过"约定，避免本改动违反大哥长期偏好。
