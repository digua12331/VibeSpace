# browser-use 按需注入 · 任务清单

- [x] 步骤 1 抽出 `writeBrowserUseToMcpJson(projectPath)` 并 export；移除 mcp-bridge 的 claude 自动注入（injectMcpForAgent 不再调 injectClaude，删旧 wrapper） → verify: `pnpm --filter @aimon/server build` 通过；grep 确认 src 内无残留 injectClaude 引用、injectHubMcps/injectCodex 未改
- [x] 步骤 2 toggle ON(browser-use) 主动写入 + 清 disabled + 补 ON 失败日志 → verify: tsc 通过；读代码确认 enabled=true 分支调 writeBrowserUseToMcpJson 且 try/catch 走 serverLog error
- [x] 步骤 3 buildList 合成 browser-use OFF 行（去重 / 防 .mcp.json 损坏崩 / 同时在 disabled+.mcp.json 渲染 OFF） → verify: tsc 通过；干净项目 GET /api/mcp-servers 返回含一条 name=browser-use enabled=false 的项目级行
- [x] 步骤 4 移除仓库根 .mcp.json 里的 browser-use（大哥拍板） → verify: `cat .mcp.json` 不再含 browser-use；git diff 仅此一处
- [x] 步骤 5 manual.md 追加 browser-tester 衔接约定（默认关后不许静默跳过浏览器验收） → verify: grep 到新条目
- [x] 步骤 6 整体验收 → verify: (已做) tsc 通过 + writeBrowserUseToMcpJson/removeFromMcpJson 8 项功能测试全过(ON写入/幂等/保留其它/OFF移除/OFF幂等/新建文件) + 越界检查 git diff 仅 4 个 write_files 文件(另5个为会话前既有改动)。(留给大哥) live 面板 OFF→ON→OFF + 干净项目新会话进程树无 browser-use + LogsView mcp-toggle 起止/ON失败 ERROR——**需重启 VibeSpace 后端才生效**，而重启会杀掉所有终端含本会话，故由大哥重启后照 handoff 清单验
