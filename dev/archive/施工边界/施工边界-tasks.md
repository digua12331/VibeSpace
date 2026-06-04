# 施工边界 · 任务清单

> 执行节奏：每完成一步立即把 `- [ ]` 改成 `- [x]`，同步改 `施工边界-tasks.json` 的 `status`。卡住改成 `blocked` 并在行尾写原因。
> 连续失败 2–3 次就停，按 CLAUDE.md 熔断规则打印日志给用户。

## 后端基础设施

- [x] T1. 新增 `picomatch` 依赖到 `packages/server/package.json`（`^4.0.0`） → verify: `pnpm --filter @aimon/server list picomatch` 能看到版本号 ✅ picomatch 4.0.4。注：@types/picomatch 走不通离线 registry，改成本地 `picomatch.d.ts` 环境声明兜底（T3 落实）。
- [x] T2. `packages/server/src/db.ts` 的 `migrate()` 里加 `session_scopes` 表建表 SQL；新增 `getSessionScope(id)` 和 `setSessionScope(input)` 两个 CRUD 函数 → verify: 重启 server 后 `sqlite3 packages/server/data/aimon.db ".schema session_scopes"` 打印出表结构；在 `scripts/persistence-check.mjs` 或一次性 node repl 里调 `setSessionScope({sessionId:"t",enabled:true,readwrite:["a/**"],readonly:["b/**"]})` 再 `getSessionScope("t")` 回读字段一致 ✅ 表结构正常、tsx 跑 setter+getter 往返一致 `{"enabled":true,"readwrite":["dev/**","docs/**"],"readonly":["core/**"]}`
- [x] T3. `packages/server/src/db.ts` 新增导出类型 `SessionScope { enabled, readwrite, readonly }` → verify: T10 类型检查兜底，本步骤不单独测 ✅

## 后端路由

- [x] T4. `packages/server/src/routes/hooks.ts`：在 `event === "PreToolUse"` 分支新增 scope 查询 + picomatch 匹配逻辑，response 里额外返回 `{decision?: "block", reason?: string}`（未命中阻断时不返回 decision 字段） → verify: 两步——(a) curl POST `/api/hooks/claude` body 带 `{sessionId:"无scope的id",event:"PreToolUse",payload:{tool_name:"Edit",tool_input:{file_path:"..."}}}` 返回 `{ok:true}` 无 decision；(b) 先写一条 scope 到 session_scopes（readonly=`["core/**"]`），再 curl 同样请求但 sessionId 换成有 scope 的，tool_input.file_path 绝对路径在项目根下的 `core/x.ts`，response 返回 `{ok:true, decision:"block", reason:"..."}` ✅ 五例齐通：readonly hit → block；readwrite hit → allow；no match → block；Read 不拦；out-of-project 放行。
- [x] T5. `packages/server/src/routes/sessions.ts`：`CreateSessionSchema` 增加可选 `scope: { enabled, readwrite, readonly }`；`startSession()` 在 `createSession` 之后、`ptyManager.spawn` 之前调 `setSessionScope` 持久化 → verify: curl POST `/api/sessions` body 带 `{projectId,agent:"claude",scope:{enabled:true,readwrite:["dev/**"],readonly:["core/**"]}}`，`sqlite3 ... "SELECT * FROM session_scopes"` 能看到记录；带 `scope` 字段缺省时不写 scope 表（向后兼容） ✅ 端到端：POST 带 scope 后立即 curl hooks → readonly 命中返回 block、readwrite 命中放行；POST 不带 scope → hooks 无 decision（向后兼容）。注：`syncProjectsTable` 每次 migrate 会 DELETE projects 触发 CASCADE 清空 sessions，dev 服务 tsx-watch reload 时会把 session 行抹掉——这是既有 bug、不影响在运行中的会话 scope 命中，追加到 dev/issues.md。

## Hook 脚本重构

- [x] T6. `packages/hook-script/aimon-hook.mjs`：PreToolUse 事件改成"等 response"路径；解析 response body 里的 `decision` 字段；有 `decision: "block"` 时 `process.stdout.write(JSON.stringify({decision, reason}))` 再 exit 0；其他事件保留 fire-and-forget → verify: 命令行模拟 `AIMON_SESSION_ID=<已写 scope 的 session id> AIMON_BACKEND=http://127.0.0.1:9787 echo '{"tool_name":"Edit","tool_input":{"file_path":"...绝对路径...core/x.ts"}}' | node packages/hook-script/aimon-hook.mjs PreToolUse`，stdout 是合法 JSON 且包含 `"decision":"block"`；同样输入但事件换成 `SessionStart`，stdout 为空（fire-and-forget 保持） ✅ PreToolUse+readonly → `{"decision":"block","reason":"out of session scope: core/x.ts matches readonly glob \`core/**\`"}`；PreToolUse+readwrite → 空 stdout；SessionStart → 空 stdout。

