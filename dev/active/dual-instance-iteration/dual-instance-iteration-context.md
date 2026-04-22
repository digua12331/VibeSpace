# dual-instance-iteration · Context

## 关键文件

本清单是本次改动的**边界**。执行阶段原则上只动这里列的文件；真要溢出，先回来补 context。

### 会改的文件

| 文件 | 改什么 |
|---|---|
| [packages/server/src/index.ts](packages/server/src/index.ts) | 1. L56-67 `installClaudeHooks()` 外加 `if (!process.env.AIMON_SKIP_HOOK_INSTALL)`；2. L71-75 CORS `origin` 改成读 `AIMON_WEB_ORIGIN`（逗号分隔，trim + 过滤空串，默认 `["http://127.0.0.1:8788","http://localhost:8788"]`） |
| [packages/server/src/routes/cli-installer.ts](packages/server/src/routes/cli-installer.ts) | L55-60 的 `ALLOWED_ORIGINS` 同样改成从 env 读；与 index.ts 保持一致（原文件已有注释 *Must stay in sync with the cors origin list in index.ts*，两处独立读 env 更简单，注释保留） |
| [packages/web/vite.config.ts](packages/web/vite.config.ts) | L7-8 给 `server` 和 `preview` 两个对象都设 `port: Number(process.env.AIMON_WEB_PORT) \|\| 8788`、`host: '127.0.0.1'` |
| [packages/web/src/store.ts](packages/web/src/store.ts) | L204 `ORIGINAL_TITLE` 前加 label 拼接：读 `import.meta.env.VITE_AIMON_INSTANCE_LABEL`，有值则 `'VibeSpace-' + label`，否则 `'VibeSpace'`；同时 `document.title = ORIGINAL_TITLE`（确保首屏就正确） |
| [package.json](package.json) | `devDependencies` 加 `cross-env@^7`；`scripts` 加 `dev:alt` / `build:stable` / `start:stable` 三条 |
| [README.md](README.md) | Roadmap 前加 `## 开发模式：稳定 + 开发双副本` 小节 |

### 新建的文件

| 文件 | 内容 |
|---|---|
| `sync-to-stable.bat` | 见 plan 步骤 7 的 8 步 |
| `dev/active/dual-instance-iteration/dual-instance-iteration-plan.md` | 已写 |
| `dev/active/dual-instance-iteration/dual-instance-iteration-context.md` | 本文件 |
| `dev/active/dual-instance-iteration/dual-instance-iteration-tasks.md` | tasks 阶段写 |

### 读但不改（理解意图所需）

