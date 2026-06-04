# 终端快捷键自定义 · 任务清单

- [x] 步骤 1 后端数据结构：app-settings.ts 加 terminalKeybindings 字段 + DEFAULTS + read/clamp/merge → verify: 删掉 json 里该字段后启动，GET /api/app-settings 返回带默认 null/null；pnpm -F @aimon/server build 类型检查通过
- [x] 步骤 2 后端校验：routes/app-settings.ts 的 UpdateBody 加 terminalKeybindings + 非法组合拦截，失败发 ERROR 日志 → verify: 合法组合保存成功；非法组合（Esc 自身/Ctrl+C 自身/重复/粘贴键/保留键）返回 400 且 serverLog ERROR；server build 通过
- [x] 步骤 3 前端类型：types.ts 加 KeyCombo / TerminalKeybindings 挂到 AppSettings → verify: pnpm -F @aimon/web build 类型检查通过
- [x] 步骤 4 前端 store + 启动载入：store.ts 加 terminalKeybindings 状态 + setter；App.tsx 加 useEffect 启动 getAppSettings 灌 store → verify: web build 通过；刷新页面后不开设置弹窗 store 里就有值
- [x] 步骤 5 设置弹窗 UI：SettingsDialog.tsx 加「终端快捷键」section（默认键展示 + 录制 + 清除），录制态让路自身 Esc 关窗，前端校验非法组合，保存 patch 带 terminalKeybindings 并同步 store → verify: 浏览器里能录 F8 / 能清除；录制态按 Esc 只取消录制不关窗；非法键给提示；LogsView 看到 scope=settings action=update-app-settings 起止配对；web build 通过
- [x] 步骤 6 终端接线：SessionView.tsx 加 matchCombo + keybindingsRef，命中 interruptAltKey 发 \x03（preventDefault+stopPropagation），命中 abortAltKey 且满足 IME/焦点/空输入守卫发 \x1b → verify: 跑 AI 的终端按 F8 能打断；默认 Esc/Ctrl+C 行为不变；web build 通过
- [~] 步骤 7 整体验收 + 越界检查 → 代码部分已完成：server+web build 全绿；git diff 8 个文件全在 write_files 白名单内（.mcp.json 是任务前既有改动，非本次）。**blocked: 浏览器五项验收 + browser-tester 需先重建并重启 VibeSpace 服务（当前跑的是旧后端，/api/app-settings 还不返回 terminalKeybindings），重启会断开在跑会话，等大哥定夺**：跑 server+web build；浏览器走完录制/刷新持久化/清除/默认仍有效/非法输入 ERROR 五项；git diff --name-only HEAD 比对 write_files 白名单无越界 → verify: 全绿，派 vibespace-browser-tester 复核浏览器可观察项
