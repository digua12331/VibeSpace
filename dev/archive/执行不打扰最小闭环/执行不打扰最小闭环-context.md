# 执行不打扰最小闭环 · context

> AI 自用，不停等大哥确认。落决策记录、关键文件、与 plan 偏差。

## 关键文件清单

### 后端（只读 / 复用）

- `packages/server/src/status.ts` —— `statusManager` EventEmitter，emit `'change'(sessionId, status, detail?)`。**BudgetManager 挂 listener 监听 session 状态变化做 stall 探测**
- `packages/server/src/pty-manager.ts:228` —— `ptyManager.kill(sessionId)` 真停手（内置 SIGTERM→3s→SIGKILL）
- `packages/server/src/log-bus.ts` —— `serverLog` 起止配对
- `packages/server/src/install-jobs.ts` —— EventEmitter + state machine 形态模板
- `packages/server/src/subagent-runs.ts` —— in-memory 跟踪模板
- `packages/server/src/db.ts` —— session 表 `task` 字段已存在（不动 schema）
- `packages/server/src/ws-hub.ts` —— module-level `broadcast()` 推 WS 消息
- `packages/server/src/routes/raw-file.ts` —— 前端读 STATUS.md 走它（不开新 API）

### 后端（要改）

- `packages/server/src/routes/hooks.ts` —— Claude hook 接收点。**改两处**：
  - `buildSessionStartAdditionalContext` 末尾追加 STATUS 注入块（D5）
  - PreToolUse/PostToolUse 分支挂 BudgetManager 计数 + token 估算
- `packages/server/src/index.ts` —— 注册新模块初始化（如果有 daemon 类启动逻辑）

### 后端（新建）

- `packages/server/src/task-budget.ts` —— BudgetManager class（EventEmitter，per-task state，5 个硬信号上限触发熔断）
- `packages/server/src/task-status.ts` —— STATUS.md 读写工具：`appendStatusEntry(taskName, entry)` / `readStatusSummary(taskName, maxBytes)`

### 前端（要改）

- `packages/web/src/components/sidebar/DocsView.tsx` —— 任务行加 budget 进度条 + `04_status` FileRow + 熔断红色卡片
- `packages/web/src/types.ts` —— 加 `BudgetState` / `StatusEntry` 类型
- `packages/web/src/api.ts` —— 加 `getTaskBudget(projectId, task)` 客户端函数
- `packages/web/src/store.ts` —— 加 `taskBudgets` state + WS handler
- `packages/web/src/ws.ts` —— 现有 onMessage 全局 listener，订阅 `budget-update` / `budget-cutoff`

### 配置 / 脚本（新建）

- `scripts/budget-cutoff-smoke.mjs` —— 端到端 smoke
- `.aimon/templates/task-budget.example.json` —— 默认配置示例（项目可自己 copy 到 `.aimon/task-budget.json` override）
- `.gitignore` 补一行 `dev/active/*/STATUS.md`（runtime 数据不入库）

## 决策记录

### D1. STATUS.md 跟三段同级 + gitignore
**为什么**：人类可读、跟 plan/context/tasks 自然并列方便扫；runtime 数据不入库。
**过度设计检查**：✅ 不过度。

### D2. BudgetManager 纯 in-memory，不入 SQLite
**为什么**：server 重启后状态从 STATUS.md 恢复；加表牵动 db.ts 三段同步 + 五处 SELECT，成本高且无对应收益。
**过度设计检查**：✅ YAGNI。

### D3. 配置先只项目级（plan 里 D3 修订）
**为什么**：plan 写双层（项目 + 任务 override），但实际任务级 override 让大哥多管一份配置，增大认知负担。**第一版只 `.aimon/task-budget.json` 项目级**；如果用一段时间发现某些任务确实要不同 budget，再加任务级。
**过度设计检查**：✅ YAGNI 修正——这条比 plan 里更保守。

### D4. token 估算 = (input.length + output.length) / 4
**为什么**：接近 GPT/Claude 实际 tokenizer 比率（实测 1 token ≈ 3-4 字符），简单粗暴；UI 文案标"大致消耗量"避免大哥以为精确。
**过度设计检查**：✅ Codex 评审认同的近似法。

