# 大任务自拆并行 · plan

## 大哥摘要

这次做的是：你批一个**大任务**（多步骤、跨多模块）后，AI 不再自己一口气跑 12+ 步——而是 plan 阶段就**自己把任务拆成 N 个相对独立的子任务**，每个子任务派给独立的 worktree（git 的临时副本，互不踩脚）和独立 Claude 会话同时跑，全部跑完后你早上一次性 review N 份小 PR（**P**ull **R**equest，代码改动包）。

跟你今天加的"issues 批量派工"是同一套底层基建，但这次自动拆的是 dev/active 主任务本身。每个子任务跑挂或撞预算闸不影响别的——主项目永远不会被某个跑飞的子任务污染。

拆完的子任务结构会在你批 plan 前先给你看到（在 plan.md 末尾新增的「自拆与依赖」段），你能在前端 UI 上**调整**（合并/拆分/改子任务之间的先后顺序）后再点头。**plan 后不再打扰你**——后续派工、跑、汇总都自动，只在所有子任务都跑完进队列等你 approve 时回到你这。

## 目标

让 Dev Docs 主任务（非 issues）也支持"拆开 N 个子任务并行跑"。

### 可验证的验收标准（必须在浏览器里能点出来）

1. AI 写 plan 时同时输出 `## 自拆与依赖` 段（在 plan.md 末尾），含子任务清单 + 每个子任务的 write_files 边界 + 依赖关系（YAML 嵌入代码块或 JSON）
2. 前端 plan 文件预览页能正常显示这段（不需要专门解析也能看到原文）
3. DocsView 任务行展开后，除了 plan/context/tasks/STATUS 多出一个 **`05_subtasks`** 入口，点开看到子任务列表（每行：序号 / 标题 / 状态 / 依赖谁 / 跑哪个 worktree）
4. 子任务列表顶部有 **「一键派工」** 按钮 → 后端按拓扑序（depends-on 关系）给每个子任务开 worktree + 起 claude session → 子任务行实时显示 `pending → running → verifying → review-ready` 流转
5. 子任务跑完进现有 queue tab（沿用 issues queue UI）
6. **「approve 全部」按钮按拓扑序逐个 merge**，merge 冲突时停下、标 STUCK、显示哪个子任务冲突让大哥手动解
7. 故意拆出有循环依赖的 plan → 后端 dispatch 接口 400 + 前端提示"依赖图有环"
8. 故意让 AI 觉得"不能拆"（plan 里没写 `## 自拆与依赖` 段）→ 任务行显示"不可拆，按单任务长跑"，05_subtasks 入口隐藏
9. 故意拆出有 write_files 重叠的两个子任务 → 后端自动给它们加依赖边（同 file 必须串行），不让用户绕过
10. 后端 `pnpm -C packages/server exec tsc -b --force` 通过；前端 `pnpm -C packages/web exec tsc -b --force` 通过
11. `pnpm smoke:task-subtasks` 全 assertion 通过（覆盖拆分解析 / 依赖序派工 / approve 拓扑 merge / 循环依赖 400）

## 非目标

- **不做自动 merge**——approve 仍是大哥手按（沿用 issues queue 模式）
- **不做子任务再自拆**（递归限制，第一版只一级，避免无限嵌套）
- **不做跨项目并行**（每个项目独立 worktree 池）
- **不动 SQLite schema**（manual.md 偏好"先评估再加列"，子任务状态用文件 metadata + in-memory）
- **不做"语义级"依赖推断**（D1 只用 read_files 重叠 + step 序号，不读代码做语义判断）
- **不做"实时拖拽改依赖"高级 UI**（第一版只支持 plan UI 显示 + 简单编辑表单，复杂拖拽留后续）
- **不动 issues 批量派工现有路径**（issue-jobs.ts 不耦合，公共部分抽成新模块）

## 实施步骤

### 1. 后端 worktree-session-runner.ts：抽公共"派 worktree+session+发 prompt+探测 marker"逻辑

- 新文件 `packages/server/src/worktree-session-runner.ts`
- 把 `routes/issue-jobs.ts` 里的 `dispatchOne / wireSessionOutput / runVerifyPipeline` 抽出来，参数化 prompt 模板 + verify pipeline + marker
- 接口：`runWorktreeJob(opts: { projectId, projectPath, prompt, markerDone, markerStuck, onDone, onStuck, agent? }): Promise<{ jobId, sessionId, worktreePath, branch }>`
- 复用 `app.inject('/api/sessions')` + ptyManager + verify-pipeline
- **verify**：tsc 通过 + `routes/issue-jobs.ts` 重构后行为不变（issues-jobs smoke 仍全过）

