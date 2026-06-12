# 工作流母版统一更新 · Plan

## 大哥摘要

现在 VibeSpace 能把"AI 干活的规矩"（Dev Docs 工作流，就是 plan/context/tasks 那套流程文字）一键装进任何项目的说明文件里。问题是：**装进去那一刻是个快照，以后母版改了，老项目刷不动**——你重新点"装配"它发现"已经装过了"就什么都不做，于是各项目停在各自当年的版本，越攒越乱。

这次要做的：给装进去的那段工作流**盖一个版本号**，VibeSpace 一眼能看出哪个项目的工作流是旧版；旧版的项目给你一个**"更新到最新版"按钮**点一下就刷成最新；再给一个**"一键刷新所有旧版项目"**的总入口，改一次母版、全项目对齐。

你能看到的变化：工作流设置那个面板里，旧版项目会显示"可更新"并多出更新按钮；点一下，那个项目说明文件里的工作流段被换成最新版，**你自己在说明文件里写的别的内容一律不动**。不涉及任何数据库或你的项目代码。

## 目标

给"装进各项目 CLAUDE.md 的 Dev Docs 工作流段"加上版本意识与一键更新，落实"改母版 → 各项目可对齐"。

可验证的验收标准：
1. **版本戳**：母版 `DEV_DOCS_GUIDELINES` 带一个机器可读版本标记；新装进的项目 CLAUDE.md 里能 grep 到该标记。
2. **旧版识别**：构造一个"装了旧版（无版本戳或版本号更低）"的项目，调 `workflow-status` 接口返回 `devDocs.outdated === true` 且带 `installedVersion` / `currentVersion`。
3. **就地更新不误伤**：对一个 CLAUDE.md = [项目自有内容] + [旧版 Dev Docs 段] + [Superpowers 段] 的文件执行更新，结果：Dev Docs 段被换成最新版，**项目自有内容和 Superpowers 段逐字保留**（写一个对比测试或脚本断言）。
4. **批量刷新**：批量端点能把所有 outdated 项目刷到最新并返回"刷新了哪几个 / 跳过哪几个（已最新/无 CLAUDE.md）"。
5. **类型检查通过**：`pnpm -F @aimon/server build` 与 `pnpm -F @aimon/web build` 均成功。
6. **浏览器可观察**：工作流设置面板里，旧版项目显示"可更新"徽章 + "更新到最新版"按钮；点击后徽章变"已最新"；LogsView 看到 `scope=project action=update-workflow`（或 `refresh-all`）的起止配对日志。

## 非目标 (Non-Goals)

- **本轮只做 Dev Docs 工作流段**。Superpowers 段、harness 文件夹、openspec 骨架的版本化同理但不在本轮（留下一轮按同一模式扩）。
- **不解决"母版源头散在 4 份文件"**（仓库自身 CLAUDE.md / AGENTS.md / `dev-docs-guidelines.ts` 常量 / 仓库外 `F:\VibeSpace\CLAUDE.md`）——那是 VibeSpace 自身的同步卫生问题，不影响"向目标项目传播"。本轮以 `DEV_DOCS_GUIDELINES` 常量为传播母版；bump 版本时该常量是唯一需要改的传播源。（记入风险段，以后可单独起任务把常量改成读单一文件的 loader。）
- 不改任何产品功能、不动数据库表结构、不动项目代码。

## 实施步骤

1. **母版盖版本戳**：在 `dev-docs-guidelines.ts` 给 `DEV_DOCS_GUIDELINES` 锚点行 `# Dev Docs 工作流` 下一行嵌入隐藏标记 `<!-- dev-docs-workflow:v1 -->`，并导出常量 `DEV_DOCS_VERSION = 1`。约定：母版文本有实质变更就 +1。
   → verify: grep 母版字符串含该标记；`pnpm -F @aimon/server build` 过。
2. **状态读已装版本 + 暴露 outdated**：`getDevDocsStatus` 解析目标 CLAUDE.md 里的 `<!-- dev-docs-workflow:vN -->`（解析不到视为 v0=旧版）；`WorkflowStatus.devDocs` 加 `installedVersion:number|null`、`currentVersion:number`、`outdated:boolean`。types 同步。
   → verify: 手造无戳/低版本的 CLAUDE.md，status 返回 outdated=true；server build 过。