### D5. SessionStart 注入 STATUS 末尾，限 3 KB
**为什么**：`routes/hooks.ts` 现有 `buildSessionStartAdditionalContext` 总预算 10 KB（memory header）。新增 STATUS 注入限 3 KB（4 KB 太大可能让 memory header 被挤），memory 不缩。如果总和超 10 KB 仍按现有 byte-accurate truncate 逻辑收尾截。
**过度设计检查**：✅ 合理。

### D6. STATUS.md 写入 append-only
**为什么**：POSIX `O_APPEND` 是 OS 原子操作，多 session 并发不会互相覆盖；永远可回溯。
**过度设计检查**：✅ 必要。

### D7. 默认上限 80 轮 / 120 分钟 / 15 分钟无活动 / 验收失败 3 次
**为什么**：
- 80 轮 ≈ 单 Claude session 90-120 分钟典型工作量
- 120 分钟 ≈ Anthropic compaction 90 分钟阈值的安全延展
- 15 分钟无活动 ≈ 大概率挂了（PTY 输出空 15 分钟）
- 3 次验收失败 ≈ manual.md / CLAUDE.md "2-3 次失败熔断" 既有约定
**过度设计检查**：✅ 合理近似，可配置。

### D8. WS broadcast 复用现有 module-level export
**为什么**：`ws-hub.ts:20 broadcast()` 已是 module-level，issues 并行派工任务已用过同模式（参考 `routes/issue-jobs.ts:wireIssueJobBus`）。
**过度设计检查**：✅ 复用。

### D9. 不开新 HTTP API 读 STATUS.md
**为什么**：STATUS.md 在 `dev/active/<task>/STATUS.md`，前端通过现有 `routes/raw-file.ts` 直接读（项目内任意文件原始字节）。不引新路由减少表面积。
**过度设计检查**：✅ 不过度——新加 route/task-status.ts 会成为孤立的"为这一个文件开 API"。

### D10. 自动 checkpoint 触发点先只用 statusManager 'change'
**为什么**：plan 写"tasks.md 勾选时也写"，但要找到 docs-service.ts 内 AI 改 tasks 状态的具体回调成本高（多个写入路径都要挂）。第一版**只用 statusManager 'change' 监听 stopped/crashed/idle 状态变化**写 checkpoint——粒度跟 session 生命周期对齐，足够。tasks.md 勾选触发 checkpoint 留 D10b 后续。
**过度设计检查**：✅ YAGNI，最小可用。

### D11. 不用 daemon，全靠 hook + EventEmitter
**为什么**：Codex 评审"漏项 1"建议 orchestrator 自动恢复，但写 daemon 增工程量大。第一版用 `SessionStart` hook 注入 STATUS 摘要 = 最少破坏路径——AI 自己在新会话里看到 STATUS 就接力。证明不够再升级 daemon。
**过度设计检查**：✅ 最小可用。

## 与 plan 的偏差（执行阶段调整）

- **plan D3 双层配置 → context D3 单层**：第一版只项目级，任务级 override 推迟
- **plan step 3 + tasks.md 勾选触发 → context D10 只 statusManager 'change'**：粒度对齐 session 生命周期，tasks 勾选触发推迟
- **plan 暗示开新路由 → context D9 不开新路由**：复用 raw-file API

不重新征求大哥确认——这些都是"纯内部实现"调整，没改变验收方向（manual.md 偏好）。

## 依赖与约束

- 修改 `routes/hooks.ts` 影响所有任务执行链路 → smoke 必须覆盖"非 task 绑定 session" 路径不回归
- BudgetManager EventEmitter 用 `unref()` 让 timer 不阻塞 Node 退出（参照 install-jobs.ts:269）
- `STATUS.md` append 用 `fs.appendFile`（POSIX 原子 O_APPEND），不用 readFile→修改→writeFile
- `.aimon/task-budget.json` 坏 JSON → 用默认值兜底 + serverLog warn（参考 auto.md "项目级可选配置目录单坏文件只跳过"）
- `tokensApprox` 累积只在 PostToolUse 阶段更新（PreToolUse 没有 output）
- 不动 SQLite schema（manual.md 偏好"先评估再加列"）

## 待执行时确认的小开口

- `routes/hooks.ts` 现有 PreToolUse/PostToolUse 事件处理具体在哪几行？需要确认挂钩点
- `docs-service.ts` 是否有"task 归档"事件源？归档时应该清理对应 BudgetManager state（防内存泄漏）
- `.gitignore` 现有内容是否已经有覆盖 `dev/active/*/` 的模式？避免重复