### 2. 后端 task-subtasks.ts：子任务结构 + 拓扑排序 + 状态机

- 新文件 `packages/server/src/task-subtasks.ts`
- 类型：`SubtaskSpec { id, title, write_files, depends_on?[] }` / `SubtaskRun { spec, jobId, sessionId, worktreePath, branch, state, mergedAt? }` / `SubtaskGraph { specs, edges }`
- 关键函数：
  - `parseSubtasksFromPlan(planMd: string): SubtaskGraph | null` —— 从 plan.md 末尾 `## 自拆与依赖` 段解析 YAML 代码块；解析失败返回 null（不可拆）
  - `validateGraph(graph)` —— 检查循环 / 重复 id / write_files 重叠（自动加依赖边）
  - `topologicalOrder(graph)` —— 拓扑排序输出 merge 顺序
- 状态机：`pending | running | verifying | review-ready | merged | failed | merge-conflict`
- **verify**：tsc 通过；构造循环依赖输入断言 validateGraph 报错

### 3. 后端 task-subtasks-store.ts：子任务运行状态持久化（in-memory + 磁盘元数据）

- 类似 issue-jobs 的 `.aimon/issue-jobs/<jobId>.json` 模式
- 子任务元数据存 `.aimon/subtasks/<taskName>/<subtaskId>.json`
- in-memory `Map<taskName, Map<subtaskId, SubtaskRun>>` 单例
- Server 启动时扫磁盘恢复孤儿
- EventEmitter `state-change` / `merged` / `remove` 给 ws-hub broadcast
- **verify**：tsc 通过；端到端由 step 9 smoke 覆盖

### 4. 后端 routes/task-subtasks.ts：4 个 HTTP 端点

- `GET /api/projects/:id/tasks/:task/subtasks` —— 返回子任务图 + 各子任务运行状态
- `POST /api/projects/:id/tasks/:task/dispatch-subtasks` —— 按拓扑序派工（call worktree-session-runner per spec，按 depends_on 等前置完成）
- `POST /api/projects/:id/tasks/:task/approve-all` —— 按拓扑序逐个 merge；冲突时停下标 STUCK
- `POST /api/projects/:id/tasks/:task/subtasks/:subtaskId/approve` —— 单个 approve（手动模式）
- `DELETE /api/projects/:id/tasks/:task/subtasks/:subtaskId` —— reject 单个
- 全部 zod 校验 + `serverLog('info', 'subtasks', '<action>', ...)` 起止配对
- 复用 BudgetManager（每个子任务一个 budget state，taskName=`<主任务>::<subtaskId>`）
- **verify**：tsc 通过；端到端由 step 9 smoke 覆盖

### 5. 前端 types.ts + api.ts + store.ts：客户端类型 + 4 个 API + state

- `SubtaskSpec / SubtaskRun / SubtaskGraph / SubtaskState` 类型镜像后端
- `api.getSubtasks / dispatchSubtasks / approveAllSubtasks / approveSubtask / rejectSubtask`
- store 加 `taskSubtasks: Record<projectId, Record<taskName, SubtaskRun[]>>` + `refreshSubtasks(projectId, taskName)`
- **verify**：`pnpm -C packages/web exec tsc -b --force` 通过

### 6. 前端 DocsView：05_subtasks 入口 + 子任务列表 + 一键派工 + approve 全部

- DocsView 任务行展开后加 `05_subtasks` FileRow（仅当子任务图存在时显示）
- 点开展开二级子任务列表：每行显示子任务标题 + 状态 chip（沿用 issues queue 配色）+ 依赖谁
- 子任务列表顶部按钮：「一键派工」/「approve 全部」/「reject 全部 STUCK」
- 子任务跑完后跟现有 queue tab 共享同一组 jobcard（IssueJobCard 改成更通用的 `WorktreeJobCard` 或新建 `SubtaskJobCard`）
- 主任务行 budget pill 旁边新加"子任务统计" pill（`3/5 done`）
- **verify**：浏览器手动验收上面 8 条 + 自派 vibespace-browser-tester

### 7. 前端 plan UI 加"自拆与依赖编辑器"（简版）

- DocsView 任务行新加 `📐 编辑自拆` 按钮（仅当 plan.md 有 `## 自拆与依赖` 段时显示）
- 点开一个简单 modal：表格显示子任务清单 + write_files + depends_on，每行可编辑
- 保存时把 YAML 重写回 plan.md `## 自拆与依赖` 段（用 docs-service.ts 的 writeFile）
- **第一版不做拖拽 DAG 可视化**，纯表格——足够大哥扫一眼调整
- **verify**：浏览器手动改一个子任务依赖再保存，刷新看 plan.md 变化

