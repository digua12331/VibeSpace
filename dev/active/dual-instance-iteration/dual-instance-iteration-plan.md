# dual-instance-iteration · Plan (v3)

> **v3 变更**（来自 Context 阶段的发现）：
> - `dev:alt` 脚本补 `AIMON_BACKEND_URL=http://127.0.0.1:9787`（否则 dev 副本里的 PTY 子进程会把 hook 回调打到 stable）
> - 翻转风险 B 的结论：dev 副本**通过 stable 安装的 hook 脚本转发事件回到 dev 自身**，状态徽标正常工作（不再是"已接受的代价"）
> - 对应更新非目标、边界情况、步骤 8 README 内容

## 背景

当前 `f:\KB\AIkanban-main\` 既是「日常在用的运行实例」（用户用它管理多个其他项目的 AI agent session），又是「正在迭代开发的仓库」。一旦开发过程中引入 bug，日常工作会立刻受影响。

目标是让「稳定运行副本」和「开发副本」在同一台机器上互不干扰地共存，且从 dev 同步到 stable 是**一键、可审计、不打扰正在使用中的 session**。

## 目标

改造代码，使项目支持以下两个副本并存：

| | 稳定副本 | 开发副本 |
|---|---|---|
| 目录 | `f:\KB\AIkanban-stable\`（由 `git clone f:/KB/AIkanban-main f:/KB/AIkanban-stable` 产生） | `f:\KB\AIkanban-main\`（本仓库） |
| server 端口 | 8787 | 9787 |
| web 端口 | 8788 | 9788 |
| 启动方式 | **build 产物**：`pnpm start:stable`（node dist + vite preview） | **watch**：`pnpm dev:alt`（tsx watch + vite dev） |
| 全局 Claude hook | 安装（独占 `~/.claude/settings.json`） | **跳过**安装 |
| 浏览器页签标题 | `VibeSpace-稳定` | `VibeSpace-开发` |
| 日常用途 | 管理所有项目、跑所有 agent session；**也可以**把 `AIkanban-main` 加为 project，在 stable UI 里对 dev 代码做开发工作 | 仅在需要验证自己的代码改动时启动 |
| 数据 | 自身 `packages/server/data/aimon.db` | 自身 `packages/server/data/aimon.db`（天然隔离） |

### 同步机制

根目录提供 `sync-to-stable.bat`（Windows cmd，一键）：
1. 检查 dev 工作区是否干净；脏 → 停下提示 "请先 commit or stash"
2. stable 目录 `git fetch origin && git reset --hard origin/main`（stable 的 origin 就是 dev 本地仓库）
3. 若 `pnpm-lock.yaml` 变化 → stable 目录 `pnpm install` + 必要的 rebuild
4. stable 目录 `pnpm build:stable`（**不自动重启**）
5. 打印 "sync 完成，请手动重启 stable"

用户何时重启 stable 完全自己决定；**重启前** stable 仍跑着旧 build，正在用的 session 完全不受影响。

### 可验证的验收标准

1. **两端浏览器正常建 session**：稳定副本 `http://127.0.0.1:8788`、开发副本 `http://127.0.0.1:9788` 同时打开，分别在各自 UI 建一个 pwsh session，输入 `echo hello` 看到回显。
2. **Claude hook 不被抢**：开发副本启动前后，`~/.claude/settings.json` 里 `hooks.*[*].hooks[*].command` 的路径字段始终包含 `AIkanban-stable`，不包含 `AIkanban-main`。
   - 验证：启动开发副本前读一次文件内容哈希、启动后再读一次，哈希一致。
3. **页签后缀正确**：两个浏览器 tab 的标题分别是 `VibeSpace-稳定`、`VibeSpace-开发`；waiting_input 闪烁时变成 `● VibeSpace-稳定` / `● VibeSpace-开发`。
4. **稳定副本不受开发副本生死影响**：稳定副本先启动一个 pwsh session 保持 running，然后开发副本反复 `Ctrl+C` → `pnpm dev:alt` 重启 3 次，稳定副本那个 session 状态始终 running、不掉线。
5. **sync bat 不破坏 stable 运行中状态**：stable 跑着一个 pwsh session（running），在 dev 改一处代码 + commit + 跑 `sync-to-stable.bat`。验证：
   - stable `.git` 的 HEAD 追上 dev 最新 commit
   - stable `packages/server/data/aimon.db` 的 mtime 在 sync 前后**未变**
   - stable 浏览器里那个 session 仍 running，ws 没断
   - 手动重启 stable（`Ctrl+C` → `pnpm start:stable`）后打开浏览器，能看到改动生效
