# 工作流装配agent团队 · 任务清单

- [x] issues.md 记 skills 错拷遗留 → verify: issues.md 末尾多一条单行条目
- [ ] 写 templates/agent-team/ 五份模板（4 角色 + 说明书，含大脑加载协议硬性段） → verify: grep 断言每份含协议段、不含 vibespace-/fastify/react/packages\/server 等禁词
- [ ] harness-template-service.ts 改造（清单换源 + 指纹标记/升级 + legacy 清理 + REPO_ROOT 防护 + renamed 适配） → verify: pnpm -F @aimon/server build 通过
- [ ] routes/projects.ts apply/remove 日志 meta 加团队数量 → verify: server build 通过；冒烟断言 meta 字段
- [ ] install.sh agents 段同步换源 → verify: bash -n 语法检查通过
- [ ] scripts/agent-team-smoke.mjs 四条路径 + 内容安全断言，挂 smoke:agent-team → verify: pnpm smoke:agent-team 通过
- [ ] WorkflowTab 加"团队 agent N/4"轻量状态 → verify: pnpm -F @aimon/web build 通过
- [ ] 真机验收：非 node 项目走 装→重复→升级→卸 → verify: 四条路径磁盘结果符合预期
- [ ] 交付 handoff → verify: 首行为验收指引 + git diff 清单
