# 工作流文件纳入git跨设备 · 任务清单

- [x] 改 .gitignore：删 `dev/` 整体忽略，换成 `dev/**/*.err` + `dev/_run_test.py` → verify: `git check-ignore dev/active/工作流文件纳入git跨设备/工作流文件纳入git跨设备-plan.md` 返回空
- [x] untrack 3 个 .err 启动日志 → verify: `git ls-files dev/` 里无 .err，且磁盘文件仍在
- [x] `git add dev/ .gitignore` 全量补入 → verify: `git ls-files dev/ | wc -l` = 341，`git status` 无非预期文件
- [x] 提交（不 push） → verify: `git show --stat HEAD` 改动全在 dev/ 与 .gitignore（提交 6d89c90，302 文件）
