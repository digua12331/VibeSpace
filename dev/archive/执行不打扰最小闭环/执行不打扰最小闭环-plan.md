# 执行不打扰最小闭环 · plan

## 大哥摘要

这次做的是：你批准 plan 后，AI **尽量一口气干完不再找你**。万一跑太久、轮次太多、轮空太久、或者反复失败，**AI 自己停下来**——不会闷头烧钱跑偏，也不会傻等你打字"继续"。

做完后你能在 Dev Docs 看到每个任务的 **STATUS.md**（任务状态记录文件，自动写）：跑到哪、卡在哪、下一步建议。新会话或熔断（自动刹车）后接力，**SessionStart hook**（会话启动时自动运行的小钩子）会把这份状态注入新 AI 的开场提示词，不用你打"继续 X 任务"。

不会动到你现有的项目数据 / 任务文件 / 数据库 / 终端。只在 server（后端）和 DocsView（左侧 Dev Docs 面板）加新机制。

预算闸用**轮次/耗时/估算 token**（大致消耗量）做硬信号近似——**不追求精确算钱**（Anthropic 的真实费用拿不到，强行算反而误导你）。

## 目标

让 Dev Docs 三段式从"规则上要求不打扰"变成"工程上能尽量不打扰"。

### 可验证的验收标准（必须在浏览器里能点出来）

1. 启 VibeSpace，左侧 Activity 切到「Dev Docs」→ 任务列表里每个 active 任务**新增一个 budget 进度条**（蓝色，灰色字显示已用轮次/上限、已用分钟/上限）
2. 任务跑到"已用轮次接近上限"时进度条变橙；触发熔断时进度条变红 + 弹一个红色 STATUS 卡片说明"为什么停"和"下一步建议"
3. 点开任务行展开 → 看到新增的 **STATUS** 入口（在 plan/context/tasks 三个文件旁边），点开能看到 append-only 的 checkpoint 日志：每步完成的时间 / 已用预算 / 验收是否过
4. 故意起一个 claude session 让它跑到第 N 轮 → 后端真 kill session（不是只写日志），LogsView 看到 `scope=budget action=cutoff` 起止配对日志
5. 触发熔断后开新 session 同 task → SessionStart hook 注入的 prompt 里**能看到 STATUS.md 最后几行 + DONE/STUCK/NEXT 三态**（在 LogsView 或 session 滚动条上能找到证据）
6. 同一个 verify 命令连续失败 3 次 → 自动熔断 + STATUS.md 写 STUCK 块 + 红色卡片
7. 后端 `pnpm -C packages/server exec tsc -b --force` 通过；前端 `pnpm -C packages/web exec tsc -b --force` 通过
8. `pnpm smoke:budget-cutoff` 全 assertion 通过（覆盖预算熔断 / STATUS.md 写入 / SessionStart 注入三条主路径）

## 非目标

- **不做大任务自动拆成多 worktree 并行跑**（留 Step 2 任务，本轮先把单 session 长跑闭环做稳）
- **不追求真实费用统计**（Anthropic API 在 Claude Code CLI 层拿不到稳定 cost，强行算反而误导；本轮只做轮次/耗时/估算 token 近似）
- **不做"AI 整体跑偏"的智能判断**（按 Codex 评审：用硬信号——超预算 / 连续失败 / 越界写文件 / 验收不过——不追求语义级跑偏检测）
- **不做 plan.md 实施步骤的全文白话翻译**（Codex 评审：只大哥摘要 + 验收标准段强制白话，技术细节段保持工程化避免拖慢任务）
- **不动 manual.md / auto.md 现有内容**（项目记忆只读取，本任务不写记忆）

## 实施步骤

### 1. 任务预算跟踪（新文件 task-budget.ts + 接入 hooks）

- 新建 `packages/server/src/task-budget.ts`：EventEmitter 风格 BudgetManager，per-task 维护 `{ rounds, elapsedMs, tokensApprox, stallSeconds, verifyFailCount }`
- 默认上限可配置（`.aimon/task-budget.json` 项目级 + `dev/active/<task>/budget.json` 任务级 override），默认值：`maxRounds=80 / maxElapsedMinutes=120 / maxStallMinutes=15 / maxVerifyFails=3`
- 复用 `routes/hooks.ts` 现有 Claude hook 入口挂 `PreToolUse` 计数 / `PostToolUse` 算耗时 + token 估算（输入输出长度近似 `Math.ceil((input.length + output.length) / 4)`）
- 复用 `statusManager` 'change' 事件监听 session 状态变化做 stall 探测
- **verify**：`pnpm -C packages/server exec tsc -b --force` 通过；budget state 变化时 serverLog 起止配对（`scope=budget`）

### 2. 真熔断执行（kill session + 写停止原因）

