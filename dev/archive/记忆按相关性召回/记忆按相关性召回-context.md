# 记忆按相关性召回 · context

## 关键文件

- `packages/server/src/routes/hooks.ts`
  - `AUTO_TAIL_COUNT = 30`、`MEMORY_HEADER_MAX_BYTES = 10_000`（line 16-18）保持不变。
  - `buildMemoryHeader(auto, manual)`（line 20-46）：当前 `auto.filter(lesson).slice(-30)` + manual 全量。要改成走 `selectAutoLessons`，返回值带 `mode`/`autoCount`。
  - `buildSessionStartAdditionalContext(sessionId)`（line 52-80）：已有 `session.task`、`project.path`、`readMemory`。在这里取 fileHints + 调用、加 serverLog。
  - 已导入 `serverLog`（line 7）、`MemoryEntry`（line 5）、`getSession/getProject`（line 3）。新增从 `../docs-service.js` 导入 `readTaskFileHints`。
- `packages/server/src/docs-service.ts`
  - 已有 `tasksJsonPath`（line 82）、`readTasksJson`（line 168，但其 `TasksJson` 类型只建模 `steps[].status`，没有 read/write_files——所以要单独读原始 JSON，不复用它）。
  - 新增导出 `readTaskFileHints(projectPath, task): Promise<string[]>`。
- `packages/server/src/memory-service.ts`（只读，不改）：`MemoryEntry` 已含 `task` / `body` / `files` / `category` 字段，正是打分所需。
- smoke 脚本：仿 `packages/server/scripts/memory-parse-test.ts` 风格新增一个小脚本验证 `selectAutoLessons` 纯函数行为（不依赖网络/DB）。

## 决策记录

- **为什么不用向量库**：记忆总量几十条 markdown，且大哥明确要白盘可审/可手动撤回；向量库是黑盒，方向相反。纯文本打分足够，且零新依赖。资深工程师视角：这是把"按时间"换成"按重叠计数排序"，几十行，不是过度设计。
- **为什么文件分占主导（×10）**：`files` 标签是记忆里最具区分度的字段，和任务 `read_files/write_files` 的重叠是最干净的相关信号；任务名二字窗口只做次级 tiebreak，避免中文分词噪声放大。
- **为什么 `selectAutoLessons` 抽成纯函数**：可单测、不碰 IO；hooks 那条路径是 fail-open 的，纯函数 + 外层 try/catch 比把逻辑塞进异步函数更稳。
- **为什么选中后按原始行序输出**：保持 AI 阅读顺序为时间序（和今天一致），只改"挑哪些"，不改"怎么排版"，减少认知差异。
- **为什么 readTaskFileHints 不复用 readTasksJson**：后者的类型只保了 status，扩它会牵动 summarizeTask 等既有逻辑（越界）；新写一个只读 read/write_files 的小函数边界更干净。
- **不新增数据库列、不新增路由**：纯进程内读文件 + 计算，无 mutation。

## 依赖与约束

- 这条路径必须 fail-open：任何异常退回 `slice(-30)`，绝不抛出阻塞 SessionStart。
- 注入预算不变：top N=30、10KB 上限沿用。
- 日志只在 SessionStart 记一条 info（非起止配对），scope=`memory`，避免每次开会话刷屏。
- 后端 TS 需过项目类型检查（命令以 server package.json scripts 为准）。
