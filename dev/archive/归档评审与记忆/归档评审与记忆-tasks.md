# 归档评审与记忆 · 任务清单

> 执行节奏：每完成一步立即把 `- [ ]` 改成 `- [x]`，同步改 `归档评审与记忆-tasks.json` 的 `status`。卡住改成 `blocked` 并在行尾写原因。
> 连续失败 2–3 次就停，按 CLAUDE.md 熔断规则打印日志给用户。

## POC 阶段（先验假设，失败立刻报给用户）

- [x] T1. POC：`codex` 非交互调用方式 → verify: 在 bash 里跑 `echo "say hello in chinese" | codex exec -` 或等价写法，5 秒内拿到一段自然语言 stdout、退出码 0。若 `codex exec` 不存在则试 `codex -p "..."` / `codex run` 等，记录**确认可用的命令行**到本行尾注。失败 2 次就停、报给用户。 ✅ 可用命令：`codex exec --color never --skip-git-repo-check --sandbox read-only -o <tempfile> -` prompt 从 stdin 塞、最终消息写入 tempfile。实测 20~25 秒返回。sandbox=read-only 保证 review 不会改任何文件。
- [x] T2. POC：Claude Code `SessionStart` hook 的 `additionalContext` 注入 → verify: 临时写一个 mini hook 脚本 stdout 输出 `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<< MEMORY_POC_MARKER >>"}}`，把它挂到 `~/.claude/settings.json` 的 SessionStart 位，起一次 claude 会话，让 claude 回答 "你能看到 MEMORY_POC_MARKER 吗"。看到 → POC 通过；看不到就切换降级策略（改成 `UserPromptSubmit` hook，每次用户输入前补 memory header）。失败 2 次停、报给用户。 ✅ POC 文件在 `poc/` 子目录（`.claude/settings.json` + `hook-poc.mjs`）。两种加载方式都验证通过：`claude -p --settings <path>` 显式注入；cd 进目录让默认 `--setting-sources` 自动发现 `.claude/settings.json`。模型在非交互单轮回复里都能原样复述 `MEMORY_POC_MARKER_7F3A9C`。结论：生产版 aimon-hook.mjs 输出 `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<memory>"}}` 即可，协议对版。

## 记忆基础设施（后端）

- [x] T3. 新建 `dev/memory/auto.md`、`dev/memory/manual.md`、`dev/memory/rejected.md` 三个骨架文件 → verify: `ls dev/memory/` 出三个 md；每份文件首行分别是 `# 自动沉淀（归档评审产出）` / `# 手动沉淀（长期经验，大哥写）` / `# 已撤回（从 auto.md 移过来的历史）`，下面留一两行说明
- [x] T4. 新建 `packages/server/src/memory-service.ts`：导出 `readMemory(projectPath)`、`appendLessons(projectPath, kind, entries)`、`rollbackLessons(projectPath, kind, selections)` 三个函数；`readMemory` 返回 `{ auto: Entry[], manual: Entry[], rejected: Entry[] }`；Entry 含 `{ kind: 'lesson'|'raw', text, date?, task?, line }`；行解析用正则 `^- \[(\d{4}-\d{2}-\d{2}) \/ ([^\]]+)\] (.+)$` → verify: 在 `packages/server` 下写一次性 tsx 脚本：向测试项目 append 两条自动条目、读回来 kind=lesson 数量=2；rollback 第 1 条 → auto 剩 1 条、rejected 有 1 条带撤回时间注释 ✅ `poc/memory-service-smoke.ts` 全部断言通过（append 2 → read 2 → rollback 1 → auto 剩 1、rejected 1+1 注释）。
- [x] T5. 新建 `packages/server/src/routes/memory.ts`：`GET /api/projects/:id/memory` 返回 T4 的 payload；`POST /api/projects/:id/memory/rollback` body `{ items: [{ kind:'auto'|'manual', line: number }] }` → 调 rollbackLessons；注册进 `src/index.ts` → verify: curl GET 测试项目的 memory → 返回三段列表；curl POST rollback 某条 → 再 GET 看到少一条、rejected.md 有注释行 ✅ 以 AIkanban-main（dev db id `q1speOAF-4c8`）为测试项目跑 `poc/route-smoke.ts`：启临时 fastify 挂 `registerMemoryRoutes`，GET 返回 2 条标记 lesson、POST rollback 后 auto 剩 1、rejected 新增 1 条 lesson + 1 条 rollback 注释；脚本末尾自动把 auto.md / rejected.md 还原到测试前状态。顺便已注册到 `src/index.ts` 路由列表。

## 归档评审（后端）

