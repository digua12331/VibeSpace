# 完善Git面板功能 · plan

## 大哥摘要（先读这段）

现在左侧 Git 面板（点 🌿 那个图标进的页面）只能做三件事：暂存（把改动放进"准备打包"里）、提交（把暂存的改动正式记下来）、看历史。**最常用的"拉取（从云端下载别人的更新）"和"推送（把自己的提交发到云端）"都没有按钮**，等于这个面板只能在本地玩，跟 GitHub 这种远程仓库打不通。

这次要补的功能分三批，按"日常用得最多 → 偶尔用 → 高级"排：

- **第一批（每天都要用）**：拉取、推送、获取（只下载不合并，看远程有啥新东西）、切换分支（branch = git 里的"平行宇宙副本"）、新建分支、撤销最后一次提交（写错提交想反悔时用）
- **第二批（偶尔用）**：暂存草稿（git stash，把当前没做完的改动先收进抽屉，腾出干净工作区去做别的）、取出草稿、删除分支、把别的分支合并进当前分支
- **第三批（高级，这次先不做）**：rebase（重排历史，新手容易翻车）、revert（生成反向提交）、强制重置、tag、远程地址管理 —— 这些**等你用过第一批反馈再决定要不要做**

**做完后你能在哪里看到效果**：左侧最外层活动栏点🌿图标 → 顶部分支名旁边会多出"⬇拉取""⬆推送""⤵获取"三个按钮，分支名本身变成**可点击的下拉**（切换/新建分支）；提交输入框下方多一组"草稿（stash）/撤销提交"二级按钮。每个操作完成后右下角的「日志（LogsView）」面板会有起止配对的记录，方便你回看刚才点了啥、成没成功。

**会动到的东西**：只在 Git 面板和后端 git 路由里加东西，不会动你的项目数据、会话、终端那些。**不会自动 force push、不会自动 rebase**——所有可能丢提交的危险操作（reset hard / force push / 删未合并分支）都会弹"⚠ 不可撤销，确认吗？"二次确认。

## 目标

补全 Git 面板缺失的常用操作，让用户不再需要切到外部终端跑 `git pull` / `git push`。

**可验证的验收标准**：

1. **打开 Git 面板，顶部分支栏出现「拉取 / 推送 / 获取」三个按钮**，对一个有远程的仓库点击三次都能看到 LogsView 里 `scope=git action=pull/push/fetch` 的起止配对（成功路径）。
2. **故意制造冲突或断网情况下点拉取**，按钮变 disabled→恢复，UI 顶部出现红色错误条说明原因，LogsView 里有 `level=error` 条目带 `meta.error.message`（失败路径）。
3. **分支名变成可点击 chip**，点开后弹出下拉，能看到本地分支列表 + 远程分支列表 + 「新建分支…」选项，选中本地分支后切换成功（顶部分支名跟着变），LogsView 有 `action=checkout` 起止配对。
4. **提交输入框下方多一行二级按钮**：「草稿暂存 / 取出草稿（N）/ 撤销最后一次提交」，每个按钮对应的 service 调用成功，状态被正确刷新（changes 列表内容变化）。
5. **后端 `pnpm -w typecheck` 通过**，没有引入新的 TS 报错。
6. **新增脚本 `scripts/git-ops-smoke.mjs`** 起一个临时仓库，依次模拟 stage / commit / branch create / checkout / stash / unstash / reset --soft 走完流程，断言每个操作的状态变化符合预期（绕过远程操作，避免 CI 依赖外网）。

## 非目标

- **不做 rebase / revert / hard reset / tag / remote 管理**——第三批，先看第一二批用得怎么样。
- **不做冲突解决 UI**（merge/pull 出冲突时给原始报错就行，不在面板里做"接受我方/接受对方"的可视化合并工具）。
- **不做 GPG 签名 / SSH key 配置 UI**——用户自己在系统层配好。
- **不做远程 URL 管理**（add remote / change remote URL）——第三批。
- **不做 cherry-pick / bisect / submodule 操作**——使用率太低，超出"日常 git"范围。
- **不改 GitGraph 组件**（下半部分的提交历史图）——它是只读视图，本次不动。

## 实施步骤

> **粗粒度**，detail 在 tasks 阶段细化。

1. **后端 service 扩展** —— 在 `git-service.ts` 里加 8 个新函数：`pull / push / fetch / checkoutBranch / createBranch / deleteBranch / stash / stashPop / resetSoftHead1`。每个函数包一层 `GitServiceError` 错误转换，pull/push/fetch 失败时把 `stderr` 原文塞进 message（远程操作排障靠这个）。
   - **如何验证**：单独写一个小冒烟脚本，在临时仓库跑一遍每个函数，断言成功路径状态正确、失败路径抛 `GitServiceError`。
2. **后端路由暴露** —— 在 `routes/git.ts` 加 8 条 POST 路由（pull/push/fetch/checkout/branches POST/branches DELETE/stash/stash/pop/reset），全部走 zod 校验、走 `loadProjectOr404`、走 `serverLog` 起止配对。
   - **如何验证**：起 dev server，curl 每个端点，看返回结构 + 看 `data/logs/YYYY-MM-DD.log` 有起止两条。
3. **api.ts 客户端封装** —— `packages/web/src/api.ts` 加 8 个对应的客户端函数，类型从 `types.ts` 导出。
   - **如何验证**：tsc 通过；浏览器 console 手动调用一次能拿到响应。
