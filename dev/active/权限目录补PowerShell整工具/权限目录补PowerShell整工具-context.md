# 权限目录补PowerShell整工具 · Context

## 关键文件

- `templates/cli-configs/permission-catalog.json` — 唯一要改的 main 仓文件。tools 组（约 L272-295）加条目；vibespace 预设 selections（约 L161-262）加一行。
- `F:\VibeSpace\KB\AIkanban-stable\templates\cli-configs\permission-catalog.json` — stable 部署同文件（改前 hash 与 main 一致：AD96A21C…），同步同样改动。
- 只读参考：`scripts/lib/cli-configs-core.mjs`（loadCatalog 每次 readFileSync 实时读盘，无缓存）、`packages/web/src/components/PermissionsDrawer.tsx`（applyClaudePreset 的 applyAllAllow 遍历目录全部 items，新条目自动被"全权"覆盖）。

## 决策记录

- 只加 `tool-powershell` 一个条目，不加 `Skill` 整工具 / `mcp__*` 通配：弹窗证据（项目 settings.local.json 尾部手动积累的 always-allow 条目）几乎全是 `PowerShell(...)`；Skill setup 类默认 ask 是有意设计；`mcp__*` 通配是否被 Claude Code 支持不确定，不写存疑规则。无过度设计。
- vibespace 预设带上该条目：其描述本就声称"关键 PowerShell"，实测 10 个固定模式远不够；该档已放行 curl/docker/node 任意命令，PowerShell wholesale 危险度同级。dev-conservative / dev-full 不动。
- 直接改 stable 仓同文件而不是跑 sync-to-stable.bat：bat 会整仓同步，影响面大；本次只需一个文件两处插入，手改可控。
- 诊断结论存档：用户面板点"最高权限"后项目 `.claude/settings.local.json`（mtime 2026-06-12 10:35）里没有 yolo 预设应写入的整工具条目（无裸 `Bash`/`Read` 等）→ 当时点了预设但没点保存（或没重启会话）。handoff 必须含"点预设→保存→重启会话"完整指引。

## 依赖与约束

- catalog 无 JSON Schema 校验（`$schema` 指向的文件不存在），server 端 loadCatalog 仅 JSON.parse → 验收用 node 断言脚本兜底。
- Claude Code 权限规则：裸工具名（`PowerShell`）= 整工具放行；与既有 `PowerShell(xxx *)` 细条目共存为并集，无冲突。
- 纯 JSON 数据文件改动，不涉及 TS 源码 → 无需类型检查。
- 操作日志豁免：本次不新增 UI 操作/不新增 mutation API（catalog 是已有 GET 路由消费的静态数据），按豁免清单不加日志。
