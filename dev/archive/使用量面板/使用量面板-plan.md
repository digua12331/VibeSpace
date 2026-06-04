# 使用量面板 · Plan

> memory 扫过：`auto.md` 仅有一条 hook 冒烟测试条目；`manual.md` 关于"小功能直改"——本任务不是小功能（涉及新组件 + 后端路由 + 数据解析），**不豁免**走完整流程。

## 一句话

在左侧 ActivityBar 加一项「使用量」，主侧栏切到该项时显示 Claude Code（及预留的其他 CLI）token 用量与套餐配额状态。

## 目标 & 验收标准

- ActivityBar 新增图标 → 点击 → PrimarySidebar 渲染新 `UsageView` 组件，**浏览器里能直接看到**
- UsageView 至少显示三块（基于本地 `~/.claude/projects/**/*.jsonl` 解析）：
  1. **今日 token 用量**：input / output / cache_creation / cache_read 四列汇总，按 model 分组（claude-opus-4-x、claude-sonnet-4-x、claude-haiku-4-x）
  2. **最近 5 小时滑动窗口（block）用量**：Claude Code 限额按 5h 滚动结算，所以这是最有实际意义的指标——显示窗口起止时间、本窗口内 token 累计、距窗口结束剩余分钟数
  3. **历史日趋势**：最近 7 天每天 token 总数的迷你柱状图（纯 div + Tailwind 高度，不引绘图库）
- **后端**：`GET /api/usage/claude` 返回结构化 JSON（同步解析 jsonl，不做缓存——文件不大、按需即可），失败返回 4xx/5xx + LogsView 可见错误
- **操作日志（硬性）**：前端按"切到 Usage tab → 拉取数据"算一次操作，用 `logAction` 包裹；后端用 `serverLog` 起止配对（`scope=usage action=read`）
- **验收命令**（在 tasks 阶段每步配 verify）：
  - `cd packages/server && pnpm tsc --noEmit && cd ../web && pnpm tsc --noEmit`（项目层面类型检查）
  - 浏览器打开 → 点 ActivityBar 新图标 → 看到当日数字 + 5h 窗口 + 7 天柱图
  - 浏览器 LogsView 看到 `scope=usage action=read 开始/成功 (Nms)` 配对
  - 把 `~/.claude/projects/` 重命名一下制造失败 → 看到 ERROR 条目 + 前端展示空态/错误提示

## 非目标 (Non-Goals)

- **不做**其他 CLI（Codex/Gemini）的真实接入：它们用 API key 计费、本地无 jsonl，账单要登 OpenAI/Google dashboard。本期只在 UI 留个"其他 CLI"折叠区写"暂未接入，详见 OpenAI/Google 后台"占位文字
- **不做**官方"套餐档位识别"（Pro/Max5x/Max20x）：jsonl 里没标，Anthropic 也没暴露公开 API。仅显示绝对用量，不做"剩余百分比"误导性指标
- **不做**实时推送 / WebSocket：5h 滚动够用按需拉取（点 tab 时拉一次 + 手动刷新按钮）。轮询会日志风暴
- **不做**历史持久化 / 自建数据库表：每次现解析 jsonl，文件本身就是事实源
- **不做**ccusage CLI 调用：避免引入 npx 下载延迟与第三方版本耦合，自己解析 jsonl 几十行代码搞定
- **不做**性能视图相关改动（PerfView 是进程指标，与 token 用量是两回事）

## 实施步骤（粗粒度）

