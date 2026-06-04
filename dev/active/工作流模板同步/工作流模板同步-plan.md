# 工作流模板同步 · 计划

## 大哥摘要

这次任务是让别的项目用 VibeSpace 装"工作流"时（在 UI 上点"应用工作流"按钮那一下），那些项目能拿到**跟你 VibeSpace 仓库里现在用的同一套硬规则**——读写白名单、删公共代码先 grep、`dev/ARCHITECTURE.md` 扫描、`git diff` 自校验等等。

现在的状况是：装到目标项目的 `CLAUDE.md` 里写的是一份**老掉牙的工作流规则**（约半年前的版本，大哥摘要、三模型 plan 会审、操作日志规则、刚加的两条硬规则全都没有）——这是仓库里 `dev-docs-guidelines.ts`（一个嵌字符串的代码文件）一直没同步。

**做完后**：你新装一个项目（或卸了重装），它的 `CLAUDE.md` 里就是当前最新规则。**不会动到的东西**：你已经装过的项目（除非你点"卸载/重装"，规则旧版仍在）；UI 任何按钮位置、点法、行为都不变。

## 目标

让 VibeSpace 装到目标项目时，目标项目 `CLAUDE.md` 的工作流段与 VibeSpace 仓库 `CLAUDE.md` **当前版本**保持等效（去掉 VibeSpace 专属内容后）。**关闭 `AGENTS.md` 第 9 节第 1 条老 TODO**（"同步 CLAUDE.md 与 dev-docs-guidelines.ts"）。

### 验收标准（可观察）

1. **代码层**：`packages/server/src/dev-docs-guidelines.ts` 的 `DEV_DOCS_GUIDELINES` 字符串完全重写——grep 命中"读写白名单 / 破坏性变更协议 / 大哥摘要 / 多模型 / 多任务量级 / 操作日志 / git diff --name-only"等关键短语；`ISSUES_ARCHIVE_SECTION` 与新 `DEV_DOCS_GUIDELINES` 内嵌的 `## Issues 档案` 段逐字一致。
2. **行为层**：跑 `pnpm -C packages/server exec tsc -b`（项目层级类型检查）通过——证明字符串语法 OK，没把 backtick 转义搞错。
3. **手动验收（可选）**：找一个临时空目录用 VibeSpace UI 点"应用工作流"，验证生成的 `CLAUDE.md` 含新规则。**这条标"待大哥手动验收"**——AI 不自动跑 UI。
4. **TODO 收口**：`dev/issues.md` 里"同步 dev-docs-guidelines.ts" 那条勾掉为 `- [x]`；`AGENTS.md` 第 9 节第 1 条标为已完成（或删除）。

## 非目标

明确**这次不做**的事，避免任务发散：

- **不分发 `AGENTS.md`**（OpenAI Codex 副本）—— 当前 manifest 没有，本次保持不变。理由：本任务核心是同步规则副本，不是扩大分发面；OpenAI Codex 用户场景另立项再说。
- **不分发 `dev/ARCHITECTURE.md` 空模板** —— 那是项目级代码地图，必须由项目自己的人填；预填空模板对目标项目是噪声。规则里"plan 第 1 步扫 ARCHITECTURE.md"已经兼容"无相关章节就一句'扫过无相关章节'"。
- **不把 `dev-docs-guidelines.ts` 改成 loader**（顶部注释里的备选方案）—— 这是架构改动；当前问题用"重写字符串"就能解决；loader 还有"server 打包后能否找到 CLAUDE.md"的路径风险，不值得为这次顺手做。
- **不动 `harness-template-service.ts` 的 manifest** —— `.aimon/docs/*` 动态扫描已经自动同步刚改的 `team-agent-harness-dev-docs-workflow.md`；其他类目无需改动。
- **不升级已经装过旧版的目标项目** —— 现有目标项目里残留的旧版 `CLAUDE.md` 工作流段是用户的项目内容，VibeSpace 不主动改。如果用户想拿新版，需要手动卸载再装（UI 已支持）。
- **不动 `~/.claude/skills/dev-docs-workflow/SKILL.md` 全局 skill** —— 跨项目通用方法论，本次不下沉（auto.md 第 33 条经验）。

## 实施步骤

