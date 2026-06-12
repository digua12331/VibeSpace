# harness-worktree隔离 · plan

> memory 扫过：`manual.md` 里"小功能直接改"对本任务**不适用**（这是结构性升级，必须走完整三段式）；`auto.md` 仅有一条 hook 冒烟占位条目，与本任务无关。

## 背景

VibeSpace 当前所有 session 共享 project 根目录作为 cwd（`routes/sessions.ts:203` 把 `proj.path` 直接传给 `PtyManager.spawn`）。这意味着同时跑两个 agent 改同一个文件时，后写入的会覆盖前者，git 状态被污染，**实际上不能并行 vibe coding**。

按 harness 12 层的 s12（worktree isolation）思路，**给每个隔离 session 配一个独立的 git worktree + 独立分支**，互不干扰，干完看哪条分支顺眼合并哪条。

## 目标

让用户在 `StartSessionMenu` 启动 session 时可以勾选"🌿 工作区隔离"，勾选后该 session 跑在独立 worktree 上，不污染主仓 working tree，多个隔离 session 可以并发改同一文件互不影响。

### 验收标准（必须包含浏览器可观察项）

1. **后端单测**：新增 `scripts/worktree-smoke.mjs`，覆盖：
   - `POST /api/sessions { isolation: 'worktree' }` 创建后，`<server-data>/worktrees/<projectId>/<sessionId>/` 存在且是合法 git worktree
   - 在 worktree cwd 里写一个新文件，主仓 `git status` 干净；主仓写一个文件，worktree `git status` 干净
   - `DELETE /api/sessions/:id` 后 worktree 目录被 GC 删除（默认行为，可关）
   - 命令：`pnpm smoke:worktree` 全绿
2. **类型检查**：`pnpm -C packages/server exec tsc -b` 与 `pnpm -C packages/web exec tsc -b` 全绿（项目用 TS，按 CLAUDE.md 必须过类型检查）
3. **浏览器可观察项**（必须项）：
   - **V1**：在 `StartSessionMenu` 看到新增的"🌿 工作区隔离"复选框；勾上启动一个 claude session，session 标签前缀显示"🌿 \<branch-name\>"
   - **V2**：勾上隔离启动后，在 SessionView 里跑 `pwd`（或 `cd` + 终端右键复制路径）能看到当前在 `…/data/worktrees/<projectId>/<sessionId>/` 下，**不是**项目根
   - **V3**：开两个隔离 session A 和 B，分别 `echo hello-a > test.txt` 和 `echo hello-b > test.txt`，**两个都成功不报冲突**；切回 ScmView 看主仓 changes，`test.txt` **不出现**
   - **V4**：关闭一个隔离 session 时弹出确认框（保留 worktree / 删除 worktree / 取消），三个分支都能走通
4. **操作日志**（按 CLAUDE.md 操作日志规则）：
   - 启动隔离 session：起止配对 `scope=session action=start meta={ isolation:'worktree', branch }`
   - 创建/删除 worktree：后端 `serverLog('info','git', …)` 起止配对 + 失败 ERROR
   - 在 LogsView 至少能观察到一次 ERROR 触发（验收时手动让 worktree add 失败一次——例如 session 启动时主仓在 rebase 中——并确认 ERROR 入账）

## 非目标（Non-Goals）

明确**本轮不做**的事，免得发散：

1. **不做 node_modules 共享**。worktree 默认 gitignore 里的 `node_modules` 不会拷过去，跑 `pnpm dev` 类命令需要在 worktree 里 `pnpm install` 一次。本轮 worktree **只面向"agent 改代码"用途**，不面向"在 worktree 里跑 dev server"。文档里写清楚。
2. **不做 worktree 间 cherry-pick / merge UI**。完成后想合并，用户自己 `git merge agent/<sessionId>` 或在主 session 里跑。后续可以加按钮，但不在 v1。
3. **不做"非隔离 session 也能在 worktree 间切"**。隔离决策在 spawn 时定，session 生命周期内不变。restart 时按原 isolation 走（restart 重建 worktree？或复用？—— v1 选**复用同一 worktree** 不重建，避免 restart 丢未提交改动）。
4. **不做 SCM 视图按 worktree 分组**。本轮 SCM 仍只看主仓 changes；用户想看 worktree 内的 changes 用 session 内的终端跑 `git status`。后续 T2-A.1 可以做。
5. **不做自动合并/PR**。`git worktree add`、`remove`、`list` 之外的 git 高阶操作不暴露。

## 实施步骤（粗粒度）

按依赖顺序排，每步带"如何验证"。

