# 记忆结构化与错误循环监测 · Context

> 给 AI 自己看的盘点。用于执行阶段对照边界、上下文耗尽换会话时衔接、归档评审产出经验。大哥不审。

## 关键文件（这次改动的边界）

### 任务 A：结构化经验

**后端**
- `packages/server/src/memory-service.ts`
  - `:7-18` `MemoryEntry` 类型 — 增加可选 `category?: string`、`severity?: 'info'|'warn'|'error'`、`files?: string[]`
  - `:50` `LINE_RE = /^- \[(\d{4}-\d{2}-\d{2}) \/ ([^\]]+)\] (.+)$/` — 不动；新增"行尾标签段"二级解析（只认 `(.+)` 捕获组里**最末**一个 `[k=v;k=v]` 段）
  - `:110` `readMemory` — 输出多 3 个可选字段
  - `:124` `appendLessons` — 写入时若 entry 带结构字段则拼接 `[...]` 段
  - `:149` `rollbackLessons` — 不动（撤回逻辑与字段无关）
- `packages/server/src/review-runner.ts`
  - `:17` `LESSON_RE` — 同 LINE_RE，跟着升级
  - `:184` `runCodex` 的 prompt 字符串 — 加可选标签提示，强调"每条仍然单行"
  - `:205` `runGemini` 的 prompt 字符串 — 同上
  - `:266` `extractLessons` — 宽进严出，标签段无法解析时降级为无标签 entry，不丢弃整行
  - `:282` `normalizeLesson` — 同上

**前端**
- `packages/web/src/types.ts`
  - `MemoryEntry` 镜像 — 增加同样三个可选字段（API 返回结构）
- `packages/web/src/components/sidebar/MemoryView.tsx:9` — 顶部加 category / severity / files 筛选 UI（默认"全部"，提供"未分类 / 未标严重度 / 无关联文件"兜底）
  - 现有 `:55` `onRollback` / `:120` manual 段 / `:144` 撤回按钮均不动

**测试 / 验收脚本**
- `scripts/memory-parse-smoke.mjs`（新建）— 跑老格式 / 新格式 / 正文方括号 / 含逗号路径 4 类样例验证 LINE_RE 升级
- `package.json` 加 `smoke:memory-parse` 入口

---

### 任务 B：错误循环检测

**后端**
- `packages/server/src/error-pattern-monitor.ts`（新建）— 自包含模块
  - `class ErrorPatternMonitor`：滑动窗 + 去重 + 冷却
  - 阈值常量集中：`WINDOW_MS = 60 * 60 * 1000`、`THRESHOLD = 3`、`COOLDOWN_MS = 24 * 60 * 60 * 1000`、`MAX_ALERTS_PER_KEY_RING = 100`（内部 buffer，不暴露 UI）
  - `record(entry: LogEntry)` — 同步入口，内部 setImmediate；try/catch 吞异常并 `serverLog('warn', 'error-monitor', ...)`
  - key 生成：优先 `(scope, action, projectId)`；缺 projectId 用 `(scope, action)`；缺 action 用 `msg.slice(0,32)` 的 SHA-1 前 8 字符 hash
  - `action` 来源：`entry.meta?.action` 字段（前端 logAction 路径自带；后端 serverLog 不带时 fallback）
- `packages/server/src/log-bus.ts`
  - `:54` `serverLog` — `appendJsonl` 后 + broadcast 之前，调用 `errorPatternMonitor.record(entry)`（仅 level='error'）
  - 新增 `broadcastAlert(payload: ErrorPatternAlert)` — 复用现有 `broadcast` 机制
  - `:88` `persistClientLog` — 同样接入 monitor
- `packages/server/src/types/log.ts`
  - 新增 `ErrorPatternAlert` 类型：`{id, ts, key, scope, action, projectId?, count, firstAt, lastAt, sampleMsg}`

**前端**
- `packages/web/src/types.ts` — 镜像 `ErrorPatternAlert`；扩展 WS `ServerToClientMessage` 加 `{type:'error-pattern-alert', payload: ErrorPatternAlert}`
- `packages/web/src/store.ts`
  - 新增 `alerts: ErrorPatternAlert[]`（默认 `[]`，上限 50）
  - 新增 `appendAlert(a)` action（裁剪逻辑参照 `:738` `appendLog` 的 `LOG_RING_CAPACITY` 模式）
  - 新增 `dismissAlert(id)` / `markAlertRead(id)` actions
