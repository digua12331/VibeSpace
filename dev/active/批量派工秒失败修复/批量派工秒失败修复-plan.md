# 批量派工秒失败修复 · plan

## 大哥摘要

「批量派工」（在「问题」里勾几条 issue、或在任务的「子任务」里一键派工，让 AI 各自在一个 worktree（git 的临时副本，几个任务并行互不踩脚）里干活）现在一点就**秒失败**，红字写 `stuck: <一句话原因>` 加一串乱码。

原因是个低级毛病：系统给那个干活的 AI 发的指令里，本来写着"你卡住了就喊一声某个暗号"。结果这句**指令本身**被终端原样显示出来，系统盯着终端找暗号，一眼就在自己刚发出去的指令里看到了那个暗号，于是 1 秒内误判"AI 卡住了"——其实 AI 还没开始干活。

这次把"喊暗号"的方式从"在终端打印一行字"换成"往一个固定小文件里写一个字"（终端只负责显示、不再被当判据），系统改成去读那个文件。这样就不会再自己骗自己。**改完后你能在哪验收**：去「问题」tab 勾一条带 typo 的 issue 点批量派工，它不再 1 秒变红，而是正常进入"运行中→可审查"；LogsView（浏览器里的日志面板）能看到这次派工的起止日志。**不动你任何现有数据/界面**，只改后端派工的内部信号机制。

## 目标

修掉批量派工/子任务派工"被自己注入的 prompt 回显触发，秒判 done/stuck"的 bug。

**可验证的验收标准：**
1. 在「问题」tab 勾一条 `auto` 类 issue 点批量派工 → 该 job **不再在数秒内变 failed**，而是进入 `running`，AI 真正改完并写信号后转 `verifying`→`review-ready`（或它真卡住才 `failed: stuck: <真实原因>`，原因不再是占位符 `<一句话原因>` 也无 ANSI 乱码）。
2. 子任务派工（任务 plan 带 `## 自拆与依赖` 时的「子任务」面板「一键派工」）同样不再秒失败。
3. 终端里即便仍出现旧 marker 字面量（历史日志/AI 复述），也**不再**触发完成/卡住判定。
4. AI 完成的改动经 approve 能正常 `git merge`，且信号文件**不进**分支（`git check-ignore <worktree>/.aimon/runtime/job-signal` 命中忽略规则）。
5. `pnpm --filter @aimon/server` 的类型检查（tsc）通过。
6. LogsView 能看到本次派工的起止日志（spawn 起 + 命中 signal 终 / 或退出未信号的失败终）。

## 非目标

- 不改派工的并发上限、wave 调度、approve/merge/worktree 清理逻辑。
- 不改前端「问题」/「子任务」面板 UI（信号机制是纯后端内部改动）。
- 不解决"AI 在 worktree 里因权限弹窗卡住"——已确认全局配置放行 Write/Edit/git，权限不是本次问题。

## 实施步骤

1. **`worktree-session-runner.ts`：把"扫终端 buffer 找 sentinel"换成"轮询带外信号文件"。**
   - 删 `wireMarkerDetection` 里对 PTY `output` 的 `buffer.includes(...)` 扫描；保留 `exit` 监听。
   - 新增导出常量 `JOB_SIGNAL_REL_PATH = ".aimon/runtime/job-signal"`。
   - spawn 成功后：`mkdir -p <worktreePath>/.aimon/runtime`，并删除可能残留的旧信号文件；起一个 `setInterval`（~1000ms）读 `<worktreePath>/.aimon/runtime/job-signal`：
     - 内容 trim 后**严格**判定：`=== "DONE"` → `onSignalDone`；以 `"STUCK:"` 开头 → reason = 其后内容（截断 ≤300 字）→ `onSignalStuck`；其余（空/半写/乱码）忽略，等下一拍。
     - 命中后：清 interval、删信号文件、`off("exit")`。
   - `exit` 回调里：先**最后读一次**信号文件（防"刚写完就退出"竞态），命中就走 done/stuck，否则才 `onSessionExitBeforeMarker`；最后清 interval。
   - 接口 `WorktreeJobSpawnInput`：删 `markerDone`/`markerStuck`；回调改名 `onSignalDone`/`onSignalStuck`（语义从终端 sentinel 改为带外信号，避免后人误解）。
   - 命中 done/stuck 时 `serverLog("info"/"warn", "worktree-runner", ...)` 记一条终点日志（spawn 那条是起点）。
   - *验证*：`pnpm --filter @aimon/server` tsc 通过。

2. **`issue-prompt.ts`：prompt 从"打印 marker"改成"写信号文件"。**
   - 删 `ISSUE_DONE_MARKER`/`ISSUE_STUCK_MARKER` 导出；完成约定改为："改完后把完成信号写入 worktree 内文件 `.aimon/runtime/job-signal`（目录不存在就创建），内容只写 `DONE`；若连续失败/超范围，写 `STUCK: <一句话原因>`（一行、简短）。写完等 verify pipeline 接管，不要主动退出。"
   - *验证*：tsc 通过；grep 确认无残留 `ISSUE_*_MARKER` 引用。

