# 修复后端启动 · Context

## 关键文件（本次改动的边界）

**只改这一个文件：**

- `F:\KB\AIkanban-main\start.bat`（第 1–46 行整体改写）
  - 现状：写死 8787/8788；kill 只按"端口 LISTENING"；浏览器 URL 写死 `http://127.0.0.1:8788`；启动命令写死 `pnpm dev:all`。
  - 目标：按 `%~dp0` 是否含 `stable` 自适应身份，分别选端口 / 选启动脚本 / 选浏览器 URL / 清理自己路径下的 node。

**会读、不会改，但要理解它们的约定：**

- `F:\KB\AIkanban-main\package.json:10` — `dev:all = pnpm -r --parallel run dev` → 默认 8787/8788。
- `F:\KB\AIkanban-main\package.json:11` — `dev:alt` 已经用 `cross-env` 把 `AIMON_PORT=9787`、`AIMON_WEB_PORT=9788`、`AIMON_WEB_ORIGIN`、`AIMON_BACKEND_URL`、`VITE_AIMON_BACKEND`、`VITE_AIMON_INSTANCE_LABEL=开发`、`AIMON_SKIP_HOOK_INSTALL=1` 都配齐了。**main 的 start.bat 直接调 `pnpm dev:alt` 就够，不用自己 set env**。
- `F:\KB\AIkanban-main\packages\server\src\index.ts:35` — `PORT = Number(process.env.AIMON_PORT || 8787)` 确认后端端口吃 env。
- `F:\KB\AIkanban-main\packages\web\vite.config.ts:4` — `WEB_PORT = Number(process.env.AIMON_WEB_PORT) || 8788`，并且 `strictPort: true` —— 端口被占会直接 fail 而不是退到 8789，正好。
- `F:\KB\AIkanban-main\packages\web\src\api.ts:29` — 前端的后端 URL 用 `import.meta.env.VITE_AIMON_BACKEND` 在构建/dev 时注入，默认 `http://127.0.0.1:8787`。
- `F:\KB\AIkanban-main\sync-to-stable.bat` — 会 `git reset --hard` stable 到 main 的某个 tag，所以**直接改 stable 的 start.bat 会被覆盖**，必须改 main、commit、再 sync。

**不会碰的边界：**

- `packages/server/src/*`、`packages/web/src/*`：server / 前端源码一行不改。
- `package.json`（root 和 sub）：scripts 一字不改，复用已有 `dev:all` / `dev:alt`。
- `sync-to-stable.bat`、`init-stable.bat`：不动。

## 决策记录

### 决策 1：用"目录路径含 `stable`"判断身份

**候选方案**：
- A. 路径子串判断（当前选择）
- B. marker 文件（在 stable 根放个 `.stable-flag`）
- C. git tag 判断（检查当前 HEAD 是否在 `stable-*` 标签上）
- D. 两份不同的 start.bat（stable 有自己的一份）

**为什么选 A**：
- 用户场景固定：两个目录就是 `F:\KB\AIkanban-main` 和 `F:\KB\AIkanban-stable`，路径名本身就是真相源。
- B 要额外维护 marker 文件、sync 时还得避开它；C 每次启动都跑 git 查询，慢；D 违反"改一处"原则——sync 机制就是为了让两边文件同步，分叉 start.bat 会让下一次 sync 产生冲突或被覆盖。
- **资深工程师视角：** 简单到一行 `echo %~dp0 | findstr /I "stable"`，没有过度设计。

### 决策 2：端口分配 stable=8787/8788, main=9787/9788

**为什么这么分**：
- `dev:alt` 脚本在 main package.json 里**已经**把 9787/9788 配齐，包括 `AIMON_SKIP_HOOK_INSTALL=1`（main 作为开发副本不争抢 Claude hooks 写入权）；反之 `dev:all` 默认 8787/8788 就是 stable 该用的。
- 用户原话 "stable 是稳定版本"——保留它的默认端口符合长期肌肉记忆，main 让步。
- **资深工程师视角：** 不新增脚本、不新增 env、只是"一个 bat 按身份挑不同的 npm script"，零抽象。

### 决策 3：清理残留进程采用 "命令行路径匹配 + 向上追 node 祖先" 的两步法

