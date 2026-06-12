# harness-subagent卡片与按需技能 · plan

> memory 扫过：`manual.md` 有"小功能直接改"——本任务体量明显超过小功能，必须走完整三段式；`auto.md` 仅占位条目无相关。
>
> 上一任务 `harness-task绑定与jobs面板` 沉淀的相关经验（`dev/learnings.md`）：ContextMenu 已原生支持 submenu；DialogHost 复合形态分两次 confirm 比扩组件更"外科"；`addColumnIfMissing` 三处套路。本任务不动 sessions 表 schema，不直接复用最后一条；前两条在 SessionView 上加 subagent chip 时若需要二级菜单 / 复合 dialog 可用。
>
> 项目级路线图见 `dev/harness-roadmap.md`，本任务对应其中的 **s04 Subagents** + **s05 Skills**。**s09+s10 Inter-Session Mailbox** 由本任务**拆出为未来评估项**——见末尾"未来评估"一节。

## 背景与定位

接续 harness 改造梯队。已落地 4 条（s07 任务系统强化 / s08 Jobs 面板 / s12 worktree / 上次的 task↔session 绑定）。本任务做剩下高确定性的两条：

- **Phase A · T2-B Subagent run 卡片**（对应 s04）：让你看清 claude 内部用 Task 工具派出去的子 agent 在干啥
- **Phase B · T3-B Skills 按需注入**（对应 s05）：`.aimon/skills/<name>.md` 集合，session spawn 时按 task 关键词动态合成 prompt 文件

原合并 plan 里的 **Inter-Session Mailbox（s09+s10）** 拆出去——它的不确定性不在文件 mailbox 实现，而在"claude/codex 客户端能否稳定 consume HTTP MCP 端点 + agent 是否会主动用 inbox tool"——这是协议探索而非工程交付。先做 spike 评估再立项，不拖累 A/B 节奏。

## 关键认知（影响设计的事实）

读源码时发现一个跟最初 plan 假设有偏差的事实：

**claude 的 Task 工具不是 spawn PTY 子进程**——subagent 在 claude 主进程内跑，没有自己的 sessionId / stdin / stdout。所以"父子 PTY 树形 ProjectsColumn 渲染"实际做不到——挂"虚拟子节点"在 PTY 列表里 UX 会很混乱。

**Phase A 的实际形态**：通过 hook 监听 Task 工具的 `PreToolUse` / `PostToolUse`，从 `tool_input.subagent_type` / `tool_input.description` / `tool_input.prompt` 抓元数据，记到 server 内存 Map，**父 session 的 SessionView 顶部 / 标签下方**展示一行 subagent run 卡片"📌 \<subagent_type\>·\<desc\> · running/done"。当前活跃 subagent 数 → 父 session 标签的小 badge "🤖×N"。

跟"手动 spawn child session"是两回事；后者用户已能通过 worktree + task 绑定实现，不需要再加一层 parentSessionId 概念。

## 目标

### Phase A — Subagent run 卡片
1. claude 调 Task 工具时，父 session 的标签出现"🤖×N"小 badge（N=当前 running subagent 数）
2. 点开 SessionView 看到顶部一栏 subagent runs 列表（最多最近 10 条），running 的高亮、done 的灰色
3. 点单条 → alertDialog 显示 description / prompt 摘要 / 起止时间
4. server 重启清零（与 jobs-service 一致）

### Phase B — Skills 按需注入（v1 仅"生成 prompt 文件 + UI 可见 + 日志可见"，**不**承诺 agent 一定遵循）
1. `<project>/.aimon/skills/<name>.md` 一堆小 md 文件，每个文件第一行 yaml frontmatter `triggers: [keyword1, keyword2]` + body
2. session spawn 时（`startSession` 内部）：
   - 读项目 skills 目录
   - 按 `task` 入参（已有）做 case-insensitive substring 匹配
   - 命中的 skills 串起来写到 `<project>/.aimon/runtime/<sessionId>-prompt.md`
   - 把 path 通过 env `AIMON_SESSION_PROMPT_PATH` 注入 PtyManager spawn
