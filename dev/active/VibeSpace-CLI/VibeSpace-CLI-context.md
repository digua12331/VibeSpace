# VibeSpace CLI · Context

> AI 自用上下文。给执行阶段对照边界，归档评审产出记忆，跨会话衔接。

## 关键文件

### 新建（本任务产出）
- `packages/cli/package.json` — `@aimon/cli`，bin `vibespace`
- `packages/cli/bin/vibespace.mjs` — 入口，shebang dispatch
- `packages/cli/src/args.mjs` — 极小 arg parser
- `packages/cli/src/api.mjs` — fetch 包装 + 错误格式
- `packages/cli/src/config.mjs` — 配置层（参数 > env > ~/.vibespace/config.json > default）
- `packages/cli/src/commands/ping.mjs`
- `packages/cli/src/commands/project.mjs`
- `packages/cli/src/commands/session.mjs`
- `packages/cli/src/commands/docs.mjs`
- `packages/cli/src/commands/skill.mjs`
- `packages/cli/skill/vibespace-cli.md` — skill 真源
- `packages/cli/README.md` — CLI 单包 README（链回主 README）

### 已存在（参考 + 极少改）
- `packages/hook-script/package.json` — 参考结构（零依赖 + bin + mjs）
- `packages/server/src/routes/projects.ts` — 项目 API 真源（不改，只读）
- `packages/server/src/routes/sessions.ts` — 会话 API 真源（不改，只读）
- `packages/server/src/routes/docs.ts` — Dev Docs API 真源（不改，只读）
- `packages/server/src/routes/health.ts` — ping 用的健康检查（不改，只读）
- `package.json` 根 / `pnpm-workspace.yaml` — workspace 拾起新包（默认 `packages/*` 通配，不改）
- `README.md` / `README.zh-CN.md` — 双语主 README，加"CLI"小节

## 决策记录

### D1：新增 `packages/cli` 独立 package vs 塞 server 子命令 → **新 package**
独立 package 边界清晰：CLI 只通过 HTTP 调 server，不复制业务逻辑。塞 server 会让 server 进程需要兼顾 CLI 入口和服务进程两种角色，complicated。

### D2：零第三方依赖 vs commander/yargs → **零依赖**
参考 hook-script。手写 arg parser 极小化，明示"不支持复杂缩写 / 组合短参数"。Codex 评审接受这个取舍，但提醒边界 case 多。**接受**：8 条命令规模下零依赖维护成本仍低。

### D3：所有命令开头是否内置 ping 自检 → **是**
Codex 建议。后端不可达是最大落地风险，每个 command 调 API 前先 1s 超时探测 health。失败 exit 2 + 友好提示。

### D4：mutation 命令安全闸 → **`--yes` 显式确认 + 完整 ID 不模糊匹配**
Codex 评审第 4 条。AI 调用容易误删，必须显式 `--yes` 才真执行；不加只打印预览 exit 3。`project delete` / `docs archive` 适用。

### D5：read 类命令默认输出格式 → **默认 raw text，`--json` 切结构化**
反例：`project list` 默认人类友好（短 ID + name + status 一行一个），加 `--json` 给原始数组。`docs read` 默认 raw md（适合 AI 直接拿来读），加 `--json` 给 `{content, lastModified, ...}` 包装。

### D6：错误输出格式 → `error: <short_code>\n<one-line human msg>` + 退出码语义
Codex 评审第 6/14 条。短码：`backend_unreachable` / `invalid_args` / `project_not_found` / `task_not_found` / `auth_required`（v1 不用但占位）。退出码：0 / 1（业务错） / 2（连接错） / 3（参数错）。

### D7：docs write 内容来源优先级 → **`--content` > `--file` > `--stdin`**，三选一必须给
Codex 评审第 13 条。AI 用 stdin 管道传内容最自然，但 inline `--content` 给小内容时方便。三个都没给 exit 3。

### D8：skill 真源放哪 → **monorepo `packages/cli/skill/`**
跟代码一起维护、跟 CLI 同版本演进；通过 `vibespace skill install` 复制到 `~/.claude/skills/vibespace-cli/SKILL.md`。**真源唯一**：用户不应该手改 ~/.claude/skills/ 那份，要改就改 monorepo 真源。

### D9：v1 skill 不放 `.aimon/skills/` → **是**
v1 目标是"AI 全局任何项目里都能调 vibespace"，`~/.claude/skills/` 是 Claude 全局。`.aimon/skills/` 是 VibeSpace 项目级，v1 不需要；v2 再考虑同步。

### D10：CLI 端是否再打日志 → **不打**
后端 mutation 路由本身已经有 `serverLog` 起止配对（每个 route handler 都有）。CLI 端再加 `logAction` 会在 LogsView 出现重复日志。记忆条 [2026-05-01 / 工作流入口形态对齐] 警告过日志一致性问题。**例外**：CLI 端的 `vibespace ping` 不打日志（纯 health check）。

### D11：session start 不挂前台 → **是**
v1 起完 session 退出，不 tail 输出。AI 要看输出去 UI 或等 v2 `logs tail`。skill 文案要明确这一条。

### D12：arg parser 不支持的语法 → 写进 README 明示
- 不支持 `-x`（单字符短选项）
- 不支持 `-xvf`（组合短选项）
- 不支持 `--key=` 后面跟空字符串
- 支持 `--key value` / `--key=value` / `--flag`（bool） / positional

## 依赖与约束

- **Node >= 20**（内置 fetch / mjs / shebang）
- **跨平台**：Windows + macOS + Linux 都要工作。pnpm bin shim 在 Windows 上生成 `.cmd`，hook-script 已验证。
- **monorepo 拾起**：`pnpm-workspace.yaml` 默认 `packages/*`，新建 `packages/cli` 后 `pnpm install` 自动拾起，无需改 workspace 配置
- **网络层**：用 Node 18+ 内置 `fetch`，不引入 node-fetch/axios。超时统一 1.5s（ping）/ 5s（其他）
- **HTTP API 兼容**：依赖现有 server route 路径不变。改 route 会让 CLI 老版本失效；v1 不做版本协商
- **配置文件**：`~/.vibespace/config.json` 格式 `{ backend?: string, currentProjectId?: string }`。文件不存在视为空配置，不报错
- **skill 安装路径**：`~/.claude/skills/vibespace-cli/SKILL.md`。需要 mkdir -p 中间目录
- **不动 `.aimon/skills/`**：v1 边界
- **不动 server / web / hook-script**：本任务严格在 `packages/cli/` 内 + 两份 README

## 边界对照（执行时不要越界）

只动以下文件：
1. `packages/cli/` 整个目录（新建）
2. `README.md`（加"CLI"小节）
3. `README.zh-CN.md`（加"CLI"小节）

**不动**：
- server / web / hook-script 任何源码
- 根 `package.json` / `pnpm-workspace.yaml`（除非新建 cli 后发现 workspace 没自动拾起）
- `.aimon/skills/` 任何文件
- `~/.claude/skills/` 任何文件（**只有** `vibespace skill install` 命令实际运行时才会写）

收尾 `git diff --name-only HEAD` 应只显示：
- `packages/cli/` 下的多个新文件
- `README.md` + `README.zh-CN.md`
- 可能的 `pnpm-lock.yaml`（新 package 引起的）
