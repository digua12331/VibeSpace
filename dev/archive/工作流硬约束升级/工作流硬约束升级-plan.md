# 工作流硬约束升级 · 计划

## 大哥摘要

这次任务是给我自己（AI）加三道"安全栏"——以后在你（大哥）的项目里改代码会更稳、更不容易出大事。三件事：

1. **每个任务开始前我会把"这次能改哪几个文件"明确写下来；交差前自己跑一次 git diff（git 自带的"看我改了哪些文件"工具）核对，越界就停手。** 你看到的变化：以后 handoff（交付摘要）会多一行"diff 在白名单内"，不会再有"AI 顺手把无关文件也改了"的情况。
2. **以后我要删公共代码（删超过 5 行 / 改导出符号 / 删文件 / 改 API / 改数据库表）之前，必须先 grep（在所有文件里搜引用）一遍，把可能受影响的地方列出来给你看，等你点头才动。** 你看到的变化：以前可能直接动手然后等翻车，现在动手前你会收到一份"以下 N 个地方在用它，要不要一起改"的清单。
3. **新建一份 `dev/ARCHITECTURE.md`——项目代码地图。** 写清楚 packages/ 下三个包（hook-script / server / web）各自做什么、跨包是怎么通讯的、有哪些既定写法。以后每次新任务我不用重新摸代码就能上手。**这份你不用看**，是给我自己看的备忘。

不会动到的东西：现有功能、UI、数据库、用户操作、归档/评审链路。这次纯改"AI 工作流的元规则"——文档加几段、新建一个 md 文件，不碰业务代码。

## 目标

让以下三类老问题在工作流层面被堵住，不再依赖"AI 自觉"：

1. **顺手改无关文件** → 通过 read_files / write_files 白名单 + 提交前 diff 比对
2. **删公共代码不查引用就翻车** → 通过破坏性变更协议（grep 引用图 + 反问大哥）
3. **每个任务从头摸代码地图** → 通过 `dev/ARCHITECTURE.md` 项目级常量文档

### 验收标准（可观察）

1. **白名单生效**：本任务自身的 tasks.md 末尾能看到一行 `git diff --name-only HEAD` 输出，所有路径都在 write_files 白名单内（贴出真实输出）
2. **CLAUDE.md 与 AGENTS.md 同步**：两份文件加了相同内容的两段新规则（"读写白名单"+"破坏性变更协议"），diff 比对一致
3. **ARCHITECTURE.md 落盘**：`dev/ARCHITECTURE.md` 存在、≤300 行、至少 4 节（Packages 拓扑 / 跨包通讯 / 既定模式 / 关键文件索引）
4. **plan 第 1 步引用规则更新**：CLAUDE.md "## 1. Plan 阶段" 第 1 步从"扫 auto.md/manual.md"扩展为"同时扫 ARCHITECTURE.md 找相关章节"
5. **不破坏归档链路**：本任务完成后 dev/active/工作流硬约束升级/ 应能正常归档（不强制现在归档，但 docs-service.ts/review-runner.ts 不动，回归不动产物）

## 非目标

- **不写代码自动校验 diff**——纯规则约束 + AI 自查命令模板。理由：归档已是末端，应在每步 verify 时自查；写后端校验会污染 review-runner 等 fire-and-forget 路径
- **不在 docs-service.ts::readTasksJson 解析 read_files/write_files**——已确认现行解析器只读 `status` 字段，新增字段被忽略不影响（packages/server/src/docs-service.ts:191-197）
- **不改全局 skill `~/.claude/skills/dev-docs-workflow/SKILL.md`**——CLAUDE.md 第一段明示"以本文件为准"，本次新规则属 VibeSpace 项目专属（依赖项目 `dev/ARCHITECTURE.md` / `vibespace-*` 子代理 / 本仓 packages 拓扑），不下沉到全局
- **不动现有归档评审 prompt 与 lessons 提取逻辑**——review-runner.ts 不在 write_files 范围
- **不强制极小档/小档任务跑白名单**——极小档目前可以连三个 md 都不写；硬上读写白名单只会让小改动更累，违反 manual.md 第 6 条大哥偏好

## 实施步骤

### 步骤 1：扩 CLAUDE.md 中 tasks.json 模板

