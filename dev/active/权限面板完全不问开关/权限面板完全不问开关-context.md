# 权限面板完全不问开关 · Context

## 关键文件

- `scripts/lib/cli-configs-core.mjs` — `writeClaudeLocal`（L244-291，加 defaultMode 参数；`next.permissions` 组装处理三态）。`readClaudeLocal`（L82-95）已返回完整解析对象，defaultMode 可直接从 `permissions.defaultMode` 读，core 读取侧无需改。
- `packages/server/src/routes/cli-configs.ts` — CoreLib 接口（L39-50）、GET handler（L115-150）、SaveSchema（L66-84）、PUT handler（L153-180）；补 `serverLog` import（`../log-bus.js`）。
- `packages/web/src/types.ts` — `CliConfigState`（L439-454）、`CliConfigSavePayload`（L589-597）。
- `packages/web/src/components/PermissionsDrawer.tsx` — 状态初始化（L82-100）、onSave（L193-217）、ClaudeTab（L412-568，顶部加开关块，props 透传）。
- `packages/web/src/api.ts` 不动（payload 类型来自 types.ts）。

## 决策记录

- defaultMode 语义三态：`undefined`=不动（旧调用方兼容）、`null`=删字段、`'bypassPermissions'`=写入。只支持这一个值，不做 plan/acceptEdits 全枚举——用户没要，避免过度设计。
- UI 用独立开关块而不是塞进预设芯片：bypassPermissions 不是白名单条目，混进 selections 会污染 diff/写入逻辑；独立字段链路最短。
- 开关接管 defaultMode 字段：保存时按开关状态写/删。用户手写过其他 defaultMode 值的场景视为面板接管，不做合并保留——只用一次的兼容分支不写。
- `writeClaudeLocal` 引用图：仅 `packages/server/src/routes/cli-configs.ts:166` 一处调用；加可选参数向后兼容，不触发破坏性变更协议实质。PUT body schema 加可选字段同理。
- 保存路由原本无任何日志，本次补 serverLog 起止配对（规则要求 mutation 路由可回放）；前端 onSave 原本裸调 api，包 logAction('project','save-cli-config')，meta 带 defaultMode。
- 全局 `~/.claude/settings.json` 已有 `skipDangerousModePermissionPrompt: true`，bypass 会话启动时不会再弹"危险模式"二次确认，开关体验是真零弹窗。

## 依赖与约束

- Claude Code 官方 settings 支持 `permissions.defaultMode: "bypassPermissions"`（settings.local.json 层级有效）；managed 层未设 disableBypassPermissionsMode，无拦截。
- 隔离会话继承：sessions.ts L455-475 已把项目 settings.local.json 拷进 worktree，defaultMode 随文件继承，无需改。
- 类型检查命令：`pnpm -F @aimon/server build`、`pnpm -F @aimon/web build`（web 无独立 typecheck script，见 auto.md 既有条目）。
- stable 部署是编译产物，本次源码改动需走 sync-to-stable 构建流程才对大哥日常实例生效——不在本任务内擅自执行，handoff 指引。
