# 权限面板完全不问开关 · 任务清单

- [x] core: writeClaudeLocal 加 defaultMode 可选参数 → verify: node 冒烟（临时目录写/删/不动三态）通过
- [x] server: GET 返回 defaultMode + SaveSchema/PUT 透传 + serverLog 起止 → verify: pnpm -F @aimon/server build 通过
- [x] web: types.ts 加字段 + PermissionsDrawer 开关 UI + onSave logAction → verify: pnpm -F @aimon/web build 通过
- [x] 端到端冒烟: curl GET/PUT defaultMode 读写 + 404 失败分支 → verify: curl 输出符合预期（写入/删除/404 全过，冒烟项目与临时后端已清理）
- [x] 交付 handoff（含 stable 同步指引 + diff 清单） → verify: 首行为验收指引