- BudgetManager 触发任一上限 → **真调用 `ptyManager.kill(sessionId)`**（不只是写日志）
- 调用 `appendStatusEntry(taskName, kind='CUTOFF', reason, nextStep)` 写 STATUS.md
- 触发熔断时 `serverLog('error', 'budget', 'cutoff: <reason>', { meta: ... })` 落盘
- 前端通过 WS broadcast `budget-cutoff` 消息 → 任务行红色显示 + 红色 STATUS 卡片
- **verify**：手动起 session 让它撞 maxRounds，确认 PTY 真死 + STATUS.md 多一行 CUTOFF + 浏览器红字

### 3. STATUS.md 自动 checkpoint（新文件 task-status.ts）

- 新建 `packages/server/src/task-status.ts`：`appendStatusEntry(taskName, entry)` 接口
- entry 类型枚举：`STEP_DONE / STEP_FAIL / CUTOFF / RESUME / NOTE`
- 文件位置 = `dev/active/<task>/STATUS.md`，加入 `.gitignore` 模板（运行时数据不入库）
- 自动触发点：
  - `statusManager` 'change' 到 stopped/crashed → 写 STEP_DONE 或 STEP_FAIL（按退出码判断）
  - tasks.md / tasks.json 的状态变更（docs-service.ts 内）→ 写 STEP_DONE
  - BudgetManager 熔断 → 写 CUTOFF（含 nextStep 建议）
- **verify**：手动跑一个 task 完成 1 步，STATUS.md 自动多一行；触发熔断多一行 CUTOFF

### 4. 自动恢复入口（SessionStart hook 注入 STATUS.md）

- 改 `routes/hooks.ts` 现有 `buildSessionStartAdditionalContext` 函数：在已有"memory header"之后追加"任务恢复块"
- 逻辑：当前 session 有 `task` 字段绑定 → 读 `dev/active/<task>/STATUS.md` 末尾 N 行 → 拼成 "## 上次执行状态（自动接力）" + DONE/STUCK/NEXT 三态摘要
- 注入大小上限 4 KB（防 prompt 膨胀，按 hooks.ts 现有 10 KB 全包预算分一半）
- **verify**：起新 session 绑 task → 看 SessionStart payload 注入文本含 STATUS 摘要 + 大哥不需要打"继续 X"

### 5. 验收失败默认策略（连续失败 2-3 次熔断）

- BudgetManager 加 `verifyFailCount` 字段，外部接口 `recordVerifyResult(taskName, stepId, ok)` 增减计数
- 达到 `maxVerifyFails`（默认 3）→ 触发 CUTOFF（复用 step 2 熔断路径）
- STATUS.md CUTOFF 块结构化写 DONE/STUCK/NEXT 三段（不是自由文本）
- **verify**：smoke 模拟一个 verify 连续 3 次失败，确认 STATUS.md 自动 CUTOFF + DONE/STUCK/NEXT 清晰

### 6. 前端 DocsView 加 budget 进度条 + STATUS 入口

- 改 `packages/web/src/components/sidebar/DocsView.tsx`：任务行展开区加新一行 `04_status` `STATUS / 自动接力日志` FileRow（与 plan/context/tasks 同形态）
- 任务行折叠态加 budget 进度条：tabular-nums 显示 `rounds/maxRounds`、`min/maxMin`；接近上限变橙，熔断变红
- 新 store 字段 `taskBudgets: Record<task, BudgetState>`，WS 消息 `budget-update` 增量推送
- 触发熔断时弹一个 dismissible 红色 STATUS 卡片在任务行上方 7 秒
- 大哥可见文案规则：用"跑了 N 轮 / 已用 N 分钟 / 自动停了 - 原因 / 下一步建议"，不用 budget/cutoff/orchestrator 这些词
- **verify**：浏览器跑完全流程 + `pnpm -C packages/web exec tsc -b --force` 通过

### 7. 操作日志埋点 + smoke + 类型检查

- 全程 `serverLog`/`logAction` 起止配对，新 scope = `budget` / `status` / `resume`
- 新建 `scripts/budget-cutoff-smoke.mjs` 覆盖：
  - 注册带 `[auto]` 的 task → 起 session → 模拟 80 轮 → 看 BudgetManager 触发熔断 + PTY kill + STATUS.md 出现 CUTOFF
  - SessionStart hook 注入 STATUS.md 内容
  - verify 连续失败 3 次自动熔断
- 加 `package.json` `smoke:budget-cutoff` script
- 收尾：完整 `pnpm -C packages/<server|web> exec tsc -b --force` 全绿 + smoke 全过 + 自派 vibespace-browser-tester 验收 UI

## 边界情况

