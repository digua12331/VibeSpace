# 新建项目克隆git仓库 · 任务清单

- [x] 步骤 1：git-service.ts 新增 `cloneRepo(url, targetPath, timeoutMs)` → verify: `pnpm -F @aimon/server build` 类型检查通过；函数用新 simpleGit 实例 + GIT_TERMINAL_PROMPT=0 + withGitTimeout，抛错消息不含原始 url
- [x] 步骤 2：projects.ts 加 cloneUrl 支持（schema + validateCloneUrl + handler 查重/克隆/写库分支 + 失败清理 + serverLog clone 起止配对脱敏） → verify: `pnpm -F @aimon/server build` 通过；阅读确认不填 cloneUrl 时原逻辑零改动、删除只针对本次创建的 path
- [x] 步骤 3：前端 api.ts createProject 加 cloneUrl 透传 → verify: 类型通过，不填时 body 不含该字段
- [x] 步骤 4：NewProjectDialog.tsx 加输入框 + 提示 + 克隆中按钮 + logAction meta 用 cloneHost → verify: `pnpm -F @aimon/web build` 通过
- [x] 步骤 5：端到端自测 + 边界（cloneRepo 真克隆公开仓库成功 + 404 仓库快速失败且 URL 已脱敏为 <url>；server/web build 均过；diff 仅 4 白名单文件） → verify: 公开仓库克隆成功(列表出现+目录有.git+remote 指向)；留空建空项目行为不变；非法地址/已存在目录/克隆失败 各报明确错误且不残留；LogsView 见 scope=project action=clone 起止配对且日志无原始 url；越界文件检查 `git diff --name-only HEAD` 仅含 4 个白名单文件
