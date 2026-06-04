# 本地AI提交体检与Claude打杂 · 任务清单

- [ ] 1. git-service 加 `getWorkingDiff(projectPath)` 导出（跑 `git diff HEAD --no-color`）→ verify: `pnpm -F @aimon/server build` 通过
- [ ] 2. 新建 `local-ai-service.ts`：provider 枚举 + `probeProvider` + `chat` + `runCommitCheck`（规则扫描+脱敏+模型补充+UTF-8 截断+JSON 解析降级）→ verify: 后端 build 通过；临时 curl/脚本对开着的 Ollama 调通 chat
- [ ] 3. 新建 `routes/local-ai.ts`（providers/models/commit-check 三端点 + serverLog 起止配对 + 409/400/502）并在 `index.ts` 注册 → verify: 后端 build 通过；curl 三端点返回符合预期；关掉后端 AI 时 commit-check 返回 409
- [ ] 4. 前端 `api.ts` 加 3 个客户端函数 + `types.ts` 加返回类型 → verify: `pnpm -F @aimon/web build` 通过
- [ ] 5. `ChangesList.tsx` 加 provider/model 下拉（自动选可达+localStorage）+「🩺 AI 体检」按钮 + 结论显示（不阻断）+ `logAction('ai','commit-check')` → verify: `pnpm -F @aimon/web build` 通过；浏览器点按钮出结论；造 console.log+大文件+假密钥三条都被揪出；LogsView 见 scope=ai action=commit-check 起止配对
- [ ] 6. 失败路径验收：关掉 Ollama/LM Studio 点体检 → 可读错误 + LogsView error 终点 → verify: 浏览器观察 + LogsView 有 scope=ai error 条目
- [ ] 7. 新建 `scripts/local_ai_ask.py`（连 Ollama/LM Studio，UTF-8，argv/stdin）+ `.claude/skills/localai/SKILL.md`（含硬边界）→ verify: `python scripts/local_ai_ask.py "用一句话介绍杭州"` 打印回答；SKILL.md 存在且写明只做简单杂活
- [ ] 8. 收尾：`git diff --name-only HEAD` 与 write_files 白名单比对，无越界 → verify: 名单内
