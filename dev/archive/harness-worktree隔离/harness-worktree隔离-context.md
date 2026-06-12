# harness-worktree隔离 · context

## 关键文件（改动边界）

执行阶段原则上**只动这里列的文件**。要溢出先回来补这份清单。

### 后端 — 改

| 文件 | 行号/符号 | 改什么 |
|---|---|---|
| `packages/server/src/db.ts` | `migrate()` ~L112；`Session`/`SessionRow` 类型 L233/L257；`createSession` L335；`rowToSession` L271；listSessions / listSessionsByProject / getSession 的 SELECT L384/L394/L404 | 加 3 列 `isolation` / `worktree_path` / `worktree_branch`；ALTER TABLE 容错（已存在则忽略）；CRUD 类型 + SELECT 同步加字段 |
| `packages/server/src/git-service.ts` | 文件末尾追加 | 新增 3 个导出：`addWorktree(projectPath, worktreePath, branch, baseRef?)` / `removeWorktree(worktreePath, opts?: { force? })` / `listWorktrees(projectPath)`；走 `simpleGit(...).raw(['worktree', ...])`；失败抛 `GitServiceError('git_failed', stderr, 400)` |
| `packages/server/src/git-service.ts` | `forgetProject` L185 | 删 worktree 后顺手 `forgetProject(worktreePath)` 清缓存 — 在调用方做即可，函数本身不动 |
| `packages/server/src/routes/sessions.ts` | `CreateSessionSchema` L68；`startSession` L168；`DELETE /:id` handler L139 | schema 加 `isolation: z.enum(['shared','worktree']).default('shared')`；spawn 前若 worktree 模式就建目录 + `addWorktree`；DELETE 接 query `?gc=true` 决定是否 `removeWorktree`；序列化加 isolation/worktreeBranch |
| `packages/server/src/routes/projects.ts` | `DELETE /api/projects/:id` | 删 project 前先 listWorktrees + 批量 removeWorktree；幂等失败不阻塞 |
| `packages/server/src/index.ts` 或新文件 `worktree-paths.ts` | 新增小模块 | 导出 `getWorktreeRoot()` = `<server-root>/data/worktrees`、`getWorktreePath(projectId, sessionId)` = `<root>/<projectId>/<sessionId>`；纯函数 |

### 后端 — 读（不改，只引用）

- `packages/server/src/pty-manager.ts` — `spawn` 已经接 cwd（L155），路由层把 cwd 换掉就行。**一行不动。**
- `packages/server/src/log-bus.ts` — `serverLog(level, scope, msg, extra?)` 用法
- `packages/server/src/status.ts` — 状态机不动
- `packages/server/src/hook-installer.ts` — hook env (`AIMON_SESSION_ID`/`AIMON_BACKEND`) 已在 pty-manager spawn 时注入；hook 反查不依赖 cwd → worktree session 的 hook 应该正常工作（smoke 验证）

### 前端 — 改

| 文件 | 行号/符号 | 改什么 |
|---|---|---|
| `packages/web/src/types.ts` | `Session` L86 | 加可选字段：`isolation?: 'shared' \| 'worktree'`；`worktreeBranch?: string`；`worktreePath?: string` |
| `packages/web/src/api.ts` | `createSession` L109；`deleteSession` L117 | createSession 入参加 `isolation?: 'shared' \| 'worktree'`；deleteSession 加 `opts?: { gc?: boolean }`，gc=true 时拼 `?gc=true` |
| `packages/web/src/components/StartSessionMenu.tsx` | 复选框区 L177-220；`start()` L103 | 在"🛡 启用施工边界"下方加一个 `<input type="checkbox">` "🌿 工作区隔离（独立 worktree + 分支）"；项目非 git 仓时灰掉（用 useEffect 调 `getProjectChanges` 探测一次缓存住）；start 时把 `isolation` 带进 createSession |
| `packages/web/src/components/editor/EditorArea.tsx`（或 SessionView 标签渲染处）| session 标签渲染 | 仅当 `session.isolation==='worktree'` 时前缀加 "🌿 \<branch\>"；branch 短名取 `worktreeBranch` 去掉 `agent/` 前缀 |
| 关闭 session 的弹窗位置 | dialog 调用处（store.ts 的 endSession 或某个组件按钮 onClick） | 关闭时若 session.isolation==='worktree' → 弹窗加"也删除 worktree 目录"复选；提交把 gc 传给 deleteSession |

