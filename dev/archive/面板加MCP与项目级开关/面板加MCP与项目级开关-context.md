# 面板加MCP与项目级开关 · Context

## 关键文件（本次改动的边界）

### 后端（packages/server/src/）

| 文件 | 操作 | 相关符号/行号 |
|---|---|---|
| `claude-settings.ts` | **改**（扩 scope 参数） | `claudeDir()` `settingsPath()` 第 5-11；`ClaudeSettingsRead` `ClaudeSettingsPatch` 第 13-29；`readClaudeSettings()` 第 35-58；`patchClaudeSettings()` 第 70-118 |
| `routes/claude-settings.ts` | **读**（保持现状参考模板） | `registerClaudeSettingsRoutes` 第 51-120；zod schema 第 11-26；`summarize` 第 28-49 |
| `routes/project-claude-settings.ts` | **新建** | `GET/PUT /api/project-claude-settings?projectId` 投影 `<proj>/.claude/settings.json` 的 `enabledPlugins` + `skillOverrides` |
| `routes/mcp-servers.ts` | **新建** | `GET /api/mcp-servers?projectId` 汇总全局 + 项目 MCP；`PUT /api/mcp-servers/toggle` 写 `~/.claude.json.projects.<absPath>.disabledMcpServers` + 调 `removeFromMcpJson` |
| `mcp-bridge.ts` | **改**（注入受控 + 抽 helper） | `MCP_KEY` 第 29；`DESIRED_ENTRY` 第 38-42；`injectClaude` 第 105-179；新增 `removeFromMcpJson(projectPath, mcpName)` + `isDisabledForProject(projectPath, mcpName)` |
| `claude-json-service.ts` | **新建** | `readClaudeJson()` `getDisabledMcpServersForProject(absPath)` `setDisabledMcpServersForProject(absPath, names)`；原子写 `~/.claude.json` + re-read 防 race；路径键大小写不敏感匹配 |
| `index.ts` | **改**（注册新路由） | 第 146-167 顺序注册区，加 `registerProjectClaudeSettingsRoutes` + `registerMcpServersRoutes` |
| `log-bus.ts` | **读** | `serverLog(level, scope, msg, extra?)` 第 84 |
| `db.ts` | **读** | `getProject(id)` 返回 `{ id, path, name }` |

### 前端（packages/web/src/）

| 文件 | 操作 | 相关符号/行号 |
|---|---|---|
| `components/sidebar/SkillsView.tsx` | **大改** | `onToggleSkill` 第 143-156；`onTogglePlugin` 第 174-187；`PluginsSection` 第 1406-1468；`SkillSection` 第 895-979；新增 `McpServersSection` + 给现有插件/技能行增加三档按钮条 |
| `api.ts` | **改**（加新客户端） | 现有 `getClaudeSettings` 第 1085-1087、`patchClaudeSettings` 第 1089-1094；新增 `getProjectClaudeSettings(pid)` `patchProjectClaudeSettings(pid, patch)` `listMcpServers(pid)` `toggleMcpServer(pid, name, enabled)` |
| `types.ts` | **改**（加项目级 + MCP 类型） | 现有 `ClaudeGlobalSettings` 第 991-997、`ClaudeSettingsPatch` 第 1005-1008；新增 `ProjectClaudeSettings` `McpServerEntry { name, scope, enabled, command, args }` `McpServerListResult` `PluginOverrideState = 'inherit' \| 'force-on' \| 'force-off'` |
| `logs.ts` | **读** | `logAction(scope, action, fn, ctx?)` 第 54 |

## 决策记录

### D1：路由按"配置文件所有者"分组（采纳 Codex 评审 ①）
- `/api/project-claude-settings`：只动 `<proj>/.claude/settings.json`
- `/api/mcp-servers`：动 `~/.claude.json.projects.<abs>.disabledMcpServers` + `<proj>/.mcp.json`
- **拒绝**合并成 `/api/project-claude-config` 大路由——两边配置文件不同 owner，混路由让并发与权限边界模糊
- 过度设计自查：4 条路由不算多，每条职责单一。**通过**