3. **就地块替换函数**：新增 `updateDevDocsGuidelines(projectPath)`——定位"锚点 → 下一个 `\n---\n` 分隔符"之间的块，**只替换这一块**为最新母版（含新版本戳），保住块之后的内容（如 Superpowers 段）。**不复用** `removeDevDocsGuidelines`（它 slice 到文件末尾会误删后续段）。复用 `insertSectionBeforeSeparator` 同款块边界算法。
   → verify: 写断言脚本，对三段式 CLAUDE.md 更新后比对，项目自有内容 + Superpowers 段逐字未变、Dev Docs 段已换新。
4. **后端能力 + 路由**：
   - 单项目更新：在 workflow-service 暴露更新入口；`routes/projects.ts` 加一个动作（复用 `/api/projects/:id/workflow` 或加 `.../workflow/update`），用 `serverLog` 起止配对。
   - 批量刷新：加机器级独立路由 `/api/workflow/refresh-all`（参考记忆"全机器级能力挂独立 `/api/<feature>/*`"），遍历所有项目、只刷 outdated 的、返回 `{updated:[], skipped:[]}`，serverLog 配对。
   → verify: 手动 curl/接口调用，旧项目被刷新、最新项目被跳过；LogsView 看到后端起止日志；server build 过。
5. **前端按钮 + 状态**：`PermissionsDrawer.tsx` workflow tab，`devDocs.outdated` 时显示"可更新"徽章 + "更新到最新版"按钮（调单项目更新，用 `logAction` 包起止）；加一处"刷新所有项目"入口（调 refresh-all，`logAction` 包）。`api.ts` 加客户端函数。
   → verify: `pnpm -F @aimon/web build` 过；浏览器里旧项目显示可更新→点更新→变已最新；LogsView 看到前端 `logAction` 起止配对。

## 边界情况

- **目标 CLAUDE.md 不存在**：更新视为"无可更新"，不报错（与现有 `claude_md_missing` 语义一致）。
- **装了 Dev Docs 但无版本戳的老项目**：解析不到戳 → installedVersion=null → 当作 v0 → outdated=true，可被刷新。
- **Dev Docs 段后面接了 Superpowers 段**：块替换必须以"下一个 `---` 分隔符"为边界，严禁切到 EOF（这是本任务最大的实现风险点）。
- **用户手改过装进去的 Dev Docs 段**：更新会覆盖这段（按设计——这段是机器产物，不该手改；提示文案里说明）。块外内容不动。
- **批量刷新遇到没装工作流的项目 / `__hub__`**：跳过，计入 skipped，不报错。
- **版本号只升不降**：installedVersion > currentVersion（理论上不该发生）按"已最新"处理，不触发更新。

## 风险与注意

- **块边界算法是唯一高危点**：写错会吞掉用户 CLAUDE.md 里 Dev Docs 段之后的内容。必须有第 3 步那条"三段式逐字保留"断言验收，且优先用现成的 `insertSectionBeforeSeparator` 块边界逻辑而非自己另写正则。
- **破坏性变更协议**：本任务会改 `WorkflowStatus` 这个跨前后端共享的导出类型（加字段，非删改，属向后兼容），并新增一个路由——按协议这两项在动手时会 grep 全部引用点确认无遗漏（记忆里有"改后端 API 必须全仓搜调用点"那条）。不删除任何现有端点/符号。
- **批量刷新的 blast radius**：会一次写多个项目的 CLAUDE.md。已用"只替换锚点块 + 只刷 outdated + 返回明细 + serverLog"四重约束兜住；仍属用户可感知的高影响操作，验收时人工确认刷新明细。
- **母版 4 份镜像的同步**：本轮不解决（非目标）；bump 版本只需改 `DEV_DOCS_GUIDELINES` 常量这一处传播源，其余镜像是 VibeSpace 自用，不影响目标项目传播。
- **假设**：目标项目的 Dev Docs 段都是经 VibeSpace 装配写入的（带 `---` 分隔、锚点标准）。手写仿造但格式不标准的极少数项目，块边界可能识别不到 → 当作"无戳/未装"处理，不误伤，最多是"刷不动需手动重装"。

## 多模型 Plan 会审

> 跳过：Codex CLI 未安装（companion 报 "Codex CLI is not installed or is missing required runtime support."，非超时/偶发），按工作流回退 Claude 单独写 plan，未反复重试。本该交给 Codex 的风险点（块边界算法、旧项目无戳兼容、批量刷新对手改文件的安全性、范围切分）已由 Claude 自审写入「边界情况」「风险与注意」两段。大哥若想要 Codex 二次把关，装好 `@openai/codex` 后说一声，我再补一轮会审。
