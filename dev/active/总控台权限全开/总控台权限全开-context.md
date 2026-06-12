# 总控台权限全开 · Context

memory 扫过：auto.md 相关条目——"会写本机文件或配置的用户可见操作，要同时补前端 logAction 和后端 serverLog"（本次纯后端自动行为，无前端入口，只补 serverLog）；"项目级可选配置目录应按'单个坏文件只跳过并记日志'处理"（坏 JSON 备份重建即此原则）。

## 关键文件

- `packages/server/src/hub-workspace.ts` — 新增 `ensureHubBypassPermissions()`（写 `hub-workspace/.claude/settings.local.json`）。
- `packages/server/src/mcp-bridge.ts:78-84` — hub 分支调用新函数（`injectMcpForAgent` 的 `HUB_PROJECT_ID` 分支）。

## 决策记录

- **用 settings.local.json 的 `permissions.defaultMode = "bypassPermissions"`，不用 `--dangerously-skip-permissions` 启动参数**：前者复用权限面板已有机制（cli-configs.ts 同款字段）、不用碰 cli-catalog 的 spawnArgs、对手动开的 hub 终端同样生效（文件持久在盘上）。不过度设计：不做开关、不做 UI、不做按通道区分。
- **挂在 `injectMcpForAgent` hub 分支而非 `spawnHubSession`**：该分支是 hub 会话两条启动路径（桥自动拉起 / UI 手动开）的共同必经点，且本身就是"启动时写盘配置"的既有位置（.mcp.json 同处写入）。
- **坏 JSON 备份 `.bak` 再重建**：文件里有 claude 自己写的 allow 列表，直接覆盖会丢用户已批准项。
- 写入失败只记 error 不抛：hub 启动不应被配置写入阻塞（与 injectHubMcps 同一容错姿态）。

## 依赖与约束

- claude CLI 读取 cwd 下 `.claude/settings.local.json` 的 `permissions.defaultMode`；bypass 模式全局首次使用可能需在终端接受一次性确认（存 `~/.claude.json`），服务端无法代点。
- hub 会话 cwd = `packages/server/data/hub-workspace`（`getHubWorkspaceDir()`）。
- 类型检查命令：`pnpm -F @aimon/server build`。
