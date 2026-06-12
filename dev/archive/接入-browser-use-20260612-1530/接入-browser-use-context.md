# 接入 browser-use · Context

> 配套 `接入-browser-use-plan.md`。本文件钉死改动边界、决策与依赖。Tasks 阶段原则上只动这里列的文件。
> **2026-04-29 更新**：本任务范围缩为 **Phase 1 only**。Phase 2 段落保留作参考，但**不进 tasks.md**——Phase 2 已并入新任务 "agent-团队编排"，相关设计决策见末尾§6。

---

## 0. plan 阶段未决项的最终结论

| # | 不确定项 | 结论 |
|---|---|---|
| 1 | claude MCP 配置写哪 | 项目根 `.mcp.json`（不污染全局，多项目互不影响） |
| 2 | codex MCP 配置精确语法 | `~/.codex/config.toml` 的 `[mcp_servers.browser-use]` 段，字段 `command` / `args` / 可选 `env`；具体字段名实施时跑通即收（codex 端写错会自报错，迭代成本低） |
| 3 | browser-use 是否有 one-shot CLI 模式给 Phase 2 用 | **没有干净的本地 one-shot**——本地 CLI 是 stateful 命令链（`open / state / click / screenshot / close`），需要外部 agent 编排；`browser-use cloud v2 POST /tasks` 是云端付费方案，不取。**Phase 2 改走"内部临时 claude session + 喂 prompt"** |
| 4 | cli-catalog 数据结构 | 扩 `kind: 'agent' \| 'mcp-tool'` 字段，缺省 `'agent'`；`mcp-tool` 项不进 StartSessionMenu 下拉，只在 CliInstallerDialog 显示 |
| 5 | `verify/<runId>/` 是否进 git | **默认不进** —— 项目根 `.gitignore` append `dev/active/**/verify/`；用户想 commit 自己手动 untrack |

附加 1 项关键发现：**Phase 2 强依赖 Phase 1**——必须先装好 browser-use + 注入成功，Phase 2 才有意义。UI 要明确表达这个依赖（按钮 disabled + tooltip）。

---

## 1. 关键文件（改动边界）

### Phase 1 后端

| 文件 | 改动类型 | 关键改动点 |
|---|---|---|
| `packages/server/src/cli-catalog.ts` | 改 | `CliEntry` 加 `kind?: 'agent' \| 'mcp-tool'`；新增 `browser-use` 条目（kind=mcp-tool，install=`uvx --from 'browser-use[cli]' browser-use --version` 即装即探） |
| `packages/server/src/pty-manager.ts` | 不动 | mcp-tool 类型永远不会被 PTY spawn |
| `packages/server/src/routes/cli-installer.ts` | 改 | `detectAll()` 探针已支持任意 `bin`；改 `publicEntry` 透传 `kind` |
| `packages/server/src/install-jobs.ts` | 不动 | 安装命令字符串统一执行，不需要分类 |
| **新** `packages/server/src/mcp-bridge.ts` | 新增 | 注入 MCP 配置到对应 CLI；按 agent 分派；幂等。导出：`injectMcpForAgent(agent, projectPath, sessionId): Promise<void>`、`removeMcpForAgent(...)` |
| `packages/server/src/routes/sessions.ts` | 改 | `startSession()` 在 PTY spawn **之前**异步调 `injectMcpForAgent(agent, proj.path, sessionId)`；注入失败仅 `serverLog('warn', 'installer', ...)` 不阻塞 |

`mcp-bridge.ts` 内部分派表（hard-code 到本期）：

```ts
agent === 'claude'  → write/merge <projectPath>/.mcp.json
agent === 'codex'   → write/merge ~/.codex/config.toml
其他 agent          → no-op（首批不支持）
```

### Phase 1 前端

| 文件 | 改动类型 | 关键改动点 |
|---|---|---|
| `packages/web/src/types.ts` | 改 | `CliEntry` 加 `kind?: 'agent' \| 'mcp-tool'` |
| `packages/web/src/components/CliInstallerDialog.tsx` | 改 | 卡片渲染加 "MCP 工具" 徽章（kind===mcp-tool 时显示）；其余复用 |
| `packages/web/src/components/StartSessionMenu.tsx` | 改 | `cliRows` 过滤掉 `kind === 'mcp-tool'` 的条目 |
| `packages/web/src/api.ts` | 不动 | 复用现有 `getCliInstallerCatalog` / `getCliInstallerStatus` |

### Phase 1 hook script

| 文件 | 改动类型 | 关键改动点 |
|---|---|---|
| `packages/hook-script/aimon-hook.mjs` | 不动 | MCP 注入跟 hook 互不相干 |

### Phase 2 后端

