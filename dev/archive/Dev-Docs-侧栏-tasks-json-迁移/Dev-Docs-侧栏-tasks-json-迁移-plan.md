# Dev-Docs-侧栏-tasks-json-迁移 · 计划

## 背景（一句话）

上一轮把 `<任务名>-tasks.json` 加进了 [CLAUDE.md](../../../CLAUDE.md) 作为机器可读副本（md 为真源，json 为派生物）。
本任务让 Dev Docs 侧栏 UI 能消费这份 json，以便将来扩展 `blocked` 等 md 表达不了的状态。

## 目标

让 Dev Docs 侧栏（[packages/web/src/components/sidebar/DocsView.tsx](../../../packages/web/src/components/sidebar/DocsView.tsx)）在展示任务状态时**优先使用 `<任务名>-tasks.json`**，json 缺失时**静默回退**到现有 tasks.md 的 checkbox 解析逻辑。

**可验证的验收标准**：

1. **浏览器可观察（硬性）**：
   - 手动构造一个 `dev/active/测试-json任务/` 目录，同时放一份空的 `测试-json任务-plan.md`、`测试-json任务-context.md`、`测试-json任务-tasks.md`（只有标题）和一份 `测试-json任务-tasks.json`（3 条 step，1 条 `done`、1 条 `doing`、1 条 `blocked`）。
   - 刷新侧栏后，该任务的状态胶囊应显示 "**阻塞**"（新增状态），且展开后的 `03_tasks` 行尾显示 `1/3`。
   - 把 tasks.json 删掉、tasks.md 改成 `- [x] a\n- [ ] b`，再刷一次：状态胶囊回到 "进行中 1/2"（回退路径正常）。
2. **回归不破**：现有 8 个 `dev/active/*` 任务（全都没 tasks.json）刷新后的 checked/total/status 与改动前一致。
3. **服务端单测**：给 `docs-service.ts` 的 `summarizeTask` 加一个测试用例覆盖"有 json → 读 json"和"无 json → 回退 md"两条路径，跑通。
4. **类型检查**：`packages/server` 和 `packages/web` 的 typecheck 均成功。

## 非目标 (Non-Goals)

- **不**做 tasks.json 的**写端**（AI 改 tasks.md 时自动同步 json）——那是 AI 侧的约束，[CLAUDE.md](../../../CLAUDE.md) 已经要求；服务端/UI 只做读端。
- **不**做"侧栏内展开 step 列表"、"显示 `verify:` / 阻塞原因"、"点击 step 跳到 md 行号"这类新能力——本次只换数据源、增加 `blocked` 状态。
- **不**重构 `summarizeTask` 的整体结构或引入 schema 校验库（zod 等）。
- **不**处理归档目录名 `dev/archive` vs `dev/archived` 的不一致（见"风险与注意"第 1 条，待你拍板后另起任务或合并）。

## 实施步骤

1. **服务端**：在 [packages/server/src/docs-service.ts](../../../packages/server/src/docs-service.ts) 里：
   - 给 `DocTaskSummary.status` 的联合类型加 `"blocked"`。
   - 新增 `readTasksJson(projectPath, name)`：读 `<任务名>-tasks.json`，宽松解析（JSON 解析失败或 schema 不合法 → 返回 `null`，不抛）。
   - 修改 `summarizeTask`：先尝试 `readTasksJson`；拿到合法 json 时，用其 `steps[].status` 聚合出任务级 status 和 checked/total；`null` 时走现有 `countCheckboxes(md)` 逻辑。
   - → verify: 新增的单测用例跑通；跑 `pnpm --filter @ai-kanban/server typecheck`（或等价命令）成功。
2. **Web 类型**：同步 [packages/web/src/types.ts](../../../packages/web/src/types.ts) 的 `DocTaskSummary.status` 加 `"blocked"`。
   - → verify: `pnpm --filter @ai-kanban/web typecheck` 成功。
3. **UI 状态胶囊**：在 [DocsView.tsx](../../../packages/web/src/components/sidebar/DocsView.tsx) 的 `StatusPill` 加 `blocked` 分支，颜色用 rose/red 色系（跟 error 区分开用更深一档），文案 "阻塞 X/Y"。
   - → verify: 浏览器里按"验收标准 1"的场景触发，能看到阻塞胶囊。
4. **联调 & 回归**：按"验收标准"1 和 2 在浏览器里逐项点过。
   - → verify: 截图 / 口头确认状态切换正常；把测试用的"测试-json任务"目录删掉，不留测试残骸。

## 边界情况

- `tasks.json` 存在但内容是空字符串 / 非 JSON / 顶层不是对象 → 回退 md。
- `tasks.json` 存在且是对象，但 `steps` 不是数组或为空 → 回退 md（避免"空 json 覆盖有内容的 md"）。
- `steps[].status` 出现未知值（比如拼错成 `"pending"`） → 该 step 视作 `todo`，不报错。
- tasks.md 和 tasks.json 状态冲突（例如 md 里 `- [x]` 数是 2，json 里 `done` 数是 1）→ 按 json 为准（本次要求 UI 基于 json；`以 md 为真源` 是对 AI 写入侧的约束，不是 UI 渲染侧的）。**此条需要你确认——见风险 2**。
- json 合法但 `steps` 全是 `todo` → 任务级 `todo`（"未开始"），不显示 `0/N` 计数，保持跟 md 现状一致。

## 风险与注意

1. **[须你拍板] 归档目录名冲突**：现有代码用 `dev/archive/`（[docs-service.ts:51](../../../packages/server/src/docs-service.ts#L51)），我上一轮在 [CLAUDE.md:12](../../../CLAUDE.md#L12) 写成 `dev/archived/`。本任务不处理这个，但你需要选：
   - **A**：把 CLAUDE.md 改回 `dev/archive/`（推荐，跟既有代码/既有归档数据一致，代价 1 行）。
   - **B**：把代码改成 `dev/archived/`（要写迁移，代价 ≫ A；还要改 DocsView.tsx 的确认对话框）。
2. **[须你拍板] 冲突时的判优**：tasks.md 和 tasks.json 状态不一致时，UI 以哪个为准？
   - **α**：以 json 为准（本 plan 默认选择；逻辑简单，契合"UI 基于 tasks.json"的本次需求）。
   - **β**：以 md 为准（贴合 CLAUDE.md "md 为真源"原文），但这样"基于 tasks.json 更新 UI"就名不副实——UI 只拿 json 看 `blocked`，其他字段还是用 md。
   - **γ**：两者不一致时标记 `inconsistent` 并在 UI 上显示一个警告 icon。**拒绝**——过度设计，用户没要。
3. **假设要显式**：本 plan 假设 AI 在执行过程中会按 CLAUDE.md 的新规则**双写** tasks.md + tasks.json。旧任务不会被追溯补 json（服务端不代维护），这是非目标。
4. **现有 8 个 active 任务**：它们都没 tasks.json，回归测试必须覆盖它们显示结果不变。
5. **熔断预案**：如果 UI 改完后现有任务的计数/状态出现偏差，属于回归；按 [CLAUDE.md 熔断规则](../../../CLAUDE.md) 2 次修不好就停手汇报。

---

**等你确认：**

- 任务名 `Dev-Docs-侧栏-tasks-json-迁移` 可以吗？
- 风险 1（A/B）和风险 2（α/β）请选。
- 非目标有没有想补的能力（例如"侧栏展开后显示每个 step"）？如果要加，我会把它并入目标。

确认后进入 Context 阶段。
