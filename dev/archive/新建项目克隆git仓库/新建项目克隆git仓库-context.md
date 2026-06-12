# 新建项目克隆git仓库 · Context

## 关键文件（改动边界）

- **packages/server/src/git-service.ts**
  - 复用：`sanitizedGitEnv()`(196-221)、`GitServiceError`(169, code 含 git_failed)、`withGitTimeout`(1134)、`clipStderr`(1128)、`normalizeNewlines`(1162)、顶部已 import `dirname`、`mkdir`、`existsSync`、`simpleGit`。
  - 常量：`REMOTE_TIMEOUT_MS=60_000`(1115)。新增 clone 用更长超时（180_000）。
  - **新增**：`export async function cloneRepo(url, targetPath, timeoutMs)`，放在 remote ops 区（pull/push/fetch ~1218-1250）附近。用 `simpleGit({baseDir: dirname(targetPath), binary:'git', maxConcurrentProcesses:1, trimmed:false}).env({...sanitizedGitEnv(), GIT_TERMINAL_PROMPT:'0'})` 起一个**非缓存**实例（不用 gitFor，因为要额外 env 且 cwd 是父目录非 repo），`withGitTimeout('clone', ms, () => g.raw(['clone','--',url,targetPath]))`，catch 后抛 GitServiceError 且消息清洗（不含 url）。

- **packages/server/src/routes/projects.ts**
  - 改 `CreateProjectSchema`(30-33)：加 `cloneUrl: z.string().trim().min(1).optional()`。
  - 改 `POST /api/projects` handler(65-147)：cloneUrl 存在时走新分支（查重→克隆→写库）；不存在时原 auto/custom 逻辑不动。
  - 新增本地 helper `validateCloneUrl(raw): string`（new URL + http/https 白名单）。
  - import 补：`rm` from "node:fs/promises"、`existsSync` from "node:fs"、`dirname` from "node:path"、`cloneRepo` from "../git-service.js"、`listProjects`(已 import) 用于 path 查重。
  - 日志：`serverLog("info","project","project-clone 开始/成功(Nms)/失败:…", {meta:{name,cloneHost,...}})`。

- **packages/web/src/api.ts**
  - 改 `createProject`(141-146) 入参类型加 `cloneUrl?: string`，透传进 body（不填则 body 不含——用条件展开）。

- **packages/web/src/components/NewProjectDialog.tsx**
  - 加 `cloneUrl` state(13-22 区)；submit(32-82) 把 cloneUrl trim 后传给 createProject；logAction meta(66-74) 加 `cloneHost`（前端解析 host，不传原始 url）。
  - JSX：name label(95-107) 之后插入「Git 仓库地址（可选）」输入框 + 提示。
  - 提交按钮文案(185)：克隆时显示「克隆中…」。

## 决策记录

- **不加 DB 列**（资深视角不会觉得过度设计 ✓）：克隆后 git 在 `.git/config` 自记 origin，项目身份 = name+path 已足够。存 remote 是「只用一次/没人要的字段」。
- **折进现有 POST /api/projects 而非新开 clone 路由**：少一个端点、少一份路由注册 + 前端 api 函数；无进度流需求，没必要拆。
- **cloneRepo 用新 simpleGit 实例不走 gitFor**：gitFor 缓存按 cwd 且 env 固定为 sanitizedGitEnv()，clone 需要 (a) cwd=父目录(非 repo) (b) 额外 GIT_TERMINAL_PROMPT=0。新实例最直接，不污染缓存。
- **协议仅 http/https**：用 `new URL()` 解析后查 `protocol`。ssh/file/scp-style(git@host:path 不被 new URL 当合法 URL，自然落入 catch→400) 全拒。比正则白名单更稳。
- **clone 前先磁盘 existsSync + DB path 查重**：避免白等 180s 才撞 UNIQUE / 撞已存在目录（Codex 评审点）。
- **目标目录必须完全不存在**：最简规则（不接受「已存在空目录」），清理时只删本次创建的 path（resolve 校验在父目录下），绝不碰用户原有目录。
- **日志脱敏**：前后端日志 meta 都只放 cloneHost，不放原始 url（防 `https://token@host` 泄露 token）；cloneRepo 抛错消息清掉 url。

## 依赖与约束

- 本机 `git` 必须在 PATH（simple-git 不自带）——项目现有 git 功能已依赖，沿用，不做启动期检测。
- 前端类型检查/构建命令：`pnpm -F @aimon/web build`（无独立 typecheck，见 auto.md 经验）；后端 `pnpm -F @aimon/server build`。
- 向后兼容：createProject 旧调用（不传 cloneUrl）行为完全不变。
