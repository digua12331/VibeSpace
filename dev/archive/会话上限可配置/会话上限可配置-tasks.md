# 会话上限可配置 · 任务清单

- [x] 1. 后端 app-settings.ts 加 maxAiTerminals + clamp + 三处同步 → verify: `pnpm -F @aimon/server build` 过
- [x] 2. 前端 types.ts AppSettings 加 maxAiTerminals → verify: 随前端 build 过
- [x] 3. store.ts 加 maxAiTerminals 字段+默认+setter → verify: 随前端 build 过
- [x] 4. App.tsx 启动载入时回填 maxAiTerminals → verify: 随前端 build 过
- [x] 5. perf-marks.ts isAtSessionLimit 加可选 limit 参数 → verify: 随前端 build 过
- [x] 6. StartSessionMenu.tsx 拦截改读 store.maxAiTerminals + 文案用该值 → verify: `pnpm -F @aimon/web build` 过
- [x] 7. SettingsDialog.tsx 终端页签加数字输入框+载入+保存+回填 store → verify: `pnpm -F @aimon/web build` 过；保存走 logAction meta 含 maxAiTerminals
