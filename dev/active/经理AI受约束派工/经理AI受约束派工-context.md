# 经理AI受约束派工 · context

> 给 AI 自用 + 归档评审 + 换会话衔接。大哥不审此文件。

## 关键文件（=本次改动边界）

### Phase 1 边界设置（持久化 + UI）
- `packages/server/src/app-settings.ts` — `AppSettings` 接口(:44-59)、默认值(`maxAiTerminals` 默认 12 在 :63)、clamp 函数(:77-99)、`getAppSettings()`(:200)、`setAppSettings(patch)`(:220,原子写)。**加 6 字段**(managerConcurrency / managerConfirmGraph / managerStopOnFailure / managerAllowDbChanges / managerAllowFileDelete / managerAllowPaidCalls)。
- `packages/server/src/routes/app-settings.ts` — `GET /api/app-settings`(:52)、`PUT`(:56)、zod `UpdateBody`(:34-47,**新字段必须加进 schema 否则被静默剥掉**,:43-46 注释有警告)。
- `packages/web/src/types.ts` — 前端 `AppSettings` 镜像(:1013),同步加字段。
- `packages/web/src/store.ts` — maxAiTerminals 的 state/默认/setter(:206/415/614),照加。
- `packages/web/src/App.tsx` — 启动拉取 app-settings 写 store(:20 附近)。
- `packages/web/src/api.ts` — `getAppSettings()`(:1160)、`updateAppSettings(patch)`(:1164)。
- `packages/web/src/components/SettingsDialog.tsx` — `SettingsTab` 类型(:54)、`SETTINGS_TABS`(:56)、左侧页签渲染(:491-507)、右侧内容区(:510)、「AI 终端数量上限」控件模板(:534-557)、保存回写(:353/360/367)、本地 state(:138/145)。窗口已 `h-[600px] max-h-[88vh]`。
- `packages/web/src/logs.ts` — `logAction(scope, action, fn, ctx?)` 包保存。

### Phase 2 后端硬约束
- `packages/server/src/task-subtasks.ts` — `SubtaskSpec`(:23-30,加可选 `danger?`,仅 UI 提示)、`parseSubtasksFromPlan`(:68)、`validateGraph`(:184)、`topologicalWaves`(:300)。
- `packages/server/src/routes/task-subtasks.ts` — dispatch 路由(:360-479)、并发校验段(:397-404,`countActive(projId)` vs `MAX_CONCURRENCY*3`;`MAX_CONCURRENCY=5`:34、`DEFAULT_CONCURRENCY=3`:35)、`DispatchSchema`(:37-40,加 `confirmToken`)、`dispatchOneSubtask`(:165)、`runVerify`(:128,**危险硬检测插这里之后、markReviewReady 之前**)、`wireWaveAdvancer`(:716,**跳过即阻塞下游插这里**)、approve(:484/600,本版不动语义)。
- `packages/server/src/worktree-session-runner.ts` — `spawnWorktreeJob`(:55)、信号轮询(:199),本版不改,仅读懂。
- `packages/server/src/issue-verify.ts` — runVerify 实际跑验证处,危险检测在其后。
- `packages/server/src/log-bus.ts` — `serverLog(level, scope, msg, extra?)`。

### Phase 3 经理 AI
- `.aimon/skills/经理AI受约束派工.md` — **新建**,经理 SOP。
- `dev/agent-team-blueprint.md` — 同步"s11 已劝退"一句(:172 附近)。

## 决策记录

- **安全立足点 = 后端按实际 git diff 硬检测,不信 AI 自报 danger**(Codex 评审核心)。`danger?` 字段只做 UI 提示/排序,不做授权。`git diff --name-status` 检测真实删除;DB 按文件路径/迁移目录/SQL 关键词。fail-closed:判不了就当危险拦。
  - 资深工程师视角自检:不过度。这是非程序员场景下唯一靠得住的护栏——人验收不了"假成功",机器必须兜。
