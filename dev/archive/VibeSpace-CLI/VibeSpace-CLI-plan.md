# VibeSpace CLI · Plan

## 大哥摘要

给 VibeSpace 加一个**命令行工具**（CLI，"在终端里敲一行字让电脑干事"的小工具），名字就叫 `vibespace`。装好之后，**AI 助手**（你跟 Claude 或 Codex 在 VibeSpace 里聊天时那些 AI）能在它自己的终端里直接敲 `vibespace project create my-app` 这样的命令，**自己**给你创建项目、起会话、读写 Dev Docs，不需要每次你点 UI 帮它点。

VibeSpace 后台**必须先在跑**（CLI 是它的客户端，跟你浏览器一样需要后台），这个限制 Codex 提醒了，我们 v1 不做脱机模式。

同时把"这个 CLI 怎么用"做成 **skill**（"AI 知识小卡片"，写到 `~/.claude/skills/vibespace-cli/`），AI 启动时自动知道**有这个工具、什么时候该用、怎么调**。skill 真源放在 monorepo 里跟代码一起维护，再提供一个 `vibespace skill install` 命令把它一键复制到 Claude 的全局目录。

**你能在哪里验收**：
1. 启动 VibeSpace 后台 → 在任意 shell 里敲 `vibespace ping` 应该返回 `ok backend=http://127.0.0.1:8787`
2. 敲 `vibespace project create 测试项目` → 浏览器里 VibeSpace 项目列表能看到这个项目
3. 在 Claude Code（或 Codex）终端里让 AI 自己创项目（"创建一个叫 demo 的 VibeSpace 项目"）→ AI 自己调 `vibespace` 命令完成
4. AI 调任何 mutation（改数据的命令）时，LogsView 里都看得到后端的起止配对日志

**风险已识别**：误删项目（要求 `--yes` 才执行），CLI 找不到后端（专门一个 ping 命令 + 错误码 2 + 友好提示），Windows 跨平台 bin（pnpm workspace 自动 shim，已验证 hook-script 包同模式跑通）。

---

## 目标

- 新增 `packages/cli`（`@aimon/cli`）—— pnpm workspace 自动拾起；零第三方依赖（参考 `packages/hook-script`）；bin 名 `vibespace`
- v1 命令子集：
  - `vibespace ping`（自检后端连通）
  - `vibespace project create|list|delete|switch`
  - `vibespace session start <agent> [--project <id>] [--task <name>]`
  - `vibespace docs read|write|archive`
  - `vibespace skill install`（把 monorepo 里的 skill 真源复制到 `~/.claude/skills/vibespace-cli/`）
- AI-friendly：**所有读类命令 `--json` 输出稳定结构**；mutation 命令默认人类可读，加 `--json` 也给结构化；错误输出统一 `error: <short_code>` + 一行人话
- 破坏性命令安全闸：`project delete` / `docs archive` 必须 `--yes` 才执行，否则只打印"这会删 X"然后退出 3
- skill 文件真源放 `packages/cli/skill/vibespace-cli.md`（跟 CLI 一起维护），用户/AI 通过 `vibespace skill install` 复制到 `~/.claude/skills/vibespace-cli/SKILL.md`
- 配置优先级写死：**命令参数 > 环境变量 `VIBESPACE_BACKEND` / `VIBESPACE_PROJECT` > `~/.vibespace/config.json` > 默认 `http://127.0.0.1:8787`**

### 验收标准（你能验收的）