### D2：行级三档按钮条（采纳 Codex 评审 ③）
- "跟随全局 / 项目强制开 / 项目强制关" 三个按钮排同一行，当前态高亮
- **拒绝** ⚙ 弹气泡——藏起来增加交互成本，密度问题不是逻辑问题
- 过度设计自查：三档是 webnovel-writer "全局关 + 小说项目开" 核心场景必需。**通过**

### D3：反向移除 .mcp.json 抽 helper 在 injectClaude 内部调用（采纳 Codex 评审 ②）
- `removeFromMcpJson(projectPath, mcpName)` 是小 helper，由 `injectClaude` 在"check disabled → skip"分支调用，**也**由 `PUT /api/mcp-servers/toggle` 关闭时调用
- **拒绝**独立用户触发清理通道——时序不一致风险
- 过度设计自查：关 MCP 必须清残留条目否则等于没关。**通过**

### D4：disabledMcpServers 写 `~/.claude.json` 项目段，不引入 VibeSpace SQLite 表
- 这是 Claude Code 官方机制；未来 `claude mcp disable` CLI 实现后兼容
- **拒绝**自建 source of truth——多一个数据源就多一份同步成本
- 过度设计自查：复用官方机制。**通过**

### D5：Windows 路径键匹配——按现有 `~/.claude.json.projects` key 匹配，找不到才新建
- 算法：先大小写敏感精确匹配；不中再大小写不敏感匹配；都不中按当前项目绝对路径新建
- **拒绝**强行归一化所有路径——会和 Claude Code 自己写入的 key 冲突
- 过度设计自查：稳妥兜底，避免重复 key。**通过**

### D6：现有 `/api/claude-settings` 全局路由签名不变
- 不重构成 scope 参数路由——避免破坏前端现有调用
- 新路由独立加，旧路由保持
- 过度设计自查：保持兼容比"统一抽象"重要。**通过**

### D7：不派 `vibespace-route-author` 子代理
- 工作量适中（2 个新路由 + 1 个新 service + 改 mcp-bridge + 改 SkillsView），混合任务主代理执行更省 token
- 子代理派工对"纯新增单一路由"更高效
- 过度设计自查：派工不是越多越好。**通过**

### D8：操作日志 scope 命名
- 新增三个 scope：`project-claude-settings`（项目级 settings 读写）、`mcp-toggle`（MCP 开关写入 `~/.claude.json`）、复用 `installer`（mcp-bridge 注入/反向移除）
- action 用动词：`patch` `toggle` `skip` `remove-from-mcp-json`

## 依赖与约束

- **Claude Code 官方契约**：
  - settings.json 分层 Managed > Local > Project (`<proj>/.claude/settings.json`) > User (`~/.claude/settings.json`)，`enabledPlugins` / `skillOverrides` 项目级可逐条覆盖
  - `~/.claude.json.projects.<absPath>.disabledMcpServers` 是字符串数组；Claude Code 启动时按 key 匹配项目路径决定是否禁用 mcpServers 里的对应 server
  - `<proj>/.mcp.json.mcpServers` 与 `~/.claude.json.mcpServers` 都参与"该项目可见 MCP server 总集"——全部受 disabledMcpServers 数组过滤

- **数据结构契约**：
  - `getProject(id)` 返回 `{ id, path, name }`，`path` 是绝对路径字符串
  - `~/.claude.json` 顶层结构示例：`{ mcpServers: {...}, projects: { "<absPath>": { mcpServers, disabledMcpServers, ... } } }`
  - 项目级 `.claude/settings.json` 顶层可能有 `_doc`、`permissions`、`enabledPlugins`、`skillOverrides`、`hooks` 等键——只 patch 目标键，保留其它

- **兼容性**：
  - 现有 `/api/claude-settings` 路由不动
  - 现有 SkillsView 全局 skill toggle + 全局 plugin toggle 行为不变（仅展示形态变三档）
  - 现有 `mcp-bridge.ts:injectClaude` 对未禁用 MCP 的项目行为完全不变（idempotent 写入）

- **平台**：
  - 服务端运行 Windows（开发机），路径分隔符混用（`/` 和 `\` 都可能出现在 `~/.claude.json` 的 key 里）—— D5 算法兜底
  - 文件 IO 全用 Node fs/promises + tmp+rename 原子写