3. **`task-subtasks.ts`：子任务 prompt 同步改写 + 去掉本地 marker 常量。**
   - 删 `SUBTASK_DONE_MARKER`/`SUBTASK_STUCK_MARKER`；`buildSubtaskPrompt` 完成约定改成同样的"写 `.aimon/runtime/job-signal`"。
   - `dispatchOneSubtask` 调 `spawnWorktreeJob` 去掉 marker 参数、回调改名 `onSignalDone`/`onSignalStuck`。
   - *验证*：tsc 通过。

4. **`issue-jobs.ts`：去掉 marker import、回调改名。**
   - `dispatchOne` 里 `spawnWorktreeJob` 调用去掉 `markerDone`/`markerStuck`，`onMarkerDone`/`onMarkerStuck` 改名 `onSignalDone`/`onSignalStuck`（函数体不变）。
   - 删对 `ISSUE_DONE_MARKER`/`ISSUE_STUCK_MARKER` 的 import。
   - *验证*：tsc 通过。

5. **端到端验收**（手动 + 浏览器）：起服务，「问题」勾一条 auto issue 批量派工，观察不秒失败、走到 review-ready；`git check-ignore` 验证信号文件被忽略；LogsView 看起止日志。子任务链路同样跑一遍。

## 边界情况

- **半写竞态**：runner 读到空/半行/乱码 → 忽略，等下一拍；只认严格 `DONE` / `STUCK:` 前缀。
- **写完即退出**：AI 写信号后 PTY 立刻退出 → `exit` 回调里先补读一次文件，避免误判"退出未信号"。
- **AI 根本不写信号就退出**：保留 `onSessionExitBeforeMarker` → 标记 cancelled（行为同现状）。
- **worktree 复用残留旧信号**：spawn 时先删旧文件 + 新建目录。
- **STUCK reason 过长**：截断 ≤300 字，防日志/前端膨胀。
- **`.aimon/runtime/` 忽略是否在 worktree 生效**：worktree 是同仓库 checkout，继承同份 `.gitignore`；验收用 `git check-ignore` 兜底确认。

## 风险与注意

- **假设**：派工的 claude 在 worktree 里有写文件权限——已查全局 `~/.claude/settings.json` 放行 `Write`/`Edit`/`git add`/`git commit`，成立。
- **假设**：AI 会按指令写信号文件（同它会按旧指令打印 marker 一样可靠）；不写就走退出失败路径，不会卡死成功判定。
- **破坏性变更协议**：本次会改 `WorktreeJobSpawnInput` 这个跨文件导出接口（删 2 个字段、改 2 个回调名）+ 删除 `ISSUE_*_MARKER` 导出符号。但 `spawnWorktreeJob` 与这些 marker 仅被 issue-jobs/task-subtasks 两文件独占使用，已全部纳入本次改动范围；改完会 grep 全仓确认无残留旧引用（`markerDone`/`markerStuck`/`ISSUE_DONE_MARKER`/`ISSUE_STUCK_MARKER`/`SUBTASK_*_MARKER`/`onMarkerDone`/`onMarkerStuck`）。
- 不引入 `fs.watch`（Windows/worktree 下易丢事件或重复触发），用 `setInterval + readFile` 轮询，简单稳。

## 多模型 Plan 会审

> [Codex 评审] "文件信号方案更稳：把'终端显示内容'从完成判定里移除，避开 TUI 回显、ANSI、重绘、模型复述 marker 等天然噪声；'时间窗+剥 ANSI'只能缓解首秒误触发，挡不住后续重绘/复述。"
> [Codex 评审] 补强清单采纳：严格只认 `DONE`/`STUCK:` 前缀避半写、spawn 时 mkdir+删残留、PTY 退出前最后补读一次防竞态、reason 限长、命中即删信号文件、接口语义 marker→signal 改名、验收覆盖两条链路 + DONE/STUCK/退出未信号三种结果 + 旧 marker 不再触发。否决项：不用 git commit message / 退出码 / STATUS.md 传信号（卡住不 commit、退出码表达不了 reason、STATUS.md 有污染分支或被误改风险）。
> [综合主笔] 本次为契合任务量级（contained bug、改动锁定 4 个后端文件），由 Claude 综合 Codex 评审清单直接定稿 plan，未再走 Codex 二次主笔；取舍：采纳 Codex 全部加固点，保留我原定的 `.aimon/runtime/job-signal` 落点与轮询方案。
> [Claude 白话化兜底] 重写大哥摘要为"指令暗号被终端回显自触发"的白话比喻，全文术语（worktree / TUI / ANSI / mutation）均括号翻译；对照 manual.md/auto.md：符合"操作日志起止配对""破坏性变更先列引用图"两条长期约束，已写进步骤与风险段。
