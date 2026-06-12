# AI资讯详情抓原文 · Claude plan 草案 + 事实包（供 Codex 会审）

## 用户需求

大哥反馈：「AI资讯的内容只有标题内容太少了」。已确认方向：**点开资讯条目时，后端去抓原文网页正文，提取出来显示在详情页里**（不做 AI 摘要，不只是铺现有字段）。

## 事实包（项目现状，Codex 没有 SessionStart 记忆，全靠这段）

### 数据源现状（已实测验证）
- 上游 `https://learnprompt.github.io/ai-news-radar/data/daily-brief.json` 的 story 字段：
  `title / primary_url / url / category / importance_label / score / reasons / sources[] / source_count / earliest_at / latest_at`。
  **没有任何正文/摘要字段**。`latest-24h.json`、`waytoagi-7d.json` 同样只有标题级数据。
- 所以"内容少"只能靠我们自己按 `primary_url` 抓原文网页解决。

### 现有代码链路
- 后端：`packages/server/src/routes/radar.ts`（239 行，独立 `/api/radar/*` 路由）：
  - `fetchDailyBrief({force})` 抓上游 + 10 分钟内存缓存（`_cache`）
  - 运行时归一化 `normalizeDailyBrief`，坏 story 跳过；`RadarError(message, code, httpStatus)` 映射结构化错误
  - `serverLog("info"|"error", "radar", ...)` 起止配对日志（项目硬性规则）
- 前端：
  - `packages/web/src/components/sidebar/RadarView.tsx`：列表；点条目 `openStory()` → `openFile({projectId: RADAR_TAB_PROJECT_ID, path: storyId, kind: 'radar', radarTitle, radarMarkdown})`，markdown 在**点击时一次性组装**（`buildStoryMarkdown`），作为内容快照存在 tab 上。
  - `packages/web/src/store.ts`：`EditorTab.radarMarkdown?: string` 内容快照字段；`EditorTabKind = 'file' | 'commit' | 'radar'`。
  - `packages/web/src/components/editor/EditorArea.tsx:363-373`：`kind === 'radar'` 时直接 `<MarkdownView source={activeFile.radarMarkdown} readOnly>`，**纯静态渲染，没有异步加载能力**。
  - `packages/web/src/api.ts` 有 `getRadarDailyBrief(force)`；`packages/web/src/types.ts` 有 RadarStory 等类型（与后端字段对齐的副本）。
- 服务端依赖（package.json）：fastify 系、better-sqlite3、simple-git、zod 等。**没有 HTML 解析库**。
- 验收命令：后端 `pnpm -F @aimon/server build`（tsc），前端 `pnpm -F @aimon/web build`（无独立 typecheck 脚本，build 即类型检查）。
- 已有测试脚本风格：`packages/server/scripts/radar-test.ts`（用 fetchImpl 注入做的轻量自测）。

### 项目记忆中的相关约束（auto.md/manual.md 摘录）
1. [安全] "接收外部地址并交给子进程/请求前，必须先白名单解析再重组安全 URL，不能把用户原始输入直接传给执行命令"（技能市场二期，severity=error）。本任务后端要 fetch 客户端传来的 URL——**有 SSRF（让服务器替攻击者访问内网地址）风险面**，必须校验。
2. [约定] 前端用户触发的异步动作用 `logAction(scope, action, fn, ctx)` 包起止日志；后端 mutation/抓取用 `serverLog` 起止配对 + 失败 ERROR。
3. [约定] 全机器级能力挂独立 `/api/radar/*`（已是现状，沿用）。
4. [约定] 上游/外部输入是不可信输入，TS 类型管不到，运行时归一化 + markdown 特殊字符转义（`escapeMd` 已有，正文也要转义后塞进 markdown）。
5. [大哥偏好] 交付前不自动跑 browser-use 验收；build/类型检查过即交付，UI 大哥手动验，handoff 给「点哪里看」指引。

## Claude 草案

### 大哥摘要（草案）
- 现在点开一条 AI 资讯，详情页只有标题、来源链接这些"目录信息"，看不到文章讲了什么。
- 这次改完：点开一条资讯，详情页会自动去原文网站把**正文文字**抓回来直接显示，不用再跳出去开浏览器。
- 部分网站会拒绝程序访问（反爬）或要登录，这种抓不到的会显示"原文抓取失败"，仍保留现在的标题+来源+原文链接，不影响使用。
- 不动你现有的任何数据；资讯列表本身不变，只有详情页变丰富。