### 前端 — 读（不改，只引用）

- `packages/web/src/store.ts` — addSession / endSession 现有签名
- `packages/web/src/logs.ts` — `logAction(scope, action, fn, ctx)` 用法
- `packages/web/src/components/dialog/DialogHost.tsx` — 弹窗 API（确认 + 复选项的样式）

### 测试 / 文档 — 新建

| 文件 | 内容 |
|---|---|
| `scripts/worktree-smoke.mjs` | 仿 `persistence-check.mjs`：起 server → 创建临时 git 项目 → 起两个 isolated session → 各自 echo 不同内容 → assert 主仓干净 → DELETE 一个带 gc=true、另一个 gc=false → assert 目录状态 |
| `package.json` | 加 `smoke:worktree` 脚本指向上面 |
| `README.md` | "Concepts" 节加一段 worktree 模式说明（≤10 行）|
| `dev/learnings.md`（新建） | 一行：isolated session 不带 node_modules，dev-server 用途请用 shared |

---

## 决策记录

每条都过了"资深工程师会不会觉得过度设计"。

### D1 · worktree 路径放 server data，不放用户项目内
**选**：`packages/server/data/worktrees/<projectId>/<sessionId>/`
**不选**：`<userProject>/.aimon/worktrees/`
**理由**：不污染用户项目目录，不需要改用户的 .gitignore；删项目时统一 GC。资深工程师视角：合理，不过度设计。
**权衡**：worktree 离主仓远了一点，但 git 完全支持任意路径的 worktree，没有性能差异。

### D2 · 走 `simple-git.raw(['worktree', ...])`，不引新依赖
**选**：复用现有 simple-git，把 `worktree add/remove/list` 用 raw 跑
**不选**：找个 worktree 专用 npm 包，或自己写一个 wrapper 类
**理由**：简洁。3 个命令，每个 4–6 行 raw 调用搞定。资深工程师视角：合理。

### D3 · DB 加 3 列，不抽新表
**选**：`sessions` 加 `isolation` / `worktree_path` / `worktree_branch`
**不选**：抽 `session_worktrees` 一对一表 + JOIN
**理由**：worktree 元数据是 session 的一对一固有属性，不会重复，不需要单独表。3 列总字节数小。资深视角：抽表是过度设计。

### D4 · isolation 用枚举字符串而不是布尔
**选**：`isolation: 'shared' | 'worktree'`
**不选**：`isolated: boolean`
**理由**：未来可能有 `'fork'` / `'mirror'` 等模式（虽然 plan 非目标），字符串可扩展且类型 narrow 友好；DB 里 TEXT 也比 INTEGER 直观。资深视角：边际成本几乎为零，可接受。

### D5 · isolation 在 spawn 时定，生命周期内不变
**选**：spawn 决定 isolation，restart 复用同 worktree 不重建
**不选**：UI 里有"切换 isolation"的入口
**理由**：换 isolation 等于换 cwd，等于换 session；与其加切换逻辑还要处理"切之前的改动怎么办"，不如关掉再起一个新的。资深视角：不做切换是省事不是过度。

### D6 · addWorktree 失败 → endSession(crashed) + 500，**不**进 PTY spawn
**选**：先 worktree 后 PTY；worktree 失败立刻报死
**不选**：先 PTY，worktree 失败回滚 PTY
**理由**：避免半死状态（PTY 起来但 cwd 还没建完）。资深视角：必要的顺序约束。

### D7 · DELETE API 用 `?gc=true|false` 查询参数，默认 false
**选**：`DELETE /api/sessions/:id?gc=true`，无参 = 不删 worktree
**不选**：DELETE 默认删 worktree，加 `?keep=true` 保留
**理由**：现有 DELETE 没有 body / 没有 query —— 加可选参数向后兼容；默认保留更"安全"（误删 session 不丢工作树改动）。已和用户确认（plan A3）。

