# 接入 browser-use · Plan

> 目标项目：https://github.com/browser-use/browser-use
> 出发点：让后续 task 的"验收"环节可以委托给 browser-use 跑（点页面、看页面、截图、报 PASS/FAIL）。
> **状态**（2026-04-29 更新）：本任务**只做 Phase 1（B 路径，MCP 注入）**。原 Phase 2（C 路径，Docs ▶ 验收按钮）**已并入新任务"agent-团队编排"** —— 因为 Phase 2 干的事就是团队工作流里"测试 role"的特化版，与其先做简版再推翻不如直接做完整版。Phase 1 落地稳定后再起团队任务。
> 下方 Phase 2 段落保留作上下文，但**本任务 tasks 不覆盖**。设计决策快照见 context.md 末尾"团队编排任务设计决策"。

---

## 0. memory 扫过

- `dev/memory/auto.md`：只有一条 hook 冒烟自测条目，无关。
- `dev/memory/manual.md`：主理人偏好"小功能直接改"——本任务不是小功能（涉及外部 Python 依赖、新进程模型、新 UI 入口），仍走完整三段式。

## 1. 关键事实校准（用户直觉确认）

经 context7 查 `/browser-use/browser-use` 官方文档：

- browser-use **MCP server 暴露的是原子浏览器工具**，不是封装好的"agent.run_task(自然语言)"高级接口。工具清单：
  - `browser_navigate(url)`、`browser_click(index)`、`browser_type(index, text)`
  - `browser_get_state(include_screenshot)`、`browser_screenshot(full_page)`
  - `browser_scroll(direction)`、`browser_go_back()`
  - `browser_list_tabs()` / `browser_switch_tab(id)` / `browser_close_tab(id)`
  - `browser_extract_content(query)` ← 唯一 LLM 驱动的工具
- 启动方式：`uvx --from 'browser-use[cli]' browser-use --mcp`（stdio MCP server）
- **Claude Code 自己就是 agent**——它决定"navigate→click(5)→screenshot"，browser-use 只负责执行动作。除非主动调 `browser_extract_content`，否则 browser-use 不会触发自己的 LLM。
- 官方示例 MCP 配置 env 里仍带 `OPENAI_API_KEY`。具体是不是启动硬性要求（vs 仅 `extract_content` 时才要）等实施期跑一下确认；不是硬性的话连这条都省，是的话用户在系统层 `setx` 即可，VibeSpace 不接管 key 管理。

> 结论：**没有"两次 LLM 费用"问题**。先前 plan 里担心的成本结构不存在。

## 2. 目标 & 验收

### 目标

- **Phase 1（B）**：让 claude / codex session 启动时自带 browser-use MCP，AI 在跑 verify 时直接调原子工具，session 内一气呵成。
- **Phase 2（C）**：把 browser-use 抬成"验收头等公民"——Docs 侧栏每条 task 旁加 "▶ 用 browser-use 验收" 按钮、跑出来的截图/日志落到 `dev/active/<task>/verify/<runId>/`、UI 直接渲染回放。

### 可验证的验收标准

**Phase 1 验收**：

1. **安装链路通**：CliInstallerDialog（📦）多出 browser-use 卡片；点装能跑通 `uvx --from 'browser-use[cli]' browser-use --version` 等价的探针，`/api/cli-installer/status` 反映 `installed=true`。Python 不在 PATH 时给清晰前置提示。
2. **MCP 注入可见**：浏览器里启 claude session，LogsView 看到 `scope=installer action=inject-mcp-browseruse` 起止配对（`成功 (Nms)` 或 `失败: <reason>`），claude MCP 配置文件里能看到 browser-use 条目。
3. **AI 真能驱动浏览器**：session 内对 claude 说"用 browser-use 打开 http://127.0.0.1:8788 然后截图"，xterm 里 claude 回复包含截图引用、LogsView 出现 MCP 工具调用日志（至少能看到 `browser_navigate` / `browser_screenshot` 这两个工具名）。
4. **失败分支可见**：故意卸了 browser-use 再启 session，LogsView 出现 `inject-mcp-browseruse 失败: <reason>` 的 ERROR 条；session 仍正常起来（注入失败不阻塞 session 启动）。
5. **类型检查通过**：`pnpm -r run typecheck`（或当前等价命令——Context 阶段确认）全绿。

