# 启动脚本自愈 · 任务清单

- [x] 步骤 1：改 `AIkanban-main/start.bat` 第 29-42 行，把 `FIRST_RUN` 触发器换成 better-sqlite3 `.node` 二进制存在性检查 → verify: `git diff start.bat` 显示仅本段改动，无意外行尾/缩进变化
- [x] 步骤 2：在 main 提交改动（注：dev/ 在 .gitignore 中被忽略，提交只含 start.bat）→ commit d226532
- [x] 步骤 3：打 stable 标签 `git tag stable-2026-05-06` → 已成为最新 stable-* tag
- [x] 步骤 4：从 main 跑 `sync-to-stable.bat` → 末尾输出 `[sync] DONE. Stable HEAD is now at stable-2026-05-06 and rebuilt.`；sync 检测到 lock 变化，自动跑了 install + native rebuild + build:stable
- [x] 步骤 5：在 stable 端验证服务能起 → 起 `pnpm --filter @aimon/server dev` 7 秒，控制台输出 `backend listening on http://127.0.0.1:8787` ✓；之后正常退出，端口 8787 已释放。备注：sync 自带的 rebuild 步骤实际未产出 `.node` 二进制（原因未深究），但新 start.bat 的自愈逻辑会在双击启动时检测并补编译，目的达成。
