# 工作流优化-单真源与档位对齐 · 任务清单

- [x] 步骤 1：docs-service.ts 进度推导改为以 tasks.md 复选框为准（json 仅 blocked + md 空兜底） → verify: `pnpm -F @aimon/server build` 通过
- [x] 步骤 2：CLAUDE.md / AGENTS.md / dev-docs-guidelines.ts 同步 #2(tasks 单真源) + #3(抬高默认档门槛) → verify: grep 旧句"必须始终一致""只动 1–2 个文件"无残留
- [x] 步骤 3：仓库外 F:\VibeSpace\CLAUDE.md 三模型→双模型 + 同步 #2 #3 → verify: grep "三模型会审/三方协作" 全仓无残留
