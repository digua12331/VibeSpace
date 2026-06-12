# context

## 关键文件

- `.gitignore`（仓库根）—— 第 13 行 `dev/` 是元凶；第 11 行 `*.log` 全局覆盖日志；第 21 行 `.aimon/runtime/` 已正确收敛。本次只改第 13 行。
- `dev/`（整目录）—— 294 个被忽略文件：210 md + 66 json（工作流文档）+ 3 log + 1 py（`_run_test.py`，内容 `raise RuntimeError("boom")`，一次性 verify 脚本）。
- `dev/active/修复后端启动/*.err`（3 个）—— 已被跟踪的启动错误日志垃圾，本次 untrack。

## 决策记录

- **为什么不逐文件挑选**：294 个忽略文件里 276 个是合法工作流文档，只有 4 个噪声（3 log + 1 py）。与其白名单挑选，不如黑名单挡噪声（`dev/**/*.err`、`dev/_run_test.py`）+ 整体放行。资深工程师视角：不过度设计，最简。
- **为什么 untrack .err 而不只是加忽略**：git 忽略只对未跟踪文件生效；已入库的 .err 加规则也不会消失，必须 `git rm --cached`。
- **为什么不碰 SKILL.md**：CLAUDE.md 明确它是抽离到 `~/.claude/skills/` 的系统级 skill，按关键词跨项目命中，本就不该进单个项目仓库。项目级强制规则由已跟踪的 `CLAUDE.md` 承担。
- **为什么不加操作日志**：本任务是仓库配置/git 卫生，无运行期行为变化，属操作日志规则豁免项（纯配置）。

## 依赖与约束

- Windows + PowerShell/Bash 混用；路径含中文，用整目录 `git add dev/` 规避转义。
- 提交不推送（push 是对外动作，留给大哥）。
