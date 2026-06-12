# 工作流模板同步 · 上下文

## 关键文件

### 要改（write_files）

- `packages/server/src/dev-docs-guidelines.ts`
  - 行 10-140：`export const DEV_DOCS_GUIDELINES = ` backtick 字符串体——整段重写
  - 行 146-172：`export const ISSUES_ARCHIVE_SECTION = ` backtick 字符串体——与新 `DEV_DOCS_GUIDELINES` 内嵌的 `## Issues 档案` 段逐字一致
  - 行 1-9 + 142-145：模块顶部注释 + 中间注释——保留架构（"内容镜像仓库根的 CLAUDE.md；修改时请同步两处"），但加一句"本文件 2026-05-07 由'工作流模板同步'任务整体重写到 CLAUDE.md 当前版本"
- `.aimon/docs/team-agent-harness-dev-docs-workflow.md`
  - 行 346 第 1 条 TODO："同步 `CLAUDE.md` 与 `packages/server/src/dev-docs-guidelines.ts`..." → 标完成（追加 `（✅ 已于 2026-05-07 解决）` 后缀，保留历史不删除）
- `dev/active/工作流模板同步/*`（本任务自身的 plan / context / tasks / tasks.json）

### 只读（read_files）

- `CLAUDE.md`（重写 `DEV_DOCS_GUIDELINES` 字符串的参照源 —— 1.0 倍长复制 + 剔除专属 + 泛化）
- `packages/server/src/workflow-service.ts:18-22, 96, 102`（确认 `DEV_DOCS_GUIDELINES` / `ISSUES_ARCHIVE_SECTION` 消费方只把字符串当文本写入文件，不依赖具体内容）
- `packages/server/src/harness-template-service.ts`（已读完——确认 `.aimon/docs/*.md` 动态扫描分发，不改 manifest）
- `dev/issues.md`（grep 已确认无相关条目，**不**写入此文件）
- `AGENTS.md`（grep 已确认无 "## 9. 当前项目的后续补强项" 类节，**不**写入此文件）

## 决策记录

### 决策 1：plan 偏差——TODO 位置只在 .aimon/docs/，不在 AGENTS.md/CLAUDE.md

**原因**：plan 步骤 5 误写"AGENTS.md 第 9 节第 1 条 + CLAUDE.md 第 9 节同步处理"——`grep "同步.*CLAUDE.md.*dev-docs-guidelines"` 在 AGENTS.md / CLAUDE.md 都 0 命中；只在 `.aimon/docs/team-agent-harness-dev-docs-workflow.md:346` 命中。
**修正**：write_files 收窄到 `.aimon/docs/team-agent-harness-dev-docs-workflow.md` 一处。
**为何不回 plan 重新确认**：这是"在哪关 TODO"的位置细节，不影响大方向（关闭老 TODO 这件事仍成立）也不影响验收方式（grep 那条 TODO 已标完成仍可观察）。CLAUDE.md "唯一例外" 触发条件是"plan 实际不可行"——这条不属于。

### 决策 2：值升级，不触发破坏性变更协议

**情形**：改 `export const DEV_DOCS_GUIDELINES`（被跨文件 import 的导出符号）的值。
**判断**：破坏性变更协议第 3 条针对"修改、重命名、删除"导出符号——这里**符号名 / 类型签名（`string`）/ 导出方式都不变**，只是字符串值更新。
**自查 grep**：`workflow-service.ts:18-22 + 96 + 102` 是仅有的两处 import，都把字符串当作纯文本写入文件，**不依赖任何具体行内容**。
**结论**：不触发协议。但仍会跑 `tsc -b` 类型检查作为兜底（CLAUDE.md 静态类型硬规则）。

### 决策 3：保留三模型 plan 会审段不剔除

**取舍**：CLAUDE.md "Plan 阶段默认流程：三模型会审" 提到 `codex:rescue` 插件 + MCP 的 `ask-gemini`——两者都是**跨项目可用**的（用户机器全局安装），不是 VibeSpace 仓库专属。**保留**整段，目标项目装出来后也能跑（前提：用户装了对应工具）。
**资深工程师视角**：会觉得过度设计吗？不会——是泛用方法论，跨项目带过去合理。

### 决策 4：操作日志规则保留方法论 + 泛化具体函数名/路径

**剔除**：`packages/web/src/logs.ts` / `packages/server/src/log-bus.ts` / `packages/server/data/logs/YYYY-MM-DD.log` 这些 VibeSpace 仓库专属路径。
**保留**：起止配对、`level=info/error`、`scope`/`action` 取小写词/动词、`meta` JSON-serializable ≤2KB、必填字段清单、验收必须 "在 LogsView 看到 scope=X action=Y 起止配对" 这条。
**泛化措辞**：把"前端必须用 logAction（见 packages/web/src/logs.ts）"改成"前端用项目内的 logAction 包装器（VibeSpace 项目落在 `packages/web/src/logs.ts`）；后端用 serverLog（VibeSpace 项目落在 `packages/server/src/log-bus.ts`）；其他项目用各自的等价物"——**括号举例自然带出 VibeSpace 路径**，对装在 VibeSpace 仓库的项目仍精确，对其他项目就是建议性引用。
**为什么不彻底剔除路径**：剔了之后目标项目用户找不到样本。括号引用 = 自带 fallback。

