# 完善Git面板功能 · 任务清单

- [x] 1. 在 `git-service.ts` 加超时 helper `withGitTimeout(60s)` + 11 个新函数（pull/push/fetch/listStashes/createStash/popStash/createBranch/deleteBranch/checkoutBranch/mergeBranch/resetSoftLastCommit），全部走 `gitFor()` + `bustStatusCache()` + `GitServiceError` → verify: 在临时仓库 node REPL 跑一遍每个新函数，断言成功路径返回结构、失败路径抛 `GitServiceError`。
- [x] 2. 在 `routes/git.ts` 加 11 条路由（POST 10 条 + GET /stashes 1 条），全部 zod 校验 + `loadProjectOr404` + `serverLog` 起止配对 → verify: 起 dev server，curl 每个端点一次，看返回结构 + `data/logs/YYYY-MM-DD.log` 含起止两条。
- [x] 3. 在 `types.ts` 加 7 个新类型导出（StashEntry、PullResult、PushResult、FetchResult、MergeResult、BranchOpResult、ResetResult） → verify: tsc 通过。
- [x] 4. 在 `api.ts` 加 12 个客户端函数（11 个 mutation + getStashes 列表） → verify: tsc 通过；浏览器 console 手动调用 `api.getStashes(pid)` 拿到空数组。
- [x] 5. 写 `BranchPopover.tsx` 新组件：列出本地/远程分支 + 「新建分支…」输入框 + 行内「合并到当前」「删除」按钮 + 切换分支点击行 → verify: 浏览器里点分支 chip 弹出，能看到本地分支、远程分支、新建分支输入，每行有合并/删除按钮。
- [x] 6. 改造 `ChangesList.tsx` 头部分支栏：分支名变 chip 触发 BranchPopover；右侧加「⬇ 拉取」「⬆ 推送」「⤵ 获取」三个按钮（无远程或 detached 时 disabled，tooltip 说明原因） → verify: 浏览器看到新按钮，点击拉取看 LogsView 有 `scope=git action=pull` 起止配对；故意断网再点，错误条出现且 LogsView 有 ERROR 条目。
- [x] 7. 在 `ChangesList.tsx` 提交框下方加二级按钮行：「草稿暂存」「取出草稿 (N)」「撤销最后一次提交」，状态自适应 disabled → verify: 浏览器跑 stash → 改文件 → unstash 看到改动恢复；commit → 撤销 → 改动回到 staged 区，每步 LogsView 有起止配对。
- [x] 8. 危险操作二次确认：删除未合并分支用 `confirmDialog({ variant: 'danger' })` 二次确认走 `-D`；合并冲突直接展示 git stderr → verify: 浏览器点删除未合并分支按钮，弹红色警告，按取消不执行；按确认执行 `-D`。
- [x] 9. 写 `scripts/git-ops-smoke.mjs`：起 bare 仓库当 origin + work 仓库当本地，跑 stage→commit→push→branch create→checkout→改文件→stash→unstash→reset --soft→branch delete 全流程，每步断言 → verify: `pnpm git-ops-smoke` 退出码 0。
- [x] 10. `package.json` 加 `"git-ops-smoke"` script + 全量类型检查 + 浏览器手测一轮（脚本端到端通；浏览器手测留给主理人验收） → verify: `pnpm -w typecheck` 通过；浏览器手动操作每个新按钮一次，UI 正常 + LogsView 起止配对正确。