**Phase 2 验收**（B 验收完且稳定 1-2 天后再启动）：

6. **Docs 侧栏每条 task 旁有"▶ 用 browser-use 验收"按钮**——浏览器里能看到、能点、能弹一个让用户填 verify 指令的对话框。
7. **跑一次验收**：填"打开 http://127.0.0.1:8788 看看首页能不能加载，截图给我"，点确认后 LogsView 出现 `scope=verify action=run` 起止配对；跑完后 task 目录下 `dev/active/<task>/verify/<runId>/` 多了 `summary.md`、`screenshots/*.png`、`raw.log`。
8. **UI 能回放**：Docs 侧栏点该 task 能展开历史 verify run 列表（runId、PASS/FAIL、时间、缩略图），点开一条能在右侧 EditorArea 看到截图和 summary。
9. **失败分支可见**：跑一个明知会失败的指令（比如打开一个不存在的端口），LogsView 出现 ERROR、UI 标红、`summary.md` 写了失败原因。

### UI 验收硬规则提醒

第 1/2/3/4/6/7/8/9 条都是浏览器里能直接看到的行为，符合"前端任务必须有浏览器可观察验收项"的项目硬规则。

## 3. 非目标 (Non-Goals)

- **不**做"在 VibeSpace UI 里实时回放 browser-use 操作浏览器画面"（live screencast）。截图只在每次工具调用结束后落盘+回显，不做流式视频。
- **不**替换/wrapper 既有的 claude/codex CLI 行为。
- **不**把 browser-use 当成独立的 PTY session 类型（形态 A 砍掉，理由见 §4）。
- **不**做跨 OS 完美覆盖；首批仅 Windows 跑通即收（macOS/Linux 不阻塞但不验收）。
- **不**做 LLM provider 适配层；browser-use 自己用什么 provider 就什么 provider。
- **不**做 MCP 工具的 scope 拦截（项目"施工边界"目前只覆盖 Edit/Write，浏览器工具暂不纳入）。
- **不**做网络白名单（接受 AI 能开任何 URL 的攻击面，但 LogsView 留 navigate URL 可事后审计）。
- **Phase 1 不**做 Docs UI 验收按钮（那是 Phase 2 的事）。

## 4. 形态决策回顾

> 为什么是 B+C，不是 A：A（往 CLI_CATALOG 加一项当独立 PTY agent）解决的是"独立用 browser-use"问题，跟"task 验收"目标错位；browser-use 不是聊天 REPL，PTY 里跑只能看日志、看不到截图。**A 直接砍掉**，本期不做。

| 形态 | 本期是否做 | 备注 |
|---|---|---|
| A. 独立 PTY agent | ❌ | 目标错位 |
| B. MCP 注入 claude/codex session | ✅ Phase 1 | 主诉求 |
| C. Docs 验收按钮 + 工件回放 | ✅ Phase 2 | 紧接 Phase 1 |

## 5. 实施步骤（粗粒度）

> 每一步带"如何验证"。具体文件路径/接口签名留到 Context 阶段定。

### Phase 1（B 路径）

1. **CliInstallerDialog 加 browser-use 卡片**
   - `cli-catalog.ts` 新增条目；但因为 browser-use 不被 PTY 拉起，需要让数据结构能区分 "agent CLI" vs "MCP 工具 CLI"——可能加一个 `kind: 'agent' | 'mcp-tool'` 字段，或者另开一份目录。
   - 安装命令优先 `uvx --from 'browser-use[cli]' browser-use --version`（探针）；安装动作给一个 README 链接 + 探针失败时的具体提示（"先装 Python ≥ 3.11 + uv，或者跑 pip install browser-use playwright"）。
   - StartSessionMenu 不在"启动 AI / 终端"下拉里出现 browser-use（它不是 session）。
   - **验证**：📦 对话框看到卡片；安装+探针流程在浏览器里能走通。

