# 项目内存占用实时显示 · plan

## 大哥摘要

每个项目行右侧加一个内存读数（比如 `1   1.2 GB`）。服务端每 **10 秒**查一次系统进程，把这个项目下所有 AI 会话(claude/codex/gemini 等)及它们派生的子进程的内存加起来，通过实时通道推给浏览器自动更新。内置 shell（cmd/pwsh）不计入。**不动会话本身、不动其它界面**——只是在「项目」列每行多一个灰色数字。

刷新频率已和你确认：**10 秒**（最省资源，机器现在偏卡，定时查进程要克制）。

## 目标

- 「项目」列每行：当该项目有活着的 AI 会话时，在原有会话数旁边显示项目下所有 AI 进程树（会话 PID + 全部子进程）的总驻留内存（WorkingSet）。
- 验收（浏览器可观察）：
  - 打开 VibeSpace，「项目」列里**有 AI 会话**的项目行能看到内存数字（如 `1   1.2 GB`）；无 AI 会话的项目行不显示数字。
  - 起/停一个 AI 会话，10 秒内该行数字相应增加/减少。
  - 「日志」面板看到 `scope=mem-stats action=ticker-start` / `ticker-stop` 起止配对；CIM 超时时看到 ERROR 但不影响主界面。

## 非目标

- 不显示 CPU 占用、不画历史曲线、不按 session 拆分。
- 不做跨平台（先 Windows；其它平台优雅降级为不显示）。
- 不动「全部 sessions」聚合行（V1 不显示总和）。
- 不动 PrimarySidebar / EditorArea / 其它面板。

## 实施步骤

1. **后端：新增 `packages/server/src/process-mem-service.ts`** —— 启停 10s ticker。
   - 每 tick 调一次 PowerShell `Get-CimInstance Win32_Process | Select ProcessId,ParentProcessId,WorkingSet | ConvertTo-Json -Compress`，**带 8s 超时**（防 WMI 卡死）。
   - 解析返回的 PID→{parent, workingSet} 表；从 `ptyManager.listAlive()` 取每个活着的 session PID（排除内置 shell agent），BFS 走子树，求和。按 `session.projectId` 分组累加。
   - `import { broadcast } from './ws-hub.js'` 发 `{ type: 'mem-stats', byProject, ts }`。
   - ticker 仅在有 WS 客户端 + 至少一个非 shell alive session 时跑；否则空转跳过（避免无谓的 CIM 调用）。
2. **后端：`packages/server/src/index.ts`** —— 启动时 `startProcessMemTicker()`；进程退出时停。
3. **共享类型 + 前端 WS 处理：** `packages/web/src/types.ts` 加 `WsMessage` 联合分支 `{ type:'mem-stats', byProject:Record<string,number>, ts:number }`；`packages/web/src/main.tsx` 的 `aimonWS.onMessage` switch 加 `case 'mem-stats'` 调 store。
4. **前端 store：** `packages/web/src/store.ts` 加 `memByProject: Record<string, number>` 字段 + `setMemByProject(map)` setter。
5. **前端渲染：** `packages/web/src/components/layout/ProjectsColumn.tsx` 在原 `countFor(p.id)` 旁加一个 `memFor(p.id)`，格式化 `<1GB` 显示 `"850 MB"`、`≥1GB` 显示 `"1.2 GB"`；值为 0 / undefined 时不显示。tabular-nums + 灰字。
6. web `tsc -b` + server `tsc --noEmit` 双双通过。

## 边界情况

- **WMI 慢/卡**：8s 超时 + 该 tick 跳过；前端保留上次数值（不闪退）。日志 ERROR 一次但不刷屏。
- **PID 复用 / 进程刚消失**：BFS 时未在表里的 PID 跳过；不抛错。
- **无 alive 会话**：ticker 内部直接 return，不发空消息；前端 store 自然为空，所有项目行不显示数字。
- **非 Windows 平台**：powershell 调用失败 → 整个 ticker 静默不出，前端不显示——优雅降级。
- **多客户端**：broadcast 已是 1→N 广播；多浏览器开同一 VibeSpace 一致看到数字。

## 风险与注意

- 与最近"start.bat 因 CIM 慢卡死"同根因——机器繁忙时 CIM 查询本身可能 5–8s 才返回。本任务用单次查询 + 超时兜底 + 10s 间隔，把开销和阻塞风险都压到最低；最坏情况是数字滞后或显示破折号，不会影响主流程。
- 写白名单严格：只动 5 个文件，不顺手清理 ProjectsColumn 其它代码。
- memory 扫过：`auto.md` 里关于"操作日志必配起止"、"项目级可选配置应优雅降级"、"高频事件不要逐次记日志"三条命中本任务（ticker 起止打日志、CIM 失败优雅降级、不在每 tick 打日志）。`ARCHITECTURE.md` 未扫到内存监控相关章节。

## 多模型 Plan 会审

> 跳过：本任务功能边界与实现路径都很清楚（单方向新功能、刷新频率已与大哥确认、无算法/架构取舍），且大哥本次会话明显倾向于快速交付而非反复评审；按 CLAUDE.md "小档/方案明确" 原则不发起外部模型评审，节省外部调用。