4. **ChangesList.tsx 顶部分支栏改造** —— 把现在的 `🌿 main ↑0 ↓0` 改成「分支 chip + 拉取按钮 + 推送按钮 + 获取按钮 + 现有的全部暂存 + 刷新」六件套；分支 chip 点击弹出 BranchPopover（新组件，列出本地/远程分支 + 新建分支输入框）。
   - **如何验证**：浏览器里看到新按钮排布，点击每个按钮都有 LogsView 起止配对。
5. **ChangesList.tsx 提交框二级按钮** —— 在「提交」按钮下方加一行：「草稿暂存」「取出草稿（N）」「撤销最后一次提交」三个小按钮，按钮文字根据当前状态自适应（无 stash 时取出按钮 disabled，HEAD 是初次提交时撤销按钮 disabled）。
   - **如何验证**：浏览器里完整跑一遍 stash → 改文件 → unstash 看到改动恢复；commit → 撤销 → 改动回到 staged 区。
6. **危险操作二次确认** —— 删除未合并分支、撤销提交（理论上是 reset --soft 没风险，但解释清楚）、push --force（**本次不做 force push**，所以这条只针对删分支）必须用 `confirmDialog({ variant: 'danger' })`。
   - **如何验证**：点删分支按钮，弹出红色警告，按取消不执行。
7. **冒烟脚本 `scripts/git-ops-smoke.mjs`** —— 仿现有 `scripts/persistence-check.mjs` 模板，起临时 git 仓库（不依赖远程），跑完整流程。
   - **如何验证**：`pnpm git-ops-smoke` 退出码 0。
8. **typecheck + 浏览器手测** —— `pnpm -w typecheck` 通过；浏览器里手动操作每个新按钮观察 UI/LogsView。

## 边界情况

- **没有远程仓库（git remote -v 空）**：拉取/推送/获取按钮 disabled，hover 显示 tooltip"未配置远程"。
- **远程要求认证（HTTPS 弹账号密码 / SSH key 没加）**：git 进程会卡住，**必须给后端调用加超时**（默认 60s），超时返回 `git_failed` 不能让请求挂死。
- **当前是 detached HEAD**（用户签出了某个历史 commit）：拉取/推送 disabled，hover 显示"当前不在分支上"。
- **分支名包含特殊字符**：交给 git 自己校验，service 层只做长度上限（256 chars）。
- **stash 列表空时点取出**：按钮 disabled，文案显示「取出草稿 (0)」。
- **撤销首次提交**：仓库只有一个 commit 时 `reset --soft HEAD~1` 会失败，按钮 disabled。
- **push 被拒（remote 有新提交）**：返回 git 原始 stderr，**不**自动建议 force push。
- **同时多个 git 操作**：UI 层 `busy` 状态已能 disable 所有按钮，service 层 simple-git 自带串行。
- **撤销提交后 changes 列表刷新**：要保证 reset --soft 后 staged 区出现刚才提交的内容。

## 风险与注意

- **远程操作的鉴权**：HTTPS 仓库可能弹密码 prompt（卡住进程）、SSH 仓库要求 ssh-agent 已加载。`sanitizedGitEnv()` 已经把 `GIT_ASKPASS` / `SSH_ASKPASS` 滤掉了，所以**密码 prompt 会直接失败**而不是卡住——这是好事，但要让用户看懂错误信息（"配置 ssh-agent 或用 git credential helper"）。**不在 UI 里做凭据管理**，超出范围。
- **超时**：必须给所有远程操作加 60s 超时，否则 fastify request 挂死。simple-git 本身没原生 timeout，要用 `Promise.race` 或包一层 AbortController 风格。
- **冒烟脚本不能依赖网络**：所有 push/pull/fetch 测试必须通过本地 file:// 远程或 bare 仓库当 origin 来跑。
- **分支删除的安全门槛**：`git branch -d`（safe）vs `git branch -D`（force）。默认走 `-d`，失败提示用户分支未合并并提供「强制删除」二次确认。
- **LogsView 的 meta 体积**：远程操作的 stderr 可能很长，`meta.error.message` 切到 1KB（CLAUDE.md 操作日志规则要求 meta ≤ 2KB）。
- **simple-git 在 Windows 下的换行**：拉取/推送的输出可能含 CRLF，落日志前 normalize 成 LF（参考 `getDiff` 已有做法）。

## 假设（写给自己存档，不再追问大哥）

- 大哥默认这次 Git 面板的目标用户是**懂基本 git 概念但不想敲命令行的人**——他自己说"不懂代码"但项目里大量 git 操作痕迹，所以「拉取/推送」这种术语他听得懂。
- 默认「撤销最后一次提交」= `git reset --soft HEAD~1`（提交退回但代码留在暂存区），**不是** `--hard`（连代码也丢）。这个是 GitHub Desktop / SourceTree 的默认语义。
- 默认 push 是 `push origin <current-branch>`，不带 `--force`、不带 `-u` 设置上游（如果没设上游会报错让用户去命令行设一次）。**这是务实的安全选择**——避免静默改写历史。
- 默认 pull 是 `pull --ff-only`（只快进合并），合并冲突直接报错让用户处理。**不**默认 `--rebase` 或 `--no-ff`，避免静默改本地历史。
- BranchPopover 设计沿用项目里 ContextMenu / InputMenu 的样式，不引入新弹窗组件库。

## 多模型 Plan 会审

> **跳过：当前会话未注入 `ask-gemini` / `codex:rescue` MCP 工具**——按 manual.md 2026-04-30 偏好"外部工具失败重试一次仍失败则回退 Claude 单写 + plan.md 记一行原因，不阻塞 plan 交付"。本 plan 由 Claude 单独主笔。
>
> 后续如果需要补做评审：在 MCP 工具就绪后，可以单独派工"对此 plan 出 ≤30 行评审清单，重点看远程操作鉴权超时 + 分支删除安全门槛"。