2. **后端起 session 时按 agent 注入 MCP 配置**
   - 新模块 `mcp-bridge.ts`：分派表
     - `claude` → 写到项目根 `.mcp.json`（claude code 优先读 project scope MCP），新增 `browser-use` server 条目；幂等
     - `codex` → 写到 `~/.codex/config.toml` 的 `[mcp_servers.browser-use]`；幂等
     - 其他 agent → 跳过（首批仅 claude+codex）
   - 注入失败**不阻塞** session 启动。
   - **验证**：起 claude session 后 `.mcp.json` 出现 browser-use 条目；起 codex session 后 codex config 出现条目；二次启动同 agent 不重复添加；LogsView 出现 `installer:inject-mcp-browseruse` 起止配对。

3. **operation log 全套**
   - 埋点位置：
     - `installer action=install-browser-use`（安装起止）
     - `installer action=probe-browser-use`（探针起止——`uvx ... --version`）
     - `installer action=inject-mcp-browseruse`（注入起止）
   - 失败分支必有 ERROR + `meta.error`。
   - **验证**：LogsView 看到上述配对；故意制造失败（断网、手卸、改坏配置）能看到 ERROR。

4. **session AI 真用一次**
   - 起 claude session → 输入"用 browser-use 打开 http://127.0.0.1:8788 然后截图"
   - **验证**：claude 回复带截图；LogsView 看到至少 `browser_navigate` / `browser_screenshot` 工具名出现。

5. **README 补一段**
   - 前置要求（Python ≥ 3.11、uv 推荐、Playwright 浏览器二进制 ~200MB）、装法、首次跑通的最小例子。
   - **验证**：跟着文档走能从 0 装到能用。

### Phase 2（C 路径）

6. **新 route `POST /api/projects/:id/docs/:task/verify-run`**
   - body：`{ instruction: string }`（自然语言验收指令）
   - 后端起 browser-use 子进程（**不是** MCP，而是直接 spawn `uvx --from 'browser-use[cli]' browser-use --task "..."` 这种 one-shot 模式；具体 CLI 形态 Context 阶段确认 browser-use 是否支持）
   - 工件落到 `<projectPath>/dev/active/<task>/verify/<runId>/`，含 `summary.md` / `raw.log` / `screenshots/`
   - 返回 `{ runId, status: 'running' }`，跑完通过 WS 推 `{ type: 'verify-done', runId, result }`
   - **如果 browser-use 没有合适的 one-shot CLI**，退回另一条路：起一个临时 claude/codex session，给它喂 instruction，它通过 MCP 调 browser-use 完成（这条路依赖 Phase 1）

7. **新 route `GET /api/projects/:id/docs/:task/verify-runs`** + 单条 `GET .../verify-runs/:runId`
   - 列出某 task 历史 verify run（runId / status / startedAt / instruction 摘要）
   - 单条返回 summary + 截图列表

8. **DocsView 加按钮和 run 列表**
   - 每条 task 标题旁 `▶` 按钮 → 弹 instruction 输入框 → 调 §6 route
   - task 展开时显示历史 run（缩略图 + 状态徽章）
   - 点一条 run → EditorArea 新开 tab 渲染截图和 summary

9. **operation log**
   - `verify action=run`（起止 + meta 含 instruction 摘要、runId）
   - `verify action=open-run`（用户点回放时）

10. **README + CLAUDE.md 更新**
    - README 写"验收按钮"用法
    - CLAUDE.md **不**强加规则（这是工具不是流程）

## 6. 边界情况