在 "## 3. Tasks 阶段" 现有 tasks.json 模板里加 `read_files` / `write_files` 字段示例。新模板形如：

```json
{
  "task": "<任务名>",
  "steps": [
    {
      "id": 1,
      "title": "步骤 1",
      "verify": "...",
      "status": "todo",
      "read_files": ["packages/server/src/foo.ts", "packages/web/src/bar.tsx"],
      "write_files": ["packages/server/src/foo.ts"]
    }
  ]
}
```

如何验证：cat CLAUDE.md 命中新字段。

### 步骤 2：CLAUDE.md "执行时硬性规则"段加两条

在 `## 3. Tasks 阶段` → `### 执行时的硬性规则（外科式改动）` 末尾追加：

> - **读写白名单（默认档/UI 改动/跨多文件任务必填；极小档/小档可省）**：tasks.json 每步声明 `read_files`（允许读）和 `write_files`（允许改）。verify 通过后、勾完成前必须跑 `git diff --name-only HEAD` 与本步骤 `write_files` 比对——越界文件不算完成，要么回滚越界改动、要么停下来回 plan 扩范围。glob 写法允许（如 `packages/server/src/routes/*.ts`），AI 自己心算判断。
> - **破坏性变更协议**：本步若涉及以下任一事项，**必须先 grep 引用图、列受影响清单给大哥、等大哥点头才动手**：
>   1. 删除任意源码文件
>   2. 删除任一文件中 ≥5 行连续业务代码（注释、空行、配置文件不计）
>   3. 修改、重命名或删除任一被跨文件 import 的导出符号（`type` / `interface` / `function` / `class` / `const` / `default export`）
>   4. 修改、删除或重命名任一 HTTP 路由 / WebSocket 消息类型 / IPC 通道
>   5. 修改 SQLite 表结构（列增删改、索引、约束变化）
>
>   触发后该步 verify 必须额外包含一次"修改后 grep 同符号 / 同路径，确认无残留旧引用"。

如何验证：cat CLAUDE.md 能命中两段；后续任务规则生效。

### 步骤 3：CLAUDE.md plan 第 1 步加 ARCHITECTURE.md 扫描

在 `## 1. Plan 阶段` 第 1 步附近（"扫 auto.md / manual.md"那条规则）补一句："**同时扫 `dev/ARCHITECTURE.md`** 找跟本任务相关的章节，在 plan 里显式引用（如"@dev/ARCHITECTURE.md#packages拓扑"）；无相关章节也写一句"ARCHITECTURE 扫过无相关章节"。"

如何验证：cat CLAUDE.md 命中"dev/ARCHITECTURE.md"字样。

### 步骤 4：CLAUDE.md handoff 段加 diff 校验要求

在 `## 规则与边界` 关于 handoff 摘要的那条规则末尾追加："handoff 摘要末尾必须附一行 `git diff --name-only HEAD` 真实输出（或 `(已提交，diff 为空)` 短结论），证明本次改动在 `write_files` 白名单内。极小档/小档可省。"

如何验证：cat CLAUDE.md 命中新增 handoff 要求。

### 步骤 5：同步 AGENTS.md 与 .aimon/docs/team-agent-harness-dev-docs-workflow.md

把步骤 1-4 在 CLAUDE.md 加的内容同步到这两份副本（auto.md 第 11 条经验：项目级规则在多份文档间同步）。`.aimon/docs/team-agent-harness-dev-docs-workflow.md` 的对应段落是 "## 2.4 Tasks 阶段"。

如何验证：grep "读写白名单" 三份文件全部命中；grep "破坏性变更协议" 三份文件全部命中。

### 步骤 6：派 vibespace-explorer 子代理摸 ARCHITECTURE.md 初稿

派一份 explorer，目标：read-only 摸 packages/{hook-script,server,web} 的职责 / 跨包契约 / 关键既定模式（logAction、serverLog、SQLite 三处同步、IIFE 模板、fastify 路由约定、WS 消息形态等）。返回简洁清单。

如何验证：子代理返回事实清单，主 Claude 据此写 ARCHITECTURE.md。

### 步骤 7：写 dev/ARCHITECTURE.md