### 1. DB schema：sessions 加 isolation 元数据
- `db.ts` 加列：`isolation TEXT NOT NULL DEFAULT 'shared'`、`worktree_path TEXT`、`worktree_branch TEXT`
- migrate 里 `ALTER TABLE sessions ADD COLUMN …`（per-column 容错——已存在则忽略）
- 类型 `Session` / `SessionRow` / `createSession` 入参 / 序列化 都同步加字段
- 验证：跑现有 `pnpm smoke:server`、`pnpm smoke:persistence` 还能过；起一个非隔离 session 后 SQLite 里 isolation='shared'

### 2. GitService 加 worktree 三件套
- 新增 `git-service.ts` 导出：`addWorktree(projectPath, worktreePath, branch)`、`removeWorktree(projectPath, worktreePath, opts?: { force? })`、`listWorktrees(projectPath)`
- 实现走 `simpleGit(projectPath).raw(['worktree','add','-b', branch, worktreePath, baseRef])` / `['worktree','remove','--force', worktreePath]` / `['worktree','list','--porcelain']`
- baseRef 默认是 `HEAD`（即当前主仓 HEAD 所在分支的 commit）；分支名格式 `agent/<sessionId>` 短一点 `agent/<sessionId.slice(0,8)>`
- 失败要把 git stderr 透出，方便排"主仓 in rebase"之类的故障
- 验证：单测 `worktree-smoke.mjs` 里直接调函数

### 3. 隔离路径管理
- 在 `db.ts` 旁加 `worktree-paths.ts`（或并入 git-service）：`getWorktreeRoot()` 返回 `<server-root>/data/worktrees`，`getWorktreePath(projectId, sessionId)` 返回 `<root>/<projectId>/<sessionId>`
- 决策：worktree 落 **server data 目录**（`packages/server/data/worktrees/`）而不是用户项目内部 `<project>/.aimon/worktrees/`。理由：
  - 不污染用户项目目录、不需要改用户的 .gitignore
  - server data 目录已在本仓 .gitignore 里
  - 删除项目时 GC 一起删，不会误删用户文件
- 验证：spawn 时打的 cwd 在该路径下；删 session 后路径清掉

### 4. routes/sessions.ts：接受 isolation 参数 + spawn 前建 worktree
- `CreateSessionSchema` 加 `isolation: z.enum(['shared','worktree']).optional().default('shared')`
- `startSession` 流程改为：
  1. createSession 写入 DB（含 isolation 标记）
  2. 若 `isolation==='worktree'`：先 `addWorktree(...)`，失败立刻 endSession+500，**不进入 PTY spawn**
  3. ptyManager.spawn 的 cwd 改成 worktree 路径（隔离时）或 proj.path（共享时）
  4. updateSession 把 worktreePath/Branch 落 DB
- DELETE handler 扩展：判断 isolation，按用户选择（query 参数 `?gc=true|false|prompt`）决定是否 removeWorktree。**默认行为**：DELETE 不删 worktree（保留磁盘），UI 在弹窗里给"也删除 worktree"复选；这样 DELETE API 不破坏向后兼容。
- 操作日志：`serverLog('info','git','worktree-add 开始'/'成功'/'失败' …)` 起止配对
- 验证：smoke 脚本 + 浏览器手动跑通 V1/V2/V3

### 5. PtyManager 不动
- spawn 已经接 cwd，路由层把 cwd 换掉就行。pty-manager 一行不动。
- 验证：grep 确认 pty-manager.ts 无改动

### 6. 前端 StartSessionMenu：复选框 + 启动调用
- 在"🛡 启用施工边界"那块上面（或下面）加一个 `<input type="checkbox">` "🌿 工作区隔离（独立 worktree + 分支）"
- 提交 createSession 时把 `isolation: 'worktree' | 'shared'` 带上
- 启动后 `addSession` 收到 server 回的字段，session 对象里有 `worktreeBranch` / `isolation`
- 验证：勾上启动后浏览器 Network 看请求 body 含 isolation；session 对象里有 worktreeBranch

### 7. 前端 SessionView 标签前缀 + 终端关闭确认弹窗
- session 标签的 title 前面加一个绿叶 icon "🌿 \<branch\>"（仅 isolation==='worktree' 时）
- 关闭按钮触发已有的 dialog，加一个新选项"也删除 worktree 目录"复选；提交时把 `?gc=true|false` 带到 DELETE 调用
- 验证：V1/V4 走通

