# AI资讯雷达面板 · Claude plan 草案 + 事实包（供 Codex 会审/主笔用，非最终 plan）

## 用户需求（原话转述）

把 ai-news-radar（github.com/LearnPrompt/ai-news-radar）做成 VibeSpace 项目内的功能：
在左侧活动栏「外观」按钮下面加一个按钮，点击后拉取 AI 资讯，侧栏显示条目列表；
点条目像 RSS 阅读器一样，在编辑区开一个 markdown 页签查看该条资讯详情。

## 上游数据事实（已实测）

- 数据源：`https://learnprompt.github.io/ai-news-radar/data/daily-brief.json`（GitHub Pages 公开静态 JSON，无鉴权无限流；本机实测 200，1.7s，49KB）
- 结构：`{ generated_at, window_hours, total_items, items: Story[] }`，items 固定约 20 条精选故事线
- Story 字段：`story_id, title(中文), url, primary_url, source, source_name, sources[](多源数组,每源含 title/url/source_name/published_at), source_count, score, importance, importance_label, category, reasons[], earliest_at, latest_at, primary_item`
- 同目录还有 `latest-24h.json`（~2MB 全量，本期不用）、`source-status.json`、`stories-merged.json`
- 上游由 GitHub Actions 自动更新；README 提示 daily-brief 在"无达标故事"时可能不更新 → 需检查 `generated_at`，>36h 提示数据陈旧
- 项目 `.claude/skills/ai-radar/SKILL.md` 已装（上一任务），与本功能互不依赖

## 本仓库代码现状（已调研）

- 活动栏：`packages/web/src/components/layout/ActivityBar.tsx:40-56` items 数组，`appearance` 是最后一项；新按钮插在它后面即"外观下面"
- Activity 类型：`packages/web/src/store.ts:54-64` ACTIVITIES 常量 + `type Activity`；老用户 localStorage 残留 activity 有清洗逻辑（store.ts:122）
- 侧栏分发：`packages/web/src/components/layout/PrimarySidebar.tsx:59-94` 硬编码 switch(activity) → View 组件；标题映射 PrimarySidebar.tsx:22
- 页签模型：`store.ts:69` `EditorTabKind = 'file' | 'commit'`；`store.ts:71-85` `interface EditorTab {key/projectId/path/ref/...}`；唯一开页签入口 `openFile()`(store.ts:518)；EditorArea.tsx:204,251 渲染 tab bar
- **openFiles 不持久化**（persistWorkbench 只存 activity/尺寸/activeSession）→ 刷新页面页签消失，资讯详情存前端内存即可
- md 渲染：`packages/web/src/components/MarkdownView.tsx:87-95`，props 接收 `source: string`（md 字符串），现唯一使用者 FilePreview.tsx
- 前端无直接 fetch 外部 URL 先例，所有请求走 api.ts → 后端 127.0.0.1:8787
- 后端代理外部 API + 内存缓存先例：`packages/server/src/skill-market-service.ts:275-300`（GH_CACHE Map + fetch + AbortController 超时），路由 `routes/skill-market.ts`
- 路由模板/日志/类型镜像约定：dev/ARCHITECTURE.md §3.3 Fastify 路由模板、§3.1 操作日志起止配对、§关键文件索引「类型镜像（手抄）」

## 项目记忆引用（Codex 看不到 SessionStart 注入，这里抄给你）

- [auto.md/技能市场二期] 全机器级能力优先挂独立 `/api/<feature>/*` 路由，不塞进 `/api/projects/:id/*` —— 资讯雷达与项目无关，挂 `/api/radar/*`
- [auto.md/项目切换优化] 小范围缓存直接放现有 store/内存 Map，不为单点缓存引入新查询库
- [auto.md] 前端用户触发的异步动作用 `logAction(scope, action, fn, ctx)` 包起止；高频/轻交互不逐次打日志
- [manual.md/2026-06-03] 交付门槛 = `pnpm -F @aimon/web build` + server 类型检查通过即可，不派浏览器测试 agent；handoff 第一行给大哥"点哪里看"指引
- [manual.md/2026-04-30] 只让大哥确认大方向和用户可感知分叉，内部实现 AI 自决

