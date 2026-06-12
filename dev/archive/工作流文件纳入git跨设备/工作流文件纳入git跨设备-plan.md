# 工作流文件纳入 git 跨设备 · plan

## 大哥摘要

你的 Dev Docs 工作流（每个任务的 plan/context/tasks 文档、记忆、问题档案）本意是"跟着项目走、换台电脑也在"。但仓库的忽略名单（`.gitignore`，告诉 git 哪些文件别管）里有一句 `dev/`，把整个工作流目录都屏蔽了——结果 294 个工作流文件根本没进 git，换设备就全丢。只有几个老任务当年硬塞进去才幸存。这次把这句屏蔽规则改精确：工作流文档全部进 git，只挡运行期产生的日志垃圾。做完后你在另一台电脑 `git pull` 就能看到所有任务文档和记忆，不会再丢。不动任何代码、不动数据库、不影响界面。

## 目标

- `dev/` 下的工作流文档（active/archive 的 *.md / *.json、memory/*.md、issues.md、learnings.md、ARCHITECTURE.md 等）全部纳入 git 跟踪。
- 验收：`git status --ignored dev/` 不再把这些文档列为 `!!`（忽略）；`git ls-files dev/ | wc -l` 从 46 涨到约 320（46 + 新补 ~276）。
- 噪声仍被忽略：`*.log`、`dev/**/*.err`、`dev/_run_test.py` 不进库。
- 已误入库的 3 个 `.err` 启动日志从跟踪里移除（文件留在磁盘，只是 git 不再管）。

## 非目标

- 不改 `.aimon/` 的忽略规则（除 `runtime/` 外已全跟踪，无需动）。
- 不处理 `~/.claude/skills/dev-docs-workflow/SKILL.md` —— 它是系统级全局 skill，本就不属于项目仓库（跨设备靠 `~/.claude` 自己同步，不在本任务范围）。
- 不删除任何工作流内容，不清理历史任务。

## 实施步骤

1. 改 `.gitignore`：删掉 `dev/` 整体忽略，换成只忽略 `dev/**/*.err` + `dev/_run_test.py`（`*.log` 已被全局规则覆盖）。验证：`git check-ignore dev/active/<某任务>/xxx-plan.md` 返回空（不再被忽略）。
2. 把 3 个已跟踪的 `.err` 用 `git rm --cached` 移出跟踪（磁盘保留）。验证：`git ls-files dev/ | grep .err` 为空。
3. `git add dev/ .gitignore` 全量补入。验证：`git status --short` 看到大量 `A`（新增）行，无意外文件类型。
4. 提交（不 push，等大哥自己推）。验证：`git show --stat` 改动文件都在 dev/ 与 .gitignore 内。

## 边界情况

- 已跟踪文件加忽略规则不会自动 untrack —— 所以 .err 必须显式 `git rm --cached`。
- 路径含中文，git 默认转义显示，操作用 `git add dev/` 整目录规避逐文件转义问题。
- `*.log`（全局第 11 行）已覆盖 dev 下日志，无需重复。

## 风险与注意

- 一次提交 ~280 个文件，体量大但全是文本文档，可逆（误了 `git reset` 即可）。
- 不 push：跨设备生效需大哥确认后自己推送。