### 8. 操作日志按 CLAUDE.md 规则配齐
- 前端 logAction：`session start` 已有，meta 里加 `isolation`
- 后端 serverLog：`git worktree-add` / `worktree-remove` 起止配对（含失败 ERROR 路径）
- 验证：LogsView 看到起止 + 至少一次 ERROR

### 9. Smoke 测试
- 新增 `scripts/worktree-smoke.mjs`：
  - 起 server → 创建 project（指向一个临时 git repo）→ 起两个 isolated session → 各自 echo 不同内容到 test.txt → 主仓 git status 无变化 → 删一个 session 带 gc=true、另一个带 gc=false → 验证目录状态
- `package.json` 加 `smoke:worktree` 脚本
- 验证：`pnpm smoke:worktree` 全绿

### 10. 文档
- 在 `README.md` "Concepts" 节加一段说明 worktree 模式
- `dev/learnings.md`（没有就新建）记一条"isolated session 不带 node_modules，dev-server 用途用 shared"的提醒
- 验证：肉眼读

## 边界情况

- 主仓在 rebase / merge / cherry-pick 中 → `git worktree add` 会失败 → 报"主仓处于 \<state\>，请先解决再启动隔离 session"
- 主仓有未提交的脏改动 → `git worktree add HEAD` 不影响（worktree 只复制 commit 的状态，不带 dirty 改动）—— **这正是隔离的意义**，要在文档里讲明白：隔离 session 起手是干净的 HEAD，主仓 dirty 不会带过去
- 项目根**不是 git 仓库** → 隔离选项灰掉，鼠标悬停提示"非 git 项目不支持隔离"
- worktree 路径已存在（之前 session 没清掉） → addWorktree 失败 → 退路：删了再建，或 sessionId 加随机后缀
- 启动隔离 session 后，用户在主仓改了 HEAD 分支（rebase / 强 reset） → worktree 的分支不受影响（git worktree 是按 commit 锚定的）
- 删除项目时 → 先 listWorktrees 把这个 project 的所有 worktree 都 remove，再删 sessions 行，再删 project（避免孤儿目录）
- pnpm-lock.yaml 不一致 / lockfile 改了 → worktree 内的 node_modules 是空的，agent 想跑 build 会失败 —— 已在"非目标"里讲清楚
- restart 一个 isolated session：v1 复用同 worktree 同分支，避免丢改动（已在非目标讲）

## 风险与注意

1. **跨平台 worktree 路径**：Windows 下 `git worktree add` 接受正斜杠或反斜杠都行，但要保证传给 node-pty 的 cwd 是 OS native 形式。`path.resolve` 处理。
2. **simple-git 的 gitFor cache** 现在按 cwd key——OK；删 worktree 时记得 `forgetProject(worktreePath)` 把缓存条目清掉。
3. **Claude/Codex hook 在 worktree session 里能否正常上报状态**：hook 走 `~/.claude/settings.json` 里的 hook 脚本，里面用 `process.env.AIMON_SESSION_ID`/`AIMON_BACKEND` 反查回 server——这两个 env 已在 PtyManager.spawn 里注入，**不依赖 cwd**，所以 hook 应该不受影响。但要在 smoke 里复测一遍。
4. **server data 目录跨 dev/stable 实例**：dev (`AIkanban-main`) 和 stable (`AIkanban-stable`) 各自有自己的 `packages/server/data/`，互不干扰，OK。
5. **磁盘占用**：每个 worktree 是 checkout 后的 working tree，本仓约 100MB+ 源码。开 5 个隔离 session = 半 GB。要不要加个上限/告警？v1 暂不做，留 issue。
6. **熔断点**：如果 worktree 创建在某些 git 配置下持续失败 2-3 次（CRLF / hooksPath / submodule …），按 CLAUDE.md 规则**停手**，把 stderr 给用户看，等人介入。
7. **依赖**：本任务无新增 npm 包，全用现有 `simple-git` 的 raw 命令。

## 假设（请用户确认）

写在最后一节，便于用户一并修正：

- A1：worktree 默认放 server data 目录而不是用户项目内（理由见步骤 3）—— **如果你想放项目内 `.aimon/worktrees/`**，告诉我，得改路径策略并让用户的 .gitignore 加一条
- A2：默认分支命名 `agent/<sessionId.slice(0,8)>`，base ref = 主仓 HEAD —— 如果你想从特定分支拉，得加 UI 选项（v1 不做）
- A3：DELETE session 默认**不**删 worktree 目录（用户在弹窗里选）—— 如果你想默认删，告诉我，弹窗就只问"保留？"反过来
- A4：restart isolated session 复用同 worktree 不重建 —— 如果你想 restart 重置成干净 HEAD，告诉我（罕见需求）