1. **后端：jsonl 解析器**——新建 `packages/server/src/usage-service.ts`：glob `~/.claude/projects/**/*.jsonl`，按行解析 `{message:{model,usage:{input_tokens,output_tokens,cache_creation_input_tokens,cache_read_input_tokens}},timestamp}`，输出 `{ today, last5h, last7days, asOf }` 结构。验证：用现有 jsonl 跑一次确认数字对得上。
2. **后端：路由**——新建 `packages/server/src/routes/usage.ts`，注册 `GET /api/usage/claude`，加 `serverLog` 起止配对 + ERROR 路径。`index.ts` 注册。验证：curl 拿到 200 + 合法 JSON。
3. **前端：API client + types**——`packages/web/src/api.ts` 加 `getClaudeUsage()`；`types.ts` 加 `ClaudeUsage` 类型。验证：tsc。
4. **前端：UsageView 组件**——`packages/web/src/components/sidebar/UsageView.tsx`，挂载即拉数据（`logAction` 包裹），三块布局参照 `PerfView` 的卡片+条形风格保持一致；空态 / loading / error 三态。验证：浏览器看到。
5. **前端：注入 ActivityBar + Sidebar**——`store.ts` 的 `Activity` 联合类型加 `'usage'`；`ActivityBar.tsx` items 数组加一项（图标用 `🧮`，"使用量"，与现有 8 项 emoji 不重复）；`PrimarySidebar.tsx` switch 加 `case 'usage'`，`TITLES` 加 `usage: '使用量'`。验证：tsc + 浏览器看到。
6. **失败路径打点**——故意把 `~/.claude/projects/` 改名 / 路由抛错，验证 LogsView 出现 `level=error` 条目；恢复后正常。
7. **handoff 摘要**——交付收尾，列改动文件 + 验证方式。

## 边界情况

- `~/.claude/projects/` 不存在或为空目录 → 后端返回 `{ today:0, last5h:0, last7days:[0,0,0,0,0,0,0], note:'no jsonl found' }`，前端展示空态（"未发现 Claude Code 历史数据"）
- jsonl 行损坏 / JSON.parse 失败 → 跳过该行，计数器记 `skipped`，最终一并返回，UI 在角落小字提示 "n 行解析失败"
- jsonl 单文件体积大（极端 50MB+）→ 用流式逐行读 `readline`，不要一次性 `readFileSync` + split
- 单个 message 没有 `usage` 字段（用户消息）→ 跳过
- model 名称形如 `claude-opus-4-7-20260101` → 归并到 `opus` / `sonnet` / `haiku` 三族（正则 `/claude-(opus|sonnet|haiku)-/`），未知归 `other`
- 时区：5h 窗口按本机时区 / 7 天日聚合按本机日界。jsonl 的 `timestamp` 是 ISO UTC，转本地时区显示
- 用户家目录非 Windows 的 `C:\Users\<name>` 形态：用 `os.homedir()`，不要硬编码

## 风险与注意

- **假设 1**：`~/.claude/projects/` 下的 jsonl 格式是 `{type, message:{model, usage:{...}}, timestamp, ...}` 单行 JSON。需要在步骤 1 实现前先 `head -1` 一份现有 jsonl 抽样确认结构（**这一步实现时如果发现结构不同，立即停下来回报**）
- **假设 2**：5h 滚动窗口是从"最早的活跃 message 起算 5h"——这是 ccusage 社区文档里描述的 Claude Code block 规则。我不 100% 确定 Anthropic 的实际计算口径。**plan 里我就用"近 5 小时滑动总和"这个简单解释，不假装它精确等同于官方 limit 重置周期**——UI 文案要写"近 5 小时累计（参考用，非官方剩余配额）"
- **假设 3**：项目目录名 `C--Users-zh-zhang-poc-blast-radius-project` 这种形态是 Claude Code 的 cwd 转义。本期不做"按项目分组"，把所有项目一起聚合即可（避免范围扩大）
- 跨平台：路径用 `path.join(os.homedir(), '.claude', 'projects')`，正斜杠/反斜杠不要写死
- ActivityBar 图标已经 8 个，加一个"使用量"=9 个；视觉上还能塞下，但要确认在小屏不会挤掉底部 ● 通知指示。验证时缩窗口看一眼

## 待用户确认的几个分叉

1. **数据源策略**：自己解析 jsonl（A，本 plan 默认） vs 调 `npx -y ccusage --json`（B，复用现成但慢/有依赖） vs 两者都做加切换（C，过度设计）。我推荐 A，但如果你已经在用 ccusage 习惯了它的口径，可以选 B。
2. **图标占位**：我打算用 `🧮`（算盘 = 计数）。如果你更喜欢 `💰` / `📈` / `📉` / `🪙`，告诉我。
3. **要不要在同一个面板里给 Codex / Gemini 留占位文字**？还是干脆这次只显示 "Claude Code"，其他 CLI 整个不出现？我倾向后者（更聚焦）。