### 步骤 1：起草新版 `DEV_DOCS_GUIDELINES` 字符串

**编辑准则**（哪些保留 / 哪些剔除）：

**保留**（通用方法论）：
- "跟大哥说话的规矩"全段
- Plan 阶段（任务名 / 大哥摘要 / 目标 / 非目标 / 实施步骤 / 边界情况 / 风险）
- Plan 写作硬性规则（假设要显式 / 大方向有分叉才问 / UI 改动必须有浏览器可观察验收项 等）
- **三模型 plan 会审段**（可保留——`codex:rescue` / `ask-gemini` 是跨项目可用的 MCP/plugin）
- Context 阶段（关键文件 / 决策记录 / 依赖与约束 / 不停下等确认）
- Tasks 阶段（tasks.md + tasks.json 模板，**含 read_files / write_files 字段**）
- 执行时硬性规则（外科式改动 / 熔断 / 静态类型必须过类型检查 / **读写白名单** / **破坏性变更协议**）
- 操作日志规则（**泛化**：把"前端必须用 logAction (packages/web/src/logs.ts)"改成"前端用项目已有的 logAction 包装器（如 logs.ts 提供的）"；后端同理）
- Issues 档案 / 跨任务知识沉淀 / 可持续记忆（dev/memory/auto.md+manual.md）/ 上下文耗尽衔接 / 任务量级判断
- handoff 摘要规则（含末尾贴 `git diff --name-only HEAD`）

**剔除**（VibeSpace 专属）：
- 顶部第 1 段 "本项目通用方法论已抽离为 dev-docs-workflow skill..." 整段（提到 `~/.claude/skills/`、`vibespace-*` 子代理、`packages/server/data/logs/` 路径）
- "## 0. 会话启动与按需 Skill" 段里 `AIMON_SESSION_PROMPT_PATH` 硬规则（这是 Harness server 注入的，目标项目装了 Harness 后实际能跑——**保留**这一段，但提示"由 VibeSpace UI 提供"）
- 操作日志规则里硬编码的 `packages/server/data/logs/YYYY-MM-DD.log` 路径 → 改成"项目自定义日志落盘路径（VibeSpace 项目落在 `packages/server/data/logs/`）"
- Plan 第 1 步引用 `dev/memory/auto.md 2026-05-01 / 项目工作流统一装配 那条经验` 这种**具体条目编号**（目标项目没这条）→ 泛化为"参见项目记忆中关于 API 调用点检查的经验"
- "## Claude Code 配置分层"末段（这是 VibeSpace 仓库特有的 .claude/templates 分层文档）→ **整段剔除**

**风险**：剔除过度可能把方法论搞丢；剔除不足会污染目标项目。**自查**：写完后通读对照原 `CLAUDE.md`，检查哪些"看起来 VibeSpace 专属的措辞"其实是通用方法论（如"vibespace-rules-auditor"是专属，但"派交付前规则审查 subagent"是通用——用泛化措辞保留方法论）。

**如何验证**：grep 关键短语；通读字符串确认没有"vibespace-* / packages/server/data/logs/ / ~/.claude/skills/" 等专属字面值（除非作为"VibeSpace 自己用的"举例放在括号里）。

### 步骤 2：同步 `ISSUES_ARCHIVE_SECTION`

`dev-docs-guidelines.ts` 第 142 行起的 `ISSUES_ARCHIVE_SECTION` 是给 "缺章节就补" 升级逻辑用的独立副本——必须与 `DEV_DOCS_GUIDELINES` 内嵌的 `## Issues 档案` 段**逐字一致**。重写字符串时同步两份。

**如何验证**：把 `ISSUES_ARCHIVE_SECTION` 从两个常量里拿出来 diff，应一致。

### 步骤 3：本任务自身的 read_files / write_files 写好（新规则首次实战）

`tasks.json` 每步声明白名单。范围：
- `packages/server/src/dev-docs-guidelines.ts`（write）
- `dev/issues.md`（write，关 TODO 那条）
- `AGENTS.md`（write，第 9 节第 1 条标完成）
- `CLAUDE.md`（read，作为字符串重写的参照源）
- `dev/active/工作流模板同步/*`（write，三个 md + json）

**如何验证**：步骤 5 跑 `git diff --name-only HEAD` 自校验，所有路径在白名单内。