- **session 没绑 task** → BudgetManager 不跟踪、STATUS.md 不写、SessionStart 不注入；只在 LogsView 留 info 提示
- **STATUS.md 不存在** → 自动创建并写一行 `RESUME / 任务首次启动`
- **token 估算失败**（极端长输入）→ 用 input+output 长度近似公式兜底，不阻塞主流程
- **熔断在工具调用中途触发** → 先标 budget=cutoff 防重入；只 kill 一次；只写一条 CUTOFF
- **同 task 多 session 同时恢复**（罕见但可能） → STATUS.md append-only 保证不互相覆盖；RESUME 条目带 sessionId 区分
- **操作日志 meta 不能塞大段 prompt / diff** → 截断到 1 KB（已有约束）
- **SessionStart 注入失败**（hook 网络问题）→ 不阻塞 session 启动，AI 仍能跑（只是没注入 STATUS，回退到大哥手动 `继续 X`）
- **底层 ptyManager.kill 失败** → 必须记错误 + 标 task STUCK，不假装已停止
- **`.aimon/task-budget.json` 坏 JSON** → 用默认值兜底 + 报警日志，不阻塞主界面（按 auto.md 经验"项目级可选配置目录单坏文件只跳过"那条）
- **dev/issues.md 第 27 条遗留 tsbuildinfo gitignore** 不影响本任务，但 STATUS.md 也要加 gitignore 模板

## 风险与注意

对应 Codex 评审给的 4 个硬伤 + 2 个漏项 + 总体警告，逐一回应规避策略：

- **硬伤 1 STATUS.md 摆设风险** → 通过 step 3 + step 4 + step 5 把它**接进了 session 状态机 / hook 入口 / 熔断路径 / SessionStart 注入**四条链路，不是孤立文件
- **硬伤 2 熔断不真执行** → step 2 明确"真调用 ptyManager.kill"+ smoke 覆盖"PTY 真死"断言
- **硬伤 3 预算用近似** → 用 `tokensApprox = (input.length + output.length) / 4` 近似公式（接近 GPT/Claude 实际 tokenizer 估算），大哥 UI 文案标"大致消耗量"
- **硬伤 4 跑偏不追求智能** → 只用 4 个硬信号（轮次 / 耗时 / 停滞 / 验收失败），不做语义级跑偏判断
- **漏项 1 自动恢复 orchestrator** → step 4 用 SessionStart hook（最少破坏路径），不需要 daemon；如果证明不够再升级到后端 daemon
- **漏项 2 失败不死磕** → step 5 `maxVerifyFails=3` 后熔断 + 结构化 DONE/STUCK/NEXT 报告
- **总体警告别做成文档升级** → 7 个 step 全部对应代码改动（新文件 / 改 hook / 新路由 / 新 UI / smoke），无"加规则到 CLAUDE.md"这种纯文档动作

其他注意：

- 修改 `routes/hooks.ts` 影响所有任务执行链路 → smoke 必须覆盖"非 task 绑定 session"路径不回归
- BudgetManager EventEmitter 用 `unref()` 确保 timer 不阻塞 Node 退出（参照 install-jobs.ts 模式）
- STATUS.md 跟现有三段 md 同级展示但不进 git → `.aimon/templates/.gitignore` 模板里要补一行
- 不动 SQLite schema（按 manual.md 偏好"先评估再加列"），budget state 纯 in-memory，server 重启丢失没关系（STATUS.md 已落盘可恢复）

## 多模型 Plan 会审

> [Gemini 评审] 跳过：`mcp__gemini-cli__ask-gemini` 仍报 `spawn gemini ENOENT`（本机未装 Gemini CLI）。CLAUDE.md 规定不阻塞 plan 交付，单独依靠 Codex + Claude 兜底。
>
> [Codex 综合主笔] 采纳"Step 1 三件套合并做"方向；把 plan 白话覆盖从核心实现里降级为大哥摘要 + 验收标准段强制白话（实施步骤段保持工程化避免拖慢任务）；放弃真实 cost 统计和智能跑偏判断（无稳定数据源），用轮次/耗时/估算 token/连续失败的硬信号闭环；明确 STATUS.md 必须接入 session 启动/恢复/归档/失败 handoff 四条链路才不是摆设；熔断必须真 kill 不只是日志。
>
> [Claude 白话化兜底] 改了三处：(1) Codex 原 step 1 "梳理数据流" 是 context 阶段的事，删掉合并进 context.md，让 plan 实施步骤更紧凑（7 步代替 9 步）；(2) 在每个 step 描述末尾加具体 verify 项（Codex 原本只写在末尾段），把 verify 跟步骤绑定方便执行时勾选；(3) 风险与注意段从自由段落改成"硬伤逐条回应"结构，明确每条 Codex 担心的硬伤对应哪个 step 怎么规避。manual.md 偏好对照：plan 顶部"大哥摘要 + 验收标准"白话化 ✅（manual.md 2026-04-30），实施步骤段保留技术化 ✅（Codex 评审），plan 后只在交付前停一次 ✅（manual.md 2026-04-24），熔断不死磕 ✅（Codex 漏项 2）。
