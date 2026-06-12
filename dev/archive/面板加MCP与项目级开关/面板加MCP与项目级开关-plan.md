# 面板加MCP与项目级开关 · Plan

## 大哥摘要

这次给左侧「技能」面板加三块新开关：① 新增「MCP servers」区，列出 browser-use / codegraph 这些"Claude 用的外部小服务"（MCP server）并能挨个关掉；② 「全局插件」每行从单个开关换成三档按钮——跟随全局 / 在本项目强制开 / 在本项目强制关，这样 webnovel-writer 这种插件能只对小说项目启用；③「全局技能」每行同样三档按钮。
点法：开 VibeSpace → 左侧「技能」面板 → 能看到这三处新东西；关掉某个 MCP 后**重启** Claude 终端就立刻省内存（每个约 100-300 MB），关掉的设置不影响别的项目。
不会动：你的项目源码、小说稿子、已有的 Claude 历史会话、其它正活着的 Claude 终端（这些要等你手动重启才生效）。

## 目标

1. 「技能」面板新出现「MCP servers」区，能看到 browser-use、codegraph 等来源于全局和项目配置的 MCP server（给 Claude 接外部工具的小服务），每行都有一个开关。
2. 关闭 browser-use 后，重启 Claude 终端时 `<proj>/.mcp.json` 会被反向移除 browser-use 条目；LogsView（操作日志面板）能看到 `scope=installer action=skip-mcp-browseruse` 的开始和结束两条日志。
3. 「全局插件」每行改成三档按钮条：跟随全局、项目强制开、项目强制关；验证 webnovel-writer 全局关、小说项目强制开后，新开 Claude 能加载该插件，其它项目不加载，可用 `claude --print '/plugins'` 或 LogsView 的 meta（日志附带信息）验收。
4. 「全局技能」每行同样改成三档按钮条，并用同样方式验证项目强制开/关是否生效。
5. 所有会改配置的操作都有起止配对日志，LogsView 能看到 `scope=claude-settings`、`scope=project-claude-settings`、`scope=mcp-toggle`、`scope=installer` 的对应记录，日志同时落盘到 `packages/server/data/logs/<YYYY-MM-DD>.log`。
6. 故意传非法 `projectId` 或非法三态值时，后端返回 400/500，并且 LogsView 出现 ERROR（错误）日志；这些失败分支需要人工触发验证过。

## 非目标 (Non-Goals)

本期不支持 hub-workspace（VibeSpace 的"总控台"虚拟项目）的项目级 MCP 控制，因为 `~/.claude.json` 需要真实绝对路径，hub 当前是 `__hub__` 这类虚拟项目 ID。
本期不做 Codex agent 的项目级 MCP 禁用；现有 Codex 写入 `~/.codex/config.toml`，是跨项目共享配置。
本期不提供单独的“清理 .mcp.json”按钮或独立清理通道，反向清理只在关闭 MCP 或下次注入 Claude 时自动发生。

## 实施步骤

1. 扩展后端项目级 Claude settings（Claude 配置文件）读写能力：新增只操作 `<projectPath>/.claude/settings.json` 的 `GET/PUT /api/project-claude-settings?projectId`，保留 `_doc` 等用户已有字段，损坏 JSON 返回 `parseError`。验证：正常项目能读写 `enabledPlugins` 和 `skillOverrides`，非法 `projectId` 返回错误并有 ERROR 日志。
2. 新增 MCP server 状态接口：`GET /api/mcp-servers?projectId` 汇总 `~/.claude.json.mcpServers` 和 `<projectPath>/.mcp.json.mcpServers`，`PUT /api/mcp-servers/toggle` 只修改 `~/.claude.json.projects.<absPath>.disabledMcpServers` 并按需清理 `<proj>/.mcp.json`。验证：关/开 browser-use 后配置文件变化正确，且不会误删其它 MCP 条目。
3. 改造 `mcp-bridge.ts` 的 `injectClaude`：写 `<proj>/.mcp.json` 前检查 `disabledMcpServers`，命中则跳过写入并调用 `removeFromMcpJson(projectPath, mcpName)` 反向移除已有条目。验证：browser-use 禁用后重启 Claude 不再写回，并出现 `installer skip-mcp-browseruse` 起止日志。
4. 更新前端 API/types（前端请求类型）：补齐项目级 settings 和 MCP servers 的请求、响应类型，并让现有全局 settings API 继续保持行为不变。验证：TypeScript 类型检查（项目层面的代码检查）通过，原全局开关不回退。
5. 改造 `SkillsView.tsx`：增加「MCP servers」区；把「全局插件」「全局技能」每行的现有开关改成行级三档按钮条，不用弹气泡；所有会改配置的前端操作用 `logAction(scope, action, fn, ctx)` 包起来。验证：浏览器里三档状态显示正确、点击后刷新仍保持，LogsView 有起止配对。
6. 补测试与手工验收：覆盖合法/非法路由、损坏 settings.json、Windows 路径键匹配、MCP 反向移除、三态覆盖；交付前自派 `vibespace-browser-tester` 跑浏览器验收清单。验证：测试命令、类型检查、浏览器验收 PASS，并人工触发至少一次 ERROR 日志。