### 8. 主任务 STATUS.md 共享 + 子任务 budget 独立

- 子任务的 checkpoint 写到主任务的 `dev/active/<task>/STATUS.md`（append-only），entry 加 `subtaskId` 字段
- 子任务的 budget 独立：BudgetManager 用 `<taskName>::<subtaskId>` 作 key 注册，避免共享主任务 budget 互踩
- 主任务的 budget 在子任务派工后**不再计**（避免双重计数）——主任务 budget 变成"调度器 budget"，跑得很轻
- **verify**：smoke 覆盖

### 9. smoke：scripts/task-subtasks-smoke.mjs + package.json + 模板

- 端到端覆盖：parseSubtasksFromPlan / 拓扑序 dispatch / approve-all 顺序 merge / 循环依赖 400 / write_files 重叠自动加依赖边
- 用 agent='shell' 避免依赖真 claude CLI
- 配置模板 `.aimon/templates/subtasks-syntax.example.md` 写一份完整 `## 自拆与依赖` 段示例供大哥参考
- `package.json` 加 `smoke:task-subtasks`
- **verify**：`pnpm smoke:task-subtasks` 全过；其他 smoke 不回归

### 10. README.zh-CN.md + CLAUDE.md 更新使用说明

- README 加一段「大任务自拆并行」介绍
- CLAUDE.md Plan 阶段段加一条："写 plan 时若任务能拆，AI 自己在 plan.md 末尾加 `## 自拆与依赖` YAML 段；不能拆则不写（任务行 UI 自动隐藏 05_subtasks）"
- 配套 `dev/issues.md` 顶部加注释指向新 skill
- **verify**：大哥按目标段验收清单逐条跑

## 边界情况

- **plan.md 没有 `## 自拆与依赖` 段** → 默认"不可拆"，任务行隐藏 05_subtasks 入口，按 Step 1 单任务长跑路径走
- **`## 自拆与依赖` 段 YAML 解析失败** → 标"自拆配置错误"显眼提示，让大哥修；不静默退回单任务（防止 AI 写错被忽略）
- **循环依赖** → POST dispatch-subtasks 接口 400 + 前端弹错；不允许 dispatch
- **write_files 集合相交** → validateGraph 自动给重叠的两个子任务加依赖边（按 spec 顺序），写日志告知用户"已自动加依赖"
- **子任务 worktree 创建失败** → 整体派工中止，已派的子任务保留状态（标 failed），等大哥处理
- **某子任务跑出 STUCK** → 不影响其他子任务，全部跑完后该子任务显眼标红等大哥决定
- **approve-all 中途 merge 冲突** → 停下，已 merge 的保留（不 revert），冲突的标 merge-conflict，等大哥手动解后单独 approve
- **主任务归档时还有未 review 的子任务** → 弹确认对话框"还有 N 个子任务未 review，确认归档将一并丢弃 worktree？"
- **子任务派工时绑 task 字段** → session.task = `<主任务>::<subtaskId>`，让 SessionStart hook 注入对应的子任务上下文（STATUS.md 注入按主任务读，子任务 prompt 单独构造）
- **拆分级别**：第一版 plan.md 里子任务**不能再写 `## 自拆与依赖`**（不允许递归），后端解析时给出"二级自拆未实现"警告

## 风险与注意

对应 Codex 上一轮评审 4 条硬伤 + 总体警告：

- **硬伤 1 不能直接套 issue-jobs 基建** → step 1 抽出 worktree-session-runner.ts 公共模块，issue-jobs 和 task-subtasks **各自调用同一个 runner**，路径不耦合
- **硬伤 2 写文件边界** → SubtaskSpec.write_files 必填（不写不让 dispatch），validateGraph 自动检测相交并加依赖
- **硬伤 3 合并顺序** → topologicalOrder 输出严格拓扑序，approve-all 按这个序逐个 merge；冲突立即停
- **硬伤 4 N 子会话烧钱** → 复用 Step 1 BudgetManager，每个子任务独立 budget；任务级总并发上限默认 3（同 issues 批量派工）
- **总体警告"别做成规范文档升级"** → 10 个 step 全部对应代码改动（新文件 / 改路由 / 改 UI / 改 store / smoke / 配置模板），CLAUDE.md 只加一行使用说明

其他注意：

