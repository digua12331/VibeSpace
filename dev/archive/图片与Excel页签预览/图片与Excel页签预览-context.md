# 图片与 Excel 页签预览 · Context

## 关键文件

> 这张清单就是本任务的边界。要溢出之前先回头补 context。

### 后端（@aimon/server）

- `packages/server/src/git-service.ts:194` — `safeResolve(projectPath, input)` 防 path traversal。**复用，不改**。
- `packages/server/src/git-service.ts:439` — `readFileAtRef`，已有的 base64+JSON+1MB 路径，本轮不动。
- `packages/server/src/index.ts:35,153` — 路由注册入口；`paste-image` 处可参考注册形态，本任务在它附近加一行 `registerRawFileRoutes(app)`。
- `packages/server/src/routes/git.ts:84-162` — `registerGitRoutes` 与 `loadProjectOr404` / `RefParam` / `FileQuery` 风格；新路由按这套写法保持一致。
- `packages/server/src/routes/paste-image.ts:9-24,46-68` — 现有 image MIME 集合 + `loadProjectOr404` 风格；MIME 映射可借鉴。
- **新增**：`packages/server/src/routes/raw-file.ts` — 实现 `GET /api/projects/:id/raw?path=...`。

### 前端（@aimon/web）

- `packages/web/src/api.ts:36-41` — `BASE` 与 `backendBase()`；**新增** `projectRawUrl(projectId, path)` 拼绝对 URL。
- `packages/web/src/components/FilePreview.tsx:22-28,36-40,221-251` — `isMarkdownPath` / `isHtmlPath` / `canPreview` / `defaultTab` / body 分支；**修改**：加 `isImagePath` / `isExcelPath`，纳入 `canPreview`，在 body 里 dispatch 到 `<ImagePreview>` / `<ExcelPreview>`。
- `packages/web/src/components/editor/EditorArea.tsx:282-301` — 文件 tab 渲染 `<FilePreview>`；**不改**。`openFile` 走的入口（`ChangesList.tsx:110`、`FilesView.tsx:301,329,339`、`DocsView.tsx:204`）一律不动。
- `packages/web/src/logs.ts:21-39,54-98` — `pushLog` / `logAction`；图片用挂载 + `onLoad/onError` 两次 `pushLog`，Excel 用 `logAction` 包 fetch+parse。
- `packages/web/src/components/HtmlPreview.tsx` — 现有 sandbox iframe 参考实现（看它怎么用 srcDoc 和 sandbox 属性），SVG 走类似套路但用 `src` 而不是 `srcDoc`。
- **新增**：`packages/web/src/components/ImagePreview.tsx`。
- **新增**：`packages/web/src/components/ExcelPreview.tsx`。
- **修改**：`packages/web/package.json` 加 `xlsx` 依赖。

## 决策记录

> 每一条都过了 “资深工程师会不会觉得过度设计” 的尺。能用现有组件就用，不为不存在的需求留口子。

### D1：新增 `/raw` 路由 vs. 给 `/file` 加 binary 直链模式

**选 D1 = 新增独立路由**。  
- `/file` 协议是 `FileContent { encoding, content, ... }`，老路由的 source / diff / comment anchor 都依赖它（`FilePreview.tsx:96,117`、`comments-service.ts`）。塞一个 `rawUrl` 字段给图片用，前端要分两条路：JSON 拿 url 又再发一次 GET，徒增往返；如果 base64 字段在图片场景下置空，又会让 source tab 看不到 base64 文本（现在是能看的，要保留）。
- 独立路由语义清晰：raw = 字节流；file = 文本/JSON。

### D2：图片用 `<img src>` 直链 vs. fetch + Object URL

**选直链**。`<img>` 自动用浏览器解码 + 缓存 + range 请求。Object URL 适合需要二次处理（裁剪/滤镜）才有价值，本轮不需要。React state 里只放路径字符串，组件挂载 / 卸载没有内存压力。

### D3：SVG 用 `<iframe sandbox>` vs. `rehype-sanitize` + `dangerouslySetInnerHTML`

**选 sandbox iframe**。iframe 是浏览器原生 origin 隔离，`sandbox=""` 不开任何 allow 直接屏蔽脚本/表单/插件/远程资源；sanitize 是 allowlist，要随 SVG 规范持续维护。简单优先。代价：SVG 里相对路径资源解析不到，但 SVG 通常自包含，可接受。

### D4：xlsx 解析放前端 vs. 后端

**选前端**。后端解析要新增 npm 包到 server、做 JSON 序列化、约定截断行列的协议；前端解析则 raw 路由零负担、随用随加载、UI 想展示多少行自己说了算。SheetJS browser bundle 走得通。

### D5：xlsx 包选 `xlsx` (SheetJS) vs. `exceljs` vs. `node-xlsx`

**选 `xlsx`（SheetJS community）**。  
- `exceljs`：大约 2 MB，偏写入场景，超出本轮只读需求。
- `node-xlsx`：SheetJS 的薄包装，没必要再加一层。
- `xlsx` (SheetJS) ~600 KB minified，xls / xlsx / ods 都覆盖，**动态 import** 隔离到 ExcelPreview 第一次挂载——从未打开 Excel 的用户永不下载。

