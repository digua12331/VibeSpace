# harness-task绑定与jobs面板 · 任务清单

## Phase A · task↔session 绑定

- [x] A-1. DB schema：sessions 加列 `task_name TEXT NULL` + 类型 + CRUD + setSessionTask → verify: server tsc 通过；老 session 行迁移后 task_name=NULL；smoke:server / smoke:persistence 仍过
- [x] A-2. routes/sessions.ts：CreateSessionSchema 加可选 `task`；startSession 写入 task；新增 `PATCH /api/sessions/:id/task` 含抢占 409 检测；序列化加 task；操作日志 serverLog('info','session','bind-task'/'unbind-task') → verify: curl POST {task:'X'} → 201 + 响应含 task；curl PATCH {task:'Y'} → 200；同任务再绑别的 session → 409；带 force:true → 200 且原 session.task 被清；server tsc
- [x] A-3. 前端 types.ts + api.ts + store.ts：Session 加 `task?`；createSession 入参加 task；新增 `bindSessionTask(id, task | null, opts?: {force?})`；store 加 `setSessionTaskLocal(id, task | null)` action → verify: web tsc 通过
- [x] A-4. DocsView：openTaskMenu 右键菜单加"绑定到 session ▸"子菜单（列出该 project 活 session：agent + 末6 字符）；任务行右侧加 binding badge（找 sessions 里 task===t.name 且 alive 的）；submenu onSelect 调 bindSessionTask + setSessionTaskLocal + logAction；抢占 409 弹 confirm 询问后带 force 重试 → verify: A-V1 浏览器看到子菜单 + badge；console 没报错
- [x] A-5. EditorArea：session 标签前缀加 📝 \<task截断10字\>（在 🌿 前面，仅 task 存在）；closeSessionTab 第一段 confirm 文案在 task 存在且未勾完时附带"绑定的任务 X (N/M) 还没做完"；不引入额外 dialog 步骤 → verify: A-V2 + A-V3 + A-V4 浏览器三条分支都走通；web tsc

## Phase B · 通用 Jobs 面板

- [x] B-1. 新建 `packages/server/src/jobs-service.ts`：JobsService class（register/get/list/cancel + 30min 自清 + serverLog 起止配对） → verify: server tsc；写一段临时 self-test 或在 review-runner 接入后实测
- [x] B-2. review-runner.ts：`kickoffArchiveReview` 内部走 `jobsService.register('review', taskName, async () => runArchiveReview(...), { projectId })`；prompt / lessons 提取逻辑不动 → verify: 触发一次归档评审，server log 看到 jobs register/done 起止；auto.md / rejected.md 仍能正常落
- [x] B-3. 新建 `packages/server/src/routes/jobs.ts`：GET /api/jobs（聚合 jobsService + installJobs，统一 wire shape）；POST /api/jobs/:id/cancel；DELETE /api/jobs/:id；index.ts 注册 → verify: curl GET /api/jobs 在归档触发时返回一条 review job；CLI 安装时返回 install + review 两条
- [x] B-4. 前端 types.ts + api.ts + store.ts：加 JobItem 类型；listJobs / cancelJob / deleteJob api；store.Activity 联合类型加 'jobs' → verify: web tsc
- [x] B-5. 新建 `sidebar/JobsView.tsx`：3 秒轮询 listJobs；按 startedAt 倒序展示；行字段 (kind icon / title / state pill / time-ago / cancel|clear button)；点 review 行 alertDialog；点 install 行 alertDialog（v1 不跳 CliInstallerDialog）→ verify: B-V1/V2/V3 浏览器跑通
- [x] B-6. ActivityBar + PrimarySidebar：items 加 jobs（icon 🛠，放 logs 之前）；TITLES + switch case 加 jobs → verify: 看到新 tab 在 logs 上方且能切换；web tsc

## 共享收尾

- [x] C-1. README "Concepts" 加 task 绑定 + jobs 面板两段；视情况追 dev/learnings.md → verify: 肉眼读
- [x] C-2. 全量验收：浏览器 A-V1..V4 + B-V1..V4 + ERROR 日志手动触发；命令行 server tsc + web tsc + smoke:server + smoke:persistence + smoke:worktree 全过 → verify: 手动+命令行全过
