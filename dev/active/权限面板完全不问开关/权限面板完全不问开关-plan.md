# 权限面板完全不问开关 · Plan

## 大哥摘要

给权限面板加一个"⛔ 完全不问"开关：打开它并保存后，这个项目里新开的 Claude 会话**任何确认弹窗都不再出现**——背后写入的是 Claude 官方的 bypassPermissions（跳过权限确认模式）。代价是删文件、推代码这类危险操作也不会再问你，所以开关旁边会放红色警示，默认关闭。做完后你去：设置 → 🛡权限 → Claude 页签最上方就能看到这个开关；打开 → 保存 → 重启会话即生效。不动你现有的白名单配置（关掉开关就恢复原来的白名单行为）。

## 目标

- 权限面板 Claude 页签顶部新增"完全不问"开关，状态读写项目 `.claude/settings.local.json` 的 `permissions.defaultMode`（开 = `"bypassPermissions"`，关 = 删除该字段）。
- 验收标准：
  1. `pnpm -F @aimon/server build` 与 `pnpm -F @aimon/web build` 通过（类型检查）。
  2. 浏览器可观察：设置→权限→Claude 页签顶部出现"⛔ 完全不问"开关；打开并保存后，项目 `.claude/settings.local.json` 出现 `"defaultMode": "bypassPermissions"`；关闭并保存后该字段消失；重开面板时开关状态与文件一致。
  3. UI 日志面板看到 `scope=project action=save-cli-config` 起止配对（保存动作补上 logAction 包装）；后端日志有保存起止条目。
  4. 失败分支：对不存在的项目 id 调保存接口返回 404（curl 验证），前端 logAction 留 ERROR 条目（断后端场景大哥无需复现，由 curl 代替验证后端校验路径）。

## 非目标

- 不动 Codex 页签（Codex 已有自己的"⚡不受限"预设）。
- 不改会话启动链路——隔离会话已会拷贝 settings.local.json，开关随文件自然继承。
- 不清理/重排现有白名单条目。

## 实施步骤

1. core（`scripts/lib/cli-configs-core.mjs`）：`writeClaudeLocal` 加第 5 个可选参数 `defaultMode`（`'bypassPermissions' | null | undefined`；undefined=不动，null=删除，字符串=写入）。→ verify: node 冒烟（临时目录写/读/删三态）。
2. server（`packages/server/src/routes/cli-configs.ts`）：GET 返回 `claude.defaultMode`；SaveSchema 加可选 `defaultMode`；PUT 透传给 core；保存路由补 serverLog 起止配对。→ verify: server build 通过。
3. web 类型（`packages/web/src/types.ts`）：`CliConfigState.claude` 与 `CliConfigSavePayload.claude` 加 `defaultMode`。→ verify: web build 通过（与步骤 4 合并跑）。
4. web UI（`packages/web/src/components/PermissionsDrawer.tsx`）：Claude 页签顶部开关块（开启时红色警示文案）；onSave 带 defaultMode 并用 logAction 包装。→ verify: web build 通过。
5. 端到端冒烟：起本地 server，curl GET/PUT 验证 defaultMode 读写与 404 分支。→ verify: curl 输出符合预期。

## 边界情况

- settings.local.json 已被用户手写了 `defaultMode: "plan"` 等其他值：UI 开关只认 `bypassPermissions`；其他值显示为"关"，保存时若开关未被用户碰过则按当前开关状态写（关=删字段）——会覆盖手写值，属面板"接管 defaultMode 字段"的预期行为，警示文案注明。
- 文件不存在/解析失败：readClaudeLocal 已兜底返回空结构，开关显示为关。
- 旧版前端调新版后端（或反之）：defaultMode 是可选字段，双向兼容。

## 风险与注意

- bypassPermissions 是真"全放行"，UI 必须红色警示并默认关闭。
- `writeClaudeLocal` 加参与 PUT schema 加字段均为向后兼容加法；调用方引用图已 grep（仅 routes/cli-configs.ts 一处），不构成破坏性变更。
- 大哥日常跑 stable 实例：本次是源码改动，stable 要重新构建同步才能看到（handoff 给指引，不擅自重启他正在用的服务）。
- memory 扫过：auto.md 有"web 无独立 typecheck 用 `pnpm -F @aimon/web build` 验收"条目，采用；manual.md 无相关条目。

## 多模型 Plan 会审

跳过：方向由大哥上一轮明确拍板（"添加一个什么都不问的权限选项"），改动为既有面板的单一开关扩展、全部向后兼容、易回滚，按小档处理不调外部模型。
