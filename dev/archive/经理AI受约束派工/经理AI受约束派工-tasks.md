# 经理AI受约束派工 · 任务清单

## Phase 1 · 边界设置（UI + 持久化）

- [x] 1. 后端 app-settings 加 6 个边界字段（接口+默认+clamp+zod 四处同步）→ verify: `pnpm -F @aimon/server build` 过；删掉 app-settings.json 后 GET /api/app-settings 返回全保守值（危险项全 false、并发 2、确认图 true）
- [x] 2. 前端 types 同步边界字段（store/App 无需改：经理边界无前端实时消费者，后端 dispatch 自读 getAppSettings；api 的 Partial<AppSettings> 已兼容）→ verify: `pnpm -F @aimon/web build` 过 ✅
- [x] 3. SettingsDialog 加「经理 AI 边界」页签：普通区（并发/确认图/出错即停）+ 危险区（动DB/删文件/付费，点开弹 confirmDialog danger 确认，自动合并灰显标第二版），保存用 logAction('settings','update-app-settings') 带 manager → verify: `pnpm -F @aimon/web build` 过 ✅；浏览器手动验（见 handoff）

## Phase 2 · 后端硬约束（核心防线，裸 curl 可验）

- [x] 4. 确认凭证机制：新增 `POST prepare-dispatch` 发放绑 graphHash 的一次性 token；DispatchSchema 加 confirmToken；managerConfirmGraph 开时 dispatch 必须带匹配 token(图变 hash 变则失效);DocsView「派工」按钮改为"弹确认框看任务图→prepare→带 token dispatch" → verify: **task-subtasks-smoke 新增 3 断言全绿**(无 token→409 confirm_required、prepare 发 token+graphHash、错 token→409) ✅；server+web build ✅
- [x] 5. 并发上限 enforce：dispatch 用 getAppSettings().manager.concurrency 作权威上限（替换 DEFAULT_CONCURRENCY），初始按 countActive(projId) 剩余空位派，advancer 每 tick 重读设置 + countActive 判满 → verify: `pnpm -F @aimon/server build` ✓（运行时"多图同时只跑 N 个"留 step 10 端到端确认）
- [x] 6. 危险动作硬检测（scanDangerousChanges：merge-base 比对 → git diff --name-status 查删除 / DB 路径正则 + diff 内容 SQL DDL 查 DB 改动，fail-closed），命中且边界关则 markFailed 不进 review-ready + serverLog ERROR → verify: **`node scripts/manager-danger-smoke.mjs` 全绿** ✅（删除/改.db/改db.ts/干净放行/非git路径fail-closed 五项实测通过）
- [x] 7. 跳过即阻塞下游：wireWaveAdvancer 把 failed/cancelled/merge-conflict 列为 failedIds，依赖含 failed 的子任务不派；移除了旧代码把 merge-conflict 误当 ready 的 bug → verify: `pnpm -F @aimon/server build` ✓（运行时留 step 10 确认）
- [x] 8. 出错即停作用域：managerStopOnFailure 开时 advancer 检到任一 failed 即 detach 停全图未派波次；SubtaskSpec 加可选 danger 字段（仅 UI 提示，不作授权）→ verify: build ✓；`grep DEFAULT_CONCURRENCY|SubtaskSpec` 确认无残留旧引用、加可选字段不破坏现有用法 ✓（运行时留 step 10）

## Phase 3 · 经理 AI 角色

- [x] 9. 写 .aimon/skills/经理AI受约束派工.md（SOP：收目标→写自拆图(标danger)→停下让大哥在面板确认→confirmGraph开则不自己派/关则curl prepare+dispatch→轮询状态机不扫PTY→全 review-ready 提醒、绝不自动合并→全合并写总结；含边界读取/失败处理）→ verify: frontmatter triggers=[经理,项目经理,派工,拆活,编排,受约束派工,经理AI] ✅
- [ ] 10. 端到端（**留大哥手动验**，按"UI 手动验收"偏好，不自动起真 claude）：给经理 AI 一个 2 子任务（互不依赖、可回滚、无危险）的真实小目标，走完整链路 → verify: 出图→面板点派工弹确认→并发≤2→停 review-ready→人工合并→写总结
- [x] 11. 同步 dev/agent-team-blueprint.md「自动派工 s11 已劝退」一句指向本任务 → verify: 已改为复活指向，旧"已劝退"表述加删除线保留历史 ✅
