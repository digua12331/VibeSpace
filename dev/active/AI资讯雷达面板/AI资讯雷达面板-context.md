# AI资讯雷达面板 · Context（AI 自用）

## 关键文件（= 本次改动边界 / write 白名单）

1. `packages/server/src/routes/radar.ts` **新建** — 上游代理 + 10min 内存缓存 + 15s 超时 + 结构校验归一化；导出可测纯函数 `normalizeDailyBrief` / `fetchDailyBrief`（fetch 可注入）
2. `packages/server/src/index.ts` — import + `registerRadarRoutes(app)`（仿 :283 registerSkillMarketRoutes）
3. `packages/server/scripts/radar-test.ts` **新建** — 可控模拟：归一化/缺字段/坏结构/缓存命中/force/超时/非200
4. `packages/web/src/types.ts` — RadarSource / RadarStory / RadarDailyBrief 手抄镜像
5. `packages/web/src/api.ts` — `getRadarDailyBrief(force?)`，走 request<T> 模板（api.ts:99）
6. `packages/web/src/store.ts` — ACTIVITIES 加 'radar'(:54)；EditorTabKind 加 'radar'(:69)；EditorTab 加 `radarStoryId?/radarTitle?/radarMarkdown?`(:71)；项目切换过滤保留 radar 页签(:659)
7. `packages/web/src/components/layout/ActivityBar.tsx` — items 数组 appearance 后加 `{id:'radar',icon:'📡',label:'AI资讯'}`(:55)
8. `packages/web/src/components/layout/PrimarySidebar.tsx` — lazy import + STATIC_TITLES + switch case
9. `packages/web/src/components/sidebar/RadarView.tsx` **新建** — 列表/刷新/陈旧提示/错误保旧
10. `packages/web/src/components/editor/EditorArea.tsx` — kind==='radar' 渲染分支（lazy MarkdownView，readOnly）；tab 标签用 radarTitle

只读参考：`MarkdownView.tsx`（props source/readOnly）、`logs.ts::logAction`、`log-bus.ts::serverLog(level,scope,msg,extra)`、`skill-market-service.ts`（缓存+超时先例）、`AppearanceView.tsx`（侧栏样式参考）。

## 决策记录

- **radar 页签的唯一键**：不改 `editorTabKey()` 签名——radar 页签用 `projectId='__radar__'`（哨兵值，全局页签）+ `path=story 的稳定标识`（story_id 缺失时用 url/位置合成），kind='radar'。这样 key 天然含 story 标识，同一故事去重、不同故事不冲突。资深工程师视角：不为此加新的 key 函数，复用现有拼接。
- **项目切换保留 radar 页签**：store.ts:659 过滤改为 `f.kind === 'radar' || f.projectId === id`。fileDropped 判定逻辑不变（radar 留下时长度不变，active 不被误切）。
- **内容快照存 tab 上**（radarMarkdown），不存 store 全局列表：openFiles 本就不持久化，单条 md 几 KB，刷新列表/上游消失后已开详情仍可读（Codex 评审采纳）。
- **列表状态放 RadarView 本地 useState**：后端有 10min 缓存，重进侧栏重新请求即可，不扩全局 store（auto.md "小范围缓存不引库" + Codex 评审一致）。
- **md 组装放前端**（RadarView 点击时），后端只负责干净的结构化数据——后端不掺渲染逻辑，将来 UI 改版不动后端。
- **转义外部文本**：标题/理由/来源名过 `escapeMd()`（转义 \` * _ [ ] ( ) # ~ | < >），链接仅放行 http/https；防上游文本改变页面结构（Codex 评审采纳）。
- **不写 service 层**：单路由全部逻辑放 routes/radar.ts，导出纯函数供测试脚本 import（Codex 评审：不为一次性逻辑新增服务层）。

## 依赖与约束

- 上游：`https://learnprompt.github.io/ai-news-radar/data/daily-brief.json`，结构 `{generated_at, window_hours, total_items, items[]}`；story 字段见 plan；**运行时必须校验**，TS 类型管不到上游。
- `pnpm -F @aimon/web build` / `pnpm -F @aimon/server build` 是两端类型检查门槛；测试脚本 `pnpm -F @aimon/server exec tsx scripts/radar-test.ts`。
- server 是 ESM（import 带 .js 后缀）；scripts/ 下已有 *-test.ts 用 tsx 跑的先例。
- openFile() 单预览语义（store.ts:522 注释）：打开 radar 会替换文件预览页签，plan 已声明，不改该语义。
- MarkdownView 链接已在新窗口打开（FilePreview 现行为），radar 分支直接复用。