### 方案要点
1. **后端新路由** `GET /api/radar/article?url=<encoded>`：
   - 校验 url 是 http/https；**SSRF 防护**：解析 hostname，拒绝 localhost/127.x/10.x/172.16-31.x/192.168.x/0.x/IPv6 回环、私网与 link-local；（备选更强方案：要求 url 必须出现在当前缓存的 daily-brief 的 primaryUrl/sources[].url 集合中——但缓存 10 分钟过期后已打开的 tab 会取不到，需要权衡，Codex 给意见）
   - fetch 原文 HTML（15s 超时、跟随重定向、限制响应体大小如 2MB、设置常规浏览器 UA 头降低被拒概率）
   - 用 readability 类提取正文 → 输出**纯文本段落**（或轻量 markdown），同时返回提取到的标题/站点名/字数
   - 内存 LRU 缓存（按 url，TTL 如 30 分钟，上限如 50 条），避免反复点开重复抓
   - `serverLog` 起止配对；失败映射 RadarError 风格结构化错误
2. **依赖选择**（AI 自决，Codex 评审给意见）：`@mozilla/readability` + `linkedom`（轻量 DOM，不用 jsdom）；备选：不引库、写启发式提取（`<article>`/`<p>` 密度），但质量没保证。
3. **前端详情页改造**：
   - 现状 radarMarkdown 是点击时组装的静态快照。改造方向：radar tab 渲染拆成独立组件 `RadarStoryView`（EditorArea 里 kind==='radar' 分支改挂它），挂载后异步调 `/api/radar/article`，加载中显示"正在抓取原文…"，成功后把正文段落渲染在"入选理由/来源"之上（或之下，定稿时定）；失败显示一行可重试的失败提示，保留现有元信息 markdown。
   - tab 上仍保留 radarMarkdown 快照作为兜底（列表刷新/条目消失后 tab 仍可读的语义不变）。
   - 正文文本经 `escapeMd` 或按纯文本渲染，防止原文 HTML/markdown 注入改变页面结构。
   - 前端 `logAction('radar', 'fetch-article', ...)` 起止日志。
4. **类型/API 客户端**：types.ts 加 `RadarArticle`；api.ts 加 `getRadarArticle(url)`。

### 验收标准（草案）
- 浏览器可观察：打开「AI资讯」侧栏 → 点一条资讯 → 详情页先显示"正在抓取原文…"，几秒内出现正文段落文字（明显多于标题）；点一条抓不到的（或断网模拟）→ 显示抓取失败提示且原有标题/来源仍在。
- LogsView 看到 `scope=radar action=fetch-article` 起止配对；后端日志落盘有对应条目；人工触发一次失败分支（非法 url 或断网）看到 ERROR。
- `pnpm -F @aimon/server build` 与 `pnpm -F @aimon/web build` 通过。
- 新增 `packages/server/scripts/radar-article-test.ts`（fetchImpl 注入式自测：正常 HTML 提取 / 非法 url 拒绝 / 私网 url 拒绝 / 超大响应截断）。

### 非目标（草案）
- 不做 AI 摘要/翻译。
- 不改资讯列表的展示形态。
- 不做正文的磁盘持久化（只内存缓存）。
- 不动上游 ai-news-radar 数据管道。

### 已知边界情况
- 反爬站点（403/验证码页）→ 失败分支或提取出垃圾内容（需要"提取结果太短视为失败"的阈值，如 <200 字符回落）
- 非 HTML 响应（pdf/图片/json）→ 按 content-type 拒绝
- 超大页面 → 响应体大小上限
- 编码非 UTF-8 的老站点 → 乱码风险（按 charset 头/meta 处理或接受降级）
- url 重定向到私网地址 → 重定向后也要做 SSRF 校验（fetch 的 redirect 语义要确认）
- 同一故事 sources 多个 url：只抓 primaryUrl，失败是否自动试下一个 source url？（倾向第一版不做，失败就显示失败）

### 风险与注意
- SSRF 是本任务最大安全风险面，校验必须在重定向链路上每一跳生效（undici fetch 默认自动 follow redirect，可能要 redirect: 'manual' 手动跟）。
- readability 对非新闻类页面（GitHub、论坛、HN 评论页）提取质量参差——HN 链接很多，提取出来可能是评论列表。
- linkedom 对真实世界脏 HTML 的容错性 vs jsdom（重）的取舍。