- **Python / uv 不在 PATH**：installer 卡片在 `cli-installer/status` 里把 `requires` 标红；探针失败信息透传，不要吞。
- **Playwright 浏览器没装**：browser-use 首跑会自动 `playwright install chromium`；首次启动可能耗时几分钟，UI 要给"正在下载浏览器二进制"的提示，不要让人以为卡死。
- **同时多 session 跑 browser-use**：browser-use 默认每次起新浏览器实例；session 间不共享 cookie/state——本期接受。
- **session 是 worktree 隔离模式**：MCP 配置写到**项目根**而不是 worktree（worktree 是临时的，下次 session 起来就没了）。Context 阶段确认 claude code 在 worktree cwd 启动时是否还能读到项目根的 `.mcp.json`——倾向是能（claude code 会向上找）。
- **Codex MCP 支持版本差异**：当前 codex 版本 MCP 支持可能不完整。注入前先探针 codex 版本；不支持的版本给明确告警而不是静默失败。
- **网络访问**：browser-use 默认能开任何 URL，AI 可能被 prompt injection 引到外网。本期接受这个风险（先内部用），LogsView 留每次 navigate 日志可审计。
- **Phase 2 子进程超时**：browser-use 跑一个验收任务可能很久，要有超时（默认 5 分钟）+ 用户取消按钮。
- **Phase 2 工件目录大小**：截图 PNG 累积下来可能很快几百 MB。本期不做自动清理，README 提一句"verify 工件需要手动清理"。
- **Phase 2 `verify/<runId>/` 是否进 git**：默认应该 `.gitignore`（人没必要 commit 截图历史）。Context 阶段确认是要全局 ignore `dev/active/**/verify/` 还是 per-task 写一个。

## 7. 用户决策（已锁定）

| # | 问题 | 决策 |
|---|---|---|
| 1 | 形态选择 | **B+C 都做**（B 先 Phase 1，C 紧跟 Phase 2） |
| 2 | LLM key 管理 | **不需要——Claude Code 直接调原子工具，browser-use 内部不跑 agent loop**。如 server 启动硬性要求 `OPENAI_API_KEY`，用户自己 `setx` 一下，VibeSpace 不接管 |
| 3 | Python 安装策略 | **用户自备**（README 写明前置），优先推荐 `uv` |
| 4 | 首批支持哪些 session agent | **claude + codex**；gemini/opencode/qoder/kilo 跳过 |
| 5 | 网络白名单 | **不做**，但 LogsView 留 navigate URL 可审计 |

## 8. 风险与注意

- **依赖外部 Python 生态**：项目至今纯 Node，引入 Python+Playwright 是隐性大门槛。README 单独章节 + installer 卡片明确前置要求。
- **MCP 配置文件位置因 CLI 而异**：claude（项目 `.mcp.json`）和 codex（`~/.codex/config.toml`）不同，注入逻辑要按 agent 分派；将来加新 agent 还得维护这张表——本期 hard-code 两个，文档里写清楚。
- **uvx 首次启动慢**：`uvx --from 'browser-use[cli]'` 第一次会下整个 Python 包+依赖+ Playwright 浏览器二进制，可能 1-3 分钟。session 启动时**异步注入**而不是阻塞；首次实际使用时如果还没装好，工具调用会失败——这是可接受的，重试一次基本就好。
- **熔断**：browser-use 一次会话可能跑很久，超时/失败重试 2 次没起来就停、把日志透给用户，不要无限重试。
- **Phase 2 子进程冲突**：同一 task 同时多个 verify run 怎么办？本期采用"同 task 串行执行"：第二个请求看到第一个还在跑就返回 `{ error: 'busy', runningId: '...' }`。

## 9. 外部审查

> 用户本轮没触发"多模型/第二意见/让 gemini 看看"等关键词，按规则不调用外部模型。

---

**下一步**：Context 阶段。需要在 context.md 里钉死的关键点：
1. 项目级 `.mcp.json` 写法（claude code 是否真的优先读这份；写到 `~/.claude/settings.json` 还是项目根更合适）
2. codex `~/.codex/config.toml` 的 `[mcp_servers.browser-use]` 精确语法
3. browser-use 是否有合适的 "one-shot CLI" 模式给 Phase 2 的 verify-run 用，没有则 fallback 到"起临时 claude session 跑 MCP"
4. `cli-catalog` 数据结构是否要扩 `kind` 字段，还是另开一份 mcp-tools 目录
5. `verify/<runId>/` 的 gitignore 处理方式