主 Claude 整合 explorer 输出 + 自己读关键入口文件（packages/server/src/index.ts / packages/web/src/main.tsx / packages/hook-script/index.ts），落盘 ≤300 行，4 节结构：

```
# VibeSpace 架构地图（项目级常量）

> 给 AI 看的代码地图。每次新任务的 plan 第 1 步先扫这份找相关章节。
> 长期稳定，只在跨包契约 / 技术栈 / 核心模式发生不可逆变更时更新；普通功能迭代不动它。

## 1. Packages 拓扑
## 2. 跨包通讯
## 3. 既定模式
## 4. 关键文件索引
```

如何验证：文件存在、行数 ≤300、4 节齐全。

### 步骤 8：本任务 self-test diff 校验

最后一步勾完成前，跑 `git diff --name-only HEAD` 贴到 tasks.md 末尾，逐路径核对都在本任务自身的 write_files 内（CLAUDE.md / AGENTS.md / .aimon/docs/team-agent-harness-dev-docs-workflow.md / dev/ARCHITECTURE.md / dev/active/工作流硬约束升级/*）。

如何验证：tasks.md 末尾能看到这段贴出来的 diff 输出。

### 步骤 9：交付 handoff 摘要

按 CLAUDE.md 规定 ≤10 行白话格式，第一行白话验收指引（"开新会话发任何任务，看 plan 第 1 步是否引用 ARCHITECTURE.md"），末尾附 git diff 校验输出。

## 边界情况

- **read_files/write_files 用 glob**：允许，AI 自查时心算 minimatch 判断；不强制脚本校验
- **本任务自己改 CLAUDE.md/AGENTS.md**：CLAUDE.md/AGENTS.md/.aimon/docs/* 在本任务的 read_files+write_files 都要列；改错用 git checkout 回滚
- **ARCHITECTURE.md 写得太啰嗦**：硬限 ≤300 行；超过说明应拆到 dev/learnings.md 或具体任务的 context.md
- **explorer 摸到的事实有矛盾**（某文件既是模式 A 又是模式 B）：主 Claude 自己读那个文件做最终判断，不留"待确认"字样在 ARCHITECTURE.md
- **CLAUDE.md 已经很长**：本次再加约 30 行规则，仍在可读范围；不为本次新增重排其他段落

## 风险与注意

1. **改元规则会污染所有后续任务**：两条新硬规则一旦写进 CLAUDE.md，下次会话起所有任务受其约束。**关键风险点**：极小档/小档任务必须显式豁免（已在步骤 2 措辞中明示），否则改个文案都要列 write_files 就违反 manual.md 第 6 条。
2. **ARCHITECTURE.md 变成另一个 stale 文档**：项目代码改了它没同步就误导。**缓解**：顶部明示"长期稳定，只在跨包契约/技术栈/核心模式发生不可逆变更时更新；普通功能迭代不动它"，把更新触发条件压窄。
3. **read_files/write_files 字段是否破坏现有 readTasksJson？** 已确认不会——`docs-service.ts:191-197` 只读 `status` 字段，其他被忽略。新加字段对现有 UI / 状态聚合 / 归档完全透明。
4. **explorer 子代理出活质量**：摸 ARCHITECTURE 比一般任务要求高（要总结而非罗列）。如果初稿太碎，主 Claude 自己重写，不让"快"压倒"对"。
5. **跟 manual.md 第 6 条（小功能直接改）的兼容性**：步骤 2 的措辞必须明示极小档/小档可省（已含），否则相互冲突。
6. **跟 auto.md 第 15 条（合并/删除 API 前必须搜索调用点）的关系**：本次的破坏性变更协议是该经验的系统化升级版（从"应该"变"必须" + 列触发条件 + 加 grep verify 步骤）。auto.md 那条不需要撤回——它本来就是经验，规则化后两者并存不冲突。

## 多模型 Plan 会审

跳过：用户在上一轮对话已经审阅过 flow-kit 与 VibeSpace 工作流的逐条对比、看完三条规则的具体内容、权衡和借鉴优先级，并明确指示"123 都做"。本任务已收敛到落地细节而非开放方案探索；多模型评审更适合方案分叉时拉视角，不适合细节落地。Gemini/Codex 看不到本会话的对比上下文，介入会建议已被讨论否决的方案，徒增噪声。