6. **sync bat 对脏工作区停手**：dev 故意留一个未 commit 的改动 → 跑 bat → 应退出并打印 "请先 commit"，stable 目录 HEAD 不变。
7. **默认行为零回归**：不设任何 `AIMON_*` env、直接 `pnpm dev:all`，表现与改造前完全一致（8787/8788、装 hook、CORS 允许 8788、title 裸 `VibeSpace`）。
   - 验证：`pnpm smoke:server`、`pnpm smoke:hooks`、`pnpm smoke:refresh`、`pnpm smoke:persistence` 全部通过。

## 非目标 (Non-Goals)

- **不自动创建 stable 目录**：用户首次初始化时自己跑 `git clone f:/KB/AIkanban-main f:/KB/AIkanban-stable`。README 里给出命令即可。
- **不在 dev 副本独立安装 Claude hook**：stable 已装的 hook 脚本会读子进程 env `AIMON_BACKEND`，dev 副本里的 claude 子进程继承的 `AIMON_BACKEND=9787`，事件会正确回到 dev 自身的 `/api/hooks/claude`，徽标正常；不搞"多实例 hook 路由"一类的复杂方案。
- **不动 DB schema、WS 协议、HTTP 路由**：本任务只涉及启动时配置读取 + web title + sync bat。
- **不做 LAN 分享、auth、token**。
- **sync bat 不自动重启 stable**：sync 和 "使新代码生效" 解耦，避免因 sync 打扰正在用的 session。
- **sync bat 不处理 feature 分支**：默认 dev 和 stable 都在 `main` 分支；用户若在 feature 分支开发，先合回 main 再 sync。

## 实施步骤

粗粒度顺序；每步附「如何验证」。