1. `pnpm install` 后 `pnpm exec vibespace ping` 在仓库根能跑，返回 `ok backend=...`（耗时 < 100ms）
2. 关掉 VibeSpace 后台再敲 `vibespace ping`：退出码 2，输出 `error: backend_unreachable` + 一行"请先启动 VibeSpace 后端"
3. `vibespace project create 烟测项目` → 浏览器 VibeSpace 项目列表里出现"烟测项目"
4. `vibespace project list --json` → 输出 JSON 数组，含 id/name/path/createdAt 等字段
5. `vibespace project delete <id>` 不带 `--yes` → 只打印"这会删除项目 <id> '<name>'，加 --yes 确认"然后退出 3
6. `vibespace project delete <id> --yes` → 真删，浏览器列表对应消失
7. `vibespace session start claude --project <id>` → 浏览器对应项目里出现新 claude 会话
8. `echo "# plan 内容" | vibespace docs write <task> --type plan --project <id> --stdin` → 浏览器 Dev Docs 里看到这份 plan
9. `vibespace docs read <task> --type plan --project <id>` → 输出 plan.md 内容到 stdout
10. `vibespace skill install` → `~/.claude/skills/vibespace-cli/SKILL.md` 出现，文件内容来自 `packages/cli/skill/vibespace-cli.md`
11. **AI 验收**：在新开的 Claude Code 终端里说"用 vibespace 给我列一下当前所有项目"，AI 应该认出该用 `vibespace project list --json` 并执行（说明 skill 触发起效）
12. LogsView 里 `vibespace project create` 调出的后端日志带正常 `scope=project action=create` 起止配对（CLI 端**不**再额外打日志，避免双份；记忆条 [2026-05-02 / 工作流入口形态对齐] 已警告"前后端日志一致性"）

## 非目标

- **不做脱机模式**（后台必须在跑；v2 再考虑本地 SQLite 直读）
- **不做 watch / streaming 模式**（`session start` 起完 session 就退出，不挂在前台 tail 输出；AI 想看输出去 UI 或 v2 的 `logs tail`）
- **不做认证 / token 鉴权**（127.0.0.1 本机绑定，跟现有 server 一致；远程访问是另一个任务）
- **不引入 commander / yargs**（手写极小 arg parser，明示"不支持复杂缩写 / 组合短参数"；命令数到 8 个还在可控范围）
- **不做 list 类的模糊匹配**（all ID 必须完整传，避免 AI 看错 ID 把项目删错）
- **不动 `.aimon/skills`**（v1 skill 只放 `~/.claude/skills/`，让 Claude 全局任何项目都能用）
- **不在 v1 加日志/使用量子命令**（你 AskUserQuestion 已经排除）

## 实施步骤

### 1. 建 `packages/cli` 骨架

- `packages/cli/package.json`：`name: @aimon/cli`、`type: module`、`bin: { vibespace: "./bin/vibespace.mjs" }`、`engines.node: >=20`，无 dependencies
- `packages/cli/bin/vibespace.mjs`：shebang `#!/usr/bin/env node`，dispatch 到 `src/` 各命令
- `packages/cli/src/`：
  - `api.ts`（不，是 `.mjs`，纯 JS 避免 tsc 步骤）：fetch 包装器 + 错误处理
  - `args.mjs`：极小 arg parser（白话翻译：把 `--foo bar --baz` 这种字符串切成 `{foo: 'bar', baz: true}`）
  - `config.mjs`：`~/.vibespace/config.json` 读写
  - `commands/{ping,project,session,docs,skill}.mjs`：每条命令一个文件
- `packages/cli/skill/vibespace-cli.md`：skill 真源（frontmatter + 触发场景 + 命令清单 + 示例）

**verify**：`ls packages/cli/bin packages/cli/src/commands`；`pnpm install` 完成

### 2. 实现 `vibespace ping` + arg parser + 配置层

- `ping`：fetch `${backend}/api/health` 1.5s 超时；正常 → exit 0 + `ok backend=<url>`；失败 → exit 2 + `error: backend_unreachable` + 一行"请先 pnpm dev 启动 VibeSpace 后端"
- arg parser：支持 `--key value`、`--key=value`、`--flag`（boolean）、positional args；不支持短参 `-x`、不支持组合 `-xvf`；遇到 unknown flag 退出 3
- config 加载顺序：CLI args > env > `~/.vibespace/config.json` > default

**verify**：`vibespace ping` 通；关后台再跑得到 exit 2 + 友好提示；`vibespace --unknown-flag` 得到 exit 3

### 3. 实现 `project` 子命令

- `project create <name> [--path <dir>]` → POST `/api/projects`
- `project list [--json]` → GET `/api/projects`；默认人类格式（id 短8位 / name / status），`--json` 输出原始 JSON 数组
- `project delete <id> [--yes]` → 无 `--yes` 时 exit 3 + 打印"这会删除项目 <id> '<name>'，加 --yes 确认"；有 `--yes` 时 DELETE `/api/projects/:id`
- `project switch <id>` → 写 `~/.vibespace/config.json` 设 currentProjectId；输出"已切换默认项目 = <id> <name>，后续命令可省略 --project"

