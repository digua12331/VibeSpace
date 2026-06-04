# 本地AI提交体检与Claude打杂 · 任务清单

- [x] 1. git-service 加 `getWorkingDiff(projectPath)` 导出（跑 `git diff HEAD --no-color`）→ verify: `pnpm -F @aimon/server build` 通过 ✓
- [x] 2. 新建 `local-ai-service.ts`：provider 枚举 + `probeProvider` + `chat` + `runCommitCheck`（规则扫描+脱敏+模型补充+UTF-8 截断+JSON 解析降级）→ verify: 后端 build 通过 ✓（运行期 chat 验收随 UI 步骤一起做）
- [x] 3. 新建 `routes/local-ai.ts`（providers/models/commit-check 三端点 + serverLog 起止配对 + 409/400/502）并在 `index.ts` 注册 → verify: 后端 build 通过 ✓
- [x] 4. 前端 `api.ts` 加 3 个客户端函数 + `types.ts` 加返回类型 → verify: `pnpm -F @aimon/web build` 通过 ✓
- [x] 5. `ChangesList.tsx` 加 provider/model 下拉（自动选可达+localStorage）+「🩺 AI 体检」按钮 + 结论显示（不阻断）+ `logAction('ai','commit-check')` → verify: `pnpm -F @aimon/web build` 通过 ✓（浏览器点按钮/三类毛病/LogsView 起止配对 = 大哥重启后端后手动验）
- [x] 6. 失败路径：关掉本地 AI 点体检 → 可读错误 + LogsView error 终点 → 已在代码实现（probe 不可达 → 409 → 前端 aiErr 红字 + 后端 serverLog error 终点）；运行期由大哥手动验 ✓代码就绪
- [x] 7. 新建 `scripts/local_ai_ask.py` + `.claude/skills/localai/SKILL.md`（含硬边界）→ verify: 实跑 `python scripts/local_ai_ask.py "用一句话介绍杭州"` 经本机 LM Studio 返回真实回答 ✓
- [x] 8. 收尾：`git diff --name-only HEAD` 与 write_files 白名单比对，无越界 → verify: 见下 ✓