### 步骤 4：跑 `pnpm -C packages/server exec tsc -b` 类型检查

字符串内有大量 backtick / 反斜杠 / 模板字符串嵌套，重写后必须过类型检查（CLAUDE.md "执行时硬性规则" 已强制）。

**如何验证**：tsc 退出码 0；无新增类型错误。

### 步骤 5：关闭老 TODO

- `dev/issues.md` 里若有"同步 dev-docs-guidelines.ts"的条目把 `- [ ]` 改 `- [x]`
- `AGENTS.md` 第 9 节第 1 条标完成（删除该行或加 `（✅ 已于本任务解决）` 后缀）
- `CLAUDE.md` 第 9 节如有相同条目同步处理

**如何验证**：grep 三份文件，"dev-docs-guidelines"相关条目都已勾掉。

### 步骤 6：self-test diff 校验

最后一步勾完成前，跑 `git diff --name-only HEAD` 贴到 tasks.md 末尾，逐路径核对在白名单内。

### 步骤 7：交付 handoff 摘要

按 CLAUDE.md 新规则：≤10 行，第一行白话验收指引，末尾附 `git diff --name-only HEAD` 输出。

## 边界情况

- **`AIMON_SESSION_PROMPT_PATH` 那段在分发版要不要保留？** 保留——目标项目装了 `.aimon/skills/` 后，VibeSpace UI 给该项目起 session 时仍会注入这个环境变量（server 的 hook-installer 跑的是 `aimon-hook` bin，与目标项目无关）。但措辞改成"VibeSpace UI 在你 session 开始前注入"，让目标项目用户知道这是 UI 附带的。
- **目标项目没有 `dev/ARCHITECTURE.md`**：plan 第 1 步规则要求"无相关章节则一句'ARCHITECTURE 扫过无相关章节'即可"——文件不存在等同于无章节，规则已自然兼容。
- **目标项目没有 `dev/memory/`**：VibeSpace UI 第一次跑归档评审时会自动建。规则保留。
- **重写字符串里要不要带 markdown table？** 当前 `DEV_DOCS_GUIDELINES` 是纯 markdown 字符串，可以含 table——backtick 在 TS 模板字符串里 OK，反引号代码块用四反引号或转义。
- **如果重写后字符串太长（> 1000 行）**：保持，不为长度拆分。AGENTS.md 第 9 节那条 TODO 本来就是要这一份"完整副本"。

## 风险与注意

1. **字符串重写"剔除/保留"的判断主观**：剔太多 → 目标项目缺方法论；剔太少 → 含 VibeSpace 专属噪声。**缓解**：写完通读，自我对照"如果我是用 VibeSpace 装的别人项目，看到 'vibespace-explorer' / 'packages/server/' 这种字面会不会困惑？"——会就改。
2. **类型检查通过 ≠ 字符串内容对**：tsc 只检语法。**缓解**：grep 关键短语清单；如果时间允许，肉眼通读一次。
3. **现有装了旧版的目标项目**：本任务**不主动升级**。已写在非目标里。如果大哥之后想批量升级，是另一个任务（需要 UI 加"刷新工作流规则"按钮 + 规则版本号探测）。
4. **dev-docs-guidelines.ts 是 TypeScript 字符串字面量**，重写时 backtick / `${` / 反斜杠转义容易踩坑。**缓解**：用 Read+Edit 而不是 Write 整文件——保留模块顶部 import 和导出语法不动，只换字符串体；Edit 失败立即停手，不要硬试。
5. **`dev-docs-guidelines.ts` 顶部那条注释里"内容镜像仓库根的 CLAUDE.md；修改时请同步两处"**——重写后这条仍然准确（同步未来还会再发生），保留。但"或把此文件变成 loader"那句的方案这次没采纳，可以保留作为未来选项。

## 多模型 Plan 会审

跳过：本任务核心决策不是技术结构、而是**产品边界**——剔除多少 VibeSpace 专属、是否扩大分发面到 AGENTS.md / ARCHITECTURE 模板。这些只能由大哥拍板，Gemini/Codex 没有项目记忆和产品上下文，介入会建议已被否决的扩张方案，徒增噪声。重写字符串副本本身是工程上很收敛的工作，不需要外部结构评审。