### D6：xlsx 通过 npm 安装而不是 CDN

**选 npm**。本仓库前端没有运行时 CDN 依赖（看 `package.json`），加一个 CDN URL 会引入网络依赖与离线问题，与现有风格不符。

### D7：图片/Excel 页签默认 Preview tab 而不是 Source

**选默认 Preview**。用户点开图片就是想看图。`defaultTab` 老逻辑是 markdown / html 默认 preview，图片/Excel 加进去与现有体验对齐。Source / Diff 仍可手动切回。

### D8：历史 ref 上的图片/Excel 不支持

**不支持**（仅 WORKTREE）。`/raw` 路由若要读历史 commit 上的图片，需要 `git cat-file -p` 流式化，实现复杂；用户基本不会想看 7 个 commit 前那张 PNG 长啥样。Preview tab 在 `ref !== WORKTREE` 时不出现，用户看到的就是 Source（base64 文本，老体验）+ Diff。

### D9：raw 路由不打 LogBus 日志

**不打**。每张图都打太吵；Fastify 默认 access log（`logger: { level: "info" }` 已配在 `index.ts:78`）覆盖访问记录，需要排查直接看 server stdout。

### D10：50 MB 上限在 raw 路由本身做 stat 检查

**在路由层 stat**。Fastify multipart 有 `limits.fileSize`，但那是 POST 上传；GET 没有现成钩子。直接 `statSync` 后比 50 MB，超了 413。简单。

### D11：埋点用 `pushLog` 还是 `logAction`

- 图片：`<img>` 的 onLoad / onError 不是 Promise 回调，硬塞进 `logAction` 不自然 → 挂载时一次 `pushLog`（开始），onLoad / onError 各一次 `pushLog`（成功 / 失败）。这是 `logs.ts:24` 注释里默许的 “这次日志跟任何异步调用无关时” 的特例。
- Excel：fetch + XLSX.read 是一组连续异步动作 → `logAction('file', 'preview-xlsx', async () => { fetch + parse })` 直接覆盖。

### D12：iframe sandbox 跨源加载是否安全

确认：网页在 `127.0.0.1:8788`，raw URL 在 `127.0.0.1:8787`，iframe 加载跨源资源 + `sandbox=""`：**iframe 的执行上下文是 unique opaque origin**，无法访问父页 / 后端会话，SVG 内联脚本不执行。这是 “双层隔离”，比同源 + sanitize 严。

## 依赖与约束

### 上游接口与版本

- **Fastify 5.8.5**（`packages/server/package.json:19`）：`reply.send(stream)` / `reply.send(buffer)` 原生支持流式响应，stream `'error'` 事件由 Fastify 处理。无需 `@fastify/static`。
- **@fastify/cors 11.x**（`index.ts:83`）：origin 已配 `127.0.0.1:8788` / `localhost:8788`，可被 `AIMON_WEB_ORIGIN` 覆盖。raw 路由 `GET` 落在配置里的 `methods` 内，无需另配。
- **better-sqlite3 / db.ts**：`getProject(id)` 返回 `{ id, path } | undefined`，复用即可。
- **safeResolve**：`git-service.ts:194`，对 `..` / 绝对路径越界都抛 `GitServiceError("path_outside_project", ..., 400)`。raw 路由 catch 它转 4xx。

### 前端

- **CORS for fetch**：ExcelPreview 用 `fetch(rawUrl)` 是 cross-origin GET（dev 环境 8788 → 8787）。CORS 已允许 → ✓。
- **`<img>` cross-origin**：不需要 CORS（浏览器对 `<img>` 默认 anonymous 加载，不读 Allow-Origin 头）。
- **xlsx 包体积**：~600 KB；动态 import 后 Vite 会单独 chunk。`pnpm --filter @aimon/web build` 后 dist 应能看到一个独立 `xlsx-*.js`。
- **BASE**：`api.ts:36-41` 已经从 `VITE_AIMON_BACKEND` 读，stable / 开发 双实例都有正确值。`projectRawUrl` 必须用 `BASE` 拼，不能写相对路径（不然 dev 环境会打到 Vite 自己）。

### 假设（写 plan 时已显式列）

- **没有用户在乎 5 MB+ 图片** —— 50 MB 上限够用。
- **Excel 不需要保留格式（颜色 / 合并 / 图表）** —— 只读纯数据满足 “看一眼” 诉求。
- **Excel 解析在主线程跑可以接受** —— ≤ 50 MB 文件一般 < 1 秒 parse；如果未来变慢再考虑 Web Worker。
- **iframe 跨源 sandbox 在所有目标浏览器（Chrome/Edge/Firefox 现代版本）都生效** —— 这是 HTML5 标准能力，无需 polyfill。

### 不会动的边界

- 不动 `readFileAtRef` 的 1 MB 上限。
- 不动 `/file` 的协议形状（`FileContent`）。
- 不动 `EditorArea` 与 `openFile` store action。
- 不动 ChangesList / FilesView / DocsView 入口（用户怎么打开文件不改，文件落到 FilePreview 后才决定怎么渲染）。
- 不在 raw 路由上做缓存策略调优 —— 第一版 `Cache-Control: no-cache`，看实际行为再说。
- 不在 raw 路由上做 ref 支持。