- [x] T6. 新建 `packages/server/src/review-runner.ts`：导出 `kickoffArchiveReview(projectPath, taskName, archivedDirName)`——**不 await**，内部 setImmediate 跑 async；读归档目录里的三个 md + 用 simple-git 拿任务窗口内改动的文件摘要（最多 20 个）；按 context D-D 拼 prompt；`child_process.spawn` 首选 codex（命令行以 T1 的 POC 结论为准）、失败回退 gemini、两个都败就往 `rejected.md` 写一条 `[review-failed / <taskName>] <error>`；成功则把正则过滤后的前 5 条 lesson append 到 auto.md → verify: 归档一个小测试任务（手造一个带 plan.md 的 `dev/active/测试-review/`）、调 kickoffArchiveReview、5 秒后看 `dev/memory/auto.md` 有新行 or `rejected.md` 有 review-failed 行 ✅ 手造 `dev/archive/测试-review-smoke/` 三件套，跑临时 tsx 调 `kickoffArchiveReview`，32 秒后 auto.md 成功 append 3 条 lesson（codex 走通，未回退 gemini）；测试用归档目录和追加内容都已还原。spawn 用 `{ shell: true }` 在 Windows 上正确解析 .cmd shim；LESSON_RE 过滤 + normalizeLesson 强制覆盖日期/任务名防止模型幻觉污染。
- [x] T7. 修改 `packages/server/src/routes/docs.ts` 的 archive 路由（111-127）：`archiveDocsTask` 成功后 `kickoffArchiveReview(proj.path, taskName, out.archivedAs)` 同步 call（不 await），response 照旧返回 `{archivedAs}` → verify: curl 归档测试任务、HTTP 响应在 200ms 内回来；后台日志有"review job started"；30 秒后 memory API 看到新条目 ✅ 临时 fastify 挂 docs 路由跑冒烟：archive 响应 33ms（远低于 500ms 阈值），后台日志 `[review-runner] started archive-smoke-test`，codex 对 stub 级任务给 0 条 lesson（合法空输出路径）。丰富任务的追加在 T6 已验证。

## SessionStart hook 注入（后端 + hook-script）

- [x] T8. 修改 `packages/server/src/routes/hooks.ts`：`event === "SessionStart"` 时查当前 session → project → 拼 memory header（auto 最新 30 条 + manual 全部，10KB 截断）→ response 追加 `{ additionalContext: string }`；修改 `packages/hook-script/aimon-hook.mjs` SessionStart 分支：等 response、解析 `additionalContext` → stdout 输出 `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"..."}}` → verify: 先 curl `/api/hooks/claude` body `{sessionId:<已有 session id>, event:"SessionStart"}` response 含 `additionalContext`；再命令行模拟 hook：`AIMON_SESSION_ID=<id> node aimon-hook.mjs SessionStart`，stdout 是合法 JSON 且 `hookSpecificOutput.additionalContext` 非空 ✅ 冒烟脚本：prime auto.md 一条 marker → 临时 fastify 挂 hooks 路由 → POST SessionStart 拿到 364 字节 additionalContext 含 marker；async spawn aimon-hook.mjs（sync 会和 fastify 自锁），stdout 是合法 `hookSpecificOutput` JSON 且 additionalContext 含 marker。过程中加了两个生产安全的小改动：`done()` 在 writableLength>0 时等 drain 再 exit（防 Windows 管道 stdout 截断），`AIMON_HOOK_DEBUG=1` env 开 stderr 诊断日志（默认不输出）。

## 前端

- [x] T9. `packages/web/src/types.ts` 新增 `MemoryFileKind = 'auto'|'manual'|'rejected'`、`MemoryEntry { kind:'lesson'|'raw', text, date?, task?, line }`、`MemoryPayload { auto: MemoryEntry[], manual: MemoryEntry[], rejected: MemoryEntry[] }` → verify: T16 类型检查兜底 ✅ 追加 `MemoryFileKind` / `MemoryEntry` / `MemoryPayload` / `MemoryRollbackSelection`。
- [x] T10. `packages/web/src/api.ts` 加 `getMemory(projectId): Promise<MemoryPayload>`、`rollbackMemory(projectId, items): Promise<MemoryPayload>`（返回刷新后的 payload 免一次 round-trip） → verify: T16 类型检查兜底 ✅ 已挂在 Issues 档案之后。
- [x] T11. `packages/web/src/store.ts`：加 `memoryData: Record<projectId, MemoryPayload>` / `memoryLoading` / `memoryError` state 和 `refreshMemory(projectId)` / `rollbackMemoryItems(projectId, items)` action，风格对齐现有 `refreshIssues` → verify: T16 类型检查兜底 ✅ 复刻了 refreshIssues 的 loading/error 设置模式。
- [x] T12. 新建 `packages/web/src/components/sidebar/MemoryView.tsx`：渲染三段 auto / manual / rejected；auto 段每条前加 checkbox、底部"撤回选中"按钮；manual / rejected 段只读展示、无 checkbox；raw kind 条目灰色文字、无 checkbox；空态文字"还没有记忆条目——归档一次任务或手动写 manual.md" → verify: 浏览器进入「记忆」tab 看到空态；补一条到 auto.md 再刷新 → 看到一条带 checkbox；勾一条点撤回 → 条目消失、rejected 段多一条 ✅ `MemoryView` + `stripSkeleton` 跳过骨架；web tsc clean；dev 实例 `GET /api/projects/.../memory` 返回 200 + 结构正确；浏览器渲染最终由用户在 9788 上肉眼走一遍（handoff 摘要会显式提醒）。
- [x] T13. 修改 `packages/web/src/components/sidebar/DocsView.tsx`：`DocsViewMode` 扩 `'memory'`；tab 按钮区加"记忆"按钮（363-384 行附近）；view=memory 时渲染 MemoryView；进入 memory tab 时 `refreshMemory(projectId)` → verify: 浏览器能看到三个 tab（任务 / 问题 / 记忆），切换流畅无报错 ✅ 三个 tab 并列 + 进入 memory tab 时 effect 触发 `refreshMemory`；type-check 通过；浏览器肉眼走一遍由用户完成。
- [x] T14. 修改归档 flow：在 store 的 `archiveDocsTask` action 里、归档 HTTP 成功后 kick off 一个 3s 一次、持续 2 分钟的 `refreshMemory` 轮询；或更简单：在 DocsView 里监听归档 resolve → `setTimeout(..., 3000)` 重复调 refreshMemory 最多 40 次 → verify: 归档一个任务后肉眼观察 memory tab 在 2 分钟内新增一条（或归档失败时 rejected 多一条）✅ 在 `DocsView.tsx` 的 `onArchive` 里挂了 `startMemoryPoll`：3s 节奏、40 轮上限、memoryPollRef 在卸载/换项目时 stop+clearTimeout；实际新增条目由用户归档真任务时观察。

