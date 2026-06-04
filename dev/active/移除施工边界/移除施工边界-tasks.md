# 移除施工边界 · 任务清单

## A. 前端清理

- [x] 1. `packages/web/src/types.ts` 删 `SessionScope` interface（L86）+ `Session.scope?` 字段（L105-106） → verify: `Grep "SessionScope" packages/web/src/types.ts` 无结果；保留三处 `scope: string`（日志条目，L167/L183/L205）
- [x] 2. `packages/web/src/api.ts` 删 import 里 `SessionScope`（L39）+ `createSession` 入参 `scope?` 字段（L165） → verify: `Grep "SessionScope" packages/web/src/api.ts` 无结果
- [x] 3. `packages/web/src/components/StartSessionMenu.tsx` 全删施工边界相关：import / `parseGlobs` / state（`scopeEnabled`/`rwText`/`roText`） / `start()` 里 scope 构造 + createSession 实参 + enriched 兜底 + logAction meta 的 `scoped` / JSX 的 `🛡 启用施工边界` checkbox + 两 textarea（保留 `🌿 工作区隔离` 外层容器） → verify: `Grep "scope|施工边界" packages/web/src/components/StartSessionMenu.tsx` 无结果（剩 `scope: 'installer'` 是日志分类）
- [x] 4. `packages/web/src/components/editor/EditorArea.tsx` 删 `scopeBadge` 函数 + 渲染时调用的 IIFE 块 → verify: `Grep "scopeBadge|session.scope" packages/web/src/components/editor/EditorArea.tsx` 无结果
- [x] 5. `pnpm -F @aimon/web build` → verify: ✅ 退出码 0

## B. 后端清理

- [x] 6. `packages/server/src/routes/hooks.ts` 删 picomatch import / `getSessionScope` import / `relative+isAbsolute+resolve` import / `WRITE_TOOLS` / `ScopeDecision` / `toRelPosix` / `evaluateScope` / `extractToolFilePath` / `PreToolUsePayload` / `checkScopeForPreToolUse` / **仅 PreToolUse 分支里的 scope 检查段（含 `kind:"scope_block"` 事件写入），保留 subagent 注册段与 PostToolUse 分支** → verify: ✅ Grep 无结果
- [x] 7. `packages/server/src/routes/sessions.ts` 删 db.js import 里 `getSessionScope`/`setSessionScope`/`SessionScope` / `GlobListSchema` / `ScopeSchema` / `ScopeInput` / `CreateSessionSchema.scope` / `WireSession.scope` / `serialize` 简化签名 / `attachScope` 函数 + 替换调用为 `serialize` / PATCH task 响应改写 / `startSession` 签名删 `scope?` / "Persist scope before spawn" 段 / POST 响应里 `serialize(..., scope ? {...})` 改写 / POST 调用 `startSession` 不再透传 scope → verify: ✅ Grep 无结果
- [x] 8. `packages/server/src/db.ts` 删 `migrate()` 里 `CREATE TABLE session_scopes` / `SessionScope` interface / `SessionScopeRow` interface / `getSessionScope` / `setSessionScope` → verify: ✅ Grep 无结果
- [x] 9. `pnpm -F @aimon/server build` → verify: ✅ 退出码 0

## C. 依赖与类型声明清理

- [x] 10. 删除 `packages/server/src/types/picomatch.d.ts` → verify: ✅ 文件不存在
- [x] 11. `packages/server/package.json` 删 `"picomatch": "^4.0.0"` → verify: ✅ grep 无结果
- [x] 12. 根目录 `pnpm install` 同步 lockfile → verify: ✅ packages/server: 块里已无 picomatch direct dep（transitive 不管）

## D. 全量回归

- [ ] 13. 浏览器手测 1：刷新前端，▶ 启动菜单只剩 `🌿 工作区隔离` 一行 checkbox，无 `🛡 启用施工边界` + 无两个 textarea → verify: 大哥去浏览器点 ▶ 启动按钮看一眼
- [ ] 14. 浏览器手测 2：session tab 上无 `🛡 rw:N ro:N` 琥珀色徽标（哪怕是老数据库里曾经配过 scope 的 session） → verify: 大哥扫一眼现存所有 session 的 tab
- [x] 15. POST `/api/hooks/claude` PreToolUse + Edit + 任意 file_path → verify: ✅ response `{"ok":true}` 无 `decision:"block"`（已 curl 自测通过）
- [ ] 16. 浏览器手测 4：起一个新 session，LogsView 看到 `scope=session action=start` 的 info 起 + info 终（"成功 (Nms)"），meta 不再有 `scoped` 字段，只剩 `agent`+`isolation` → verify: 大哥新起一个 session 后展开 LogsView meta
- [ ] 17. 输出 handoff 摘要 → verify: 摘要 ≤ 10 行，覆盖改动文件、验证方式、遗留 TODO
