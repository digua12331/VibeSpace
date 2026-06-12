# harness-worktree隔离 · 任务清单

- [x] 1. DB schema 加 isolation/worktree_path/worktree_branch 三列 + 类型 + CRUD 同步 → verify: 起 server 后 `SELECT sql FROM sqlite_master WHERE name='sessions'` 能看到三列；老 session 行迁移后 isolation='shared'；`pnpm -C packages/server exec tsc -b` 通过
- [x] 2. 新建 `packages/server/src/worktree-paths.ts`（getWorktreeRoot / getWorktreePath） → verify: 单元自测：`getWorktreePath('p1','s1')` 返回 `<server-root>/data/worktrees/p1/s1`；tsc 通过
- [x] 3. GitService 加 addWorktree / removeWorktree / listWorktrees 三件套 → verify: 写临时 node 脚本（或直接在 smoke 里）跑：addWorktree 后 `git worktree list` 含新条目；removeWorktree 后消失；listWorktrees 返回数组；失败抛 GitServiceError 含 stderr
- [x] 4. routes/sessions.ts：CreateSessionSchema 加 isolation；startSession 在 PTY spawn 前 addWorktree（失败 endSession+500）；DELETE 接 `?gc=true`；序列化加 isolation/worktreeBranch；非 git 仓 isolation='worktree' 返回 400；操作日志 serverLog('git','worktree-add 开始'/成功/失败) 起止配对 → verify: curl POST /api/sessions {isolation:'worktree'} → 201 且响应含 worktreeBranch；server-data/worktrees/<projectId>/<sessionId>/ 存在且是合法 worktree；DELETE ?gc=true 后路径消失；POST 到非 git 项目 → 400
- [x] 5. routes/projects.ts DELETE /api/projects/:id：删 sessions 前 listWorktrees 这个 project 路径下的所有 worktree 并 removeWorktree → verify: 创建项目 → 起隔离 session → 删项目，data/worktrees/<projectId>/ 整个目录被清
- [x] 6. 前端 types.ts 加 Session 字段（isolation/worktreeBranch/worktreePath?）；api.ts createSession 入参加 isolation；deleteSession 加 opts.gc → verify: `pnpm -C packages/web exec tsc -b` 通过
- [x] 7. StartSessionMenu.tsx：加"🌿 工作区隔离"复选框；项目非 git 仓时 disabled + tooltip；start() 携带 isolation 字段 → verify: 浏览器打开菜单看到复选框；非 git 项目复选框灰掉鼠标 hover 有提示；勾上启动 Network 请求 body.isolation==='worktree'；session 对象有 worktreeBranch
- [x] 8. session 标签前缀显示 🌿 \<branch\>（仅 isolation==='worktree'）→ verify: V1 浏览器看到隔离 session 标签前缀含 🌿 + 短分支名；非隔离 session 无变化
- [x] 9. 关闭 session 弹窗加"也删除 worktree 目录"复选（仅隔离 session）；提交时 deleteSession({ gc: checked }) → verify: V4 三条分支都走通——保留 worktree（gc=false 默认） / 删除 worktree（gc=true） / 取消（不调 API）
- [x] 10. README.md "Concepts" 节加 worktree 模式说明（≤10 行）；新建 `dev/learnings.md` 写一条"isolated session 不带 node_modules" → verify: 肉眼读
- [x] 11. 新增 `scripts/worktree-smoke.mjs` + `package.json` 加 `smoke:worktree` 脚本 → verify: `pnpm smoke:worktree` 全绿（含 V3 等价的两 session 写同名文件主仓干净 assert）
- [x] 12. 全量验收：浏览器手动跑 V1/V2/V3/V4；手动让 worktree-add 失败一次（例如让主仓 in rebase）观察 LogsView ERROR 入账；`pnpm -C packages/server exec tsc -b` + `pnpm -C packages/web exec tsc -b` + `pnpm smoke:server` + `pnpm smoke:persistence` 仍通过 → verify: 手动 + 命令行全过
