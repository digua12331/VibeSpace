# AI资讯详情抓原文 · Context（AI 自用）

## 关键文件（本次改动边界）

### 后端
- `packages/server/src/radar-article.ts`（**新建**）：原文抓取核心逻辑——SSRF 校验（IP 黑名单判定函数 + 绑定到 net/tls 连接的 lookup 包装）、手动逐跳重定向、流式 2MB 字节截断、charset 解码、readability 提取、最短/最长正文阈值、内存 TTL 缓存。所有外部 IO 走可注入的 transport 接口，供测试脚本替换。
- `packages/server/src/routes/radar.ts`：注册 `GET /api/radar/article?storyId=`；导出 `findCachedStory(storyId)` 供 article 模块从 daily-brief 缓存解析 primaryUrl；serverLog 起止配对（meta 只记 host/耗时/字数，不记完整 URL）。
- `packages/server/package.json`：新增依赖 `@mozilla/readability`、`linkedom`。
- `packages/server/scripts/radar-article-test.ts`（**新建**）：注入式自测。

### 前端
- `packages/web/src/components/editor/RadarStoryView.tsx`（**新建**）：radar 详情组件——渲染 radarMarkdown 快照 + 正文区（加载中/成功/失败可重试三态），logAction('radar','fetch-article') 包装。
- `packages/web/src/components/editor/EditorArea.tsx`：kind==='radar' 分支（363-373 行）改挂 RadarStoryView，传 `storyId={activeFile.path}` 和 `fallbackMarkdown={activeFile.radarMarkdown}`。
- `packages/web/src/api.ts`：加 `getRadarArticle(storyId)`。
- `packages/web/src/types.ts`：加 `RadarArticle`。
- `pnpm-lock.yaml`（装依赖自动变）。

不动：store.ts（radar tab 的 path 已存 storyId，够用）、RadarView.tsx（列表与 openStory 不变）、上游数据管道。

## 决策记录

1. **HTTP 客户端用 node:http/https 原生 request，不用 undici Agent**。原因：SSRF 防护要把"公网 IP 校验"绑定到实际连接，node 原生 request 的 `lookup` 选项直接传给 net.connect/tls.connect，校验结果就是建连用的地址，天然防 DNS 重绑定；undici 的 connect/lookup 钩子文档不稳且 undici 不在依赖里。原生方案 0 新依赖、重定向/字节计数/超时全程自控。不算过度设计：这正是 plan 第 1 步"无法证明安全就不交付"的最直路径。
2. **私网判定范围**：拒绝 IPv4 0/8、10/8、100.64/10、127/8、169.254/16、172.16/12、192.168/16、224/4、240/4；IPv6 ::1、::、fe80::/10、fc00::/7、ff00::/8、::ffff:v4 映射（按内层 v4 再判）。纯 IP 字面量 host 直接判，不走 DNS。
3. **重定向**：手动逐跳，最多 5 跳；每跳只接受 http/https 绝对/相对 Location，重新走完整校验（含 lookup 绑定）。
4. **大小/长度阈值**：响应体流式累计 >2MB 中止；提取正文 <200 字符判失败（radar_article_unextractable，覆盖空壳/登录页）；>50000 字符截断加标记。超时 15s（复用 radar.ts 的常量风格，独立定义）。
5. **charset**：Content-Type 头 charset → 无则嗅探首 2KB 的 meta charset → 默认 utf-8；TextDecoder 不认识的编码回落 utf-8（Node 全 ICU，gbk/gb2312 可解）。
6. **提取**：linkedom `parseHTML` + `new Readability(document).parse()`，取 `textContent` 规整空白成段落；**只返回纯文本**，前端用 `whitespace-pre-wrap` 的 div 渲染（不过 MarkdownView），从渲染层面消灭 HTML/markdown 注入——比转义更简单可靠。
7. **缓存**：模块级 Map（url→结果），TTL 30 分钟，上限 50 条 FIFO 淘汰。不持久化。
8. **错误码**：复用 RadarError——`radar_story_not_found`(404) / `radar_article_blocked`(403, SSRF 拒绝) / `radar_article_timeout`(504) / `radar_article_failed`(502) / `radar_article_unextractable`(422)。
9. **前端布局**：快照 markdown 原样渲染在上，正文区（「原文正文」标题 + 三态）接在其后。不拆快照字符串——拆了就是只用一次的抽象。
10. **storyId 缓存失效**：daily-brief 缓存 10 分钟 TTL 过期后（_cache 仍保留对象，只是过期），`findCachedStory` 查"最后一次成功结果"即可命中——radar.ts 的 `_cache` 过期后不清空，fetchDailyBrief 失败也保留旧值，所以正常使用中旧 tab 大多仍能解析；服务器重启后才真正取不到，按 404 失败提示兜底。

## 依赖与约束

- Node ≥20（项目现状，tsx 跑 ESM），TextDecoder 全 ICU。
- `@mozilla/readability` 需要一个 DOM Document；linkedom 的 parseHTML 返回兼容文档（社区成熟组合）。Readability 会改 DOM，无所谓（一次性解析）。
- fastify 路由层沿用 radar.ts 的 sendError 映射。
- 验收命令：`pnpm -F @aimon/server exec tsx scripts/radar-article-test.ts`、`pnpm -F @aimon/server build`、`pnpm -F @aimon/web build`。
- 日志硬规则：前端 logAction 起止 + 后端 serverLog 起止；meta ≤2KB、JSON-serializable、不含完整 URL/正文/HTML。