## Claude 草案

### 方向

活动栏新增「📡 AI资讯」按钮（外观下方）→ 侧栏 RadarView：
顶部 = 刷新按钮 + 数据生成时间（>36h 染黄提示陈旧）；
列表 = 20 条故事：标题、importance_label 徽标、来源数、相对时间。
点条目 → `openFile({kind:'radar', ...})` 开 md 页签，前端把 Story 组装成 md 字符串（标题/分类/重要度/reasons/时间窗/多源链接列表/原文链接），交 MarkdownView 渲染；链接 target=_blank。

### 数据通道

后端新增 `GET /api/radar/daily-brief`：代理上游 daily-brief.json，内存缓存 TTL 10min，`?force=1` 绕缓存（刷新按钮用）；15s 超时；失败返回结构化错误。serverLog('radar', ...) 起止配对。
理由：与项目"全部走后端"的惯例一致；规避将来 CORS/网络环境差异；可统一日志排障。

### 改动面（预估 7 文件）

1. `packages/server/src/routes/radar.ts` 新建 + `index.ts` 注册
2. `packages/server/src/types.ts`(或等价) + `packages/web/src/types.ts` 手抄镜像 RadarStory 类型
3. `packages/web/src/api.ts` 加 `getRadarDailyBrief(force?)`
4. `store.ts`：Activity 加 'radar'；EditorTabKind 加 'radar'；EditorTab 加可选 `radarStoryId`；radar items 瞬时 state（不持久化）
5. `ActivityBar.tsx` 加按钮；`PrimarySidebar.tsx` 加 case + 标题
6. `packages/web/src/components/sidebar/RadarView.tsx` 新建（列表）
7. `EditorArea.tsx`/`FilePreview.tsx` 接 kind==='radar' 的渲染分支（组装 md → MarkdownView）

### 验收（浏览器可观察）

- 活动栏外观下方出现 AI资讯按钮；点开见列表（约 20 条，含重要度徽标和时间）
- 点刷新重新拉取，顶部时间更新；断网/上游不可达时列表区显示错误文案，LogsView 出现 scope=radar 的 ERROR
- 点任一条目右侧开 md 页签：标题、重要度、入选理由、各来源链接可点（新窗口打开）
- LogsView 见 `scope=radar action=fetch` 起止配对
- `pnpm -F @aimon/web build` + server 类型检查通过

### 非目标

- 不自建抓取流水线（数据仍来自 LearnPrompt 公开 JSON，不 fork 不跑 Python）
- 不做订阅源管理 / OPML / 已读收藏 / 推送通知
- 不拉 2MB 的 latest-24h.json，本期只用 daily-brief
- 不修技能市场"多 skill 仓库错抓第一个 SKILL.md"的 bug（已知问题，另行处理）

### 已知风险/边界

- 上游某天不更新 → generated_at 陈旧提示（>36h）
- 上游字段缺失/结构变化 → 前端渲染需对缺失字段容错（sources 空、reasons 空）
- 刷新页面后 radar 页签随 openFiles 一起消失 → 符合现有页签语义，不额外处理
- 重复点同一条目 → openFile 以 key 去重（沿用现有行为，key=radar:<story_id>）

## 请 Codex 评审的点（≤30 行清单）

1. 结构上有没有显著更简的路（如：要不要后端代理？前端直拉 GitHub Pages 是否更简且可接受）
2. EditorTab 扩展方式（加 kind + radarStoryId vs 内容直接挂 tab）哪个对现有 EditorArea 改动最小
3. 落地路径风险：Activity 枚举新增对 localStorage 清洗逻辑（store.ts:122）的影响
4. 有没有漏掉的上游依赖 / 边界情况 / 数据影响