3. UI：StartSessionMenu 在选了 task 时下方显示"将注入：a / b / c"提示
4. 操作日志记录哪几条被注入；log 里能看到生成的 runtime 文件路径
5. **明确不承诺**：v1 不主动改 CLAUDE.md，不强制 agent 读 prompt 文件——agent 端要不要 consume 这份 prompt 取决于用户在 CLAUDE.md / agent 配置里自己接入

### 验收标准（必须包含浏览器可观察项）

#### Phase A 验收
- **A-tsc**：server tsc + web tsc 全绿
- **A-V1**（浏览器）：起一个 claude session，让它跑一个会触发 Task 工具的复合任务（"调研 + 修复 X"）→ 父 session 标签出现 `🤖×1` badge；SessionView 顶部出现 subagent run 卡片
- **A-V2**（浏览器）：同时多个 Task 调用 → 卡片列表展示多条 running，结束后变 done
- **A-V3**（浏览器）：点单条 chip → 弹 alertDialog 显示 description / prompt 截断 / 起止
- **A-LOG**：server 端 `serverLog('info','subagent','start'/'done', { runId, subagentType, ms })` 起止配对，至少一条 ERROR（PostToolUse payload 解析失败时手动构造一次）

#### Phase B 验收（**全部是 server 端 + UI 端可观察项；不验收 agent 真正读 prompt**）
- **B-tsc**：server tsc + web tsc 全绿
- **B-V1**（浏览器 + 文件）：在某项目下 `.aimon/skills/` 放两个 md（如 `飞书相关.md` triggers `[飞书, lark]` 和 `游戏配表.md` triggers `[xls, 配表]`）；启动 session 时绑 task 名含"飞书" → StartSessionMenu 选 task 后下方显示"将注入：飞书相关"
- **B-V2**（终端）：进入 session 后跑 `echo $AIMON_SESSION_PROMPT_PATH && cat $AIMON_SESSION_PROMPT_PATH` 看到拼出来的 prompt 文件包含被命中的 skill 内容
- **B-V3**（浏览器）：LogsView 看到 `serverLog('info','skills','injected', { sessionId, taskName, skills: ['飞书相关'] })`
- **B-V4**：项目无 `.aimon/skills/` 目录时 spawn 不报错也不注入（向后兼容）；env 不存在或空字符串
- **B-V5**：关键词不命中任何 skill 时不写 runtime 文件、不注入 env

## 非目标（Non-Goals）

1. **不做"父子 PTY 子进程"**——claude Task 内部 subagent 不是 PTY（见关键认知）
2. **不做 mailbox / inbox / 邮箱**——拆出去为独立的未来评估项（见末尾）
3. **不做 skill 匹配引擎**——v1 朴素 case-insensitive substring 字典；不上 embedding / fuzzy / scoring
4. **不做 subagent run 持久化**——重启清零，与 jobs-service 一致
5. **不做"自动绑定 task 到 subagent run"**——subagent run 是父 session 的事，不跟 dev/active task 关联
6. **不做"agent 主动 consume prompt 文件"**——env 路径暴露完了，agent 端读不读看用户配置
7. **不做强制改 CLAUDE.md**——skill 注入是"runtime prompt 文件 + env"，CLAUDE.md 由用户决定写不写"读 env 的指令"
8. **不做 skills 文件 hot-reload**——session 启动时是快照；启动后改 skill 文件不影响已 spawn 的 session

## 实施步骤（粗粒度）

### Phase A · Subagent run 卡片

A-1. **新建 `packages/server/src/subagent-runs.ts`**：仿 jobs-service.ts 的内存 Map 模式；`registerStart(parentSessionId, runId, subagentType, description, prompt)` / `markDone(runId)` / `list(parentSessionId)` / `listAll()`；30 min 自清；events 'change' → verify: server tsc

A-2. **routes/hooks.ts 加 Task 工具识别**：在现有 `extractToolFilePath` 旁边加 `extractTaskInvocation(payload)`，识别 `tool_name === 'Task'` 时抽取 `subagent_type / description / prompt`；PreToolUse 时 registerStart；PostToolUse 时 markDone（payload 字段名实施时**先 console.log 实际格式再 commit**） → verify: 模拟 POST /api/hooks/claude 一次 Task 的 Pre + Post → list(parent) 返回 1 条 done

