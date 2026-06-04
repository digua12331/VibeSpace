# 技能插件开关面板 · 任务清单

- [x] 1. 写后端 helper `packages/server/src/claude-settings.ts` → verify: 文件存在；导出 `readClaudeSettings` / `patchClaudeSettings`；ts 单独检查无类型错；patch 写 null 删 key、写 'off' 增/改 key、tmp 文件与目标同目录、写前 re-read
- [x] 2. 写后端路由 `packages/server/src/routes/claude-settings.ts` → verify: GET 返回 `{ skillOverrides, enabledPlugins, path, exists }`；PUT body 含 `skillOverrides` 或 `enabledPlugins`，zod 校验失败返 400；serverLog 起止配对（scope=`claude-settings` action=`patch`）；catch 路径返 500 + ERROR 日志带 `meta.error`
- [x] 3. 注册路由 + 前端类型 + 客户端 → verify: `packages/server/src/index.ts` 加 `import` + `await registerClaudeSettingsRoutes(app)`；`packages/web/src/types.ts` 加 `ClaudeGlobalSettings` / `ClaudeSettingsPatch`；`packages/web/src/api.ts` 加 `getClaudeSettings()` / `patchClaudeSettings(patch)`；server + web 两个包各跑一次 typecheck 都通过
- [x] 4. 改 `packages/web/src/components/sidebar/SkillsView.tsx` → verify: 浏览器打开技能面板（agent='claude-code'）能看到顶部灰字 banner、每个全局技能行有 toggle、分组 header 有"全部启用/全部禁用"按钮、出现"全局插件"区列出 enabledPlugins 全部条目；切到 codex/opencode tab 这些都不显示
- [x] 5. 类型检查 + diff 白名单核对 → verify: server `npx tsc --noEmit` 通过；web `npx tsc -b` 通过；`git diff --name-only HEAD` 输出仅含本任务 write_files（其余 Workbench/SettingsDialog/paste-image-cleaner/app-settings 等是 session 起始已有的脏文件，非本任务改动）
- [x] 6. 浏览器验收派 `vibespace-browser-tester` → **大哥决定跳过**：跑着的 dev server 是从 `AIkanban-stable` 启动的，我的改动在 `AIkanban-main`，跨树无法即时验收。代码 + typecheck 已过，大哥自己开浏览器验