**verify**：4 条命令在 VibeSpace 跑着时全部工作；浏览器看得到变化；LogsView 看到对应 serverLog 起止

### 4. 实现 `session start`

- `session start <agent> [--project <id>] [--task <name>]` → POST `/api/sessions`，body 含 projectId/agent/task
- agent 合法值：`claude` / `codex` / `gemini` / `shell` / `cmd` / `pwsh`，非法值 exit 3
- 输出新 session 的 id；不挂前台不 tail 输出（v2 再加 `session watch` 之类）

**verify**：`vibespace session start claude --project <id>` → 浏览器对应项目里出现 claude 会话

### 5. 实现 `docs read|write|archive`

- `docs read <task> --type <plan|context|tasks> [--project <id>] [--json]` → GET docs；默认输出 raw md 文本（write 是反向操作）
- `docs write <task> --type <type>` 接受三种内容来源（**优先级**写死）：
  1. `--content <inline>`（命令行直接给内容；小内容用）
  2. `--file <path>`（从本地文件读）
  3. `--stdin`（从 stdin 读；AI 管道用）
  三种都没给 → exit 3
- `docs archive <task> [--project <id>] [--yes]` → POST 归档接口；无 `--yes` 同 delete 安全闸

**verify**：三种 docs 命令通；`echo X | vibespace docs write Y --stdin` 工作

### 6. 实现 `skill install`

- 读 `packages/cli/skill/vibespace-cli.md` → 写 `~/.claude/skills/vibespace-cli/SKILL.md`
- 文件已存在且内容相同 → exit 0 + "已是最新"
- 文件已存在但内容不同 → 需 `--force` 覆盖，否则 exit 3 + 提示
- 输出最终路径

**verify**：跑完后 `cat ~/.claude/skills/vibespace-cli/SKILL.md` 内容与 monorepo 真源一致

### 7. 写 skill 真源

`packages/cli/skill/vibespace-cli.md` 内容包括：
- frontmatter（name / description 含真实触发词："创建 VibeSpace 项目" / "VibeSpace 起会话" / "VibeSpace dev docs"）
- "什么时候用 vibespace 命令"段（先检查 `vibespace ping` 是否通；通才可继续）
- 命令清单（每条带 1 行白话 + 示例）
- 安全注意：mutation 必须用完整 ID、`--yes` 显式确认
- 关键约束：CLI 是操作工具，**不取代** Dev Docs 三段式工作流（即 AI 不能用 `docs write` 跳过 plan 阶段直接写 tasks；这个边界要写进 skill 文案，避免 AI 混淆）

**verify**：人工读 SKILL.md 文案是否清晰；触发词在 "用 vibespace 创建项目"、"vibespace list 项目"、"vibespace 起 claude" 这些自然话术下能命中

### 8. 文档更新

- `README.md` / `README.zh-CN.md` 各加一个"CLI（命令行工具）"小节：装、ping、典型场景、Skill 安装路径
- 不动 `.aimon/skills/`（v1 不放项目级 skill）

**verify**：双语 README 都有这一节；不漏

### 9. 类型检查 + 烟测 + 浏览器自测

- `pnpm install`（让 workspace 拾起新 package）
- 跑各条命令的人工烟测（验收 1-11）
- `pnpm -F @aimon/cli lint`（如果没 lint 就用 `node --check` 检查每个 .mjs 语法）

**verify**：12 条验收逐条人工跑过

## 非目标外的边界情况

- **后端不可达**：所有命令开头先内置 ping 检查（1s 超时）；不通直接 exit 2
- **VibeSpace 后台版本不匹配**：v1 不做版本协商；v2 在 ping 响应里加 server version 比对
- **项目 ID 不存在**：返回 exit 1 + `error: project_not_found`
- **docs write 内容超大**：用 fetch + Buffer 直传；预计单 doc 不超 1MB（plan/context/tasks 都是 md）
- **Windows 路径分隔符**：用 `node:path` 模块，避免硬编码 `/` 或 `\\`
- **多版本并存**：用户/AI 可能装多份 vibespace（pnpm workspace、npm link、global install）。skill 文档建议优先使用 `pnpm exec vibespace`（仓库内）

