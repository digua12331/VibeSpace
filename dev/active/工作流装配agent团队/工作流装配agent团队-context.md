# 工作流装配agent团队 · Context

## 关键文件（改动边界）

- `templates/agent-team/`（新建）：`team-explorer.md`、`team-implementer.md`、`team-verifier.md`、`team-rules-auditor.md`（dstRel→`.claude/agents/`）+ `team-usage.md`（dstRel→`.aimon/docs/team-usage.md`）。
- `packages/server/src/harness-template-service.ts`：
  - `getTemplateFiles()` L71-139：agents 来源从仓库根 `.claude/agents/`（vibespace-*）改为 `templates/agent-team/`；team-usage.md 进清单（kind="workflow-doc"）。
  - `applyHarnessTemplate()` L200-221：team 文件走"拷贝+末尾指纹标记"，并支持"有标记+未改+落后→刷新覆盖"；其他文件维持原样 copyFile/存在跳过。
  - `uninstallHarnessTemplate()` L243-275：新清单卸 team-*；新增 LEGACY_AGENT_FILES（7 个 vibespace-*.md）清理——仅当文件含 `vibespace-` 字面量（renamed 探测=未改造原件）才删；**projectPath 解析后等于 REPO_ROOT 时跳过 legacy 清理**（防止在本仓库点卸载删掉母版原件）。
  - `getHarnessStatus()` L152-184：agent kind 的 renamed 探测适配 team 命名——`renamed = 无有效指纹标记`（语义保持"用户已改造"）。
- `packages/server/src/routes/projects.ts`：apply（L305 起）/ remove（L414 起）serverLog meta 加团队 agent 数量（从 copied/removed 里数 `.claude/agents/team-` 前缀）。
- `templates/harness/install.sh` L59-63：agents for 循环源改 `templates/agent-team/`（文件头同步提醒要求两份实现一起改）；install.ps1 如有等价段同改。
- `scripts/agent-team-smoke.mjs`（新建）+ 根 `package.json` 加 `"smoke:agent-team"`。
- `dev/issues.md`：append 一条 `.aimon/skills` 错拷遗留。
- `packages/web/src/components/PermissionsDrawer.tsx`（可选轻量）：WorkflowTab 状态行加"团队 agent N/4"——数据源 `status.harness.entries`（kind==='agent' && exists），types.ts 已有 HarnessFileEntry，无需新字段。

## 决策记录

- **指纹标记设计**：装配时在 team 文件**末尾**追加一行 `<!-- vibespace-team-agent v=1 fp=<sha256hex12> -->`（fp=母版全文的 sha256 前 12 位）。放末尾因为 agent md 的 frontmatter `---` 必须在第一行，顶部插行会破坏解析。升级判定：剥离标记行后 hash==fp → 未改；fp != 当前母版 hash → 落后 → 覆盖（新内容+新标记）。无标记或 hash 不符 → 用户文件，不动。零渲染承诺保持：正文不做任何替换。
- **不做的抽象**：不存历史版本库、不做模板引擎、不加新 HarnessFileKind（team-usage 用现有 workflow-doc）；ApplyResult 形状不变（刷新计入 copied），前端 HarnessApplyShape 零改动。
- **REPO_ROOT 防护**：legacy 清理在本仓库跳过——这是事故级风险（卸载工作流会删掉 7 个母版原件），Codex"不加特殊分支"指的是共存场景，不适用于此。
- **skills 错拷不修**（plan 非目标）：getTemplateFiles 的 skills 段不动，issues.md 记录。
- **smoke 验证路径**：脚本 import `packages/server/dist/harness-template-service.js`（build 后产物），临时目录造假项目跑 装→重复→升级→卸 四条路径 + 内容安全断言（无 vibespace-/fastify/react/调色板/函数名）。仿 worktree-smoke 模板。
- 资深工程师检验：改动集中在一个 service + 模板内容，无新依赖、无新概念层级，不过度。

## 依赖与约束

- Claude Code agent md frontmatter：`name`/`description`/`tools`，`---` 必须首行；正文即 system prompt；末尾 HTML 注释不影响执行（实施第 2 步用现有 vibespace-* 文件结构对照验证）。
- `isHarnessApplied` 探测点是 `.aimon/skills/` 目录——本次不动 skills 拷贝，探测不受影响。
- 11 个已装项目的旧 vibespace-* 文件：依赖卸载时 legacy 清理或用户重新应用（apply 不主动删旧件——apply 只管装新；删除动作只在 uninstall 里，行为可预期）。
- 大脑文件清单（写进模板协议段）：`CLAUDE.md`、`dev/memory/manual.md`、`dev/memory/auto.md`、`dev/ARCHITECTURE.md`、`.aimon/skills/`（按任务相关挑读）——全部项目根相对路径，缺失=声明并退化。
- 类型检查：`pnpm -F @aimon/server build`；UI 改动则 `pnpm -F @aimon/web build`。
