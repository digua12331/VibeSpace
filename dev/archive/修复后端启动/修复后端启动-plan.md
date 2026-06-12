# 修复后端启动 · Plan

## 目标

让 **同一份 `start.bat`** 放在 `AIkanban-main` 或 `AIkanban-stable` 里都能正确工作：

- 两个项目**各跑自己的一套前后端**，端口互不冲突，可以同时存活。
- 启动时只清理**本项目自己**残留的 node 进程和本项目端口的 LISTENING，不误伤另一个项目。
- 浏览器自动打开的 URL 指向本项目的前端端口。

为什么之前会坏：当前 main 和 stable 的 `start.bat` 一字不差都在 8787/8788，`dev:all` 是同一脚本；先启哪个哪个抢到端口，后启的那个的 server 启动时撞 `EADDRINUSE` 或被另一边的同路径 tsx 进程污染锁——于是你看到的 "8787 没人监听、一堆僵尸 node 进程" 就是双端冲突的尾巴。

### 可验证的验收标准（必须全部通过才算完成）

1. **双端共存冒烟**：
   - 在 `AIkanban-main\start.bat` 跑起来后，`AIkanban-stable\start.bat` 再跑起来，**两个命令窗口都能保持运行**、互不报错。
   - `netstat -ano | findstr "LISTENING"` 能同时看到两组（main 一对、stable 一对）端口监听。
2. **前端可观察**：
   - 浏览器访问各自前端端口的 URL，顶栏**不再**出现 "后端 WebSocket 已断开: Failed to fetch"。
   - 页面左下的实例标签（`VITE_AIMON_INSTANCE_LABEL`）能区分是 "开发" 还是 "稳定"。
3. **精准清理**：
   - 在 main 正在运行时，执行 `AIkanban-stable\start.bat`（假设 stable 曾经留过僵尸进程），**不得**杀掉任何路径在 `AIkanban-main` 下的 node 进程；反之亦然。
   - 用命令：在两项目都启动后，先 `tasklist /FI "IMAGENAME eq node.exe" /V` 记一份，再只重启 stable 一次，看 main 那组 PID 是否保留。
4. **浏览器自动打开**：每个项目 `start.bat` 自动打开的浏览器 URL 指向**该项目自己**的前端端口（而不是写死 8788）。
5. **idempotent**：同一项目的 `start.bat` 连跑两次，第二次的清理阶段能把第一次残留的进程全部清掉，然后正常启动（不会出现"旧 server 还活着，新 server 报 EADDRINUSE"）。

## 非目标 (Non-Goals)

- **不改 server 源码**（`packages/server/src/*`）。这次纯属启动脚本/配置问题，不动业务逻辑。
- **不改 package.json 的 scripts**。`dev:all` / `dev:alt` 已经存在，本次复用它们，不新增脚本。
- **不改 `sync-to-stable.bat` / `init-stable.bat`**。这两个文件本次不碰；start.bat 自适应就够。
- **不做 Node 版本自愈 / 自动 rebuild native**。前面 Q2 没必要展开，超出本次范围。

## 实施步骤

### 步骤 1：选定身份区分机制

**假设（明确列出，待你确认）**：start.bat 通过 **"自身所在目录路径里是否包含子串 `stable`"** 判断自己是哪边：

- 路径含 `stable` → 身份 = stable，端口 = **8787 / 8788**（沿用默认，让老用户的记忆不变），脚本 = `pnpm dev:all`，实例标签 = "稳定"。
- 否则 → 身份 = dev，端口 = **9787 / 9788**，脚本 = `pnpm dev:alt`（此脚本已存在且已配好 9787/9788 + 环境变量），实例标签 = "开发"。

**为什么这样分**：
- `dev:alt` 脚本在 main 的 package.json 里已经把 AIMON_PORT=9787 / AIMON_WEB_PORT=9788 / AIMON_WEB_ORIGIN / AIMON_BACKEND_URL / VITE_AIMON_BACKEND / VITE_AIMON_INSTANCE_LABEL=开发 都铺好了，不用再重造。
- `dev:all` 保持默认 8787/8788，对应"稳定"副本用户习惯的端口。
- 按目录名区分，简单、不依赖额外 marker 文件、不用动 git。

**验证**：在 start.bat 开头加一次 `echo`，跑 bat 时确认它识别到的身份正确。

### 步骤 2：改写 start.bat 的清理段

当前（第 23–29 行）的清理是"按端口 8787/8788 杀 LISTENING 进程"。问题：

- 只能杀到正在 LISTENING 的，杀不到**启动失败卡在 tsx watch** 的僵尸（它没绑端口、但持有 sqlite 锁和文件句柄）。
- 会误杀对面项目（如果对面恰好在用 8787/8788 —— 这次改完 stable 确实会用这对端口，所以 main 的 start.bat 绝不能再碰这俩）。