| 文件 | 改动类型 | 关键改动点 |
|---|---|---|
| **新** `packages/server/src/verify-runner.ts` | 新增 | `runVerify(projectPath, taskName, instruction): Promise<{runId}>`：临时起 claude session（cwd=项目根，agent=claude）→ 通过 PTY stdin 喂 prompt → 监听输出找 sentinel `===VERIFY_DONE: PASS===` / `FAIL` → 关 session → 返回 |
| `packages/server/src/routes/docs.ts` | 改 | 新增三条 route：`POST /api/projects/:id/docs/:task/verify-runs`（启动）、`GET .../verify-runs`（列历史）、`GET .../verify-runs/:runId`（取详情） |
| `packages/server/src/docs-service.ts` | 改 | 新增 `listVerifyRuns(projectPath, taskName)`、`readVerifyRun(...)`、`createVerifyRunDir(...)`；走纯文件系统，**不进 SQLite** |
| `packages/server/src/db.ts` | 不动 | verify run 工件全文件系统 |
| `packages/server/src/ws-hub.ts` | 改 | 新增 server→client 消息：`{ type: 'verify-progress', runId, line }` / `{ type: 'verify-done', runId, status }` |

### Phase 2 前端

| 文件 | 改动类型 | 关键改动点 |
|---|---|---|
| `packages/web/src/components/sidebar/DocsView.tsx` | 改 | 每条 task 标题旁加 `▶` 按钮 → 弹"输入验收指令"对话框 → 调 `POST verify-runs`；task 展开时拉 `GET verify-runs` 渲染历史列表 |
| `packages/web/src/types.ts` | 改 | 加 `VerifyRunSummary` / `VerifyRunDetail` 类型 |
| `packages/web/src/api.ts` | 改 | 加三个 API 函数对应上述 route |
| `packages/web/src/ws.ts` | 改 | 处理 `verify-progress` / `verify-done` 推送，同步给 zustand store |
| `packages/web/src/store.ts` | 改 | 加 `verifyRuns: Record<runId, VerifyRunDetail>`；`pushVerifyProgress` / `setVerifyDone` action |
| `packages/web/src/components/editor/EditorArea.tsx` | 改 | 新增 tab kind=`verify-run`（展示 `summary.md` + 截图缩略图墙） |

### 文档

| 文件 | 改动类型 |
|---|---|
| `README.md` / `README.zh-CN.md` | 加"browser-use 验收"小节，说明前置（Python ≥ 3.11 + uv）+ 装法 + 最小例子 |
| `.gitignore`（项目根） | append `dev/active/**/verify/` |

---

## 2. 决策记录

> 每条都过一遍"资深工程师会不会觉得过度设计"。回答都是 **不会**，下面是理由。

### D1. `CliEntry.kind` 字段，而不是另开一份目录

- **资深工程师视角**：现有 catalog 已经混了"启动" + "安装" + "探针" 三类元数据；加一个分类字段是最低改动量的扩展。开第二份目录得复制一份 detect/install 路径——这才是真正的过度。
- **取舍**：缺省值 `'agent'`，已有条目零迁移。

### D2. claude MCP 配置写**项目根 `.mcp.json`**，不写 `~/.claude/settings.json`

- 项目级配置不污染其他项目；多 VibeSpace 项目互不干扰。
- claude code 官方约定项目级 MCP 入口就是这个文件，无须自创路径。
- **风险**：用户可能不希望把 `.mcp.json` commit（带 env、带配置漂移）。**默认不主动 commit**，README 提一句"想共享给协作者就把它加进 git"。

### D3. 注入失败 `warn` 不 `error`，session 启动不阻塞

- claude/codex 的 MCP 支持有版本差异（codex 老版本不支持），写入失败时 session 仍能跑、用户能从 LogsView 看出原因。
- **比对**：阻塞 session 启动是过度——MCP 是增强不是必需。

### D4. Phase 2 用"临时 claude session 跑 prompt"，不自己写 agent loop

- browser-use 本地 CLI 是 stateful 命令链，需要外部 agent 编排"看页面 → 决定下一步 → 执行"——这正是 LLM agent 的本职。我们再写一个就是重新发明 browser-use 的脑子。
- 复用现有 PTY/session 体系，verify-runner 是个**薄编排层**：spawn 临时 session → 喂 prompt → 监听 sentinel → 关 session。
- **取舍**：Phase 2 强依赖 Phase 1（browser-use 没装注入失败 → 临时 session 也用不了 MCP）。**UI 上 ▶ 按钮在 cli-installer/status 里 browser-use 未安装时 disabled + tooltip 提示**。

### D5. verify run 工件**全文件系统**，不进 SQLite

- 唯一查询场景是"列出某 task 历史 run"，O(N) 列目录足够，量级也就几十条。
- 截图 PNG 本来就只能落盘，DB 多此一举。
- **比对**：建表+CRUD+迁移+索引是真正的过度。

