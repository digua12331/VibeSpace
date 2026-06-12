# 项目内存占用实时显示 · context

## 关键文件

### 后端
- **新增** `packages/server/src/process-mem-service.ts` — ticker + CIM 查询 + 进程树 BFS + 按项目聚合 + broadcast。
- `packages/server/src/index.ts` — 启动时 `startProcessMemTicker()`；进程退出时 `stopProcessMemTicker()`。
- `packages/server/src/ws-hub.ts:20` — `broadcast(msg)` 复用，按帧广播。
- `packages/server/src/pty-manager.ts:287` — `ptyManager.listAlive()` 取 alive session id 列表；`getPid(id)` 取 PID。
- `packages/server/src/db.ts:234` — `BUILTIN_SHELL_AGENTS = ["shell","cmd","pwsh"]`；用于过滤"AI 会话"。
- `packages/server/src/log-bus.ts` — `serverLog('info', 'mem-stats', ...)` ticker 起停日志（只在状态切换时记一次，不每 tick 刷）。

### 前端
- `packages/web/src/types.ts` — `WsMessage` 联合分支加 `mem-stats`。`BUILTIN_SHELL_AGENTS` 已存在。
- `packages/web/src/main.tsx:23-52` — `aimonWS.onMessage` switch 加 `case 'mem-stats'` → `useStore.getState().setMemByProject(msg.byProject)`。
- `packages/web/src/store.ts` — 新增 `memByProject: Record<string, number>` 字段 + `setMemByProject` setter。
- `packages/web/src/components/layout/ProjectsColumn.tsx:250-253` — 在 `countFor(p.id)` 旁加内存读数 span。

## 决策记录

- **不引入 systeminformation / pidusage 等第三方库**：单一 CIM 查询 + JS 端 BFS 已足够；新增依赖收益小、维护面大。
- **不做 cache + 增量更新（每 30s 重建树、每 10s 只刷内存）**：复杂度跳一档，V1 一律 CIM 全量；如果实测 10s 间隔在大哥机器上仍卡，再切增量。
- **8s CIM 超时**：在 10s 间隔下留出 2s 余裕；超时丢弃这一 tick，前端保留旧值不闪退。
- **ticker 空跑短路**：无 WS 客户端 / 无 AI alive session 时 tick 内部直接 return，**不**调 CIM——避免后台长开 VibeSpace 但没在用时持续吃机器资源。
- **格式化阈值**：`<1GB` 显 MB（整数），`≥1GB` 显 GB（1 位小数）；与"精致细边"风格一致——简短紧凑、tabular-nums 等宽。
- **日志规则**：ticker start/stop 各 1 条 info；CIM 失败 1 条 error / 每次连续失败不去重（失败本身是排障线索）；不在每 tick 打成功日志（参 auto.md "高频事件不要逐次记日志"）。
- **操作日志规则豁免？** ticker 是后台轮询、非用户主动操作，按 CLAUDE.md "豁免：轮询/心跳" 处理；只在 start/stop 边界记。

## 依赖与约束

- 仅 Windows：`Get-CimInstance` 不存在于非 Windows 节点。其它平台 ticker 启动后第一次调用即失败 → 永远显示空 → 优雅降级。
- TypeScript 双包：server tsc + web tsc 都跑。
- 写白名单（默认档强制）：仅以下 5 个文件可写入；越界即停。
  - `packages/server/src/process-mem-service.ts` (新)
  - `packages/server/src/index.ts`
  - `packages/web/src/types.ts`
  - `packages/web/src/store.ts`
  - `packages/web/src/main.tsx`
  - `packages/web/src/components/layout/ProjectsColumn.tsx`
- 不动 `ws-hub.ts`、`pty-manager.ts`、`db.ts` —— 已有 API 够用。
