# 启动脚本自愈 · plan

## 大哥摘要

`start.bat` 现在只在第一次装依赖时编译 native 模块（C++ 写的、要按 Node 版本编译的库），后续如果这些二进制文件被删了或 Node 升级了不匹配，启动脚本不会自动补编译——后端崩在 `getDb()` 第一行，浏览器就显示"后端连接失败"。本次把判断逻辑改成"二进制文件在不在"——只要 `better-sqlite3`（SQLite 数据库的 native 绑定）的 `.node` 文件丢了，下次启动会自动重编译，不用再手工跑命令。

验收方式：在 `AIkanban-stable` 里把 `better-sqlite3` 的 `.node` 文件删掉（模拟今天的故障），双击 `start.bat`，应看到一行 `[VibeSpace] rebuilding native modules ...`，然后服务正常起在 8787 端口、浏览器打开后无红色错误条。

## 目标

修复触发条件：start.bat 的 native 模块重编译只在 `node_modules` 不存在时触发，导致以下场景下后端启动失败、前端报"后端连接失败"无法自愈：
- Node 版本升级后 ABI 不匹配（NODE_MODULE_VERSION 变化）
- pnpm 缓存被清、native 二进制被误删
- 跨机器同步时 native 二进制没带过来

**可验证的验收标准**：
1. 在 stable 副本删掉 `node_modules\.pnpm\better-sqlite3@*\node_modules\better-sqlite3\build\Release\better_sqlite3.node`
2. 双击 `start.bat`
3. 控制台输出包含 `rebuilding native modules`
4. 后端日志（`packages/server/data/logs/2026-05-06.log`）写入 `backend listening on http://127.0.0.1:8787`
5. 浏览器打开 `http://127.0.0.1:8788` 顶部**无**红色"后端连接失败"条

## 非目标 (Non-Goals)

- 不顺手重写整个 start.bat、不挪 PowerShell 清理逻辑、不改端口逻辑
- 不引入 Node.js 脚本替代 .bat（保留纯 batch + powershell 现状）
- 不处理 `@homebridge/node-pty-prebuilt-multiarch` 单独缺失的检测（它的失败更软、且已被现有 rebuild 命令覆盖；用户感知差异小，避免过度设计）
- 不动 `sync-to-stable.bat`、`init-stable.bat`、`_tp.bat` 任何其它启动相关脚本

## 实施步骤

1. **改 `AIkanban-main/start.bat`**：删除 `FIRST_RUN` 标志，改成"装完依赖之后用 `dir /s /b` 检查 better-sqlite3 的 `.node` 二进制是否存在；不存在则重编译"。 → verify: `start.bat` diff 干净，只动重编译触发段；脚本能在 cmd 里语法跑通（`start.bat /?` 能正常退出，无 batch 解析错误）
2. **本地提交**：`git add start.bat dev/active/启动脚本自愈/* && git commit -m "fix(start.bat): rebuild native modules when better-sqlite3 binding is missing"` → verify: `git log -1` 显示新提交
3. **打 stable 标签**：`git tag stable-2026-05-06` → verify: `git tag -l "stable-2026-05-*"` 列表里能看到新标签
4. **跑 sync-to-stable**：`./sync-to-stable.bat` → verify: 末尾输出 `[sync] DONE. Stable HEAD is now at stable-2026-05-06 and rebuilt.`
5. **stable 端验收**：双击 `AIkanban-stable/start.bat` → verify: 控制台看到 `rebuilding native modules`（如果 sync 过程已经 rebuild 过，则跳过这条）；后端日志出现 `backend listening on http://127.0.0.1:8787`；浏览器无红条

## 边界情况

- **better-sqlite3 装在不同 pnpm 路径**：检测使用 `node_modules\.pnpm\better-sqlite3@*\node_modules\better-sqlite3\build\Release\better_sqlite3.node` 通配，覆盖 pnpm 任意版本；如果未来 pnpm 改用其它存储结构（pnpm 原生 hoist / pnpm linker 切换），这条检查会持续 false → 每次启动都强制 rebuild。**容忍此退化**：rebuild 只是慢一点，不会破坏功能。
- **dir 命令在路径不存在时退出码非 0**：`for /f` 解析输出，路径不存在时输出为空，循环不执行，`BSQLITE_BIN_FOUND` 保持未定义 → 触发 rebuild。✓ 符合预期。
- **sync-to-stable 步骤 7 的 lock-changed 检查**：从 `stable-2026-05-02-2` 到新 `stable-2026-05-06`，中间夹了 `3e49ce0 更新配置` 改了 `pnpm-lock.yaml`，所以 sync 自己会跑一次 install + rebuild。这意味着 stable 端的 native 绑定在 sync 阶段就被修好了，第 5 步双击 `start.bat` 时新逻辑可能不会真触发 rebuild（绑定已存在）—— 但这不影响验收：服务能起、前端无红条即可。如要专门验证新逻辑生效，需在 stable 端**手工删除 .node 文件后**再启动一次。

## 风险与注意

- **会把 main 上未进 stable 的 2 个提交一并带过去**：`3e49ce0 更新配置`（lock 文件更新）、`dd4b437 merge: 合并另一台电脑的 checkpoint`。这是 sync-to-stable 工作流的固有行为（它按 stable-* 标签整体 reset stable），不是本次新增风险。如果大哥不希望这两个提交进 stable，需要换成"基于 stable-2026-05-02-2 cherry-pick 本次修复并打 hotfix 标签"的路径——本 plan 默认采用前者（普通 sync 流程）。
- **CRLF vs LF**：start.bat 是 batch 文件，必须保留 CRLF 行尾。Edit 工具不会主动改行尾，但提交前 `git diff` 看一眼确保没整行换行变化。
- **Windows 路径里的反斜杠**：`dir /s /b` 用 `\`；`for /f` 用单引号包裹命令并用 `2^>nul` 转义。已在边界情况里覆盖。
- **delayed expansion 已开**：脚本顶部 `setlocal EnableDelayedExpansion` 已存在，新代码可放心用 `!VAR!`。