**改成**：
- **先按端口清**：清理的是身份对应的那对端口（main 清 9787/9788，stable 清 8787/8788），不是写死。
- **再按命令行清**：用 PowerShell `Get-CimInstance Win32_Process` 枚举 `node.exe`，过滤 `CommandLine` 里**包含 `%~dp0`**（本项目根路径）的进程，`Stop-Process -Force` 掉。
  - 这样能扫到 pnpm wrapper、tsx watch、vite、子 node —— 所有命令行带有本项目路径的 node 全干掉。
  - 不会误杀 MCP（命令行在 `AppData\Local\npm-cache\_npx` 下）、IDE 的 node、Claude 自己的 node，更不会动对面项目（命令行路径前缀不同）。
- **两步顺序**：先按命令行精准清（处理僵尸），再按端口兜底清（万一命令行匹配漏了），最后 `timeout /t 1` 等 Windows 释放文件锁。

**验证**：
- 故意留一个僵尸（用 Task Manager kill 掉 pnpm 父进程但保留 tsx 子进程），重跑 start.bat，确认僵尸被清。
- 两个项目同时跑，单独重启 stable，确认 main 的 node 数量不变。

### 步骤 3：改写 start.bat 的启动段

- 根据步骤 1 的身份选 `pnpm dev:all` 或 `pnpm dev:alt`。
- 浏览器自动打开的 URL 改成身份对应的前端端口（main → `http://127.0.0.1:9788`，stable → `http://127.0.0.1:8788`）。

**验证**：每边跑 start.bat，浏览器打开的都是自己的前端端口。

### 步骤 4：同步到 stable

- 在 main 提交 `start.bat` 修改。
- 跑 `sync-to-stable.bat`（或其等价效果：让 stable 的 `start.bat` 文件跟 main 一致）。
- 进入 stable 重跑 `start.bat`，过验收标准 1–5。

**验证**：stable 里 `git log -n 1 -- start.bat` 的 commit 与 main 最新一致；stable 启动后走一遍验收。

## 边界情况

- **目录名大小写**：Windows 文件系统大小写不敏感，但 `%~dp0` 的大小写取决于调用时输入的路径。判断 `stable` 子串要用不区分大小写的匹配（`findstr /I` 或 PowerShell `-match`）。
- **路径带空格**：`%~dp0` 可能含空格，传给 PowerShell 的字符串必须双引号包住。
- **PowerShell 兼容**：用户机器是 Windows PowerShell 5.1（不是 pwsh 7）。要避免 5.1 不支持的语法（三元、`??`、`2>&1` on native exe），`Get-CimInstance` + `Where-Object` + `Stop-Process` 都在 5.1 兼容范围。
- **Ctrl+C 退出**：当前 start.bat 用 `pnpm dev:all` 作为前台命令，Ctrl+C 时 pnpm 会传信号给子进程，但 tsx watch + vite 有时会留一两个僵尸。本次方案**不保证** Ctrl+C 零残留，但保证**下次启动时清掉**——这是启动时清理的价值所在。
- **两个项目抢同一个 Claude hooks 配置**：server 会写 `~/.claude/settings.json`（installClaudeHooks）。两个实例都写不会打架（同一份文件），但如果 main 写的 hook 路径指向 main 的 server 端口、stable 又覆盖成自己的端口，最后一次启动的那个会赢。这次先不管，出问题再开新任务。
- **更多副本**：如果用户将来再克隆第三份（比如 `AIkanban-experimental`），这套"含 stable 则 stable 否则 dev"的判断会把它归到 dev，跟 main 撞 9787/9788。下次遇到再扩展，本次不做。

## 风险与注意

- **我仍然没看到你 start.bat 的真实错误日志**。我这次 plan 是基于"双端端口冲突 + 按端口杀进程不够精准"这个**强假设**写的。如果实际根因是 native module ABI 坏了 / fastify 插件挂了 / sqlite 文件权限，光改 start.bat 不会让 server 起来。所以——
  - **强烈建议**：在我进入 Context 阶段之前，你还是按原 plan 步骤 1 抓一次日志，确认 server 本身没问题只是端口互抢。
  - 如果你觉得直接上手改 start.bat 验证更快（改完就知道坏没坏），那也行，但验收标准 1 就是实打实的端到端跑通。
- **端口分配方向可能要调**：我默认 "stable=8787/8788, main=9787/9788"，理由是 stable 对用户更常用、保留默认端口。如果你觉得反过来（main=8787/8788，stable=9787/9788）更顺，说一声我调。
- **stable 的 `start.bat` 改动会被 sync-to-stable 覆盖**：所以必须改 main 的那份、然后 sync。直接改 stable 会在下一次 `git reset --hard` 时丢掉。
- **同步到 stable 需要 commit**：`sync-to-stable.bat` 要求 main 工作树干净。改完提交、打 `stable-2026-04-23-*` 标签后再 sync。

---

**待你确认的几个点（都是一句话回答）：**

1. 身份判断改成"路径含 `stable`" ——同意还是要换别的标志？
2. 端口分配 "stable=8787/8788, main=9787/9788" ——接受还是倒过来？
3. 是否仍然要求 Plan 阶段就抓一次启动错误日志（确认不是 server 自己坏）？还是你想直接开干 start.bat 改造，等改完跑一遍出错再说？
4. 非目标里列的三条（不改 server 源码、不改 package.json scripts、不改 sync/init 两个 bat）都同意？

你回完这四点我就进入 Context 阶段。
