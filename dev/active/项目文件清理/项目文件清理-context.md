# 项目文件清理 · Context

## 关键文件（= 改动边界）

仅删除/移动，不改任何源码：

- 删：`_tp.bat`、`dev/_run_test.py`、`docs/1.md`、`docs/1.md.comments.json`、`output/示例功能/**`（删完 output/ 若空则一并删目录）、`dev/active/修复后端启动/*.{log,err}`、`_design-explorations/**`
- 移：`dev/active/<已完成任务>/` → `dev/archive/`（批量搬家，大哥已批，放弃归档评审）
- 不动：在途任务目录（见下）、所有 git modified/untracked 业务文件、`docs/求职/`、`docs/*-plan.md`

## 在途任务白名单（dev/active 里保留不动）

判定标准：LastWriteTime 为 2026-06-12 当天（对应未提交改动或当日刚提交的任务），加上本任务自身：

AI资讯详情抓原文、AI资讯雷达面板、团队模板借鉴鲁班四条、工作流装配agent团队、微信ilink可行性试点、微信单飞锁加逃生口、微信接入设置、权限目录补PowerShell整工具、权限面板完全不问开关、项目文件清理

## 决策记录

- 批量 mv 而非逐个 UI 归档：大哥拍板，接受不触发归档评审的代价。
- 重名冲突（dev/archive 已有 43 个目录，已知重名：运行 Python 文件、问题面板、项目切换卡顿优化、项目列表激活分页、项目工作流统一装配）按工作流约定加 `-<YYYYMMDD-HHMM>` 后缀，不覆盖。
- 用 PowerShell 脚本批量移动（目录名含中文/空格），不用通配符裸奔。
- 删除均可从 git 历史恢复（除 gitignore 的 _run_test.py 和 log/err，本身无价值）。
- 不跑额外评审/外部模型：纯文件操作，无代码结构决策。

## 依赖与约束

- `docs-service.ts` 按目录扫描 dev/active / dev/archive，移动目录对它透明，无需改代码。
- 移动后跑 `pnpm -F @aimon/server build` 或 typecheck 确认无误伤（预期无关，保险起见）。
- git 提交由大哥决定，本任务不主动 commit。
