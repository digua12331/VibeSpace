# browser-use 按需注入 · context

## 关键文件

- `packages/server/src/mcp-bridge.ts`
  - `injectMcpForAgent(agent, projectPath, sessionId, projectId)` (L68)：会话启动入口，被 `sessions.ts:510` 调。hub→injectHubMcps；claude→injectClaude；codex→injectCodex。
  - `injectClaude(...)` (L106)：当前默认注入（除非 disabled）。**改造对象**——抽出写入逻辑、移除自动注入。仅被 injectMcpForAgent 调（已 grep 确认，dist/ 是产物不算）。
  - `removeFromMcpJson(projectPath, name)` (L245, 已 export)：toggle OFF 复用，不动。
  - `DESIRED_ENTRY` (L39)、`deepEqualEntry` (L284)、`MCP_KEY="browser-use"` (L30)：复用。
  - `injectHubMcps` / `injectCodex`：**不动**（非目标）。
- `packages/server/src/routes/mcp-servers.ts`
  - `buildList(globalMcp, projectMcp, disabled)` (L82)：**加合成条目**——browser-use 不在两处来源时，补一条 enabled=false 项目级行。
  - `PUT /api/mcp-servers/toggle` (L156)：enabled=true 时**新增主动写入** browser-use（调 mcp-bridge 新 export 函数）+ 现有 disabled 清除；补 ON 失败日志。
- `packages/server/src/cli-catalog.ts`：browser-use 条目 (id/label/kind=mcp-tool)，buildList 合成时取 label/描述来源（也可直接硬编码 name）。
- `packages/web/src/components/sidebar/SkillsView.tsx`：`McpServersSection` (L1734) 渲染列表 + 开关，**预计不用改**（它照 list 渲染；合成行让它自然显示 browser-use OFF）。需确认前端对 enabled=false 行的开关交互正常。
- `.mcp.json`（仓库根，git 已提交）：移除 browser-use（大哥拍板"一起清掉"）。
- `dev/memory/manual.md`：追加 browser-tester 衔接约定。

## 决策记录

- **真源用 `.mcp.json` 存在性，不引入新状态文件**：Claude Code 本就以 `<project>/.mcp.json` 为项目级 MCP 入口；"在不在里面"天然就是开/关。再造一个 enabled 列表是重复状态、过度设计。toggle 负责增删该文件即可。
- **自动注入整段去掉，不改成"条件注入"**：若 injectClaude 改成"只在已启用时注入"，而"已启用"又靠读 .mcp.json 判断，是自我循环。最干净是：mcp-bridge 不再自动写，toggle 成为唯一写入方，Claude Code 自己读盘加载。
- **injectClaude 重构而非纯删**：把它的幂等写入主体抽成 `writeBrowserUseToMcpJson(projectPath, ...)` 并 export 给 toggle 用；外层带 disable-skip 的 wrapper 连同 injectMcpForAgent 的 claude 分支一起移除。这样不留孤儿、也不凭空删 130 行。
- **不碰 codex**：codex 配置全局，项目级 opt-in 无落点，且非痛点。保持 injectCodex 现状（codex 会话仍自动带 browser-use）。资深工程师视角：本轮只解 Claude 痛点，范围最小。
- **不动前端 McpServersSection**：它是纯渲染 + 调 toggle API；后端把合成行喂进 list 就够，避免改 UI 扩大面。若实测开关对"当前不在盘上的行"行为异常再回来补。

## 依赖与约束

- `~/.claude.json` 的 `disabledMcpServers`（per-project，路径键）：历史遗留项目可能有 browser-use；toggle ON 要顺手清它，否则写了 .mcp.json 仍被 Claude Code 禁用。
- 幂等/原子写：沿用现有 tmp+rename；`deepEqualEntry` 防重复写。
- best-effort：会话启动注入失败不阻塞 spawn（现有契约，保持）。
- 类型检查命令：`pnpm --filter @aimon/server build`（tsc -p，本仓库无独立 typecheck 脚本）。
- grandfather：停自动注入只防新写；老项目 .mcp.json 里已有的仍加载，需手动 OFF——预期行为，写进 plan 边界。
- 验"未注入"要用**干净项目**（AIkanban 自身 .mcp.json 清掉后也可验，但建议另起干净项目避免历史干扰）。
