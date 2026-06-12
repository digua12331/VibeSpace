# 权限目录补PowerShell整工具 · Plan

## 大哥摘要

你在权限面板里点了"最高权限"还是狂弹确认，查下来根本原因是：权限目录（面板里那张可勾选的清单）里压根没有"PowerShell 任意命令"这一项——Windows 上 Claude 跑命令大量走 PowerShell（微软家的命令行，和 Bash 是两个独立工具），清单里只放了十来个固定 PowerShell 命令，其他全弹。这次把"PowerShell (任意命令)"补进清单，这样"⚡全权"预设就能真正覆盖它。改完后你去：设置 → 🛡权限 → 点"⚡全权(危险)" → 点右上角"💾 保存" → 按提示重启会话，弹窗会大幅减少。不动你现有的任何数据和已存配置。

## 目标

- 权限目录（`templates/cli-configs/permission-catalog.json`）的"整工具"分组新增 `tool-powershell`（值 `PowerShell`，整工具放行规则）。
- "🚀VibeSpace 推荐"预设带上该条目（描述里本就声称覆盖"关键 PowerShell"，实测远不够用）。
- "⚡全权(危险)"预设是 applyAllAllow（自动遍历目录全部条目），无需改即自动覆盖新条目。
- 验收：
  1. `node -e` 加载 main 仓 catalog，断言 tools 组含 `tool-powershell` 且 value 为 `PowerShell`，vibespace 预设含 `"tool-powershell": "allow"`。
  2. stable 部署（`F:\VibeSpace\KB\AIkanban-stable`，大哥日常跑的实例）同文件应用同样改动并通过同样断言——catalog 是每次请求实时读盘，改完 UI 刷新即可见。
  3. 浏览器可观察：打开 设置→权限→Claude 页签，"整工具"分组能看到"PowerShell (任意命令)"一行；点"⚡全权(危险)"后该行变"允许"；保存后项目 `.claude/settings.local.json` 的 allow 数组里出现 `"PowerShell"`。

## 非目标

- 不加"完全不问"（bypassPermissions）开关——大哥已拍板只走白名单路线。
- 不动"💻开发(保守)"、"🛠开发(完整)"两档预设（保持细粒度理念）。
- 不清理 settings.local.json 里历史积累的零散条目。

## 实施步骤

1. main 仓 catalog：tools 组 `tool-bash` 之后插入 `tool-powershell`；vibespace 预设 selections 加 `"tool-powershell": "allow"`。→ verify: node 断言脚本通过。
2. stable 仓同文件做同样两处插入（两文件当前 hash 一致，直接同步改）。→ verify: 同样断言通过。
3. 交付 handoff，给大哥 UI 操作指引。

## 边界情况

- 用户 settings.local.json 里已有 `PowerShell(...)` 细条目：diff 逻辑按等价形式识别，整工具 `PowerShell` 与细条目共存不冲突（allow 并集）。
- 已开着的会话不会热加载——handoff 里明确要求重启会话。

## 风险与注意

- 大哥日常跑的是 stable 实例（hooks 指向 AIkanban-stable），只改 main 仓他看不到效果，必须同步 stable——已列入步骤 2。
- `PowerShell` 整工具放行意味着任何 PowerShell 命令不再确认，归到"全权/推荐"两档由用户自选，符合其"危险自担"定位。
- memory 扫过：auto.md / manual.md 无与权限目录直接相关条目。

## 多模型 Plan 会审

跳过：小档任务（单数据文件、两处插入、易回滚），按工作流不调外部模型。
