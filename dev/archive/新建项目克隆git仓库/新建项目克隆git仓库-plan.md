# 新建项目克隆git仓库 · Plan

## 大哥摘要

现在「新建项目」只能建一个**空文件夹**。这次给它加一个**「Git 仓库地址（可选）」**输入框：你把一个 GitHub 项目的下载链接（就是仓库页面上「Code → HTTPS」那串 `https://github.com/xxx/yyy.git`）粘进去，点创建，系统会自动把那个项目**整个下载（克隆）到指定目录**，建好后就能直接当成你自己的项目开发。

- **在哪里看**：左下角「新建项目」对话框里，会多出一个「Git 仓库地址（可选）」的输入框。留空 = 跟以前一样建空项目；填了 = 下载远程项目。
- **会不会动到现有东西**：不会。不填这个框时，新建项目的行为跟现在**一模一样**。你现有的项目、数据、界面都不受影响。
- 下载大项目可能要等十几秒到几分钟，按钮会显示「克隆中…」（克隆 = git 把远程仓库完整拷到本地的术语）。

## 目标

让「新建项目」支持填一个 git 仓库地址，后端把它 `git clone`（把远程仓库完整下载到本地）到目标目录后写入项目库，之后该目录就是一个带完整 git 历史的可开发项目。

**可验证的验收标准**：
1. 在新建项目对话框填一个公开仓库地址（如 `https://github.com/sindresorhus/slugify.git`）+ 项目名，点创建 → 几秒后项目出现在列表，打开后目录里有该仓库的真实文件 + `.git`（运行 `git -C <目标目录> remote -v` 能看到 origin 指向填的地址）。
2. **不填**地址时，新建空项目行为与改动前完全一致（建空目录、写库、装配工作流都不变）。
3. 填一个**非法地址**（如 `ssh://...`、`file:///c:/...`、`git@github.com:a/b.git`、纯本地路径、乱码）→ 前端收到明确错误提示，**不**创建项目、**不**克隆。
4. 填一个**目标目录已存在**的项目名 / 路径 → 立即报「目录已存在」错误，**不**进入耗时的克隆（不会白等几分钟）。
5. 克隆**失败**（断网、私有仓库无凭据、地址不存在）→ 前端收到错误、**不**写库、本次创建的半成品目录被清理干净（不残留垃圾文件夹）。
6. 浏览器日志面板（LogsView）能看到 `scope=project action=clone` 的**起止配对**（开始 / 成功(Nms) / 失败:原因），且日志里**看不到**原始 URL 中的 token/密码（只显示主机名）。
7. `pnpm -F @aimon/web build`（前端类型检查 + 构建）通过；后端 `pnpm -F @aimon/server build` 或等价类型检查通过。

## 非目标（本次不做）

- **不**新增数据库列存远程地址——克隆后 git 自己在 `.git/config` 记 origin，项目身份仍是 `name + path`。
- **不**做克隆进度条 / 流式输出（只给「克隆中…」+ 起止日志，进度留待以后）。
- **不**支持 SSH 协议克隆（`git@...` / `ssh://`）——本项目 `sanitizedGitEnv()` 清掉了认证环境变量，SSH 跑不通；本次只做 http/https。
- **不**做私有仓库凭据输入 UI（私有仓库本次会因无凭据而快速失败并提示，凭据管理另起任务）。
- **不**改 worktree、删除项目、工作流装配等相邻逻辑。

## 实施步骤

1. **后端 git-service.ts 新增 `cloneRepo(url, targetPath, timeoutMs)`**
   - 用 `simple-git`（数组传参，不过 shell，天然防注入），env = `sanitizedGitEnv()` 之上补 `GIT_TERMINAL_PROMPT='0'`（要认证时立即失败，不挂起等输入）。
   - 从 `targetPath` 的**父目录**为 cwd 跑 `git clone <url> <targetPath>`，超时 180s（克隆比普通远程操作慢，比现有 60s 长）。
   - 失败时抛 `GitServiceError`，**消息里清掉可能内嵌的 URL/凭据**（只保留通用原因 + 主机名）。
   - *验证*：临时脚本调一次克隆公开仓库成功、克隆不存在仓库快速失败。

