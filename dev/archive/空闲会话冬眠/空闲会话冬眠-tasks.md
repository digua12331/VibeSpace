# 空闲会话冬眠 · 任务清单

- [x] 1. DB schema 扩展（db.ts 三段 + 五处 SELECT 同步） → verify: server tsc 通过；3 列加入；SessionStatus 含 hibernated；hibernateSession/clearHibernation/flushActivityTimestamps 函数存在
- [x] 2. PTY/WS 活动时间戳钩子 → verify: pty-manager 导出 lastInputAt/lastOutputAt 两个 in-memory Map；ws-hub input handler 钩 lastInputAt；onData 钩 lastOutputAt；onExit 清理两个 map
- [x] 3. app-settings 扩展 + zod 校验 → verify: AppSettings 加 hibernation 段；clampIdleMinutes [5,180]；zod HibernationSchema；setAppSettings 改 AppSettingsPatch 参数类型
- [x] 4. 新建 hibernate-sweeper.ts + 启动期 wire（30s 顺便 flush） → verify: setInterval 30s tick；先 flush 活动时间戳再扫；跳过 working/waiting_input/starting；shell agent 按设置跳过；超阈值 hibernateSession + ptyManager.kill；serverLog scope=session action=hibernate-auto 起止
- [x] 5. index.ts reap orphans 排除 hibernated + exit 监听分流 → verify: reap orphans 加 `s.status !== 'hibernated'` 守卫；exit 监听读 `getSession(id).hibernatedAt` 不为 null 时直接 return 不走 endSession
- [x] 6. POST /api/sessions/:id/wake 路由 → verify: 404 / 400 / 500 三种失败码；clearHibernation + ptyManager.spawn 复用旧 id；起止 serverLog；失败回滚 hibernated 状态
- [x] 7. 前端类型 + api client → verify: types.ts SessionStatus 加 hibernated + AppSettings 加 hibernation；HibernationSettings 接口；api.ts wakeSession 存在
- [x] 8. StatusBadge 字典加紫色 hibernated → verify: hibernated 项 dot=紫 chip=紫 label='💤 已冬眠'
- [x] 9. SettingsDialog 加冬眠段 → verify: 开关 + 数字输入 5–180 + 复选框；hint 含"冬眠会强制结束 CLI 进程"；onSave 改 update-app-settings 统一发送
- [x] 10. session tab 点击：hibernated 时 = wakeSession → verify: selectSessionTab 判定 hibernated 时 fire-and-forget wakeSession + logAction；tab 渲染 💤 emoji + opacity-70；title 提示"已冬眠，点击唤醒"；失败弹 alertDialog
- [x] 11. typecheck + diff 白名单核对 → verify: server tsc --noEmit 通过；web tsc -b 通过；git diff 全在 write_files 白名单内
- [x] 12. 浏览器验收派 vibespace-browser-tester → **大哥继上一任务延续偏好跳过**：dev server 跑在 AIkanban-stable，本任务改动在 AIkanban-main，跨树无法即时验收。代码 + typecheck 已过；大哥自己开浏览器验