- **确认凭证用轻量内存表,不落 DB**:`projectId+task → {graphHash, token}`,进程内 Map 即可。第一版不需要持久化(会话级确认,重启重确认是合理预期)。不为此引入新表/新库。
- **自动合并第一版砍掉**:不改 approve 路由语义,经理 AI skill 里硬约束"绝不自动合并"。设置项 `managerAllowAutoMerge` **本版不加**(避免死开关),UI 危险区用一行灰显文字标"第二版开放"即可,不接后端。
- **并发上限复用现有 `countActive(projId)`**(已是项目级),只把比较基准从 `DEFAULT_CONCURRENCY` 换成 `managerConcurrency`;每推进波次前重读设置。
- **经理 AI 入口最省**:复用现有"起会话+绑task+注入skill",不造新 UI 按钮(YAGNI);验收不顺再加。
- **付费不做内容检测**:成本过高,降级为"默认禁止+不配付费入口"的弱约束,handoff 明示。
- **经理 AI 调后端走 Bash curl**:dispatch 路由裸 HTTP 本机可达,不造 MCP/CLI 包装(YAGNI)。

## 依赖与约束

- 静态类型:改后端 `pnpm -F @aimon/server build`、改前端 `pnpm -F @aimon/web build` 必须过(无独立 typecheck 脚本,build 即类型检查)。
- 破坏性变更:`SubtaskSpec` 是跨文件导出类型 + dispatch 是关键链路 → 改前 grep 引用、改后 grep 确认无残留旧引用。
- zod schema 与 AppSettings 接口、前端镜像类型**四处必须同步**,漏一处字段被静默丢。
- worker 完成判定走带外文件信号 + 状态机(auto.md 2026-06-02 教训),经理 AI 轮询**不扫 PTY buffer**。
- 操作日志:派工/确认/保存边界/危险拦截都要 logAction/serverLog 起止配对(scope=manager),含一次人工触发的 ERROR 验证。

## Phase 2 详细设计（已精读 routes/task-subtasks.ts:1-774 后定稿，下轮直接执行）

dispatch 路由全貌:`POST .../dispatch-subtasks`(:360-479)→ parseSubtasksFromPlan → topologicalWaves → 池上限校验(:397-404 `countActive < MAX_CONCURRENCY*3`)→ 只同步派 `firstWave.slice(0, concurrency)`(:428)→ `wireWaveAdvancer`(:716,监听 state-change 自动派后续波)。`dispatchOneSubtask`(:165)→ spawnWorktreeJob → 完成回调 `runVerifyPipeline`(:128)→ ok 则 `markReviewReady`、fail 则 `markFailed`。merge 只在 approve/approve-all(:484/600)人工触发。

- **步骤 5 并发(纯后端,最省)**:`concurrency` 现 = `body.maxConcurrency ?? DEFAULT_CONCURRENCY`(:376)。改成读 `getAppSettings().manager.concurrency` 为权威上限:`const cap = getAppSettings().manager.concurrency; const concurrency = Math.min(body.maxConcurrency ?? cap, cap)`。**关键缺陷**:wireWaveAdvancer 的 handler(:728-758)**根本没应用 concurrency**——它把所有 ready 的 spec 一次全派。要在 handler 里加 `if (subtaskRuns.countActive(projectId) >= cap) return;` 并逐个派时重查(每波重读设置满足"中途改并发生效")。初始 firstSlice 也改成按 `cap - countActive` 限。
- **步骤 6 危险硬检测(纯后端,核心防线)**:插在 `runVerifyPipeline`(:128) verify ok 之后、`markReviewReady`(:138)之前。在 worktree 内跑 `git diff --name-status <baseBranch>...HEAD`(baseBranch 取项目当前分支,worktree 分支是 `agent/<sid8>`,见 worktree-paths.ts)。检测:有 `D` 开头行=删文件;变更文件含 `*.db`/`data/`/迁移目录 或 diff 内容含 `CREATE TABLE`/`ALTER TABLE`/`DROP` 等=动 DB。命中且对应 `getAppSettings().manager.allow*` 为关 → 不进 review-ready,改 `markFailed(runId, '危险动作被边界拦截: ...')` + `serverLog('error','manager',...)`。**fail-closed**:git 命令失败/判不了 → 当命中拦截。已有 `runGit(cwd,args)` helper(:48)可复用。
- **步骤 7 下游阻塞(纯后端)**:wireWaveAdvancer handler(:728)的 `readyIds`(:731)目前把 `merge-conflict` 也算 ready(:737)——错误地会放行下游。要改:被 `markFailed`(含危险拦截/stuck)的子任务,其 `depends_on` 链上的后代不得派。handler 里加"失败集合",`spec.depends_on.every(d => readyIds.has(d) && !failedIds.has(d))`,且若任一依赖在 failedIds 则该 spec 标阻塞跳过。
- **步骤 8 出错即停 + SubtaskSpec.danger**:`managerStopOnFailure` 开 → 任一子任务 markFailed 时,advancer 整个 `active=false` 停掉该图未派波次(handler 开头加 `if (settings.stopOnFailure && anyFailed) { detach; return }`)。`SubtaskSpec`(task-subtasks.ts:23-30)加可选 `danger?: ('db'|'delete'|'paid')[]`,`parseSubtasksFromPlan` 解析(仅作 UI 提示/排序,**不作授权**——授权看步骤 6 实际 diff)。破坏性变更:改 SubtaskSpec 前后 grep 引用。
- **步骤 4 确认凭证(需配 UI,放到 Phase 3 一起做)**:`prepare-dispatch` 新路由算 graphHash + 发 token 存进程内 Map(`projectId::taskName → {graphHash, token, confirmed:false}`);UI 在 DocsView 子任务面板加"经理 AI 拆出 N 个任务 / 开始 / 取消",点开始→ `confirm-dispatch` flip confirmed=true → dispatch 校验 `confirmToken` 且 `confirmed && graphHash 匹配`,图变 hash 变则旧 token 失效。`managerConfirmGraph` 关时跳过。**用户必须亲手点"开始"才发 token——这是闸口的核心,manager AI 不持有发 token 的能力**。DocsView 派工按钮在 `DocsView.tsx:1257` 附近(api.dispatchSubtasks @ api.ts:869)。

