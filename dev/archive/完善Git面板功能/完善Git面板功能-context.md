# 完善Git面板功能 · context

## 关键文件（边界——原则上只动这些）

### 后端

- `packages/server/src/git-service.ts` — **新增 11 个函数**（pull/push/fetch/listStashes/createStash/popStash/listLocalRemoteBranches/createBranch/deleteBranch/checkoutBranch/mergeBranch/resetSoftLastCommit）。所有新函数沿用现有 `gitFor()` + `bustStatusCache()` + `GitServiceError` 模式。
- `packages/server/src/routes/git.ts` — **新增 11 条路由**（POST /pull /push /fetch /stash /stash/pop /branches/create /branches/delete /branches/checkout /merge /reset-soft，以及 GET /stashes）。所有路由用 zod 校验，必走 `loadProjectOr404` + `serverLog` 起止配对。
- `packages/server/src/log-bus.ts` — 不改，只调用 `serverLog`。

### 前端

- `packages/web/src/api.ts` — **新增 11 个客户端函数 + 1 个 stashes 列表函数**（254 行附近的 git 区段）。
- `packages/web/src/types.ts` — **新增**：`StashEntry`、`PullResult`、`PushResult`、`FetchResult`、`MergeResult`、`BranchOpResult`、`ResetResult`。
- `packages/web/src/components/ChangesList.tsx` — **改造头部分支栏 + 提交框下方加二级按钮行**（行 263–316 区域）。
- `packages/web/src/components/BranchPopover.tsx` — **新文件**，分支切换/新建/删除/合并的下拉弹窗。复用项目里 ContextMenu / InputMenu 的样式。

### 冒烟脚本

- `scripts/git-ops-smoke.mjs` — **新文件**，仿 `scripts/persistence-check.mjs` 模板。起 bare 仓库当 origin + work 仓库当本地，跑：clone → branch create → checkout → commit → push → 改文件 → stash → unstash → reset --soft → branch delete。**不连外网**。
- `package.json` — 加一条 `"git-ops-smoke"` script。

### 不动的（重要的边界）

- `GitGraph.tsx`（下半部分提交历史图）—— 只读，本次不动。
- `git-service.ts` 现有的 `getChanges` / `listCommits` / `getDiff` / `addWorktree` 等 —— 不动。
- 现有 11 条 git 路由 —— 不动签名。
- `ScmView.tsx` —— 不动布局。
- LogsView / log-bus —— 只调用，不改实现。

## 决策记录

> 资深工程师审视："这个方案过度设计吗？" 逐条自检：

1. **超时实现：用 `Promise.race` + `setTimeout`，不引入 AbortController 改 simple-git** — 因为 simple-git 没原生 timeout，且改它的内部就是过度发明。`Promise.race` 让请求按时返回 `git_failed`，子进程会被 git 自己清理（有 `GIT_OPTIONAL_LOCKS=0` 兜底）。**资深工程师视角：可以接受，因为子进程残留风险低（git 命令短）且超时是兜底场景**。
2. **远程操作错误统一回传 stderr 原文** — 不做翻译/分类（"鉴权失败" / "网络错误"），因为分类不可靠，原文是排障最准确的信息。前端把它直接展示在红色错误条里。
3. **BranchPopover 自己写一个组件，不抽 Popover 通用库** — 项目目前没有通用 Popover，只有 ContextMenu。BranchPopover 是单点用一次，不抽。**避免"只用一次的抽象"**。
4. **stash 不做命名 / 不支持选择 stash 弹出** — 默认行为：`git stash`（无 message）+ `git stash pop`（弹最新一个）。这覆盖 90% 场景。带 message 选 stash 等用户提需求再加。
5. **撤销提交固定走 `reset --soft HEAD~1`** — 不暴露 mixed/hard 选项。CLAUDE.md「不做用户没要的功能」+ 大哥摘要里已承诺"不丢东西"。
6. **新建分支默认基于当前 HEAD** — 不暴露"基于 X 创建"输入框。需要时用户先 checkout 到目标基底，再新建。
7. **合并默认 `merge --no-ff`** —— 保留合并提交，方便回看历史。如果用户想要 ff-only，等需求再加。**修正**：与 plan 里"pull 用 --ff-only"对齐反思 → 实际上 `merge` 在 GUI 里大多数人期望的是"看得见的合并节点"，所以 `--no-ff` 比 `--ff-only` 更符合直觉。两者目标场景不同（pull 是同步、merge 是分支整合），决策合理。
8. **删除分支：先尝试 `-d`（safe），失败时 UI 弹"未合并，强删？"二次确认才发 `-D`** — 不在前端做"是否合并"预检查，因为 git 自己最准。
9. **push 不带 `-u`（设置上游）** — 用户首次 push 新分支会失败，错误信息会包含 git 给的 `--set-upstream` 建议，让用户去命令行补一次。**自动设上游=静默改本地配置**，违反"非用户主动行为不静默改状态"。
10. **不引入新 npm 依赖** — simple-git 已经够用，所有新增功能都是它现有 API 或 `g.raw([...])` 包装。

## 依赖与约束

- **simple-git 版本**：现有 `package.json` 已锁定（不查具体版本，沿用即可）；所有新调用都用 `g.raw(['cmd', ...args])` 形式，避开 simple-git 高层 API 的隐式行为差异。
- **路径安全**：所有用户传入的分支名走 zod 长度+字符白名单校验（256 chars，禁止控制字符 / 空格首位 / 反斜杠）；service 层不再做二次校验（信任 route 层）。
- **日志规则**：所有新 mutation 端点必须配 `serverLog` 起止配对；所有前端按钮必须用 `logAction('git', '<action>', fn, { projectId, meta })` 包装。`meta` 中 stderr 切 1KB。
- **Windows 路径**：冒烟脚本临时仓库用 `os.tmpdir() + path.join`，bare 远程地址转 `file:///` URL 形式（git 在 Windows 下识别）。
- **TS 类型**：所有新函数都要有显式返回类型；`types.ts` 新增类型必须 export。
- **busy 状态**：现有 `ChangesList` 的 `busy` 是 `null | string`，新增按钮共用同一个状态机，避免多操作并发。

## 预计改动量

- `git-service.ts`：+~250 行（11 个函数 + 共享超时 helper）
- `routes/git.ts`：+~180 行（11 条路由）
- `api.ts`：+~80 行
- `types.ts`：+~50 行
- `ChangesList.tsx`：+~80 行（头部 + 二级按钮）
- `BranchPopover.tsx`：~150 行（新文件）
- `git-ops-smoke.mjs`：~200 行（新文件）

合计 ~1000 行。属于"加东西"型任务，没有大重构。

## 风险预案（context 写完发现的额外问题）

- **冒烟脚本起 bare 仓库当 origin** —— 需要用 `git init --bare`，用户的项目是 monorepo，要确保脚本只在临时目录里跑，不污染仓库本身。参考 `scripts/worktree-smoke.mjs`（如果存在）。
- **BranchPopover 弹出位置** —— ChangesList 在左侧 sidebar 里宽度有限，弹窗可能溢出。参考 `ContextMenu` 的 viewport 定位逻辑。
- **stash 列表查询频率** —— 不能跟 changes 一样轮询，按钮点开下拉时再查；初始渲染时一次 `getStashes` 拿计数即可。