| 文件 | 意义 |
|---|---|
| [packages/server/src/hook-installer.ts](packages/server/src/hook-installer.ts) | L121-133 的 refresh 语义：hook 路径变了会被覆盖，所以"stable 独占 hook"就是"只让 stable 调这个函数" |
| [packages/server/src/pty-manager.ts:143-149](packages/server/src/pty-manager.ts#L143-L149) | 给 PTY 子进程注入 `AIMON_BACKEND = process.env.AIMON_BACKEND_URL \|\| "http://127.0.0.1:8787"` — **env 名是 `AIMON_BACKEND_URL`**（带 `_URL` 后缀），容易看错 |
| [packages/hook-script/aimon-hook.mjs:24](packages/hook-script/aimon-hook.mjs#L24) | hook 脚本读 `AIMON_BACKEND`（子进程视角），来源就是上面那行注入 |
| [packages/web/src/api.ts:28](packages/web/src/api.ts#L28) | 已经读 `VITE_AIMON_BACKEND`，dev 副本 build/watch 时设置即可，不改 |
| [packages/web/index.html:8](packages/web/index.html#L8) | 静态 `<title>VibeSpace</title>`，由 store.ts 运行时覆盖，不改 HTML |
| [packages/server/package.json:10](packages/server/package.json#L10) | 确认 `start: "node dist/index.js"` 存在，`start:stable` 直接复用 |
| [packages/web/package.json:9](packages/web/package.json#L9) | 确认 `preview: "vite preview"`，`start:stable` 直接复用 |
| [.gitignore](.gitignore) | 确认 `packages/server/data/`、`.env*`、`*.db` 都被忽略 — 这是 sync bat 的 `git reset --hard` 安全的前提 |
| [packages/server/src/db.ts:9-12](packages/server/src/db.ts#L9-L12) | DB 路径 `packages/server/data/aimon.db` 相对 repo 根 — 确认 stable 和 dev 天然隔离 |

## 决策记录

每条决策都过一遍「资深工程师会不会觉得过度设计」这道尺子。

### 1. stable 目录用 `git clone` 而不是 `cp -r`
- **选择**：`git clone f:/KB/AIkanban-main f:/KB/AIkanban-stable`
- **替代**：robocopy / 手动 cp 外加一份 exclude 列表（`packages/server/data/`、`.env*`、`*.db`、`node_modules`、`.vibespace/`）
- **理由**：git 天然尊重 `.gitignore` — 本地 DB、env、日志不会被复制，`git reset --hard` 也不会删 untracked 文件；审计 trace（`git log`）作为副产物免费得到
- **过度设计？否。** 反而 robocopy 要维护 exclude 列表，更繁

### 2. stable 跑 build 产物，dev 跑 watch
- **选择**：stable = `node dist/...` + `vite preview`；dev = `tsx watch` + `vite dev`
- **替代**：两边都用 `pnpm dev:all`
- **理由**：stable 的核心价值是"正在用的 session 不被打扰"。tsx watch 检测到文件变化会立即重启 server，正在用的 WS 断开；vite HMR 也会让 UI 抖。stable 跑 build 产物后，sync 只刷新 `dist/`，stable 进程不知情、session 不受影响，重启时机完全由用户决定
- **过度设计？否。** 这正是 stable / dev 区分的第一性原因

### 3. stable 写 hook、dev 跳过
- **选择**：dev 用 `AIMON_SKIP_HOOK_INSTALL=1` 跳过，stable 维持默认行为写 `~/.claude/settings.json`
- **替代**：给两个实例各一份 hook，hook 脚本内根据 session id 路由
- **理由**：replacement 路由需要改 `aimon-hook.mjs`（按 env 转发）+ 改 hook-installer（支持多 command 同 key）+ 改 `settings.json` 结构（一个 key 多个 entry）。改动量翻倍，只为在 dev 副本看到 Claude 状态徽标——**代价不值**。dev 副本用来测试代码，没徽标可以接受
- **过度设计？否。** 反向：实现多实例 hook 路由才是过度设计

### 4. env 未设置时默认值保持原样（"零回归"）
- **选择**：`AIMON_PORT || 8787`、`AIMON_WEB_PORT || 8788`、默认 CORS origin 8788、默认 title 裸 `VibeSpace`（不带后缀）
- **理由**：任何开发者在任何时刻 `pnpm dev:all` 跑仓库，行为都跟改造前一致；只有显式用 `pnpm dev:alt` / `pnpm start:stable` 才触发新行为。最小惊喜
- **过度设计？否。** 默认值就是一行 `||`，零成本

### 5. sync bat 不自动重启 stable
- **选择**：bat 做完 build 就 exit，打印"请手动重启"
- **替代**：bat 自动 kill 旧进程 + 启新 `pnpm start:stable`
- **理由**：自动重启 = 立即杀掉正在用的 session。跟 build 产物模式的初衷冲突。用户自己选在低使用时刻重启最安全
- **过度设计？否。** 反向才是

### 6. sync bat 对 dev 脏工作区停手（用户决策 (i)）
- **选择**：`git diff --quiet && git diff --cached --quiet`；脏 → exit 1 + 提示
- **替代**：自动 `git add -A && git commit -m "sync: <timestamp>"`
- **理由**：自动 commit 会把实验性 / 调试用的改动一起带到 stable，造成污染；显式要求 commit 让用户主动决定"这个改动到底要不要同步"
- **过度设计？否。** 安全保守是美德

### 7. STABLE_DIR 写死在 bat 顶部变量
- **替代**：读 `.sync-stable-config` 或 env
- **理由**：单用户单机工具；一行 `set STABLE_DIR=...`，以后想改自己编辑即可
- **过度设计？否。** 加配置文件才是

### 8. CORS origin 用逗号分隔字符串，不抽 config helper
- **选择**：`index.ts` 和 `cli-installer.ts` 两处各自读 env 各自解析
- **替代**：抽一个 `src/config.ts`，两处 import 同一个 `getAllowedOrigins()`
- **理由**：两处都是 3 行解析，共 6 行。抽 helper 要新建文件、加 import，反而更多。原文件已有注释 `Must stay in sync` 提示后续维护
- **过度设计？否。** 抽 helper 才是

### 9. 只支持 Windows（bat）
- **选择**：只写 `sync-to-stable.bat`，不写 `.sh`
- **理由**：项目 README 已声明 *Windows 10+ primary target，macOS / Linux experimental*；用户自己在 Windows 上
- **过度设计？否。** 一并写 .sh 才是（还要测，还要维护）

## 依赖与约束

### 运行时依赖（已有）
- Node.js >= 22（[package.json:engines](package.json)）
- pnpm >= 10.20
- `concurrently` @ ^9.2.1（已在根 devDeps，`start:stable` 会用）
- `better-sqlite3` 和 `@homebridge/node-pty-prebuilt-multiarch`（native，需要各副本各自 rebuild）

### 新增依赖
- `cross-env@^7`（根 devDeps）— 在 pnpm scripts 里跨 shell 设 env；Windows 下 `AIMON_PORT=9787 pnpm ...` 语法不通，必须 cross-env。替代方案 Node 22 `--env-file` 要维护两个 .env 文件且 pnpm -r 子进程继承行为要验证，不如 cross-env 直接

### 平台
- Windows 10/11（主要目标；`sync-to-stable.bat` 为 cmd 脚本）

### 对 Claude Code 的依赖
- `~/.claude/settings.json` 的 `hooks.{SessionStart,UserPromptSubmit,PreToolUse,PostToolUse,Notification,Stop}` schema 稳定
- hook 脚本通过子进程 env 里的 `AIMON_BACKEND` 决定 POST 目标

### Vite 行为依赖
- `import.meta.env.VITE_*` 在 build 时静态替换（Vite 官方契约）
- `preview.port` 和 `server.port` 独立配置（Vite 8 稳定 API）

### 对 pnpm 行为依赖
- `pnpm -r --parallel run <script>` 把根 env 传给每个 workspace 子进程
- `pnpm --filter @aimon/server rebuild` 重建 native bindings

### 向后兼容
- 默认端口 8787 / 8788 不变，默认 CORS 不变，默认不 SKIP_HOOK_INSTALL，默认 title 裸 VibeSpace — 所有 env 未设置时完全同现状
- 路由、DB schema、WS 协议、HTTP API 均不动

## Plan 回修（Context 阶段发现）

### 修正 1：`dev:alt` 脚本少设了一个 env

Plan v2 步骤 6 里 `dev:alt` 脚本没包含 `AIMON_BACKEND_URL`，这会导致 dev 副本里启动的 PTY 子进程（比如 claude）拿到的 `AIMON_BACKEND` env 走 [pty-manager.ts:147](packages/server/src/pty-manager.ts#L147) 的默认值 `http://127.0.0.1:8787` —— 子进程的 hook 回调会错误打到 stable 的 server。

**修正**：`dev:alt` 脚本加 `AIMON_BACKEND_URL=http://127.0.0.1:9787`。完整脚本：

```json
"dev:alt": "cross-env AIMON_PORT=9787 AIMON_WEB_PORT=9788 AIMON_SKIP_HOOK_INSTALL=1 AIMON_WEB_ORIGIN=http://127.0.0.1:9788,http://localhost:9788 AIMON_BACKEND_URL=http://127.0.0.1:9787 VITE_AIMON_BACKEND=http://127.0.0.1:9787 VITE_AIMON_INSTANCE_LABEL=开发 pnpm -r --parallel run dev"
```

注意 env 名字坑：**server 读的是 `AIMON_BACKEND_URL`**（带 `_URL`），注入给子进程时改名成 `AIMON_BACKEND`（不带 `_URL`）。外部用户不需要关心这个，只要设 `AIMON_BACKEND_URL` 即可。

### 修正 2：风险 B 的判断修正

Plan v2 风险 B 里我标注了 TODO "验证 dev 副本里 claude session 的 hook 去哪"。分析 + 上面修正 1 之后结论清楚：

- stable 独占 `~/.claude/settings.json` 里的 hook 注册，脚本路径指向 `stable/packages/hook-script/aimon-hook.mjs`
- dev 副本里的 claude 子进程启动时**调用的仍是 stable 的 aimon-hook.mjs**（因为全局 settings.json 指向它）
- hook.mjs 读 `process.env.AIMON_BACKEND`，这个 env 由 dev 的 PtyManager 注入 `9787` → hook 事件正确回到 dev 的 `/api/hooks/claude`
- **所以 dev 副本里的 claude session 其实会有状态徽标**，前提是修正 1 生效

这让 README 的措辞要变：不是"dev 副本没有 Claude 状态徽标"，而是"dev 副本通过 stable 安装的 hook 脚本把事件转发回 dev 自己，徽标正常"。plan 的"代价"那栏可以删掉。

tasks 阶段要做的 smoke：
- stable 和 dev 同时跑，在 dev UI 里启动一个 claude session
- 观察 dev server 日志里 `/api/hooks/claude` 是否被命中
- 观察 stable 那边的 `/api/hooks/claude` 是否没被命中
- 命中正确才算修正 1 + 修正 2 成立

---

Plan 需要我立即同步修正吗？还是在 tasks 阶段一并处理（执行 step 6 时用修正后的脚本、执行 step 8 README 时用修正后的措辞）？

Context 写完，等用户确认无误即进入 Tasks 阶段。
