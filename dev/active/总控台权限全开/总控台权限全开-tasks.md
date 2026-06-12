# 总控台权限全开 · 任务清单

- [x] hub-workspace.ts 新增 ensureHubBypassPermissions()（幂等合并 defaultMode，坏 JSON 备份重建，serverLog 成功/失败） → verify: pnpm -F @aimon/server build 通过 ✓
- [x] mcp-bridge.ts hub 分支调用该函数 → verify: build 通过 + 手动跑一次确认 settings.local.json 合并正确（保留原 allow 列表）✓
- [x] 验收落盘：模拟已有文件/坏 JSON 两种输入，确认合并与 .bak 备份行为 → verify: 合并保留 allow 列表 ✓；坏 JSON 生成 .bak 并重建 ✓；幂等早退 ✓