1. **server 的 hook 安装改为可跳过**
   - 文件：[packages/server/src/index.ts:56-67](packages/server/src/index.ts#L56-L67)
   - 改动：`installClaudeHooks()` 外层加 `if (!process.env.AIMON_SKIP_HOOK_INSTALL)`；跳过时打印 `aimon hook install: skipped (AIMON_SKIP_HOOK_INSTALL=1)`。
   - verify：`AIMON_SKIP_HOOK_INSTALL=1 pnpm dev:server` 启动后，`~/.claude/settings.json` 内容哈希不变。

2. **server 的 CORS origin 可配**
   - 文件：[packages/server/src/index.ts:71-75](packages/server/src/index.ts#L71-L75) 和 [packages/server/src/routes/cli-installer.ts:58-59](packages/server/src/routes/cli-installer.ts#L58-L59)
   - 改动：读 `AIMON_WEB_ORIGIN`（逗号分隔），trim + 过滤空串；未设置时沿用现有 `127.0.0.1:8788` + `localhost:8788`。
   - verify：`AIMON_WEB_ORIGIN=http://127.0.0.1:9788 pnpm dev:server`，从 9788 的前端发 fetch 不被 CORS 拦。

3. **vite 的 server.port 和 preview.port 都可配**
   - 文件：[packages/web/vite.config.ts:7-8](packages/web/vite.config.ts#L7-L8)
   - 改动：同时设置 `server.port` 和 `preview.port`（stable 跑 preview），都读 `Number(process.env.AIMON_WEB_PORT) || 8788`；`server.host` 和 `preview.host` 均为 `127.0.0.1`。
   - verify：`AIMON_WEB_PORT=9788 pnpm dev:web` 访问 `http://127.0.0.1:9788` 能加载；`AIMON_WEB_PORT=9788 pnpm --filter @aimon/web preview` 也能在 9788 起。

4. **web 的页签标题带 instance label**
   - 文件：[packages/web/src/store.ts:204](packages/web/src/store.ts#L204)
   - 改动：读 `import.meta.env.VITE_AIMON_INSTANCE_LABEL`，若有值则 `ORIGINAL_TITLE = 'VibeSpace-' + label`，否则保留 `'VibeSpace'`；同步 `document.title = ORIGINAL_TITLE`（确保页面刚加载就是带后缀的）。
   - 注意：`import.meta.env.VITE_*` 在 **build 时静态替换**；所以稳定副本的 label 必须在 `build:stable` 脚本里设 env，不能等 runtime。
   - verify：`VITE_AIMON_INSTANCE_LABEL=稳定 pnpm --filter @aimon/web build && pnpm --filter @aimon/web preview`，访问 preview 页，页签显示 `VibeSpace-稳定`。

5. **加 cross-env 到根 devDependencies**
   - 文件：[package.json](package.json)
   - 改动：`cross-env@^7`。
   - verify：`pnpm install` 后 `npx cross-env --version` 能跑。

6. **加三个启动/构建脚本**
   - 文件：[package.json](package.json) 的 `scripts`
   - 新增：
     ```json
     "dev:alt": "cross-env AIMON_PORT=9787 AIMON_WEB_PORT=9788 AIMON_SKIP_HOOK_INSTALL=1 AIMON_WEB_ORIGIN=http://127.0.0.1:9788,http://localhost:9788 AIMON_BACKEND_URL=http://127.0.0.1:9787 VITE_AIMON_BACKEND=http://127.0.0.1:9787 VITE_AIMON_INSTANCE_LABEL=开发 pnpm -r --parallel run dev",
     "build:stable": "cross-env VITE_AIMON_INSTANCE_LABEL=稳定 pnpm -r build",
     "start:stable": "concurrently \"pnpm --filter @aimon/server start\" \"pnpm --filter @aimon/web preview\""
     ```
   - verify：
     - `pnpm dev:alt` 起两个包，server 在 9787、web 在 9788
     - `pnpm build:stable` 产物里 grep `VibeSpace-稳定` 能命中
     - `pnpm start:stable` 起来后 8787/8788 可达

7. **加 `sync-to-stable.bat`**
   - 文件：`sync-to-stable.bat`（dev 根目录）
   - 顶部变量：`STABLE_DIR=f:\KB\AIkanban-stable`
   - 步骤（结构上面背景部分已列）：
     1. `pushd %DEV_DIR%` → `git diff --quiet && git diff --cached --quiet`；失败则打印提示并 exit 1
     2. `pushd %STABLE_DIR%`；不存在则打印提示并 exit 1
     3. `git fetch origin`
     4. `git diff --quiet HEAD origin/main -- pnpm-lock.yaml` 记录 errorlevel → `LOCK_CHANGED`
     5. `git reset --hard origin/main`
     6. 如果 `LOCK_CHANGED==1` → `pnpm install` + `pnpm --filter @aimon/server rebuild @homebridge/node-pty-prebuilt-multiarch better-sqlite3`
     7. `pnpm build:stable`
     8. 打印 "DONE. Restart stable manually: close old stable, run 'pnpm start:stable'."
   - verify：故意改个 server 文件，commit，跑 bat，检查 stable HEAD 追上 + dist 更新 + aimon.db mtime 未变

8. **README 追加双副本使用小节**
   - 文件：[README.md](README.md)（末尾 Roadmap 之前）
   - 内容：
     - 初始化：`git clone f:/KB/AIkanban-main f:/KB/AIkanban-stable` 一次；在 stable 里 `pnpm install && pnpm --filter @aimon/server rebuild ... && pnpm build:stable`
     - 启动 stable：`cd f:\KB\AIkanban-stable && pnpm start:stable`（占 8787/8788）
     - 启动 dev：`cd f:\KB\AIkanban-main && pnpm dev:alt`（占 9787/9788）
     - 同步：在 dev 目录 commit 完，双击 `sync-to-stable.bat`；stable 会更新 build，**不会重启**，你自己选时间重启
     - 跨实例 hook 机制（一段说明）：dev 副本里的 Claude session 依然有状态徽标，因为 stable 装在 `~/.claude/settings.json` 的 hook 脚本会读子进程 env 的 `AIMON_BACKEND`，dev 副本的 PTY 已经注入 `9787` → hook 事件回到 dev 自身
     - 在 stable UI 里对 dev 代码做开发：把 `f:\KB\AIkanban-main` 加为项目，启动 claude/codex session 去改它
   - verify：按 README 从零走一遍能跑通

9. **回归**
   - verify：默认端口模式下 `pnpm smoke:server` / `pnpm smoke:hooks` / `pnpm smoke:refresh` / `pnpm smoke:persistence` 全部通过。

## 边界情况

- **dev 不在 main 分支**：sync bat 写死拉 `origin/main`。用户若在 feature 分支工作，需自己 merge 到 main 再 sync。README 会点明。
- **stable 有本地 uncommitted 改动**：理论上不该有（stable 只跑 build 产物，用户不该在里面改代码）；`git reset --hard` 会丢。我们在 sync bat 里**不加 stable dirty 检查**（保持精简），但会在 README 警告一句 "不要在 stable 目录里改代码"。
- **端口占用**：9787/9788 被其它程序占了 → fastify / vite 报错退出；不重试、不自动找空闲端口，依赖用户看日志。
- **dev 副本里的 Claude session**：通过 stable 装的 hook 脚本 + dev 子进程 env `AIMON_BACKEND=9787` 把事件转发回 dev 自身，徽标正常；前提是 `dev:alt` 脚本正确设置了 `AIMON_BACKEND_URL`。codex session 的 heuristic 检测仍然有效。
- **多 origin 逗号分隔**：CORS 解析要 trim、过滤空串；重复值不必去重（无害）。
- **`VITE_AIMON_INSTANCE_LABEL` 含空格或特殊字符**：直接拼到 `VibeSpace-<label>`，不做转义；README 只给"开发" / "稳定"两个示例，不支持任意字符。
- **`pnpm-lock.yaml` 没变时**：bat 跳过 install / rebuild，省时间。检查方式是 `git diff --quiet HEAD origin/main -- pnpm-lock.yaml`。
- **sync 中断**：脚本任一步 errorlevel != 0 → `goto :fail` → `popd` 退出非零；stable 会停在半更新状态（HEAD 已 reset、但 build 未完成）。用户重跑即可，幂等。
- **hook-installer 的"path refresh"分支**：stable 首次启动会把 `~/.claude/settings.json` 的 hook 路径从（若之前 dev 跑过）`AIkanban-main` 改回 `AIkanban-stable`（[hook-installer.ts:127-132](packages/server/src/hook-installer.ts#L127-L132) 的 refresh 逻辑）。无需额外代码处理，但验收 2 的初始状态需要先启动一次 stable 把路径摆正。

## 风险与注意

- **假设 1**：stable 副本不承受代码改动（永远 clean worktree）。如果用户在 stable 目录本地改了文件，sync 的 `git reset --hard` 会无预警丢掉。→ README 警告 + sync bat 里**不加**检查（选择精简），由用户自律。
- **假设 2**：dev 工作区脏时 bat 停手（用户决策 (i)），不做自动 commit。
- **假设 3**：stable 目录路径写死在 bat 里（`f:\KB\AIkanban-stable`）。如果用户以后想改位置，自己编辑 bat 顶部变量即可。
- **假设 4**：`pnpm-lock.yaml` 路径检查能稳定反映依赖变更（rebuild 的触发条件）。如果遇到原生依赖版本不变但 prebuild 环境变了的极端情况，`pnpm build:stable` 会挂，用户手动补一次 rebuild 即可。
- **假设 5**：`VITE_AIMON_INSTANCE_LABEL` 在 vite build 时被静态替换，这是 Vite 标准行为，在 `import.meta.env.VITE_*` 文档里明确。
- **风险 A**：hook-installer 在多实例场景"谁最后启动谁赢"。→ 只要 dev 启用 `AIMON_SKIP_HOOK_INSTALL`，stable 就是唯一写 hook 的实例，永远赢。
- **风险 B（已定调）**：[pty-manager.ts:147](packages/server/src/pty-manager.ts#L147) 给每个 PTY 子进程注入 `AIMON_BACKEND = process.env.AIMON_BACKEND_URL || "http://127.0.0.1:8787"`。**注意 server 侧读的 env 名是 `AIMON_BACKEND_URL`（带 _URL），子进程侧是 `AIMON_BACKEND`（不带 _URL），容易搞错**。
  - 运行时拓扑：`~/.claude/settings.json` 里的 hook command 全局共享且指向 **stable** 的 `aimon-hook.mjs`。无论从 stable UI 还是 dev UI 启动 claude，Claude CLI 都会执行 stable 的 hook 脚本；hook 脚本内部读 `process.env.AIMON_BACKEND`（继承自 PTY 子进程 env），因此：
    - stable 启的 session → 子进程 env 是 8787 → hook 回 stable ✓
    - dev 启的 session → 子进程 env 是 9787 → hook 回 dev ✓（**前提：dev:alt 脚本里设了 `AIMON_BACKEND_URL=http://127.0.0.1:9787`**）
  - tasks 阶段仍做一次 smoke 双盲验证（dev 启 claude session，观察日志命中 dev 9787 而不是 stable 8787）以确认实际行为符合上述推理。
- **风险 C**：[CLAUDE.md](CLAUDE.md) 的 Dev Docs 流程要求外科式改动。本任务 9 个步骤都是"读 env + 加文件"，不改业务逻辑，天然聚焦。执行阶段严格按 tasks.md 走、每一步改完立即验证 verify。

## 待用户最终确认

前面几轮已经确认：
- ✅ stable 路径 `f:\KB\AIkanban-stable\`
- ✅ 允许加 `cross-env`
- ✅ 页签后缀策略 3A（两边都有专属脚本）
- ✅ 第 3 点理解正确（stable UI 可作为开发编辑器）
- ✅ 简化验收（删掉"4 端口 LISTENING"）
- ✅ stable 跑 build 产物模式
- ✅ sync bat 脏工作区停手策略 (i)
- ✅ stable 通过 `git clone` 方式创建

Context 阶段已完成（见 [dual-instance-iteration-context.md](./dual-instance-iteration-context.md)），两处发现已回写入 v3。
下一步：Tasks 阶段（生成 tasks.md 带 verify 清单，随后开始执行）。