## 边界情况

- `~/.claude.json` 是 Claude Code 也会写的活文件，patch（局部修改）前必须重新读取，写入使用 tmp+rename 原子写（先写临时文件再改名替换，避免半写状态）避免并发时写坏文件。
- Windows 路径大小写不能随意归一化；优先匹配 `~/.claude.json.projects` 里已经存在的 key，找不到才用当前项目绝对路径新建。
- worktree-isolated 会话（git 的临时副本会话）必须用当前会话实际项目路径做 key，不能误写父项目的 disabledMcpServers。
- 多个 alive session（正在运行的会话）同时开关时按 last-write-wins（最后一次写入生效）处理；实现上至少保证不写坏 JSON，是否需要 CAS（写前比对版本号，类似乐观锁）本期只评估不扩大。
- `<proj>/.claude/settings.json` 不存在时按空对象处理；文件损坏时返回 `parseError`（解析错误提示），patch 时不能破坏 `_doc`（项目里自描述配置层级的注释字段）或其它用户已有字段。
- 反向清理 `<proj>/.mcp.json` 只移除当前被禁用的 MCP 名称，不能删除用户手工加的其它 server。
- 项目强制开插件但全局未启用的场景必须验收：webnovel-writer 全局关、小说项目强制开，新会话能加载才算通过。
- 非法 `projectId`、非法三态值、非法 MCP 名称、无权限写配置文件，都要返回明确错误并记录 ERROR 日志。

## 风险与注意

- 本任务一次覆盖 MCP、plugin、skill 三块，范围比拆 PR 更大；但大哥明确要求一步到位，所以作为单次交付处理，靠任务清单、白名单和浏览器验收控制风险。
- 路由按配置文件所有者分组，避免把 `~/.claude.json` 的 MCP 状态和 `<proj>/.claude/settings.json` 的 plugin/skill 覆盖混在同一路由里。
- `mcp-bridge.ts` 现有 codex agent 写 `~/.codex/config.toml`，项目级 MCP 禁用不影响 Codex，这是本期明确边界。
- 操作日志是硬要求：新增 mutation（会改配置的接口）必须有后端 `serverLog` 起止配对，前端点击必须有 `logAction` 起止配对，失败分支也要能在 LogsView 看到。
- 需要特别保护用户手写配置：`settings.json` 的 `_doc`、未知字段、注释外的 JSON 字段都不能被覆盖丢失；`~/.claude.json` 也只能 patch 目标项目的 `disabledMcpServers`。
- 交付前必须跑项目级类型检查、相关测试和浏览器验收；UI 改动必须有浏览器里能看到、能点出来的验收记录。

## 多模型 Plan 会审

> [Codex 评审] 路由应按配置文件所有者分组，MCP 禁用状态不要和项目级 plugin/skill overrides 混进同一路由；三态 UI 用行级按钮条更简单；MCP 反向移除放进 injectClaude helper。
> [Codex 综合主笔] 采纳路由分组、行级三档按钮条、removeFromMcpJson helper 和边界场景补充；不采纳“拆两个 PR”，因为大哥明确要求一次性拿到完整能力，只在风险段记录范围偏大的风险并用验收兜住。
> [Claude 白话化兜底] 重写大哥摘要为三行白话（做什么/在哪点/不会动什么）；给 hub-workspace、patch、tmp+rename 原子写、parseError、_doc、CAS 这些术语加括号白话翻译；核对 manual.md 偏好——2026-05-06"交付前自派 vibespace-browser-tester"已在实施步骤 6 体现，2026-04-30"只问大方向不问技术分叉"已遵守，2026-04-24"小功能直接改"不适用（本任务是默认档）。