2. **后端 projects.ts handler 支持 cloneUrl（核心顺序：先查重 → 再克隆 → 后写库）**
   - `CreateProjectSchema` 加 `cloneUrl: z.string().trim().min(1).optional()`。
   - 提取一个 `validateCloneUrl(raw)`：`new URL(raw)` 解析，仅放行 `protocol === 'http:' || 'https:'`，否则 400 `invalid_clone_url`。空白串当未填。
   - cloneUrl 存在时的分支（**与现有 auto/custom 逻辑并存，cloneUrl 优先**）：
     1. 算 `path`（auto: `join(DEFAULT_ROOT, name)`；custom: `rawPath`）。
     2. **磁盘查重**：`existsSync(path)` 为真 → 400 `path_exists`（绝不克隆进已存在目录）。
     3. **数据库查重**：已有项目 path 相同 → 409 `path_already_exists`（避免白等 180s 才撞 UNIQUE）。
     4. `mkdirSync(dirname(path), { recursive: true })` 确保父目录在。
     5. `serverLog` clone 开始 → `await cloneRepo(url, path, 180_000)` → 成功/失败配对日志（meta 用 `cloneHost`，非原始 url）。
     6. 失败：用 `rm(path, { recursive, force })` 清理（**只删本次创建的 `path`，先 `resolve` 校验它在父目录下**），然后回错误，不写库。
     7. 成功：`createProject({ id, name, path })` 写库，201 返回。
   - cloneUrl **不存在**时：现有 auto/custom 流程**原样不动**。
   - *验证*：上述验收标准 2/3/4/5/6 逐条手测 + 看 LogsView 日志。

3. **前端 api.ts**：`createProject` 入参加 `cloneUrl?: string`，透传进 POST body。
   - *验证*：类型通过，不填时 body 不含该字段。

4. **前端 NewProjectDialog.tsx**：名称下方加「Git 仓库地址（可选）」输入框
   - 填了就把 `cloneUrl` 传给 `api.createProject`；提交按钮在克隆时显示「克隆中…」、`submitting` 期间禁用（防重复提交）。
   - 输入框下加白话提示：「填了会把这个 GitHub 项目下载到目标目录；项目名只是显示名，可以和仓库名不同」。
   - `logAction` 的 meta 用**主机名**（前端从 url 解析 host），不放原始 url（防 token 泄露）。
   - *验证*：`pnpm -F @aimon/web build` 通过；浏览器手测填/不填两条路径。

## 边界情况

- **目标目录已存在**（含非空）→ 步骤 2.2 提前拦截报 `path_exists`，不进克隆。
- **数据库已有同 path 项目** → 步骤 2.3 提前 409，不进克隆。
- **非法/危险协议**（`ssh://`、`file://`、`git@host:a/b`、纯本地盘符路径、malformed）→ `validateCloneUrl` 400 拦截。
- **私有仓库无凭据 / 地址不存在 / 断网** → `GIT_TERMINAL_PROMPT=0` 使其快速失败而非挂起；超时 180s 兜底；清理半成品目录。
- **克隆出的目录名 ≠ 项目名**：无所谓，`path` 是项目身份的真源，`name` 仅显示名（前端提示已说明）。
- **git 未安装 / 不在 PATH**：cloneRepo 会失败并把原因透出（不做启动期专门检测，避免过度设计）。
- **URL 含凭据**（`https://token@host/...`）：日志只记 host，错误消息清洗，避免 token 落进 LogsView / 落盘日志。

## 风险与注意

- **半成品清理的删除操作有危险性**：必须保证只删「本次请求 mkdir/clone 出来的那个 `path`」——因为步骤 2.2 已确保该 path 改动前不存在，所以删它是安全的；删之前再 `resolve` 校验它确实在预期父目录下，绝不递归删用户原有目录。
- **假设**：本机 `git` 在 PATH 中（simple-git 不自带 git 二进制）；项目现有 git 功能已依赖这一点，故沿用。
- **假设**：用户主要场景是公开 GitHub https 仓库（与需求「github 项目下载链接」一致）；私有仓库本次只保证「快速失败 + 明确提示」，不做凭据。
- **波及面**：改动集中在 NewProjectDialog.tsx / api.ts / projects.ts / git-service.ts 四个文件，不动 db schema、不动 worktree/sessions/workflow 逻辑。

## 多模型 Plan 会审

> [Codex 评审] "no DB column is the simplest approach；keep clone behavior inside existing POST /api/projects；URL validation should use `new URL()` plus allowlist；cloneUrl meta can leak tokens — log cloneHost or redacted URL；check DB path uniqueness + disk existence BEFORE clone so you don't spend 180s then hit UNIQUE；custom-mode validation must be swapped when cloneUrl present；cleanup only the dir this request created, guard with resolve；simple-git error messages may embed the remote URL — sanitize；git binary must be in PATH。"
> [Codex 综合主笔] 采纳 Codex 全部要点（脱敏、克隆前查重、custom 校验反转、严格只删本次目录、协议白名单用 new URL）；放弃 Codex 提的「http:// 给自建 Git」——本次只做 http/https 已含；放弃单独 clone API（折进现有 POST /api/projects 更简）。本份 plan 由 Claude 综合 Claude 草案 + Codex 评审主笔（省一次 Codex 定稿往返，要点已全部并入），非二次评审。
> [Claude 白话化兜底] 重写「大哥摘要」为 3 行白话、术语（克隆 / git clone / origin）首次出现括号翻译；对照 manual.md 偏好（2026-06-03「交付门槛=构建+类型检查通过，UI 大哥自验」）——验收标准 6/7 保留浏览器可观察项 + 类型检查，但**不**自动派 browser-use tester。