### D6. `uvx --from 'browser-use[cli]' browser-use --version` 作为**装+探针二合一**

- uv 是 browser-use 官方推荐方式，`uvx` 自带"取一次包跑一次"，免维护 venv。
- 第一次跑会下整个包+依赖+ Playwright 浏览器（~200MB，1-3 分钟），UI 要给"正在下载"提示，**不要让人以为卡死**。
- **前置**：用户得装 uv。`detectRequires()` 加一个 `uv` 依赖，缺时在 installer 卡片标红 + 给"如何装 uv"链接。

### D7. 不做白名单 / 不接管 LLM key / 不做 scope 拦截 MCP 工具

- 已与用户对齐，本期都不做。
- LogsView 留 navigate URL 可事后审计，作为安全风险的最小补偿。

### D8. Phase 2 verify-runner 用 sentinel 字符串识别完成

- prompt 模板末尾会要求 claude 输出 `===VERIFY_DONE: PASS===` 或 `===VERIFY_DONE: FAIL===`。
- 等价方案：让 claude 写 `done.json` sentinel 文件，runner watch 文件——多一次 IO，但更强壮（避免 ANSI 转义干扰文本匹配）。
- **本期选 sentinel 字符串**，简单先；如果实测 false-negative 多再换文件 sentinel。

### D9. Phase 2 同 task 的 verify run **串行**

- 第二个 verify 请求看到第一个还在跑就返回 `409 { error: 'busy', runningId }`。
- **比对**：并发跑会启多个 chromium 实例、覆盖工件目录命名、状态机复杂——本期先串行。

---

## 3. 依赖与约束

### 项目内已有依赖（不变）

- Node 22 / pnpm 10
- Fastify v5、@fastify/cors、@fastify/websocket
- node-pty-prebuilt-multiarch、better-sqlite3
- React 18 / Vite / zustand / xterm.js
- simple-git、pidusage

### 新增外部依赖（用户自备）

| 依赖 | 版本 | 用途 |
|---|---|---|
| Python | ≥ 3.11 | uv / browser-use 运行时 |
| uv | 最新 | `uvx` 拉取 browser-use |
| browser-use[cli] | 最新 | MCP server + 浏览器驱动 |
| Playwright Chromium | uvx 自动 | 实际浏览器二进制 |

**项目代码自身不依赖任何 Python**——只是 spawn 子进程调 uvx。Node side 没新增 npm 依赖。

### 配置文件 schema 约束

#### 项目级 `.mcp.json`（claude code 项目 scope MCP 入口）

```json
{
  "mcpServers": {
    "browser-use": {
      "command": "uvx",
      "args": ["--from", "browser-use[cli]", "browser-use", "--mcp"]
    }
  }
}
```

- 写入采用 read-modify-write：保留已有其他 MCP server 条目；同名 key 幂等覆盖。
- Atomic write：tmp → rename（参考 `hook-installer.ts::installClaudeHooks` 的写法）。

#### `~/.codex/config.toml`（codex MCP 入口）

```toml
[mcp_servers.browser-use]
command = "uvx"
args = ["--from", "browser-use[cli]", "browser-use", "--mcp"]
```

- 实施时确认：codex 0.x 当前版本对 `[mcp_servers.*]` 段的具体字段名（可能是 `cmd` 而不是 `command`，参考 codex 自己的文档）。
- 写入采用读取整个 toml → 在结构层修改 → 写回；用 npm 包 `@iarna/toml` 或更简单的"识别已有段就替换、否则 append"——若仅 append 模式够用就不引入新依赖。

### 兼容性约束

- **Windows 路径**：`.mcp.json` / `~/.codex/config.toml` 写入的路径里如果有反斜杠，**必须转换成正斜杠**（参考 `hook-installer.ts` 第 50 行的 `replace(/\\/g, "/")`）。
- **idempotent**：每次 session start 都会调注入；同 agent 同项目重复调用不重复添加条目、不污染其他 server。
- **worktree 模式**：MCP 配置写到**项目根**而不是 worktree path。worktree 是临时目录，session 退出后可能被 GC；写到那里下次起 session 还得重写。**worktree session 启动时 cwd 是 worktree 但 MCP 配置文件路径仍走项目根**。
- **claude code 在 worktree cwd 启动时是否能读到上层项目根的 `.mcp.json`**：claude code 会从 cwd 向上搜，能读到。**如果实测发现读不到，回退方案是把 `.mcp.json` 也复制一份到 worktree 路径**，但这是后路，不在本期范围。

### 操作日志埋点清单（硬规则要求）

每个 mutation 都要起止配对（`logAction` / `serverLog`）：