**候选方案**：
- A. 只按端口 LISTENING 杀（现有做法，已知不够）
- B. 只按命令行含 `%~dp0` 杀（能抓到 tsx/vite 子进程，抓不到 pnpm wrapper —— pnpm 的命令行是 `node pnpm.cjs --filter ...` 不含项目路径）
- C. **按命令行含 `%~dp0` 锁定 victim，然后沿 ParentProcessId 向上追 `node.exe` 祖先全部杀掉（当前选择）**
- D. 按端口 + 强制 kill 整个 node.exe 家族

**为什么选 C**：
- pnpm wrapper 自己命令行不含项目路径，但它的子进程（tsx watch）含。C 从子回溯到 pnpm 父，在遇到**非 node.exe 的祖先**（如 `cmd.exe` = start.bat 宿主）时停 —— 不会误杀 start.bat 自己也不会越过项目边界误伤其他。
- D 太野蛮，会误杀 MCP、IDE、Claude 本身的 node。
- 再叠加一步"按身份端口清 LISTENING"做兜底，覆盖万一祖先追溯遗漏。
- **资深工程师视角：** 看起来复杂？其实只有一小段 PowerShell，写一次就完。不这样做会留"启动失败的僵尸 tsx 进程"—— 这次的病根。

### 决策 4：浏览器自动打开在 start.bat 里按身份切 URL

- main → `http://127.0.0.1:9788`
- stable → `http://127.0.0.1:8788`

现状是写死 8788。不改会让 main 启动后浏览器打开错端口，用户体验炸。

### 决策 5：不等启动错误日志直接上手改

- 用户在对话里选了"直接改"。
- 本次改完直接跑验收标准 1 就知道假设对不对：如果 server 还是起不来，立刻把 log 贴出来、回 plan 加分支。
- **熔断**：改完第一次跑 bat 两个项目都不监听，立刻停手贴日志、不继续往 start.bat 里加新花样。

## 依赖与约束

### 运行环境

- Windows 11 Pro for Workstations，cmd.exe 作为 start.bat 宿主。
- **Windows PowerShell 5.1**（不是 pwsh 7）—— 写 kill 脚本要避开 5.1 不支持的语法：
  - 不用 `&&` / `||` 链（5.1 不支持），用 `; if ($?) { ... }`。
  - 不用三元 / `??` / `?.`。
  - 不用 `2>&1` 在 native 命令上（会把 stderr 当 ErrorRecord 污染 `$?`）。
- `%~dp0` 以反斜杠结尾。传给 PowerShell 用双引号包住。
- `findstr /I` 不区分大小写，能覆盖 `Stable` / `STABLE` / `stable` 各种变体。

### pnpm / Node 约束

- `pnpm dev:all` 和 `pnpm dev:alt` 启动时会 spawn 一串 node 子进程（pnpm wrapper → `-r --parallel run dev` 分发 → server 的 tsx watch + web 的 vite）。
- Ctrl+C 传给 pnpm 前台进程时，pnpm 会**尽力**传信号给子进程，但 Windows 上偶尔会留 tsx / vite 僵尸。这次方案不保证 Ctrl+C 零残留，但保证下次启动清得干净。
- `tsx watch` 如果 import 期抛错，会在 stdout 打印 stack 然后**原地等文件变更重跑**，不会绑端口也不会退出。我们的 PowerShell 按路径匹配能抓到它。

### 用户约定

- `sync-to-stable.bat` 里第 38-49 行要求 main 工作树干净才能 sync。改完 start.bat 必须 commit 才能同步到 stable。
- 双端共存已确认是日常场景（用户原话"两者各自独立"）——验收要端到端两边同时跑。

### 可能的坑

- **PowerShell CommandLine 可能截断**：CIM 返回的 `CommandLine` 理论上完整，但某些安全软件会 hook。万一匹配不到，兜底的"按端口清"还能挽救一次，再挂就要手动介入。
- **主 start.bat 自己是 cmd.exe**：不会出现在 `node.exe` 列表，不会被误杀。
- **浏览器自动打开那条 PowerShell**（第 32 行）本身是个独立 pwsh 子进程，6 秒后自动退出，不影响。

## 改动体积预估

- 文件数：1 个（`start.bat`）。
- 行数：大致从 46 行膨胀到 70–90 行之间（多了身份判断 + PowerShell kill 脚本）。
- 新增抽象：0 个。
- 新增 env 变量：0 个。
- 新增 npm script：0 个。

---

**下一步**：写 `修复后端启动-tasks.md` + `修复后端启动-tasks.json`，然后执行。

context 有遗漏或方向不对请现在提，我等你确认后再进入 Tasks 阶段。
