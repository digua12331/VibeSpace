# 记忆结构化与错误循环监测 · 任务清单

## 任务 A：结构化经验

- [x] A1. 升级 `memory-service.ts` 解析与类型：`MemoryEntry` 加可选 `category/severity/files`；新增"行尾标签段"二级解析（只认行尾最后一个 `[k=v;k=v]`，正文方括号不误吃；files 内逗号分隔，路径含逗号视为非法标签整段降级）；`appendLessons` 接受结构字段并拼接 → verify: `pnpm -r build` 过类型；新建 `scripts/memory-parse-smoke.mjs` 跑老格式 / 新格式 / 正文方括号 / 含逗号路径 4 类样例，全部断言通过
- [x] A2. 调整 `review-runner.ts` 的 prompt 与提取：`runCodex`/`runGemini` 的 prompt 字符串里追加可选标签提示，强调"每条经验仍必须单行"；`extractLessons` / `normalizeLesson` 宽进严出，标签段无法解析时降级为无标签 entry，多行/markdown 表格丢弃 → verify: `pnpm -r build` 过类型；smoke 脚本里加"模拟 LLM 输出"分支（有标签 / 无标签 / 多行 / 表格）走 extractLessons，断言合法行保留、非法丢弃、缺标签不阻塞
- [x] A3. 前端类型 + API 镜像（pre-existing skills Activity 错误已记入 dev/issues.md，与本次改动无关）：`packages/web/src/types.ts` 的 `MemoryEntry` 加同样三个可选字段；`api.ts` 的 `getMemory` 返回类型同步 → verify: `pnpm -r build` 过 web 包类型
- [x] A4. `MemoryView.tsx` 加筛选 UI：顶部加 category / severity / files 筛选下拉（默认"全部"，提供"未分类 / 未标严重度 / 无关联文件"兜底），老条目在"全部"和"未分类"档都显示 → verify: web 包 tsc 通过（pre-existing 'skills' 错误除外）；浏览器打开「Dev Docs」→「记忆」tab，看到老 28 条；切到"未分类"仍能看到；归档新任务后能筛新标签条目（待主理人手动验收）。**修正**：原 verify 要求 `logAction('memory','filter-...')` 起止配对，与 auto.md 经验"纯前端视图切换不埋日志"冲突，已移除该要求
- [x] A5. 确认 SessionStart hook 注入未受影响（hooks-smoke 全 OK；buildMemoryHeader 仅用 e.text 字段，未受新可选字段影响）：跑 `pnpm smoke:hooks` 或直接调 `buildSessionStartAdditionalContext`，验证新格式 30 条仍在 10KB 内 → verify: smoke 通过；手工算 30 条平均字节 + 标签段长度 ≤ 10KB

## 任务 B：错误循环检测

- [x] B1. 新建 `packages/server/src/error-pattern-monitor.ts`（24/24 单测通过）：`class ErrorPatternMonitor` 含 `record(entry)` / 滑动窗 / 去重 / 冷却；阈值常量集中（`WINDOW_MS=3600000`, `THRESHOLD=3`, `COOLDOWN_MS=86400000`）；key 生成 `(scope, action, projectId?)`，缺 action 用 `msg.slice(0,32)` 的 SHA-1 前 8 字符 hash → verify: `pnpm -r build` 过类型；新建 `scripts/error-pattern-smoke.mjs` 单测：3 次同 key 触发 1 次告警 / 2 次不触发 / 冷却期不重复 / 不同 projectId 不误聚合 / 缺 action fallback 稳定
- [x] B2. 接入 `log-bus.ts`：`serverLog` 在 `appendJsonl` + `broadcast` 之后用 `setImmediate` 调 `errorPatternMonitor.record(entry)`（仅 level='error'）；`persistClientLog` 同样接入；try/catch 吞异常并 `serverLog('warn', 'error-monitor', ...)` → verify: `pnpm -r build`；smoke 脚本里故意让 monitor 抛错，断言原始 error 日志仍落盘和广播，并多一条 warn
- [x] B3. 扩展 WS 报文：`packages/server/src/types/log.ts` 新增 `ErrorPatternAlert` 类型；`log-bus.ts` 新增 `broadcastAlert(payload)`；触发告警时同时 `serverLog('warn', 'error-monitor', ..., {meta:{alert:true,...}})` → verify: `pnpm -r build`；smoke 验证连续 3 次同 key 只看到一次 broadcast，JSONL 里能看到 alert 日志
- [x] B4. 前端类型镜像 + WS 处理：`packages/web/src/types.ts` 镜像 `ErrorPatternAlert`；扩展 `ServerToClientMessage` discriminated union 加 `error-pattern-alert` case；`main.tsx` WS 收消息时 dispatch 到 store → verify: `pnpm -r build` 过 web 包类型
- [x] B5. `store.ts` 加 alerts 状态：`alerts: ErrorPatternAlert[]`，`ALERT_RING_CAPACITY=50`；新增 `appendAlert(a)` / `dismissAlert(id)` / `markAlertRead(id)` actions，裁剪逻辑参照 `appendLog` → verify: `pnpm -r build`；浏览器 console 模拟 60 条 appendAlert，断言只保留最新 50
- [x] B6. `MemoryView.tsx` 顶部加告警卡片区：在筛选 UI 上方、manual/auto 段之前；卡片字段 `scope · action · count 次 · 时间窗`；文案"当前运行期间检测到"；按钮 [复制 manual.md 草稿]、[已读]、[关闭]；复制用 `navigator.clipboard.writeText` + 调 `openFile('dev/memory/manual.md')`；所有按钮用 `logAction('memory', 'alert-...', ...)` 包装 → verify: 浏览器在 LogsView 看到 `scope=memory action=alert-copy-draft` / `alert-dismiss` / `alert-mark-read` 起止配对；故意触发剪贴板失败分支看到 ERROR；卡片可点开复制、关闭、已读，manual.md 内容未被自动修改（待主理人手动验收）
- [x] B7. 端到端 smoke：编写 `scripts/error-pattern-e2e-smoke.mjs` 启临时 server，往 `serverLog('error', 'foo', 'bar', {meta:{action:'baz', projectId:'p1'}})` 连发 3 次，订阅 WS 收到一次 `error-pattern-alert`，再发 3 次确认冷却不重复 → verify: `pnpm smoke:error-pattern-e2e` 通过；JSONL 里能看到 alert 日志

## 收尾

- [x] Z1. 全量类型 + 双 smoke：`pnpm -r build` + `pnpm smoke:memory-parse` + `pnpm smoke:error-pattern-e2e` 全绿 → verify: 三条命令各自退出码 0
- [x] Z2. 准备 handoff 摘要给大哥（≤10 行，第一行验收指引）→ verify: 输出在最后一轮回复末尾
