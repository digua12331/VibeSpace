# AI资讯详情抓原文 · 任务清单

- [x] 1. 装依赖 @mozilla/readability + linkedom → verify: pnpm install 成功，package.json 出现两条依赖
- [x] 2. 后端核心模块 radar-article.ts（SSRF 校验 + lookup 绑定 + 手动重定向 + 流式 2MB 截断 + charset 解码 + readability 提取 + 阈值 + 内存缓存，全部 IO 可注入） → verify: pnpm -F @aimon/server build 通过
- [x] 3. radar.ts 注册 GET /api/radar/article?storyId= + findCachedStory 导出 + serverLog 起止配对（meta 只记 host/耗时/字数） → verify: build 通过；启动 server 后 curl 一条真实 storyId 返回正文 JSON，curl 非法 storyId 返回 404 结构化错误
- [x] 4. 自测脚本 scripts/radar-article-test.ts（私网/回环/映射 IPv6 拒绝、DNS 重绑定拒绝、未知 storyId、重定向到私网、重定向过多、伪造 Content-Length 实际超 2MB 中止、非 HTML、脏 HTML 提取、空壳页判失败、超长截断） → verify: pnpm -F @aimon/server exec tsx scripts/radar-article-test.ts 全绿
- [x] 5. 前端 RadarStoryView.tsx（快照渲染 + 正文三态 + 重试 + logAction）、EditorArea 接入、api.ts/types.ts 补客户端 → verify: pnpm -F @aimon/web build 通过
- [x] 6. 全链路人工验证（API 层已在临时实例 18791 实测：真实文章 8070 字提取成功 / 404 失败分支 ERROR / 落盘日志起止配对且只记 host / 缓存命中 1ms；浏览器 UI 部分按 manual.md 偏好留大哥手动验收，正式实例 8787 需重启后生效）：浏览器点开资讯出正文；触发一次失败分支（非法 storyId / 断网）看到失败提示 + LogsView ERROR；LogsView 看到 scope=radar action=fetch-article 起止配对；落盘日志无完整 URL/正文 → verify: 以上逐项观察 + git diff --name-only HEAD 对照 write_files 白名单