- 拆分粒度 A3 半自动（AI 提议 + 大哥点头时调整）—— 风险点：AI 拆错；缓解：拆错时大哥在 plan 阶段就能调整，执行后才发现的话靠 STUCK 报警
- 第一版不做 5 步以上深度依赖图可视化（表格 UI 够用）—— 用户感知差异：复杂任务的拓扑关系看起来累，但不影响功能
- 主任务 budget 派工后停记 → 防双重计数，但意味着主调度会话不受 budget 保护；缓解：调度本身轻量（只 POST dispatch + 等子任务回来），不会跑飞
- 子任务 STATUS.md 共享主任务文件 → 防文件爆炸；append-only + subtaskId 字段足够区分

## 自拆与依赖

> 元注释：本任务**自己作为示例**展示 `## 自拆与依赖` 段的标准格式。第一版本任务自身 plan 在 step 1 完成前**不可拆**（worktree-session-runner.ts 是所有后续 step 的依赖根），所以下面 YAML 全部 depends_on 链式串行——但格式可作为模板参考。

```yaml
schema_version: 1
subtasks:
  - id: 1
    title: "抽公共 worktree-session-runner"
    write_files:
      - packages/server/src/worktree-session-runner.ts
      - packages/server/src/routes/issue-jobs.ts
    depends_on: []
  - id: 2
    title: "子任务结构 + 拓扑排序"
    write_files:
      - packages/server/src/task-subtasks.ts
    depends_on: [1]
  - id: 3
    title: "子任务持久化"
    write_files:
      - packages/server/src/task-subtasks-store.ts
    depends_on: [2]
  - id: 4
    title: "HTTP 路由"
    write_files:
      - packages/server/src/routes/task-subtasks.ts
      - packages/server/src/index.ts
    depends_on: [3]
  - id: 5
    title: "前端类型 + api + store"
    write_files:
      - packages/web/src/types.ts
      - packages/web/src/api.ts
      - packages/web/src/store.ts
    depends_on: [4]
  - id: 6
    title: "DocsView 05_subtasks 入口"
    write_files:
      - packages/web/src/components/sidebar/DocsView.tsx
    depends_on: [5]
  - id: 7
    title: "plan UI 自拆编辑器"
    write_files:
      - packages/web/src/components/sidebar/DocsView.tsx
    depends_on: [6]
  - id: 8
    title: "STATUS.md 共享 + budget 独立"
    write_files:
      - packages/server/src/task-budget.ts
      - packages/server/src/task-status.ts
    depends_on: [3]
  - id: 9
    title: "smoke + 配置模板"
    write_files:
      - scripts/task-subtasks-smoke.mjs
      - package.json
      - .aimon/templates/subtasks-syntax.example.md
    depends_on: [4, 8]
  - id: 10
    title: "README + CLAUDE.md 更新"
    write_files:
      - README.zh-CN.md
      - CLAUDE.md
      - dev/issues.md
    depends_on: [7, 9]
```

## 多模型 Plan 会审

> [Gemini 评审] 跳过：`mcp__gemini-cli__ask-gemini` 仍报 `spawn gemini ENOENT`（本机未装 Gemini CLI）。
>
> [Codex 综合主笔] 跳过：连续两次调用 codex:rescue 都返回 `API Error: 529 Overloaded`（服务器侧临时问题）。CLAUDE.md 规则"失败一次重试一次仍失败回退 Claude 单独写"。Codex 上一轮（Step 1 评审时）已经给过 4 条硬伤评审针对本任务方向（不能套 issue-jobs / 必须写文件边界 / 必须合并顺序 / 必须先有 Step 1 预算保护），这 4 条全部已经在本 plan 的"风险与注意"段对应回应。
>
> [Claude 单独主笔 + 自审] 本 plan 完全由 Claude 综合事实包 + Codex 上一轮 4 条评审 + 4 个用户感知分叉（A/B/C/D）的推荐组合（A3+B1+C3+D1）写成。manual.md 偏好对照：大哥摘要 + 验收清单白话化 ✅；plan 后只确认一次 ✅；纯内部决策 AI 自决 ✅（如 worktree-session-runner 抽取方式、metadata 文件位置、状态机命名）；用户感知差异分叉在 plan 草案阶段已经替大哥做了推荐组合，大哥可在呈交后调整（4 个分叉的可选项都在"实施步骤"和"非目标"段标了出来）。**未经 Codex 综合主笔环节，万一漏架构性视角的风险后补**——若大哥发现执行中明显结构性偏差，可在归档评审阶段由 codex 自动补正到 auto.md。