## 进度（2026-06-09）

- Phase 1 完成且 `pnpm -F @aimon/server build` + `pnpm -F @aimon/web build` 均过:后端 6 边界字段 + zod;前端 types 镜像;SettingsDialog「经理 AI 边界」页签(普通区 + 危险区 confirmDialog danger 确认 + 自动合并灰显)。
- **未做(下轮)**:Phase 2 步骤 4-8、Phase 3 步骤 9-11。**注意**:Phase 1 的开关目前是"空壳"——后端还没读 manager 设置去 enforce(步骤 5/6 才接上)。交付时已向大哥说明,这一版别真拿它派活。
- 续作入口:读本文件 Phase 2 详细设计 + tasks.md,从步骤 5(并发,纯后端最省)或步骤 6(危险硬检测)开始。

### 进度更新(2026-06-09 第二轮)

- **Phase 2 后端硬约束 code-complete**(步骤 5/6/7/8),`pnpm -F @aimon/server build` 过:
  - 步骤 6 危险检测 `scanDangerousChanges`(routes/task-subtasks.ts,已 export)**已 smoke 实测全绿**:`node scripts/manager-danger-smoke.mjs`(删除/改.db/改db.ts DDL/干净放行/非git fail-closed 五项)。这是命门,真验证过。
  - 步骤 5 并发:dispatch 用 `getAppSettings().manager.concurrency` 权威上限 + 初始按剩余空位 + advancer 每 tick 重读设置/countActive 判满。
  - 步骤 7 下游阻塞 + 步骤 8 出错即停:重写了 wireWaveAdvancer handler(失败集合、failed 依赖不派、stopOnFailure detach、移除"merge-conflict 误当 ready"旧 bug)。SubtaskSpec 加可选 `danger`(仅提示)。
  - 5/7/8 的运行时行为(多图并发数、下游真不派、停机范围)**未实跑确认**——需 step 10 端到端(真起 claude 子任务)或扩 smoke。
- 步骤 11 blueprint 同步完成。
- **仍未做**:步骤 4(confirmGraph 确认凭证 + DocsView「开始」按钮 UI——**managerConfirmGraph 这个设置项目前是空壳,没人校验**)、步骤 9(经理 AI skill)、步骤 10(端到端真跑)。步骤 4 和 9 绑在一起做(skill 要调 token 流程)。
- 续作入口:从步骤 4 开始(token 机制 + DocsView UI),再步骤 9(skill,context 的 Phase2 设计末尾有 SOP 要点),最后步骤 10 端到端。