A-3. **新增 `routes/subagent-runs.ts`**：GET /api/sessions/:id/subagent-runs；index.ts 注册 → verify: curl 拿到列表

A-4. **前端 types/api/store**：加 `SubagentRun` 类型；`listSubagentRuns(sessionId)`；store 字段 `subagentRunsBySession: Record<sessionId, SubagentRun[]>` + `refreshSubagentRuns(sessionId)` → verify: web tsc

A-5. **EditorArea / SessionView**：session 标签加 `🤖×N` badge（N=running 数）；SessionView 顶部加一栏 subagent runs（横向 chips，最多 10 个，hover 显示 description；click → alertDialog 显示 prompt 摘要 + 起止 + 状态） → verify: A-V1 / A-V2 / A-V3

A-6. **轮询**：父 session 标签激活时 5 秒轮询一次 listSubagentRuns（先轮询；后续可改 ws 广播）→ verify: hook 进来后 5s 内 UI 更新

### Phase B · Skills 按需注入

B-1. **新建 `packages/server/src/skills-service.ts`**：扫 `<project>/.aimon/skills/*.md`；手动 parse yaml frontmatter（识别开头 `---` 到下一个 `---` 之间，line by line `key: value`，**不引新依赖**如 gray-matter）；`pickSkillsForTask(projectPath, taskName): SkillEntry[]` case-insensitive substring 匹配 → verify: 单元自测脚本

B-2. **routes/sessions.ts startSession 集成**：spawn 前调 pickSkillsForTask；如果有命中，写 runtime prompt 到 `<project>/.aimon/runtime/<sessionId>-prompt.md`，把 path 通过 env `AIMON_SESSION_PROMPT_PATH` 注入到 PtyManager spawn 的 env；操作日志记录注入了哪几条；不命中跳过整段 → verify: 启动后 ls runtime/ 看到文件；`echo $AIMON_SESSION_PROMPT_PATH` 在终端输出路径

B-3. **新增 GET /api/projects/:id/skills**：列出该项目所有可用 skill，给前端 StartSessionMenu 用 → verify: curl

B-4. **StartSessionMenu**：选了 task 时（绑定到 task 是已有能力），下方小字显示"将注入：a / b / c"（按当前 task name 预测）；项目无 skills 目录时不显示；命中 0 条不显示 → verify: B-V1

B-5. **README + dev/learnings.md** 更新：
- README "Concepts" 加 subagent 卡片 + skills 段
- dev/learnings.md 视情况追加经验（如 Task 工具 payload 字段格式、yaml frontmatter 手动解析坑）
- verify: 肉眼读

### 共享收尾

C-1. **全量验收**：
- 浏览器 A-V1..V3 + B-V1..V5
- 命令行：server tsc + web tsc 全绿
- smoke:worktree 仍过（确认 spawn 路径加 env 注入对 worktree 模式无回归）
- LogsView 看到 subagent + skills 起止配对，至少一条 ERROR
- verify: 手动 + 命令行全过

## 边界情况

### Phase A
- **Task PostToolUse 没收到**（claude 进程异常崩溃）→ subagent run 永远 stuck running；30 min 自清兜底
- **同 runId 多次 Pre/PostToolUse**（重试）→ 用 nanoid 而不是 claude 自己的 toolUseId 做主键，每次 PreToolUse 视为新 run
- **Task tool_input 字段缺失**（claude SDK 改了 schema）→ 兜底显示"unknown subagent"
- **subagent 嵌套**（subagent 里又调 Task）→ hook 仍会上报，所有 run 都挂在最外层 sessionId 下；v1 不做层级
- **session 关闭时还有 running subagent**：subagent run 留在 Map 里到 30 min 自清

