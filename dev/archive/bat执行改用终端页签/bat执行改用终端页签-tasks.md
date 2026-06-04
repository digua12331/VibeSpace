# bat执行改用终端页签 · 任务清单

- [x] 步骤 1 改 `packages/web/src/components/fileContextMenu.ts` 的"执行"条目：`createSession({ agent: 'cmd' })` → `addSession` / `setActiveSession` / `setActiveTabKind('session')` → `subscribe` → 120ms 后 `sendInput("cd /d \"dir\" && \"file.bat\"\r")`；失败仍走 `alertDialog('执行失败', ...)` → verify: `grep -n execBatFile packages/web/src/components/fileContextMenu.ts` 无匹配；文件里能看到 `createSession({ projectId, agent: 'cmd' })` 和 `aimonWS.sendInput(`
- [x] 步骤 2 删 `packages/web/src/api.ts` 里 `export function execBatFile` 整段 → verify: `grep -rn execBatFile packages/web/src` 结果为空
- [x] 步骤 3 删 `packages/server/src/routes/fs-ops.ts` 里 `POST /fs/exec-bat` 路由整段（含上方 4 行注释）。`spawn` import 在 reveal/open-vscode 路由里还在用，保留。→ verify: `grep -rn "exec-bat" packages/server/src` 为空
- [x] 步骤 4 跑 `pnpm -r build` → verify: 退出码 0，`packages/server/dist/` 和 `packages/web/dist/` 产物都有更新；无 TS 报错
- [ ] 步骤 5 浏览器冒烟（dev 副本）：`pnpm dev:alt` 启动 → 打开 http://127.0.0.1:9788 → 文件树右键 `start.bat`→"执行" → verify: (a) 不弹独立 cmd 窗口；(b) UI 出现一个新的 `cmd·xxxxxx` 页签并自动聚焦；(c) 页签里流式输出 "VibeSpace - AI monitor dashboard launcher" 横幅
