# 接入-browser-use · 任务清单（Phase 1 only）

> 本任务只做 Phase 1（B 路径，MCP 注入）。Phase 2 已并入新任务"agent-团队编排"，详见 context.md §6。
> 每条 verify 行尾给一个能在浏览器或终端里直接观察的判定方式。

- [x] 1. **后端类型扩展 + browser-use catalog 入口**
  → verify: `pnpm -r run typecheck` 全绿；`curl http://127.0.0.1:8787/api/cli-installer/catalog` 返回数组里能看到 `id: "browser-use"` 一项且 `kind: "mcp-tool"`；其余既有条目（claude / codex / ...）默认 `kind: "agent"`
  - Edit `packages/server/src/cli-catalog.ts`：`CliEntry` 加 `kind?: 'agent' | 'mcp-tool'`；新增 `browser-use` 条目（install 用 `uvx --from 'browser-use[cli]' browser-use --version`，`requires: ['uv']`）
  - Edit `packages/server/src/routes/cli-installer.ts::publicEntry`：透传 `kind`

- [x] 2. **前端类型 + UI 渲染（徽章 + 下拉过滤）**
  → verify: 浏览器里打开 📦 CliInstallerDialog，browser-use 卡片右上有"MCP 工具"徽章，其他卡片无；点"+启动 AI/终端"打开下拉，**没有** browser-use 一项，但 claude/codex/shell 等正常显示
  - Edit `packages/web/src/types.ts`：`CliEntry` 加 `kind?: 'agent' | 'mcp-tool'`
  - Edit `packages/web/src/components/CliInstallerDialog.tsx`：mcp-tool 类型卡片显示徽章
  - Edit `packages/web/src/components/StartSessionMenu.tsx`：`cliRows` 过滤掉 `kind === 'mcp-tool'`

- [ ] 3. **手动跑通安装链路** （进行中：browser-use 已装到 PATH；待 dev server 重启 + UI 验证）
  → verify: 浏览器里点 📦 → browser-use 卡片 → "安装"，SSE 流跑完不报错；`curl /api/cli-installer/status` 反映 `cli["browser-use"].installed=true`；LogsView 看到 `installer:install-browser-use` 起止配对（`成功 (Nms)`）
  - 已完成：装好 `uv 0.11.8`（PowerShell 官方 installer），用清华镜像跑 `uv tool install --python 3.12 'browser-use[cli]'` 成功；`browser-use.exe` 已在 `C:\Users\zh_zhang\.local\bin\`
  - 待用户：重启 dev server（让新 PATH 生效）→ 浏览器 📦 看 browser-use 是否检测为已装；可选再点一次"重装"验证 UI 流程

- [ ] 4. **mcp-bridge 模块 + sessions.ts 调用**
  → verify: 浏览器里起 claude session，`<projectPath>/.mcp.json` 出现 `mcpServers["browser-use"]` 条目（首次创建）；LogsView 看到 `installer:inject-mcp-browseruse` 起止配对（`成功 (Nms)`，meta.agent=claude，meta.configPath 含项目路径）
  - 新文件 `packages/server/src/mcp-bridge.ts`：导出 `injectMcpForAgent(agent, projectPath, sessionId): Promise<void>`；按 agent 分派；幂等；写入采用 read-modify-write + atomic tmp→rename（参考 `hook-installer.ts` 第 150 行）；Windows 路径反斜杠转正斜杠
  - Edit `packages/server/src/routes/sessions.ts::startSession`：在 `ptyManager.spawn` 之前 `await injectMcpForAgent(agent, proj.path, sessionId).catch(...)`；失败仅 `serverLog('warn'/'error', 'installer', ...)` 不阻塞

- [ ] 5. **幂等性测试**
  → verify: 同一项目连续起两个 claude session，`.mcp.json` 里 `mcpServers["browser-use"]` 还是一份（不重复出现）；LogsView 第二次 `inject-mcp-browseruse` 成功且 meta 显示"无变化"或类似含义
  - 仅手动验证；如果不幂等回头修 step 4 的 mcp-bridge 逻辑

- [ ] 6. **codex 注入路径**
  → verify: 装了 codex 的环境下，起 codex session，`~/.codex/config.toml` 出现 `[mcp_servers.browser-use]` 段；LogsView 同样看到注入成功的起止配对
  - 实施时按 codex 当前版本的 toml schema 写（具体字段名 `command`/`args` 还是 `cmd`/`argv` 实施时跑通即收）
  - 没装 codex 跳过此步并标 blocked，不阻塞 task 完成

- [ ] 7. **失败分支测试**
  → verify: 把 `<projectPath>/.mcp.json` 改成只读文件，再起一个 claude session；LogsView 出现 `inject-mcp-browseruse 失败: <reason>` 的 ERROR 条目（带 `meta.error.{name,message,stack}`）；session 仍正常进入 `starting → running`，没被注入失败阻塞
  - 仅手动验证；测试完把文件权限改回去

- [ ] 8. **AI 真用一次浏览器工具**
  → verify: 浏览器里起 claude session，输入"用 browser-use 打开 http://127.0.0.1:8788 然后截图"；xterm 里 claude 回复包含截图引用；LogsView 能看到至少 `browser_navigate` / `browser_screenshot` 两个 MCP 工具名出现在某处
  - 仅手动验证；如果工具调不到回头查 `.mcp.json` 是否真被 claude code 读到

- [ ] 9. **README 写章节**
  → verify: 在干净环境（没装 uv 也没装 browser-use）跟着 README 走能从 0 装到能用；README 章节包含 Python ≥ 3.11 + uv 前置、安装步骤、最小验证例子
  - Edit `README.md` 和 `README.zh-CN.md`：加"browser-use 验收（实验）"小节，链到本任务的 plan/context

- [ ] 10. **整体回归**
  → verify: `pnpm -r run typecheck` 全绿；`pnpm smoke:server` / `pnpm smoke:web` / `pnpm smoke:hooks` 全绿，跟 Phase 1 改动前没有退步
