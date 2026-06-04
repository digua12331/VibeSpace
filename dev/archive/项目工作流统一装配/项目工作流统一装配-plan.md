# 项目工作流统一装配 · 计划

## 主理人摘要

- **这次要做什么**：把"主理人入口手册"和"AI 执行手册"两份说明书从 `docs/` 搬到 `.aimon/docs/`，让它们随"Harness 团队配置"一次性拷到新项目；并把权限抽屉里现在两个并排的开关（"Dev Docs 三段式工作流"和"Harness 团队配置"）合并成一个开关——主理人视角下装这套东西就是一件事，不应该分两块。
- **做完后在哪里点哪里能看到**：
  1. 打开任意项目的「权限」抽屉（permissions drawer，AI 配置侧栏）→「工作流」那一栏，原来上下两个块（"Dev Docs 三段式工作流"+"Harness 团队配置"）合成一个块，叫"项目工作流"；点"应用"会一次装好（写 CLAUDE.md 工作流段 + 拷 `.aimon/`/`.claude/agents/`/`dev/agent-team-blueprint.md`/`dev/harness-roadmap.md`/**两份 docs**），点"卸载"也是一次性撤销。
  2. 应用之后到目标项目里看，多出 `.aimon/docs/agent-harness-overview.md` 和 `.aimon/docs/team-agent-harness-dev-docs-workflow.md` 两份说明书。
  3. 本仓库的 `docs/agent-harness-overview.md` / `docs/team-agent-harness-dev-docs-workflow.md` 两份文件**不再出现在 docs/**（它们已经搬走，原位置被删除）。
- **会不会动到已有数据/界面**：
  - 不会动业务数据、不会动会话、不会动用户文件。
  - 会动：本仓库 `docs/` 下两份说明书的位置（搬到 `.aimon/docs/`）、`.gitignore` 白名单、CLAUDE.md 末尾"真源文档"表里的两条引用路径、PermissionsDrawer.tsx 的 UI（两块合成一块）、harness-template-service.ts 的拷贝清单、**后端 routes/projects.ts**（删旧的 4 个 apply/remove 端点 + 3 个 status 端点，加新的 3 个统一 workflow 端点）、**前端 api.ts**（删旧调用函数、加新调用函数）。
  - **已经装过 Harness 的旧项目**会有一个手动操作：旧项目里没有这两份新加的 docs，需要在该项目权限抽屉里点一次"卸载"再点"应用"，才能补上。这是 `applyHarnessTemplate` 现行的"已存在则跳过"语义决定的，不是 bug，但要提醒主理人。
- **验收方式**：
  1. 浏览器打开权限抽屉，"工作流"区只剩**一个**块（不是两个），名字叫"项目工作流"，状态显示"已应用 / 未应用"，按钮"应用 / 卸载"。
  2. 在一个干净的目标项目里点"应用"，到该项目目录看：`.aimon/skills/*.md`、`.claude/agents/*.md`、`dev/harness-roadmap.md`、`dev/agent-team-blueprint.md`、`.aimon/CUSTOMIZE-harness.md`、`.aimon/docs/agent-harness-overview.md`、`.aimon/docs/team-agent-harness-dev-docs-workflow.md` 全都在；CLAUDE.md 含 Dev Docs 工作流守则段。
  3. 点"卸载"后这些文件被清理（按现行 `uninstallHarnessTemplate` 的清单逐项 unlink），CLAUDE.md 工作流段被移除，状态翻"未应用"。
  4. LogsView 看到 `scope=project action=apply-workflow` 与 `action=remove-workflow` 各一次起止配对。
  5. 故意把目标项目里某份 docs 文件锁住（chmod / 占用），点"应用"，failedFiles 在弹窗列出该文件——失败分支至少触发过一次 ERROR。
- **风险**：
  - 旧已应用项目的"补拷"问题（见上）。
  - **底层也合并**（按主理人指示从原 plan 的"不合并"改过来）：新增 `POST /api/projects/:id/workflow`、`DELETE /api/projects/:id/workflow`、`GET /api/projects/:id/workflow-status` 三个统一端点；旧的 7 个端点（`apply-dev-docs` / `dev-docs`-DELETE / `dev-docs-status` / `harness`-POST / `harness`-DELETE / `harness-status` / `harness-applied`）一并删除，前端只剩 PermissionsDrawer 一个消费者，没有第二个调用方。合并 service 函数 `applyWorkflowToProject` 在内部按"先 Dev Docs（写 CLAUDE.md 段）→ 后 Harness（拷文件）"顺序调用，第一个失败 abort 第二个；返回聚合结果 `{ devDocs: ..., harness: ..., partial: boolean }`。`removeWorkflowFromProject` 反向（先卸 Harness 文件再卸 CLAUDE.md 段），失败收集到 `failedFiles`。

## memory 扫过

- `dev/memory/manual.md` 2026-04-24 主理人偏好：小功能直接改不走流程。本任务**不**符合"小功能"——多文件 + 跨模块 + UI 合并 + 后端 manifest 改动，按默认档走完整流程。
- `dev/memory/manual.md` 2026-04-30 主理人偏好（确认压成一次）：本 plan 写完后等主理人确认主理人摘要，context/tasks 不再停下等。
- `dev/memory/manual.md` 2026-04-30 三模型会审：默认档应当三模型会审。本任务变更面清晰、方案选择不多，但仍按规则跑——见末尾 `## 多模型 Plan 会审`。如果外部工具不可用，会按 CLAUDE.md 第 99-101 行规则记一行跳过原因，不阻塞 plan 交付。
- `dev/memory/auto.md` 仅 hook-smoke 样例，无相关条目。

## 目标

1. 把 `docs/agent-harness-overview.md` 和 `docs/team-agent-harness-dev-docs-workflow.md` 物理搬到 `.aimon/docs/` 下（保留原文件名，避免引用同步出错）。
2. `harness-template-service.ts::getTemplateFiles()` 加上 `.aimon/docs/*.md` 拷贝条目；`uninstallHarnessTemplate` 由于走的是 manifest 反向 unlink，自动覆盖；末尾 `rmdir` 兜底列表加 `.aimon/docs`。
3. CLAUDE.md 末尾"真源文档"表里两条引用路径同步到 `.aimon/docs/...`。
4. `.gitignore`：移除两条 `!docs/...` 白名单（因为文件已经搬走）；`.aimon/docs/` 不需要新加白名单（`.aimon/` 顶层未被 ignore，只有 `.aimon/runtime/` 被 ignore）。
5. `PermissionsDrawer.tsx` UI 合并：原来两个 `<div>` 块（line 1173-1217 Dev Docs + line 1219-1265 Harness）合并为一个块"项目工作流"。
   - 状态：两边都已应用 → "已应用"；两边都未应用 → "未应用"；只有一边应用 → "部分已应用"（点"应用"会补另一边；点"卸载"会撤销已应用的那边）—— 状态由后端 `workflow-status` 聚合返回。
   - 应用按钮：调 `api.applyWorkflow(projectId)` 一次，包在 `logAction('project', 'apply-workflow', fn)` 里；后端聚合 service 内部依次跑两件事，失败 alertDialog 提示。
   - 卸载按钮：先弹 confirmDialog danger 二次确认，确认后调 `api.removeWorkflow(projectId)` 一次，包在 `logAction('project', 'remove-workflow', fn)` 里。
6. 验收时对应步骤的 `verify:` 写明 LogsView 里能看到 `scope=project action=apply-workflow` / `remove-workflow` 起止配对（后端 `serverLog`），以及前端 `logAction` 的对应起止两条。

## 验收标准

- 浏览器抽屉"工作流" tab 只剩一个块"项目工作流"，按钮形态、点击行为同 plan 第 5 条。
- 干净目标项目应用后，`.aimon/docs/agent-harness-overview.md` 与 `.aimon/docs/team-agent-harness-dev-docs-workflow.md` 都在；卸载后被清。
- LogsView 起止配对见到 `apply-workflow` / `remove-workflow`。
- 失败分支：人为锁住一份目标 docs 文件，点"应用"得到 failedFiles 列出该文件 + ERROR 日志条目。
- 类型检查：`pnpm --filter @aimon/server exec tsc -b` 与 `pnpm --filter @aimon/web exec tsc -b` 都过。

## 非目标

- 不重构 `applyHarnessTemplate` / `applyDevDocsGuidelines` 的内部实现（保留它们作为合并 service 的子调用，不动 manifest 拷贝逻辑、不动 CLAUDE.md 段落写入逻辑）。
- 不重命名两份 docs 文件名（保留原英文名，避免 CLAUDE.md / .gitignore / harness manifest 多处引用同步出错）。
- 不为旧项目自动补拷（见风险段）；旧项目要补 docs 由主理人手动卸载再装。
- 不动 `.aimon/skills/*` / `.claude/agents/*` 的内容；不动 CLAUDE.md 工作流主体段落，只改"真源文档"表的两条路径。
- 不保留旧的 7 个分散端点作为"备用入口"——按 CLAUDE.md "不做没人要求的灵活性"原则，删干净；前端只有 PermissionsDrawer 一个消费方，没有第二个调用点。

## 实施步骤

1. **搬文件**：`git mv docs/agent-harness-overview.md .aimon/docs/agent-harness-overview.md` 与 `git mv docs/team-agent-harness-dev-docs-workflow.md .aimon/docs/team-agent-harness-dev-docs-workflow.md`（以及修正两份 docs 互相引用的路径，如 `docs/team-...md` → `.aimon/docs/team-...md`）。
   - verify：两份 docs 在新位置存在，docs/ 下不再有这两份；docs 内文里相互引用路径已更新。
2. **更新 `.gitignore`**：删掉 `!docs/agent-harness-overview.md` 与 `!docs/team-agent-harness-dev-docs-workflow.md` 两行。
   - verify：`git status` 显示这两个 untracked 文件位置正确，原 docs/ 位置已不再 tracked。
3. **CLAUDE.md 真源表更新**：把末尾"真源文档"表里两条引用从 `docs/` 路径改为 `.aimon/docs/` 路径。
   - verify：`grep` `docs/team-agent-harness-dev-docs-workflow.md` 在 CLAUDE.md 中已无（除非历史段落里有需要保留的——会全文核对）。
4. **后端 manifest 加 docs 条目**：`harness-template-service.ts::getTemplateFiles()` 增加 `.aimon/docs/*.md` 动态发现段（仿 skills/agents 写法）；`uninstallHarnessTemplate` 末尾 `rmdir` 列表加 `.aimon/docs`，顺序调整为叶子→根（`.aimon/docs` → `.aimon/skills` → `.claude/agents` → `.aimon`）。
   - verify：`pnpm --filter @aimon/server exec tsc -b` 0 错误；起 dev server 后 `curl /api/projects/:id/harness-status` 返回的 entries 包含 docs 两条。
5. **前端 PermissionsDrawer.tsx UI 合并**：
   - 把 line 1173-1217 与 line 1219-1265 合并为一个块；
   - 状态文字与按钮逻辑按 plan 第 5 条；
   - 应用按钮按 `logAction('project', 'apply-workflow', ...)` 包装，内部依次 `applyDevDocs` → `applyHarness`，第一个失败 abort；
   - 卸载按钮按 `logAction('project', 'remove-workflow', ...)` 包装，前面带 confirmDialog danger 二次确认。
   - verify：`pnpm --filter @aimon/web exec tsc -b` 0 错误；浏览器抽屉看到合并后的块。
6. **浏览器实操验收**：
   - 一个干净的目标项目点"应用" → 看 `.aimon/docs/` 两份在；CLAUDE.md 工作流段在；LogsView 见 `apply-workflow` 起止配对。
   - 同项目点"卸载"（confirm）→ 文件清理；CLAUDE.md 段移除；状态翻"未应用"；LogsView 见 `remove-workflow` 起止配对。
   - 在另一个项目里手动 `chmod 000 .aimon/docs/agent-harness-overview.md`（或占用文件）→ 点"应用" → 弹窗列出 failedFiles；LogsView 见 ERROR。

## 边界情况

- **聚合 service 内部子调用其中一个失败**：第一个（Dev Docs 写 CLAUDE.md 段）失败时直接 abort 不调第二个，返回 `{ devDocs: { ok: false, error }, harness: null, partial: false }`，前端 alertDialog 报错。第二个（Harness 拷文件）失败时 Dev Docs 已经写入 CLAUDE.md，**不自动回滚**——返回 `{ devDocs: { ok: true, ... }, harness: { ok: false, error }, partial: true }`，前端 alertDialog 明确告知"CLAUDE.md 工作流段已写入，但项目文件夹拷贝失败，可重试"。状态查询时这种"部分已应用"会被聚合状态如实反映。
- **状态混合（一边已装一边未装）**：UI 显示"部分已应用 (Dev Docs ✓ / Harness ✗)"或类似，按钮文案"应用剩余"——点击只调缺失的那个 API。这是为了兼容历史装过单独一边的项目。
- **旧项目装了 Harness 没有 docs**：现行 `applyHarnessTemplate` 的"已存在则跳过"会让重复点应用不补 docs。在 UI 提示文案里加一句"已应用项目想补充新加文件请先卸载再装"。
- **`.aimon/runtime/` 被 gitignore**：`.aimon/docs/` 不在 ignore 范围（runtime 是子目录单独 ignore），新加的 docs 会进 git，无需额外白名单。
- **CLAUDE.md 内有其它地方引用 `docs/team-agent-...`**：本步骤 3 会全文 grep 一遍，所有命中点同步改路径。
- **`docs/` 顶层被 gitignore**（`docs/*` + 白名单模式）：搬走后两条白名单要删，不删的话 git 不会管它们但也无害；为保整洁删掉。

## 风险与注意

- **风险 1：旧装过 Harness 的项目不会自动补拷新加的两份 docs。** 处理：UI 提示文案里说明"重新装才能补"；不在本任务里做"差异化补拷"逻辑（属于过度设计，且会让 apply 行为不可预测）。
- **风险 2：UI 合并后状态判断变复杂（"部分已应用"）。** 处理：保守显示，按钮文字明确"应用剩余 / 卸载已应用"；不藏着掖着。
- **风险 3：CLAUDE.md 全文里可能还有别的地方引用 `docs/team-agent-...`。** 处理：实施步骤 3 包含 grep 全仓库（不止 CLAUDE.md），命中点统一改路径。
- **风险 4：搬完文件后 SessionStart hook 注入的 manual.md / auto.md 仍然指向旧路径**——但 hook 注入的是文件**内容**而非路径，不影响。仅 CLAUDE.md 真源表里的"指引"路径需要修。
- **风险 5：现有"工作流入口形态对齐"任务（已归档）的 tasks.md 里有 PermissionsDrawer L1133–L1160 / L1162–L1202 的行号引用**——本次 UI 合并后行号失效，但那任务已归档，不需要回头修。

## 多模型 Plan 会审

> [跳过：当前会话所在 IDE 终端中 ask-gemini / codex:rescue 工具未在本会话上下文中确认可用，且本任务变更面集中（搬文件 + 合并 UI），主要技术分叉很少。按 CLAUDE.md 第 99-101 行规则，外部工具不可用时回退 Claude 单写 plan，记一行原因继续，不阻塞交付。]

如果主理人希望本任务跑三模型会审，请在确认 plan 时明示，会重新派 ask-gemini + codex:rescue 跑一遍后再呈终稿。