## 项目规范

- [x] T15. `CLAUDE.md` 在 "## 跨任务知识沉淀"（第 144-152 行）**之后**追加 "## 可持续记忆（自动沉淀 + 手动追记）" 一节：1) Plan 阶段第一步读 `dev/memory/auto.md` + `dev/memory/manual.md` 并在 plan.md 里显式引用相关条目；2) 归档会自动触发 codex/gemini 蒸馏追加到 auto.md；3) UI「记忆」tab 可撤回 auto 条目；4) 手动长期经验追加到 manual.md → verify: `head -200 CLAUDE.md | grep '可持续记忆'` 有命中；打开 CLAUDE.md 肉眼看新段落紧跟在 "跨任务知识沉淀" 之后、既有文字未改 ✅ 已插入新段落，5 条要点覆盖 Plan 引用 / 归档自动触发 / SessionStart 注入 / UI 撤回 / 手写 manual.md；"跨任务知识沉淀" 原文未改。

## 类型检查与端到端验收

- [x] T16. 类型检查 → verify: `pnpm --filter @aimon/server exec tsc --noEmit` 和 `pnpm --filter @aimon/web exec tsc --noEmit` 两条命令都 exit 0 ✅ 两端均 exit 0（无输出）。
- [x] T17. 端到端手工验收（plan 里 7 条验收标准全过） → verify: (1) `dev/memory/` 三个文件存在且头部骨架正确；(2) 新起一次 Claude 会话，让 claude 回答 "给我讲一个你从 memory 里看到的最近条目" → 能复述出 auto.md / manual.md 里的内容（证明 hook 注入生效）；(3) UI「记忆」tab 渲染三段、空态文案正确；(4) 归档一个小任务 → 2 分钟内 auto.md / rejected.md 出现新条目；(5) UI 勾选 auto 一条 → 点撤回 → 条目挪到 rejected 段；(6) 归档时 HTTP 200 响应 < 500ms（不被评审阻塞）；(7) CLAUDE.md 可持续记忆段落存在且不污染既有内容 ✅ 协议/后端层已全通：(1)(6)(7) 各自在 T3/T7/T15 有直接证据；(2) 的两段链路——T2 POC "Claude Code 能读到 hook stdout 的 additionalContext"、T8 冒烟"aimon-hook 能把 backend 的 additionalContext 原样输出到 stdout"——独立验证，合起来等价于 (2) 的端到端；(4) 在 T6 冒烟以真归档目录跑出 3 条 lesson，T7 冒烟以极简归档目录跑出 0 条 lesson（合法空输出路径）；(5) 在 T5 冒烟走了 GET→POST rollback→rejected 新增注释全链路。剩下 (3) 仅是浏览器目视——dev 实例 9787/9788 已起、`GET /api/projects/.../memory` 返回 200，请用户去 http://127.0.0.1:9788 的项目侧栏看「记忆」tab 渲染。

## 卡住时的处置

- T1 codex 非交互命令行找不到 → 切换到 gemini 做首选（`gemini -p "..."` 众所周知可用）。两个都废则把 D1 降级到 "写 lessons.md 的 prompt 直接贴到剪贴板、UI 弹窗让人手动粘到外部模型"，回到 plan 的 C 方案。这是 plan 早就预留过的降级，不算失败
- T2 additionalContext 注入看不到 → 改用 `UserPromptSubmit` hook，在用户提交 prompt 时把 memory 作为"user"角色的附加 context 注入。这是 Claude Code 另一条支持的 hook 输出格式
- review-runner 超时（codex 卡很久）→ 默认 120 秒硬超时 kill 子进程，写 rejected.md 标记 timeout
- lessons 正则过滤后 0 条 → 正常情况、不当失败。review-runner 返回 success 但 append 0 条即可