### 决策 5：AIMON_SESSION_PROMPT_PATH 段保留

**事实**：`.aimon/skills/*` 模板会被 harness-template-service 拷到目标项目；目标项目用 VibeSpace UI 起 session 时，server 仍会按任务名匹配 `.aimon/skills/` 注入 `AIMON_SESSION_PROMPT_PATH`——这个机制对装了 Harness 的目标项目有效。
**结论**：保留这段。但措辞可加一句"该环境变量由 VibeSpace UI 在 session 启动时注入；如果项目独立运行（不通过 VibeSpace UI 起 session），变量不存在，按 'skill prompt 未注入' 处理即可"。

### 决策 6：剔除"## Claude Code 配置分层"末段

**理由**：CLAUDE.md 末段 "## Claude Code 配置分层" 引用 `docs/claude-config-tiers.md` 和 `.claude/templates/`——这些是 VibeSpace 仓库内的具体文档/模板，目标项目没有。整段剔除。

### 决策 7：剔除 CLAUDE.md 顶部第 1 段（提到全局 skill）

**原文**："本项目通用方法论已抽离为 `dev-docs-workflow` skill（落盘在 `~/.claude/skills/dev-docs-workflow/SKILL.md`）..." 整段。
**理由**：这段说的是"本仓库的元规则与全局 skill 的关系"——是 VibeSpace 仓库自身的元约束，分发到目标项目无意义。剔除。
**替代**：分发版顶部加一句"本工作流由 VibeSpace UI 装配；可在「Dev Docs」侧栏卸载"。

### 决策 8：关老 TODO 用追加 ✅ 后缀，不删除

**理由**：保留历史可回溯（auto.md 第 17 条经验"保留历史不删除"在 dev/issues.md 处理上已是惯例）。
**格式**：`原文（✅ 已于 2026-05-07 解决：本仓 dev-docs-guidelines.ts 已与 CLAUDE.md 当前版本同步——任务"工作流模板同步"）`

### 决策 9：模块顶部注释保留 "或把此文件变成 loader" 那句

**理由**：未来仍可能采纳 loader 方案（plan 非目标里写明这次不做）。保留作为未来选项。

## 依赖与约束

### 兼容性

- `workflow-service.ts::appendToClaudeMd` 用 `MAIN_GUIDELINES_ANCHOR = "# Dev Docs 工作流"` 判断"已存在"——重写后字符串首行仍是 `# Dev Docs 工作流`，anchor 不变，**幂等性保持**。
- `workflow-service.ts::insertSectionBeforeSeparator` 用 `ISSUES_SECTION_ANCHOR = "## Issues 档案"` 判断"已存在"——重写后此 anchor 也不变。
- 已经装过旧版的目标项目：CLAUDE.md 里有 anchor → apply 重新跑会 no-op（plan 非目标已写明本任务不主动升级）。
- TS 类型签名不变（仍是 `string`）——消费方代码不需要改。

### 执行顺序约束

- 步骤 1（确认引用图）已在 context 阶段完成 → 步骤 2（重写 DEV_DOCS_GUIDELINES）→ 步骤 3（同步 ISSUES_ARCHIVE_SECTION，与新 DEV_DOCS_GUIDELINES 内嵌段保持一致）→ 步骤 4（tsc -b）→ 步骤 5（grep 关键短语验证）→ 步骤 6（关老 TODO）→ 步骤 7（self-test diff）→ 步骤 8（handoff）

### 不变约束（任务结束时仍成立）

- `MAIN_GUIDELINES_ANCHOR` / `ISSUES_SECTION_ANCHOR` 字面值不变
- `DEV_DOCS_GUIDELINES` / `ISSUES_ARCHIVE_SECTION` export 名 + 类型不变
- `workflow-service.ts` 不被本任务触碰
- `harness-template-service.ts` 不被本任务触碰（manifest 已经能动态扫到 `.aimon/docs/*` 改动）
- `~/.claude/skills/dev-docs-workflow/SKILL.md` 不被本任务触碰

## 任务边界

**做**：
- 重写 `dev-docs-guidelines.ts` 两个常量字符串
- 关 `.aimon/docs/team-agent-harness-dev-docs-workflow.md:346` 那条老 TODO
- 跑 `pnpm -C packages/server exec tsc -b` 验证
- 完整跑通本任务自身的 read_files / write_files / git diff 自校验流程（新规则首次实战）

**不做**：
- 不动 `workflow-service.ts` / `harness-template-service.ts` / 现有 manifest
- 不动 `AGENTS.md` / `CLAUDE.md`（grep 确认这两份没相关 TODO 条目）
- 不动 `dev/issues.md`（grep 确认无相关条目）
- 不实现"刷新已装项目工作流" UI 入口（plan 非目标）
- 不分发 `AGENTS.md` / `dev/ARCHITECTURE.md` 模板（plan 非目标）
- 不把 dev-docs-guidelines.ts 改成 loader（plan 非目标）