## 风险与注意

- **R1（高）**：v1 skill 只放 `~/.claude/skills/`，但 VibeSpace 项目里 AI 调起的 Claude session 是否会自动加载 `~/.claude/skills/`？需要在 verify 11 实测确认（理论上 Claude Code 会扫这个目录，但要看 hook-installer 是否影响）
- **R2（中）**：手写 arg parser 边界 case 多（unknown flag、缺参、`--key=val` vs `--key val`）。Codex 评审第 21 条警告"未知参数/缺参/多余参数边界行为必须测试覆盖"。实施步骤 2 要带边界测试
- **R3（中）**：mutation 命令默认输出人类可读 + `--json` 备份。AI 该用 `--json` 但有时会忘——skill 文案要明确"AI 调用时永远加 --json"
- **R4（低）**：`session start` 不挂前台。AI 可能期望"起完会话就能看到输出"——skill 文案要明确"v1 不 tail 输出，要看 PTY 输出去 UI"
- **R5（低）**：`vibespace skill install` 会覆盖 `~/.claude/skills/vibespace-cli/` 的内容。如果有其他工具也写这个路径会冲突；不太可能但记录在文档里
- **R6（低）**：Windows + pnpm + bin shim。已验证 hook-script 同模式跑通，CLI 沿用应没问题；但要在 verify 阶段实测一次

## 多模型 Plan 会审

> [Codex 评审 1] "新建 `packages/cli` 是合理边界；要确认它只调用后端 API，不复制后端业务逻辑。"
>
> [Codex 评审 2] "CLI 应有一个 AI 可先跑的自检命令（如 `vibespace ping`），明确返回'后端不可达'。" → **采纳**，作为 step 2 核心
>
> [Codex 评审 3] "配置优先级必须写死并可被 AI 读懂：命令参数 > 环境变量 > 配置文件 > 默认值。" → **采纳**，写进配置层
>
> [Codex 评审 4] "delete/archive 这类破坏性操作要考虑 AI 误调用；至少需要明确 ID、不可模糊匹配，最好有 `--yes` 之类显式确认。" → **采纳**，安全闸贯穿所有破坏性命令
>
> [Codex 评审 5] "AI 更适合稳定 JSON 输出；建议所有命令提供 `--json`。" → **采纳**，read 类默认 JSON 友好；mutation 提供 `--json` 备份
>
> [Codex 评审 6] "错误输出应包含机器可判断的短码或固定文案。" → **采纳**，统一 `error: <short_code>` 格式
>
> [Codex 评审 7] "docs write 内容来源（stdin/文件/参数）三者优先级 plan 草案里尚未定义。" → **采纳**，step 5 写死三种来源 + 优先级
>
> [Codex 评审 8] "如果目标是'所有 AI agents 在本项目内用'，项目级 `.aimon/skills` 更贴近 VibeSpace；如果目标是'本机 Claude 全局用'，`~/.claude/skills` 更合理——两者可以同步一份，但要说明谁是真源。" → **采纳**，v1 真源在 monorepo `packages/cli/skill/`，安装到 `~/.claude/skills/`，v2 再考虑 `.aimon/skills/` 同步
>
> [Codex 评审 9] "零依赖符合 monorepo 轻量目标；但当前命令数（8 条 + flags）已接近手写 parser 维护临界点。" → **采纳但维持零依赖**，arg parser 极小化 + 明示不支持复杂特性
>
> [Codex 评审 10] "vibespace-cli skill 文案要强调 CLI 是操作工具，不改变本项目的 Plan/Context/Tasks 规则。" → **采纳**，step 7 skill 文案显式写"不取代 Dev Docs 三段式"
>
> [Gemini 评审] 跳过：`spawn gemini ENOENT`（本机 gemini CLI 未安装）。
>
> [Claude 综合 + 白话化] 采纳 Codex 全部要点。本任务从单纯"加个 CLI"扩展到"CLI + skill + 安全闸 + JSON 协议"，规模适中但落地稳健。一次完工还是分两阶段？我倾向**一次完工**——9 步实施都属于同一个 package，拆开反而增加协调成本；如果你担心范围太大，最小可用是 step 1+2+3+7（建包 + ping + project 命令 + skill 真源），其余 step 4-6+8-9 留 v1.1。
