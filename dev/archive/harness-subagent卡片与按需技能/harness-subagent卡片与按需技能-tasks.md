# harness-subagent卡片与按需技能 · 任务清单

## Phase A · Subagent run 卡片

- [x] A-1. 新建 `packages/server/src/subagent-runs.ts`：内存 Map + register/markDone/list/listAll + 30min 自清 + serverLog 起止配对 → verify: server tsc 通过
- [x] A-2. routes/hooks.ts 加 `extractTaskInvocation(payload)`；PreToolUse 命中 Task 调 registerStart、PostToolUse 调 markDone；**先 console.log 一次实际 payload 字段名再 commit** → verify: 起 server，手动起 claude session 让它跑 Task；server 终端 console 输出 payload 字段；调整后调用接通
- [x] A-3. 新建 `routes/subagent-runs.ts`：GET /api/sessions/:id/subagent-runs；wire shape prompt 截断 1KB；index.ts 注册 → verify: curl GET 拿到列表（先 manual POST hook 模拟数据）
- [x] A-4. 前端 types.ts (SubagentRun) + api.ts (listSubagentRuns) + store.ts (subagentRunsBySession + refreshSubagentRuns) → verify: web tsc 通过
- [x] A-5. EditorArea session 标签加 `🤖×N` badge（N=running 数）；SessionView 顶栏下方加 subagent chips bar（最多 10 chip，hover tooltip，click → alertDialog）；5s 轮询 → verify: A-V1/V2/V3 浏览器跑通；ERROR 日志手动触发一次

## Phase B · Skills 按需注入

- [x] B-1. 新建 `packages/server/src/skills-service.ts`：手动 parse yaml frontmatter（不引 gray-matter）；导出 listSkills / pickSkillsForTask / buildRuntimePrompt → verify: 写临时 node 自测脚本验证 parser 解析准确；server tsc
- [x] B-2. routes/sessions.ts startSession 集成：spawn 前 pickSkills + 写 runtime prompt + env 注入 + serverLog → verify: 启动后 ls `.aimon/runtime/` 看到文件；终端跑 `echo $AIMON_SESSION_PROMPT_PATH`
- [x] B-3. routes/projects.ts 加 `GET /api/projects/:id/skills`（仅 name+triggers，不带 body）→ verify: curl 返回数组
- [x] B-4. 前端 api.ts (listProjectSkills) + StartSessionMenu 加"将注入：a · b · c"提示（项目无 skills 目录或命中 0 时不显示）→ verify: B-V1 浏览器看到提示；B-V4/V5 边界条件不报错
- [x] B-5. 浏览器 + 终端联动验证：B-V2 终端 cat $AIMON_SESSION_PROMPT_PATH；B-V3 LogsView `skills injected` 日志条目 → verify: 5 个 B-V 全过

## 收尾

- [x] C-1. README "Concepts" 加 subagent 卡片 + skills 两段；提示 `.aimon/runtime/` 应进 .gitignore；dev/learnings.md 视情况追加（Task payload 字段实测、yaml parser 坑）→ verify: 肉眼读
- [x] C-2. 全量验收：浏览器 A-V1..V3 + B-V1..V5 + ERROR 日志手动触发；命令行 server tsc + web tsc + smoke:worktree 全过 → verify: 手动+命令行全过
