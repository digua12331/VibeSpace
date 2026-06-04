# issues并行派工 · 任务清单

- [x] 1 issues-service 加 `[auto]` 标签 + hash 解析 → verify: `pnpm -C packages/server exec tsc -b --force` 通过（项目无 unit test，逻辑细节用后续步骤 6 的 issues-jobs-smoke 端到端覆盖）
- [x] 2 types.ts 同步 IssueItem.auto/hash + 新增 IssueJob 类型 → verify: `pnpm -C packages/web exec tsc -b --force` 通过
- [x] 3 后端 IssueJobManager（issue-jobs.ts）+ 单例 → verify: `pnpm -C packages/server exec tsc -b --force` 通过；状态机在后续 step 6 的 issues-jobs-smoke 端到端覆盖
- [x] 4 issue-prompt.ts + issue-verify.ts → verify: `pnpm -C packages/server exec tsc -b --force` 通过；issue-verify 的 pass/fail 行为由 step 6 smoke 端到端覆盖
- [x] 5 ~~sessions.ts 扩可选 worktreePath 参数~~ → **skip**：调研发现可直接复用现有 createSession(isolation='worktree')，路由自动生成 `data/worktrees/<projectId>/<sessionId>` 路径并随 WireSession.worktreePath 返回；孤儿元数据改用 `.aimon/issue-jobs/<jobId>.json`，合并到 step 6 实现。不改 sessions.ts
- [x] 6 后端 routes/issue-jobs.ts + 在 index.ts 注册 → verify: `pnpm -C packages/server exec tsc -b --force` 通过；端到端行为（batch-dispatch / approve / reject）由 step 11 的 issues-jobs-smoke.mjs 覆盖
- [x] 7 ws-hub 推送 `issue-job-state` 消息 + 监听 pty exit 同步 cancelled 状态 → verify: `pnpm -C packages/server exec tsc -b --force` 通过；bus wiring 在 routes/issue-jobs.ts 内挂；pty exit→cancelled 在 wireSessionOutput.onExit 里实现（不在 ws-hub 层）；端到端由 step 11 smoke 覆盖
- [x] 8 api.ts + store.ts 加客户端函数与 store → verify: `pnpm -C packages/web exec tsc -b --force` 通过；WS 增量更新留 step 10 跟 UI 一起串
- [x] 9 DocsView 'issues' view 加多选 checkbox + 批量派工按钮 → verify: `pnpm -C packages/web exec tsc -b --force` 通过；浏览器手动验收在 step 11 大哥跑完整流程时一起做
- [x] 10 DocsView 加 'queue' view 显示 IssueJob 列表 + approve/reject 操作 → verify: 同 step 9；WS 增量更新留后续 issue（polling 2s 已足够），写 IssueJobCard 子组件 + 状态色彩 + approve/reject confirm
- [x] 11 写 scripts/issues-jobs-smoke.mjs 覆盖契约层 + 操作日志埋点核对 → verify: `pnpm smoke:issues-jobs` 全 assertion 通过（11 项契约校验：[auto] 解析 / hash 字段 / not-found / already-done / not-auto / 空 hash / maxConcurrency 越界 / 404 paths）；后端 serverLog `issues:batch-dispatch 开始/成功` 配对已观察到；前端 logAction 已埋点（issues batch-dispatch/approve/reject）；真起 claude session 后的 verify+marker 链路依赖宿主 claude CLI 装好，留给大哥手工验
- [x] 12 README.zh-CN.md + dev/issues.md 顶部加 `[auto]` 标签使用说明 → verify: 大哥按 plan "目标 - 可验证的验收标准" 整条清单跑一遍验收。README.md（英文版）同步留下个任务，本任务面向中文用户
