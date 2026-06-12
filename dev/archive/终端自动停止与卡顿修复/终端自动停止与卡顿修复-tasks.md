# 终端自动停止与卡顿修复 · 任务清单

- [x] 步骤 1：`app-settings.ts` 的 `DEFAULTS.hibernation.enabled` 改 `false` → verify: web/server 类型检查前先确认改动；通读 `hibernate-sweeper.ts` 确认 `enabled===false` 时 tick 提前 return；核对 `SettingsDialog` 读同一份 `/api/app-settings`
- [x] 步骤 2：`TerminalHost.tsx` 把项目保活过滤改成始终生效（当前项目 + 最近 3 个项目）→ verify: 当前 active 会话恒在集合内；web `tsc` 通过
- [x] 步骤 3：`~/.claude/settings.json` 关闭 5 个插件（frontend-design/context7/code-review/code-simplifier/skill-creator）→ verify: 文件仍是合法 JSON；codex/github/superpowers 仍为 `true`
- [x] 步骤 4：项目级类型检查 → verify: server 与 web 各自 `tsc` 退出码 0
- [x] 步骤 5：浏览器验收 → 浏览器自动化工具（browser-use MCP）本会话未注册，自动验收跳过；改用 `curl /api/app-settings` 实测运行中的服务，`hibernation.enabled=false` 已确认（P1 通过——该接口即休眠开关真源，sweeper 与设置对话框都读它）；P2 靠 TerminalHost 代码审查 + web 类型检查保证
- [x] 步骤 6：`dev/issues.md` 追加 2 条（WS 输出 backpressure；refreshSessions 默认订阅全部 alive 会话）→ verify: issues.md 末尾新增 2 行 `- [ ]`
