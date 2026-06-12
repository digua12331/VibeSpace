# 记忆按相关性召回 · plan

## 大哥摘要

借鉴腾讯刚开源的智能体记忆系统里**唯一**对我们有用的一条思路：新会话启动时塞给 AI 的项目经验，从"按时间拿最近 30 条"改成"按和当前任务最相关挑几条"。改完后，开一个新任务会话时，AI 一上来看到的是跟这次任务最贴的踩坑/约定（以前可能因为做得早、被新条目按时间挤出窗口而看不到了）。**只动后端两个文件，不碰数据库、不碰界面、做错容易回滚。** 你能验收的点：开一个绑定了某任务的会话后，在浏览器日志面板（LogsView）能看到一条 `scope=memory` 的记录，写明这次是"按相关性"还是"按最近"注入、挑了几条。

## 目标

把 SessionStart（新会话启动）注入的 `auto.md` 经验，由纯时间截断改为相关性优先：

- 会话**绑定了任务**时：用该任务的文件白名单（`tasks.json` 里每步的 `read_files`/`write_files`）和任务名，给每条记忆打分，挑相关性最高的 N 条注入（N 仍沿用现有的 30 条预算、10KB 上限）。
- 会话**没绑任务**、或绑了任务但**算不出任何相关信号**（白名单缺失、全部 0 分）时：**退回现状**——按最近 30 条注入，行为与今天完全一致（保证不会比现在更差）。
- `manual.md` 全量注入、10KB 截断逻辑**不变**。

**可验证的验收标准**：

1. 后端类型检查/构建通过（`pnpm -F @aimon/server` 的 typecheck 或 build，命令以 package.json 为准）。
2. 新增一个纯函数 `selectAutoLessons` 的单元 smoke：构造一组带 `files` 标签的假记忆 + 一组任务文件白名单，断言"和白名单文件重叠的条目"排在被选中的前面；白名单为空时退回最近 N 条原序。
3. 浏览器 LogsView 能看到 `scope=memory` 一条 info 记录，`meta` 里含 `mode=relevance|recency` 与 `autoCount`；绑定任务的会话应为 `relevance`，裸会话应为 `recency`。

## 非目标

- **不**引入向量库 / embedding / 任何检索依赖——纯 markdown 文本打分。
- **不**做腾讯那套的 L3 用户画像合成、Mermaid 压工具日志、记忆分组分层（auto.md 现在才几十条，平铺+相关性够用，分层是过度设计）。
- **不**改 `auto.md` / `manual.md` / `rejected.md` 的文件格式、写入流程、撤回流程。
- **不**改前端「记忆」tab 的任何展示。

## 实施步骤

1. `docs-service.ts` 加导出助手 `readTaskFileHints(projectPath, task)`：读 `<task>-tasks.json` 原始 JSON，收集所有步骤的 `read_files` + `write_files`，去重返回 `string[]`；文件缺失/坏 JSON/字段缺失一律返回 `[]`（不抛）。验证：对现有某任务目录调用返回非空、对不存在任务返回 `[]`。
2. `hooks.ts` 抽出纯函数 `selectAutoLessons(autoLessons, { taskName, fileHints })`：按"文件重叠分 ×10 + 任务名二字窗口重叠分"排序，取 top N，再按原始行序输出；无信号→退回 `slice(-N)`；返回 `{ selected, mode }`。验证：smoke 脚本断言排序与退回行为。
3. `hooks.ts` 改 `buildMemoryHeader` 用 `selectAutoLessons`，返回值带上 `mode`/`autoCount`；标题随 mode 切换文案（"与当前任务相关的经验" / "最近自动沉淀的经验"）。验证：类型检查通过。
4. `hooks.ts` 的 `buildSessionStartAdditionalContext` 里取 `session.task` → `readTaskFileHints` → 传入；建好后 `serverLog("info","memory",...)` 记一条 mode+autoCount。验证：LogsView 看到该条。
5. 全量后端类型检查/构建通过；跑 smoke。

## 边界情况

- 任务无 `tasks.json` 或其中没有 `read_files`/`write_files` 字段（小档任务常省略）→ `fileHints=[]`，靠任务名兜底；任务名也无重叠→退回最近 N 条。
- `fileHints` 含 glob（如 `packages/server/src/routes/*.ts`）→ 用去掉 `*` 后的静态前缀做前缀匹配 + basename 匹配，不引入 glob 库。
- 记忆条目没有 `files` 标签（早期手写条目）→ 文件分为 0，仅参与任务名打分，不会被误排到最前。
- 全部条目同分（含全 0）→ 按原始行序（即时间序）稳定输出，等价现状。
- 中文任务名无空格 → 用 2 字滑动窗口生成 token 做重叠，且只和"另一条记忆的来源任务名"及正文比，控制噪声。

## 风险与注意

- SessionStart 每次开会话都会触发 → 只记**一条** info 日志，不做起止配对，避免日志风暴。
- 这条路径是 fail-open 的（hook 出错不能卡住 AI 会话）→ 相关性计算、读 tasks.json 全部包在 try/catch，任何异常都退回最近 N 条。
- memory 扫过 `auto.md`/`manual.md`：多为前端/session 经验，与本次"后端注入选择逻辑"无直接条目；相关的是工作流本身对 SessionStart 注入的约定（CLAUDE.md 可持续记忆段），本次不改约定只改选法。

## 多模型 Plan 会审

跳过：小档任务（改动落在 2 个后端文件、不含破坏性变更、不动数据/表结构、易回滚），按 CLAUDE.md 小档规则 Claude 单独写 plan、不调外部模型。