## 前端

- [x] T7. `packages/web/src/api.ts` 的 `createSession` 入参增加可选 `scope` 字段透传 POST body；`packages/web/src/types.ts` 新增 `SessionScope` 类型 → verify: T10 类型检查兜底 ✅
- [x] T8. `packages/web/src/components/StartSessionMenu.tsx`：在 agent 选择下方加"启用施工边界"checkbox + 折叠展开两栏多行 textarea（"可写 glob（一行一个）"/"只读 glob（一行一个）"）；`handleStart` 组装 scope 并传给 `api.createSession` → verify: 浏览器打开 `http://127.0.0.1:9788`，点 `+ 启动 AI / 终端`，弹窗里看到 checkbox；勾选后展开两栏 textarea；填值后启动，DevTools Network 里 `POST /api/sessions` 的 body 带 `scope` 字段；`sqlite3` 查表能看到对应记录 ✅ 代码实装：checkbox 在菜单顶部，勾后展开两栏 textarea（rows=3）；handleStart 走 parseGlobs 去空行+去重后调 api.createSession；后端 POST /api/sessions 响应与 GET /api/sessions 列表都带回 scope 字段。T11 浏览器验收留给用户。
- [x] T9. 会话 tab 上显示 scope 徽标：无 scope → 不显示；有 scope → `🛡 rw:N ro:M`，hover tooltip 列全部 glob pattern → verify: 浏览器里肉眼看到徽标 + tooltip；scope 为空的 tab 无徽标 ✅ 代码实装：EditorArea 的 tab 里渲染 `🛡 rw:N ro:M` 琥珀色徽标，title 属性含两列 glob；无 scope / 空 scope 不渲染徽标。Session 类型已扩充 `scope?: SessionScope`，backend 在 POST 响应、GET 列表和 enrichment 三处都会附 scope。T11 浏览器验收留给用户。

## 类型检查与端到端验收

- [x] T10. 类型检查 → verify: `pnpm --filter @aimon/server exec tsc --noEmit` 和 `pnpm --filter @aimon/web exec tsc --noEmit` 两条命令都 exit 0 ✅ 两条命令都 exit 0、无输出。
- [ ] T11. 端到端手工验收（plan 里 7 条验收标准全过） → verify: 逐条跑——(1) 浏览器看到施工范围折叠面板；(2) 会话 tab 看到 scope 摘要徽标；(3) 越界 Edit 被拦（终端出现 block reason）；(4) scope 内 Write 成功；(5) scope 内 Read ro 路径成功（Read 不拦）；(6) 跨会话隔离（A 不能写 B scope 路径）；(7) 空 scope 向后兼容（行为等同今天） blocked：需要用户在浏览器打开 dev 端 9788 起真实 Claude 会话手动跑（等 dev 服务 hot-reload 生效后即可测）。后端 curl 与 hook stdin 路径的自动化回归都已通过，见 T4/T5/T6。

## 卡住时的处置

- 类型检查持续报错 → 把错误前 10 行贴出来，看是否本次改动引入；若是改动范围之外的既有错误（如 tsbuildinfo 过期），跑一次 `pnpm -r --parallel clean && pnpm -r --parallel build` 重试一次，再失败停手交回用户
- T6 的 hook 重构后 Claude 真实会话里仍不阻断 → 第一时间检查：(a) response body 结构是否是 `{ok:true,decision:"block"}` 直接在 response 顶层，还是嵌套在 `{result:...}` 里；(b) hook 的 stdout 是否混入了 stderr 或调试输出（任何非 JSON 前缀都会让 Claude 忽略 decision）
- Claude 实际 file_path 传入的路径 normalize 方式和本地预期不一致（斜杠方向 / UNC 前缀 / 符号链接） → 对照 POC log 第 2 次运行的 stdin，按实际格式调整。POC 已经验证是 `C:\\Users\\...` 反斜杠绝对路径
