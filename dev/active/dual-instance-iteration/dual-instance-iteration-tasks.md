# dual-instance-iteration · 任务清单

顺序执行；每完成一步立即把 `- [ ]` 改成 `- [x]` 再进下一步。熔断：同一步 verify 连续失败 2-3 次就停手告警。

## 代码改动（步骤 1-4：独立，可按顺序逐个推）

- [x] **T1 · server hook 安装可跳过** — 在 [packages/server/src/index.ts:56-67](packages/server/src/index.ts#L56-L67) 的 `installClaudeHooks()` 调用外包一层 `if (!process.env.AIMON_SKIP_HOOK_INSTALL)`；跳过时打印 `aimon hook install: skipped (AIMON_SKIP_HOOK_INSTALL=1)`。
  - verify: 运行 `cross-env AIMON_SKIP_HOOK_INSTALL=1 AIMON_PORT=19787 pnpm --filter @aimon/server dev`（临时端口避免撞车），观察日志出现 `skipped` 且未打印 `installed/updated/already-installed`，然后 Ctrl+C；对比 `~/.claude/settings.json` 的内容在启停前后哈希一致。

- [x] **T2 · server CORS origin 可配** — [packages/server/src/index.ts:71-75](packages/server/src/index.ts#L71-L75) 和 [packages/server/src/routes/cli-installer.ts:55-60](packages/server/src/routes/cli-installer.ts#L55-L60) 都改成读 `AIMON_WEB_ORIGIN`（逗号分隔，trim + 过滤空串）；未设置时沿用原 `127.0.0.1:8788` + `localhost:8788`。
  - verify: `cross-env AIMON_WEB_ORIGIN=http://127.0.0.1:9788 AIMON_PORT=19787 pnpm --filter @aimon/server dev`，另开窗口 `curl -i -H "Origin: http://127.0.0.1:9788" -H "Access-Control-Request-Method: GET" -X OPTIONS http://127.0.0.1:19787/api/health`，响应头里 `Access-Control-Allow-Origin: http://127.0.0.1:9788`。

- [x] **T3 · vite server.port + preview.port 可配** — [packages/web/vite.config.ts:5-10](packages/web/vite.config.ts#L5-L10) 在 `server` 旁加 `preview` 对象，两者 `host='127.0.0.1'`、`port=Number(process.env.AIMON_WEB_PORT) || 8788`。
  - verify: `cross-env AIMON_WEB_PORT=19788 pnpm --filter @aimon/web dev`，访问 `http://127.0.0.1:19788/` 200 并加载；Ctrl+C 后 `pnpm --filter @aimon/web build && cross-env AIMON_WEB_PORT=19788 pnpm --filter @aimon/web preview`，也在 19788 可达。

- [x] **T4 · web 页签 title 带 label** — [packages/web/src/store.ts:204](packages/web/src/store.ts#L204) 改成读 `import.meta.env.VITE_AIMON_INSTANCE_LABEL`，若有值则 `ORIGINAL_TITLE = 'VibeSpace-' + label`，否则保留 `'VibeSpace'`；同步 `document.title = ORIGINAL_TITLE`。
  - verify: `cross-env VITE_AIMON_INSTANCE_LABEL=开发 pnpm --filter @aimon/web build`，在 `packages/web/dist/` 里 grep 出 `VibeSpace-开发` 字面；清掉 env 再 build 一次，grep 出裸 `VibeSpace`（不带后缀）。

## 工程化（步骤 5-7：依赖 1-4 的代码改动已就位）

- [x] **T5 · 根 devDeps 加 cross-env** — [package.json](package.json) 的 `devDependencies` 加 `"cross-env": "^7.0.3"`；`pnpm install`。
  - verify: `npx cross-env --version` 能输出版本号。

- [x] **T6 · 加 `dev:alt` / `build:stable` / `start:stable` 三条脚本** — [package.json](package.json) `scripts` 加：
  ```json
  "dev:alt": "cross-env AIMON_PORT=9787 AIMON_WEB_PORT=9788 AIMON_SKIP_HOOK_INSTALL=1 AIMON_WEB_ORIGIN=http://127.0.0.1:9788,http://localhost:9788 AIMON_BACKEND_URL=http://127.0.0.1:9787 VITE_AIMON_BACKEND=http://127.0.0.1:9787 VITE_AIMON_INSTANCE_LABEL=开发 pnpm -r --parallel run dev",
  "build:stable": "cross-env VITE_AIMON_INSTANCE_LABEL=稳定 pnpm -r build",
  "start:stable": "concurrently \"pnpm --filter @aimon/server start\" \"pnpm --filter @aimon/web preview\""
  ```
  - verify: 三步各跑一下：
    1. `pnpm dev:alt` → 2-3 秒后 `curl -s http://127.0.0.1:9787/api/health` 返回 `{ok:...}`，浏览器开 `http://127.0.0.1:9788/` 看到页面且 title 含 `-开发`；Ctrl+C 关掉
    2. `pnpm build:stable` → 成功 exit 0；在 `packages/web/dist/` 里 grep 到 `VibeSpace-稳定`
    3. `pnpm start:stable` → `curl -s http://127.0.0.1:8787/api/health` 返回 OK；浏览器开 8788 看到 `VibeSpace-稳定`；Ctrl+C 关掉

- [x] **T7 · 加 `sync-to-stable.bat`** — 在 dev 根目录新建，内容按 plan 步骤 7 的 8 步实现；顶部 `set STABLE_DIR=f:\KB\AIkanban-stable`。
  - verify: 无 stable 目录时双击 bat，应在第 2 步打印 `stable dir not found` 并非零退出；故意留一处 dev 未 commit 的改动跑 bat，应在第 1 步打印 `请先 commit`。真实同步端到端验收等 stable clone 就绪后再做（见 T10）。

## 文档与回归（步骤 8-9）

- [x] **T8 · README 追加「开发模式：稳定 + 开发双副本」小节** — [README.md](README.md) 在 `## Roadmap` 之前插入；内容按 plan 步骤 8 六点覆盖（初始化命令 / 启 stable / 启 dev / 同步 / 跨实例 hook 机制说明 / stable UI 做开发的 workflow）；明确提醒"不要在 stable 目录改代码"（sync 的 `git reset --hard` 会丢）。
  - verify: 读一遍；按 README 写的命令在脑里走一遍 mental check，无断点。

- [x] **T9 · 回归 smoke（默认端口模式）** — 3 个通过，1 个登记为独立任务（见 `dev/active/fix-persistence-cascade/`）：
  - ✅ `smoke:hooks`（self-spawn 5274）
  - ✅ `smoke:server`（临时端口 19787，默认 8787 被用户实例占用）
  - ✅ `smoke:refresh`（临时端口 19787）
  - ❌ `smoke:persistence`：`session row missing after restart`。**预存问题**，不是本任务引入：
    - 根因：`syncProjectsTable` ([db.ts:79-88](packages/server/src/db.ts#L79-L88)) 做 `DELETE FROM projects` → 重新 INSERT；sessions 表 FK `ON DELETE CASCADE` ([db.ts:107](packages/server/src/db.ts#L107)) 导致瞬间级联删除
    - 工作区里还有非本任务范围的未提交改动（`fs-ops.ts`、`api.ts`、`fileContextMenu.ts`、`ProjectsColumn.tsx`），可能是触发条件之一
    - 决定：**另起任务 `fix-persistence-cascade` 单独处理**，不纳入本任务

## 工程化追加（v4）

- [x] **T11 · `init-stable.bat` 一键初始化 stable + tag workflow** — 根目录新建；步骤：`where git/pnpm` 预检 → 检查 `STABLE_DIR` 不存在 → 检查 dev 是 git repo → `git clone "%DEV_DIR%" "%STABLE_DIR%"` → pushd stable → checkout 最新 `stable-*` tag（无则留 HEAD）→ `pnpm install` → `pnpm --filter @aimon/server rebuild ...` → `pnpm build:stable` → 打印 ref + 下一步指引。任一步 errorlevel 非 0 跳 `:fail`。
  - sync-to-stable.bat 同步升级为 tag-driven：`git fetch origin --tags --prune` → 找最新 `stable-*` tag（无则 `origin/main`）→ `git reset --hard <target>` → `pnpm-lock.yaml` 变了才 install/rebuild → `pnpm build:stable`。
  - verify: (a) stable 已存在时跑 init bat，在 "STABLE_DIR already exists" 分支退出 ✓；(b) dev dirty 时跑 sync bat，在 "unstaged changes" 分支退出 ✓；(c) 用户实跑完整 init：stable 已到达 dev HEAD、build:stable 成功、web dist 含 `稳定` 字符 ✓；真实 tag 切换留到首次打 `stable-*` tag 后首次 sync 时验。

## 延后验收（依赖 stable 目录已存在）

- [ ] **T10 · 跨实例 hook smoke（完整 e2e）** — 由用户在 `f:\KB\AIkanban-stable` `git clone` 就绪后触发；我侧仅负责记录操作步骤：
  1. stable 目录：`pnpm install` + rebuild + `pnpm build:stable` + `pnpm start:stable`
  2. dev 目录（本仓库）：`pnpm dev:alt`
  3. 两个浏览器分别打开 `127.0.0.1:8788` 和 `127.0.0.1:9788`，title 分别 `-稳定` / `-开发` ✓
  4. dev UI 启动一个 claude session；观察 dev 后端日志里 `POST /api/hooks/claude` 被命中，stable 后端日志**未**命中
  5. stable UI 启动一个 claude session；反向命中
  6. dev 改一个文件 → commit → 双击 `sync-to-stable.bat`；检查 stable `.git` HEAD = dev 最新 commit，`packages/server/data/aimon.db` mtime 未变，stable 仍跑旧 build（浏览器刷新无差异）；手动 `Ctrl+C` stable 再 `pnpm start:stable`，刷新浏览器看到改动生效
  - verify: 上述每步人工观察通过。