| scope | action | 触发点 | meta 关键字段 |
|---|---|---|---|
| `installer` | `install-browser-use` | 用户点 📦 装 browser-use | `cliId`、`cmdline` |
| `installer` | `probe-browser-use` | install job 跑完后探针 | `version`、`stderr` |
| `installer` | `inject-mcp-browseruse` | session start 注入 | `agent`、`configPath`、`changed` |
| `verify` | `run` | Phase 2 ▶ 启动 | `runId`、`taskName`、`instructionPreview` |
| `verify` | `open-run` | 用户点回放 | `runId`、`taskName` |

ERROR 分支必带 `meta.error = { name, message, stack }`。

---

## 4. 边界确认（plan §6 的进一步明确）

- **同时多 session**：MCP 配置文件本身是共享的，多 session 起 chromium 实例时 browser-use 默认每实例独立浏览器进程；不是问题。
- **Phase 2 子进程超时**：临时 claude session 默认 5 分钟没出 sentinel → runner 强制 kill session、状态记 FAIL（reason=timeout）。
- **Phase 2 取消**：UI 提供"取消"按钮 → 调 `DELETE verify-runs/:runId` → runner kill 临时 session。
- **截图体积**：Phase 2 不做自动清理。README 提一句"verify 工件需要手动清理"。

---

## 5. 不在本次范围（明确划线）

- **`browser_extract_content` 工具的 LLM 链路联调**——本期默认能用即可，不专门优化。
- **MCP 工具的 scope（施工边界）拦截**——见 plan §3 非目标。
- **多 agent 并发同一 task verify**——见 D9，本期串行。
- **gemini / opencode / qoder / kilo 的 MCP 注入**——见 plan §7 决策 4。
- **Phase 2 实时浏览器画面回放（live screencast）**——见 plan §3 非目标。

---

**下一步**：用户确认 context 后，写 `接入-browser-use-tasks.md` + `接入-browser-use-tasks.json`（Phase 1 only），进入执行阶段。

---

## 6. 团队编排任务设计决策快照（forward-looking · 不在本任务范围）

> 用户在本任务进行中提出的更大愿景：把 VibeSpace 升级为 "AI 团队编排器"——多个 role-agent 在 harness 上协作，按 Dev Docs 流程跑。原 Phase 2（Docs ▶ 验收按钮）并入这个新任务。
> 下面这份快照是用户与 AI 在 plan.md 之外做的设计对齐结果，**当本任务（接入-browser-use Phase 1）归档、新任务"agent-团队编排"启动时，应被直接搬进新任务的 plan.md**，省一轮重新讨论。

### 已锁定决策

1. **协调者形态**：**确定性 Node 代码**（新模块 `team-runner.ts`），不做 leader-LLM。理由：LLM 编排者不可控、贵、难调试；harness 已经是"代码编排 PTY 子进程"模型，沿用即可。
2. **role 颗粒度**：6 个 role —— **框架 / 开发 / 测试 / 反馈 / 总结 / 巡查（monitor，开发并行 watch diff + typecheck）**。配套 **role 组合预设**：
   - 极简（开发+测试）
   - 标配（框架+开发+测试+总结）
   - 严格（全套+反馈循环）
3. **plan.md 由谁写**：**框架 agent 写**，但**写完必须停下来等用户确认**（保留"人在环上"的关键节点；跟 CLAUDE.md "Plan 阶段必须用户拍板"硬规则一致）。
4. **熔断**：
   - 单 role 内：复用 CLAUDE.md "同步骤连续失败 2-3 次熔断"。
   - 跨 role：开发→测试→反馈循环上限 **2 轮**；第 3 轮自动停下来等用户介入。
5. **可观测性**：新「Team Run」侧栏 —— 看团队当前在哪一棒、点进任意 role 的 xterm 围观、看 handoff 文件 diff、紧急叫停。

### 待新任务起 plan 时再定的

- role 之间 handoff 走什么文件（plan/context/tasks 复用？还是另起 review.md / summary.md？）
- 测试 role 的实现：直接借 Phase 1 的 MCP 注入跑（这就是为什么 Phase 1 是基础设施）
- role-session 之间怎么传递 sentinel（接入-browser-use 已研究过：sentinel 字符串简单先，遇到 false-negative 再换文件 sentinel）
- role 预设的 UI 入口在哪（DocsView 新建任务对话框加下拉？）
- 同 role 在不同 task 用不同 model 的配置面板要不要做（成本控制）
- 团队任务的 task 元数据存哪（`dev/active/<task>/team.json`？还是 SQLite 加表？）

### 与 Phase 1 的依赖关系

- 团队编排任务**强依赖 Phase 1**：测试 role 的"驱动浏览器"能力直接用 Phase 1 注入的 browser-use MCP；没 Phase 1 这一棒就跑不起来。
- 反过来 Phase 1 完全独立：没有团队编排功能，单 session AI 用户也能直接在 claude session 里手动调 browser-use 工具做验收。
