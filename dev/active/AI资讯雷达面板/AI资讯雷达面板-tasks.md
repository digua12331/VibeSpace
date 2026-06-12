# AI资讯雷达面板 · 任务清单

- [x] 1. 后端 routes/radar.ts（代理+缓存+校验+serverLog 起止）+ index.ts 注册 → verify: `pnpm -F @aimon/server build` 通过；curl 本地 /api/radar/daily-brief 普通与 ?force=1 均返回归一化结构（注：运行中的旧后端无热重载，路由经 tsx 直调 fetchDailyBrief 实测真实上游 20 条+缓存命中；HTTP 路由待大哥重启后端后生效）
- [x] 2. 后端验证脚本 scripts/radar-test.ts（归一化/坏结构/缓存/force/超时/非200 可控模拟）→ verify: `pnpm -F @aimon/server exec tsx scripts/radar-test.ts` 全部场景 PASS（21/21）
- [x] 3. 前端契约：types.ts 镜像类型 + api.ts getRadarDailyBrief → verify: `pnpm -F @aimon/web build` 通过
- [x] 4. store.ts：Activity/EditorTabKind 加 'radar'、EditorTab 加 radar 字段、项目切换过滤保留 radar 页签 → verify: `pnpm -F @aimon/web build` 通过；过滤逻辑 radar 保留、普通文件仍按原规则
- [x] 5. ActivityBar 按钮 + PrimarySidebar 分发 + RadarView.tsx（列表/刷新禁用/陈旧提示/错误保旧/logAction 起止）→ verify: `pnpm -F @aimon/web build` 通过
- [x] 6. EditorArea kind==='radar' 渲染分支 + RadarView 点击组装 md（escapeMd + http/https 过滤）开页签 → verify: `pnpm -F @aimon/web build` 通过
- [x] 7. 终检：两端 build + radar-test 脚本 + `git diff --name-only HEAD` 对白名单 → verify: 全绿；本任务 10 个文件全部在白名单内（工作区另有 feishu/权限目录等其他并行任务的改动，与本任务无关）；handoff 附大哥手动验收清单
