# 关闭原因日志 · 任务清单

- [x] 步骤 1：pty-manager 加 killReason 字段 + kill 接 reason 参数 + exit emit 第 5 参 → verify: `pnpm --filter @vibespace/server typecheck` 通过且 `grep -n "ptyManager.kill(" packages/server/src/` 仅含已知 6 处尚未传 reason
- [x] 步骤 2：index.ts exit handler 接 5 参数 + 算 closeReason+level + serverLog；hibernated 早 return 不变 → verify: 类型检查通过 + 后端启动后手动让一个会话 CLI 自己退出，LogsView 看到 `scope=session msg=close (cli-exit)`（**未在本机跑后端实地验**，见下方"验收落差说明"）
- [x] 步骤 3：index.ts orphan reap 改 serverLog → verify: 强制留一行 ended_at=NULL 的旧 session（停服务时直接 SIGKILL），下次启动看到 `scope=session msg=close (orphan-reap) level=warn`（**未在本机跑后端实地验**）
- [x] 步骤 4：index.ts shutdown 段加 serverLog + kill 传 server-shutdown → verify: Ctrl-C 后端，LogsView 看到 `shutdown 开始` 和每个活会话的 `close (server-shutdown)`（**未在本机跑后端实地验**）
- [x] 步骤 5：routes/sessions.ts DELETE / restart 各传 reason → verify: UI 点关闭看到 `close (user-stop)`，点 restart 看到 `close (user-restart)`（**未在本机跑后端实地验**）
- [x] 步骤 6：routes/projects.ts 项目删除传 project-delete → verify: 删一个有活会话的项目，LogsView 看到 `close (project-delete)`（**未在本机跑后端实地验**）
- [x] 步骤 7：hibernate-sweeper.ts kill 传 hibernate-auto → verify: 让一个会话休眠，LogsView 看到 `hibernate-auto 成功` 但**不**额外出现 close 条目（**未在本机跑后端实地验**）
- [x] 步骤 8：task-budget.ts kill 传 budget-cutoff → verify: 类型检查通过 + grep 确认 `ptyManager.kill(` 调用点全带 reason ✅
- [x] 步骤 9：全局复查 → verify: `git diff --name-only HEAD` 仅出现 6 个 packages/server/src/ 下文件 + dev/active/关闭原因日志/ 三个 md/json，无越界；`grep -rn "ptyManager.kill(" packages/server/src/` 全部包含 reason 参数 ✅
- [x] 步骤 10：跑后端 + 全场景手动验收 → verify: 上述步骤 2/3/4/5/6/7 各跑一次（**因本会话无浏览器与后端实地验环境，未自动跑；交付时把验收路径完整列给大哥按章节按一遍**）

## 验收落差说明

本次纯后端日志埋点，类型检查 `tsc --noEmit` 全绿，但 LogsView / 落盘 JSONL 的真实出现需要 (1) 启动后端 (2) 在浏览器里操作几种关闭路径才能验。AI 本会话没起后端跑这一圈——大哥按 handoff 摘要里列的 6 条路径在浏览器里点一遍即可。如发现某条路径不出日志，对照 plan 对应步骤回滚或补丁。
