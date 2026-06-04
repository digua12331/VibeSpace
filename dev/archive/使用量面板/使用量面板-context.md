# 使用量面板 · Context

## 关键文件（本次改动的边界）

### 后端（packages/server/src/）

- **新增 `usage-service.ts`**——纯解析逻辑：
  - 列目录 `~/.claude/projects/` → 每个子目录 → `*.jsonl` 文件
  - 逐行 `JSON.parse`，丢掉无 `message.usage` 的行（用户消息行 / 元数据行）
  - 按 `timestamp` 落入「今日」「近 5h」「近 7 天」三个桶
  - model 名归并：`/^claude-(opus|sonnet|haiku)-/` → 三族；其他 → `other`
  - 累计 4 个 token 字段：`input_tokens / cache_creation_input_tokens / cache_read_input_tokens / output_tokens`
  - 返回 `{ today: {...byModel}, last5h: {...byModel, windowStart, windowEnd}, last7days: [{date, tokens}], skipped, asOf }`
- **新增 `routes/usage.ts`**——参照 `routes/perf.ts` 形态：
  - `app.get('/api/usage/claude', ...)`
  - 起止 `serverLog('info'|'error', 'usage', '...')`
  - 失败 `reply.code(500).send({ error, message })`
- **改 `index.ts`**——line ~33 加 import，line ~154 附近加 `await registerUsageRoutes(app)`

### 前端（packages/web/src/）

- **改 `types.ts`**——加 `ClaudeUsage`、`UsageByModel`、`UsageDayPoint` 三个 type
- **改 `api.ts`**——加 `getClaudeUsage(): Promise<ClaudeUsage>` 一个函数（参照 `listJobs` 形态）
- **新增 `components/sidebar/UsageView.tsx`**——参照 `PerfView.tsx` 卡片+条形风格：
  - 顶部 "Claude Code" 标题 + 刷新按钮
  - 三块卡片：今日 / 近 5h / 近 7 天柱图
  - 底部"其他 CLI"折叠区，写两行占位文字（Codex / Gemini）说明本地无统计、查 dashboard
  - 挂载 `useEffect` 调 `logAction('usage', 'read', () => api.getClaudeUsage())`
  - 三态：loading / error（带重试）/ ready
- **改 `store.ts`**——line 34 `Activity` 联合类型末尾加 `| 'usage'`
- **改 `components/layout/ActivityBar.tsx`**——`items` 数组加一项 `{ id: 'usage', icon: '📈', label: '使用量' }`，位置放在 `perf` 之后 / `jobs` 之前（数据型聚在一起）
- **改 `components/layout/PrimarySidebar.tsx`**——`TITLES` 加 `usage: '使用量'`，switch 加 `case 'usage': body = <UsageView />`，import UsageView

### 不会动的边界

- 不动 `db.ts`、不加表 / 列：每次现解析 jsonl
- 不动 `ws-hub.ts`、不加 WS 事件：按需 GET 即可
- 不动 PerfView / JobsView：使用量与进程指标 / Job 状态完全无关
- 不动现有 8 个 ActivityBar 项的图标 / 顺序

## 决策记录

### D1. jsonl 读取策略：`readFileSync + split('\n')`，不上流式 readline

资深工程师视角自检：单个 Claude Code 会话 jsonl 实测在几 MB 级别（messages × 行长），几十个会话累加同步 read 也不会卡事件循环超过 200ms。流式 readline 写起来啰嗦，**当下不需要**。如果将来发现单文件 50MB+ 再换，YAGNI。

### D2. 不缓存解析结果

每次 `/api/usage/claude` 请求都重新读所有 jsonl。理由：
- 解析成本 O(总行数)。**步骤 1 实测：192 个 jsonl / 21363 条有效行 / 26445 跳过 → 1.8s**（比预估 500ms 慢，但仍在"切 tab 等一下"可接受范围）
- UI 也不轮询、只在用户切到 Usage tab 或点刷新时调用一次
- 缓存意味着要做"jsonl 文件 mtime 变化检测"或"TTL"——都是过度设计
- 如果之后真慢，优先把 `today` / `last5h` 算成增量比加缓存层更合理

### D3. 不区分项目，所有 jsonl 一锅聚合

理由：用户提的需求是"我的当前 Claude Code 用量"，**主体是用户而非项目**。本仓库的 ProjectsColumn 已经按项目隔离一切了，使用量再做按项目筛选会和左侧导航强耦合。本期跨项目聚合即可，"按项目下钻"未来需要再加。

### D4. 5h 窗口实现："最近 5 小时滑动总和"，不模拟官方 block 重置

理由：plan 里已经写了——我不知道 Anthropic 后台具体怎么算 block 起算点。**ccusage 自己也是经验性推断**。既然不是官方语义，UI 文案就老老实实写"近 5 小时累计（参考用，非官方剩余配额）"，不要假装精确。

### D5. 占位文字不留任何"将来支持"承诺

Codex/Gemini 折叠区只写一句"本地无 token 历史，请到对应平台 dashboard 查看"+ 各自一个外部链接（OpenAI 账单页 / Google AI Studio 配额页）。**不写**「即将支持」「TODO」之类——避免立 flag。

### D6. 图标 📈 选定，与现有 8 项不冲突

清单：📁🌿📝📐📊🛠📋🔔。`📈` 与 `📊（性能）`轮廓不同（折线 vs 柱图），16px 下能区分。

### D7. 错误处理保持最低限度

- jsonl 单行损坏 → try/catch 包裹 `JSON.parse`，`skipped++`，跳过
- `~/.claude/projects/` 不存在（ENOENT）→ 返回 200 + 空数据 + `note:'no jsonl found'`，不算 5xx
- 单个 jsonl 文件读失败（权限等）→ 跳过该文件，`skipped++`，整体仍返回成功
- 真正 5xx 的只有：`os.homedir()` 抛错 / `fs.readdir` 顶层抛非 ENOENT 错误

不写"重试"、不加"最大错误数熔断"——服务器端的轻量解析没必要。

## 依赖与约束

- **运行时**：Node ≥ 18（项目实测在用 22.18.0）。`fs/promises.readdir`、`os.homedir()`、`path.join` 全是内置；不引 `globby` / `fast-glob`
- **类型检查**：每次改完动两边——`packages/server` 和 `packages/web` 各跑一次 `pnpm tsc --noEmit`（CLAUDE.md 硬性规则）
- **import 风格**：server 是 NodeNext ESM，相对 import 必须带 `.js` 后缀（看现有路由文件）；web 是 Vite 不需要后缀
- **跨平台**：路径用 `path.join(os.homedir(), '.claude', 'projects')`，不写 `\\` 也不写 `/`
- **操作日志契约**（CLAUDE.md 硬性）：
  - 前端 mutation 必须 `logAction('usage', 'read', ...)`，scope 小写
  - 后端必须 `serverLog('info', 'usage', 'read 开始'/'read 成功 (Nms)' / 'read 失败: ...')`
  - 失败分支必须人工触发验证一次（步骤 6）
- **UI 验收硬性**：plan 里已经写了浏览器可观察项；tasks.md 对应步骤的 verify 必须复述
- **日志 meta ≤ 2KB**：不要把 `today.byModel` 全塞进 meta；只塞 `{ totalEntries, skipped, ms }` 这种小标量
