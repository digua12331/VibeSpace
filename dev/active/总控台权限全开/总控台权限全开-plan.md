# 总控台权限全开 · Plan

## 大哥摘要

你在微信里跟总控台聊天时，AI 一要执行命令就卡在"权限确认"上，而你在微信里根本点不了确认。这次改完：总控台（hub 会话，就是微信/飞书背后那个 AI 指挥台）启动时自动带上"权限全开"配置（bypassPermissions，跳过所有确认弹窗），以后微信里的指令会直接执行、直接回结果。只影响总控台自己的沙箱目录，不动你任何真实项目的权限设置。

## 目标

- 微信发指令给总控台时，claude 不再弹权限确认，直接执行。
- 验收：重启总控台会话后，`packages/server/data/hub-workspace/.claude/settings.local.json` 里出现 `"defaultMode": "bypassPermissions"`，且原有 allow 列表保留；在 LogsView 看到 `scope=hub` 的写入日志。
- 类型检查：`pnpm -F @aimon/server build` 通过。

## 非目标 (Non-Goals)

- 不做"把权限确认推送到微信审批"的方案（重得多，需要双向交互协议；本次选了用户给的第一条路：全开）。
- 不动各真实项目的 `.claude/settings.local.json` 与权限面板逻辑。
- 不处理 codex 的 hub 会话（hub 强制 claude，codex 不在本次范围）。

## 实施步骤

1. `hub-workspace.ts` 新增 `ensureHubBypassPermissions()`：幂等合并写 `hub-workspace/.claude/settings.local.json` 的 `permissions.defaultMode = "bypassPermissions"`，保留已有内容；坏 JSON 先备份 `.bak` 再重建。→ verify: 函数单独跑一次，文件内容正确合并。
2. `mcp-bridge.ts` 的 hub 分支调用它（`injectHubMcps` 旁），覆盖微信/飞书自动拉起与手动开总控台两条路径。→ verify: 类型检查 + 重启 hub 会话后文件含 defaultMode。
3. 服务端日志：写入成功/失败各一条 `serverLog`（scope=hub）。→ verify: LogsView / 落盘日志可见。

## 边界情况

- 已存在的 settings.local.json 含 allow 列表 → 必须保留，只加 defaultMode。
- 文件是坏 JSON → 备份为 `.bak`，重建最小配置，记 error 日志，不阻塞 hub 启动。
- claude 全局首次用 bypass 模式可能弹一次性的"我接受"红色确认框（记在 ~/.claude.json）→ 交付说明里告知大哥去总控台终端点一次。

## 风险与注意

- 权限全开意味着总控台里的 AI 可以无确认执行任意命令——但它 cwd 在 hub-workspace 沙箱，且这是用户明确要求的取舍。
- 写入失败不抛错（hub 启动不被配置写入阻塞），靠 error 日志暴露。

## 多模型 Plan 会审

跳过：小档任务（2 个文件、无破坏性变更、易回滚），按工作流不调外部模型。