- `packages/web/src/main.tsx:35-45` — WS 处理新 case `error-pattern-alert` → `useStore.getState().appendAlert(payload)`
- `packages/web/src/components/sidebar/MemoryView.tsx`
  - 顶部加告警卡片区（在筛选 UI 上方，manual/auto 段之前）
  - 卡片字段：`scope · action · count 次 · 时间窗`、文案"当前运行期间检测到"、按钮：[复制 manual.md 草稿]、[已读]、[关闭]
  - 复制后用 `navigator.clipboard.writeText(...)` + 调 `openFile('dev/memory/manual.md')`（已有 API）
  - 用 `logAction('memory', 'alert-copy-draft', ...)` 包装

**操作日志埋点（mutation 端点）**
- 复制草稿、已读、关闭 — 前端 `logAction('memory', 'alert-...')` 包装；纯前端状态变更，不跟后端通讯
- 后端发出告警时 `serverLog('warn', 'error-monitor', '检测到错误循环', { meta: { key, count, ... } })` —— 这条本身落 JSONL，便于回放

---

## 决策记录

> 资深工程师审查"会不会过度设计？"已逐条压过，全部回答"不会"。

1. **行尾标签 vs YAML frontmatter vs 单独索引文件** → 选行尾标签
   - 理由：SessionStart hook 按"行"取末尾 30 条 + 10KB 字节预算，frontmatter 会破坏；单独索引文件引入双源同步问题；行尾标签零迁移成本，向后兼容
2. **告警状态内存 vs 落盘** → 选内存
   - 理由：MVP 边界；JSONL 已能回放 alert 日志；落盘需要清理策略和并发控制，复杂度上升不止 2x
3. **告警 key 粒度 (scope, action, projectId?)** → 折中
   - 理由：纯 (scope, action) 会跨 project 误聚合；加 sessionId 拆得太碎；projectId 是大哥关心的隔离边界
4. **错误日志无 action 时 fallback** → msg 前 32 字符 SHA-1 前 8 字符
   - 理由：避免所有 actionless 错误挤到一个空 key；hash 比直接用 msg 更稳定（msg 含动态变量时不会被切碎）
5. **不抽公共 alert 卡片组件** → 直接写在 MemoryView 内
   - 理由：单一消费点；本仓库 PermissionsDrawer 内联多个 Tab 是范式；过早抽象违反外科式原则
6. **不引入 setInterval** → 用惰性清理（record 时顺手清过期窗口）
   - 理由：本仓库后端无 setInterval；新增 timer 增加进程退出阻塞风险；惰性清理足够
7. **告警卡片不自动写 manual.md** → 只复制 + 打开
   - 理由：manual.md 主理人独占；自动写会把误报沉淀成长期规则；评审方明确反对
8. **review-runner prompt 改动是"软提示"** → 不强制 LLM 按格式
   - 理由：codex/gemini 回退链路本身脆弱，强约束会增加格式化失败概率；宽进严出
9. **不做 cluster 多进程兼容** → 单进程假设
   - 理由：当前部署形态就是单进程；多进程兼容需要共享状态，超出 MVP 范围；plan 已声明
10. **不暴露阈值 UI 配置** → 常量集中放 monitor 内部
    - 理由：YAGNI；先观察实际使用频率再决定是否需要可配置

## 依赖与约束

- **SessionStart hook 字节预算**：10000 bytes，30 条 auto + 全部 manual。新格式标签会让单行变长（典型 +20-50 bytes）。30 条平均 +35 bytes ≈ +1.05KB，预算内 → 不需要改 hook
- **LogEntry 类型契约**：现有字段 `id, ts, level, scope, projectId?, sessionId?, msg, meta?` 不动；action 走 `meta.action`（前端 logAction 已经放在这）
- **WS 报文类型**：扩展 `ServerToClientMessage` discriminated union；前端 main.tsx 的 switch 必须加 case
- **TS 类型严格**：每步 verify 都包含 `pnpm -r build`（项目级类型检查命令；packages/server 和 packages/web 都用 tsc）
- **alerts 上限 50**：参照 store.ts:119 `LOG_RING_CAPACITY = 500` 的风格，把 `ALERT_RING_CAPACITY = 50` 放在同一文件顶部

## 任务 A、B 解耦

- 评审建议"分两条任务落地，避免结构化 memory 的解析风险影响错误循环检测交付" → 两条链可并行实现，但 tasks.md 按顺序排（A 先 B 后），各自独立 verify
- 任何一条失败都不阻塞另一条交付

## 不动的部分（边界澄清）

- 老 28 条 auto.md 不回写
- manual.md 不动（结构 / 内容均不动）
- rejected.md 撤回逻辑不动
- review-runner 的 fire-and-forget / codex→gemini 回退机制本身不动（只动 prompt 文本和 extractLessons 解析）
- jobsService / pruneOldLogs / pruneTimer 不动
- LogsView / store.logs / LOG_RING_CAPACITY 不动（错误循环监控独立于 LogsView）
- skills-service / .aimon/skills 路由 / dev-docs-guidelines 等周边模块不动
