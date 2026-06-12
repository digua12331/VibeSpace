# 授权通知增强 · 任务清单

- [x] 1. 路B改键+文案：sw.js approve title 改"✅ 同意并不再问"；main.tsx NOTIFY_RESPONSE_KEYS.approve 改 '\x1b[B\r' → verify: 读改后两处常量正确；build 通过
- [x] 2. 收窄SW投递：sw.js notificationclick 的 approve/reject 只投递一个 client（优先 focused，回退第一个） → verify: 代码不再 for 全发；build 通过
- [x] 3. 通知信息加料：notify.ts body 含 agent + detail → verify: 读改后 body 组装含两者；build 通过
- [x] 4. 跨项目抑制：notify.ts 改用传入 suppress 参数；store.updateSessionStatus 计算 suppress=isPageFocused()&&selectedProjectId===sess.projectId 传入 → verify: build 通过；逻辑自查（选中A前台时B触发不被抑制）
- [x] 5. 焦点回归只清当前项目：store visibility/focus 处理从 clearAllNotify 改为只清当前选中项目的 notifying 会话（clearAllNotify 失去调用点已一并删除）→ verify: build 通过
- [x] 6. selectProject 清该项目提醒：store.selectProject 清掉该项目下 notifying 会话 → verify: build 通过
- [x] 7. 项目列表红点：ProjectsColumn 聚合 notifyingProjectIds，项目行加红点 + "激活"分页标签加标记 → verify: build 通过；红点元素存在
- [x] 8. 全量构建验收：pnpm -F @aimon/web build 通过（含 tsc） + git diff --name-only 比对 write_files 白名单