### Phase B
- **skill md frontmatter 解析失败**：skip 该 skill，warn 日志，不阻塞 spawn
- **没有 task name 的 session**（直接启动不绑 task）→ 不注入任何 skill
- **runtime/<sessionId>-prompt.md 残留**：session 结束时不主动删（debug 友好）；启动时如果文件已存在覆盖
- **skill 文件被改 / 删** 在 session 启动后：runtime prompt 是快照，已注入的不变
- **triggers 是空数组或缺字段**：skip 该 skill，不当作 fallback "everything matches"
- **多个 skill 同时命中**：按文件名字典序拼接，section 间用 `\n\n---\n\n` 分隔；不去重 body
- **路径 .aimon 在用户项目下**：`.aimon/skills/` 应进 git（用户项目内的"配置"）；`.aimon/runtime/` 应被 .gitignore 忽略——README 段里提示用户

## 风险与注意

1. **claude Task 工具的 PostToolUse payload 字段名** plan 里没写死——A-2 实施时先 console.log 一次实际 payload 再 commit；不要拍脑袋猜字段。
2. **subagent run 5 秒轮询负载**：10 个并发 session × 0.2 次/秒 = 2 次/秒 GET，可承受
3. **skill 注入 agent 端是否真 consume**：v1 不验证；这是设计选择不是缺陷。如果用户后续抱怨"装了 skill 但 claude 没读"，单独立项做"在 CLAUDE.md 写入'读 env'指令"的小任务。
4. **不引新依赖**：yaml frontmatter 手动 parse；不上 `gray-matter`。
5. **熔断**：如果 A-2 实施时发现 Task PostToolUse 的字段格式跟假设差太多（比如根本没 tool_response），停手，console.log 出真实 payload 给我看，再调整设计。

## 假设（请用户确认）

- AS1：Phase A 接受"subagent run 卡片"而不是"父子 PTY 树"——基于"关键认知"那一节的事实
- AS2：Phase B v1 验收只到"runtime prompt 文件生成 + env 注入 + UI 显示 + 日志记录"为止；**不**包含"agent 实际读入并遵循"
- AS3：Phase B 不主动改 CLAUDE.md，让用户决定要不要在 CLAUDE.md 加"读 env 的指令"
- AS4：subagent runs / skill prompts 重启清零，与现有 jobs-service / install-jobs 模式一致
- AS5：A → B 串行做，A 完成 + tsc 通过再进 B

---

## 未来评估：inter-session mailbox（原合并 plan 的 Phase B / s09+s10）

**为什么从本任务拆出**

最初合并 plan 里把 mailbox 当 Phase B 做。复审后判断：

- 文件系统 mailbox 部分（`<project>/.aimon/inbox/<sessionId>/*.json` + tmp+rename 原子写）实现风险极低，几小时能写完
- **真正不确定的是协议链**：MCP 标准走 stdio，本地 server 想暴露 HTTP/SSE 端点让 claude/codex 当 MCP server 来调，是非标做法
- 即使协议链通了，**agent 是否会主动调 inbox_send/read 取决于训练**（这是模型能力，不是 harness 工程问题）
- 在两个不确定性都没消除的前提下做完工程，最差结果是"server 端齐全 / agent 端不动"——半成品

**未来怎么继续**

不立即做。等以下任一信号出现再立项：

1. 你实际工作流里出现"经常需要让 codex 做完后端、claude 做完前端，互相接力消息"的场景
2. claude/codex 官方文档明确支持 HTTP/SSE 形式的 MCP server（v1 时不确定，半年后可能就有了）
3. 出现 "agent 间通信" 的具体业务需求（不是"听起来很 cool"）

**先做的 spike（如果你想推进）**

不是立项做，而是**单独花半天**做最小验证：

- 起一个最简单的 stdio MCP server，只暴露一个 `inbox_send` tool
- 在本机 claude 配置里把它加进 `--mcp-config`
- 手动跑一个 prompt "请给会话 X 发个 'hello'"，看 claude 会不会主动调
- 如果会调 → 立项做完整 mailbox + UI
- 如果不会调 → 这条路死掉，记到 `dev/harness-roadmap.md` 的"已劝退"

这个 spike 不放本任务，留给后续单独触发。