### D8 · base ref 默认 HEAD，不加"选源分支" UI
**选**：`addWorktree(..., baseRef='HEAD')`
**不选**：UI 暴露"从哪个分支拉"
**理由**：v1 简洁；用户已确认（plan A2）。后续如果有人想从 feature 分支拉再开隔离 session，可加。

### D9 · 项目非 git 仓时复选框灰掉，不静默 fallback
**选**：检测到非 git → 复选框 disabled + tooltip "非 git 项目不支持隔离"
**不选**：勾了但 backend 自动 fallback 到 shared
**理由**：明确比静默好；用户预期与实际行为一致。资深视角：合理 UX。

### D10 · pty-manager.ts 一行不动
**选**：spawn 已接 cwd，路由层换 cwd 即可
**不选**：pty-manager 加"isolation 感知"逻辑
**理由**：关注点分离 —— PTY 不该懂 git。资深视角：标准。

### D11 · isolation === 'worktree' 但项目根不是 git 仓 → 后端 400
**选**：route 层在 addWorktree 前先 `isGitRepo(proj.path)`，false → 400 + 不创建 session row
**不选**：让 git worktree add 自己报错
**理由**：早失败更清楚；前端已经灰掉复选框，这是兜底。

### D12 · 不在 SCM 视图增加按 worktree 分组的能力
**已在非目标**。资深视角：增量做。v1 用户想看 worktree 内 changes，进 session 跑 `git status` 就行。

---

## 依赖与约束

### 上游 / 兼容性

- **`git` 二进制**：现已是项目硬依赖（simple-git 调它）；worktree 子命令在 git 2.5+ 可用，本仓 README 没限定 git 版本，**确认下用户机的 git ≥ 2.5**（实际上 2026 年了，几乎不用担心）
- **`simple-git` 现有版本**：本仓在用 raw API，不需要包做高阶封装；版本不限
- **现有 DELETE /api/sessions/:id**：客户端目前不传 body 不传 content-type（README 明确写过 Fastify 在这种 case 才不会 400）。新增 `?gc=true` 查询参数与之兼容
- **现有 `dev:alt`（dev 实例 9787）和 stable（8787）共存**：两个实例各自的 `packages/server/data/worktrees/` 互不干扰，无冲突

### 数据结构

- DB 新加列**必须 NULLABLE 或带 DEFAULT**，老 session 行才能存活迁移
  - `isolation TEXT NOT NULL DEFAULT 'shared'`
  - `worktree_path TEXT`（NULL = 共享模式）
  - `worktree_branch TEXT`
- 不要给 `worktree_path` 加 UNIQUE：理论上不同 sessionId 路径就不同，但 NULL 多了 SQLite 的 UNIQUE 行为变扭，不值得

### Hook env 链路

- Claude hook 走 `aimon-hook.mjs` POST 到 `/api/hooks/claude`，里面用 `process.env.AIMON_SESSION_ID` 和 `AIMON_BACKEND` 反查 server。这两个 env 在 `pty-manager.ts:146` 注入，**与 cwd 无关** → worktree session 的 hook 应该照常工作。Smoke 里跑一次实际 claude session 验证。

### 操作日志

- 前端：`logAction('session','start', fn, { projectId, meta:{ agent, scoped, isolation }})` 已有，扩 meta 即可
- 后端：新增 `serverLog('info'/'error','git', 'worktree-add 开始'/'成功 (Nms)'/'失败: …', { projectId, sessionId, meta })`
- 验收必须在 LogsView 里看到一次 ERROR 入账（手动让 worktree add 失败一次）

### 性能与磁盘

- 每个 worktree ≈ 主仓 working tree 大小（VibeSpace 自身 ~50–100MB；用户项目可能更大）
- 5 个隔离 session ≈ 0.5 GB 量级，可接受
- v1 不加上限/告警，留 issue 跟进

### 熔断点（按 CLAUDE.md）

- worktree 创建在某些 git 配置下连续失败 2–3 次（CRLF / hooksPath / submodule…）→ **停手**，把 stderr 给用户，等人介入。**不要为了凑绿灯去改用户的 git 配置**。
