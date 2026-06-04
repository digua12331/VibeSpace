# 图片与 Excel 页签预览 · Plan

## 目标

让用户在文件页签里直接看到图片与 Excel 数据表，而不是被现有的 “二进制文件，不显示内容。” 拦下。

**架构选择**：新增一条 raw 流式路由（不走现有 `/file` 的 base64+JSON+1 MB 截断那条路），由浏览器直接 GET 字节。`/file` 老路保留给源码 / diff，不动。

**可验证的验收（必须在浏览器里看到）**：

1. 在「源代码更改」/资源管理器里点开一张 PNG / JPG / GIF / WebP（≤ 50 MB），文件页签里出现 **Preview** 标签，默认进入 Preview，能直接看到这张图，并保持 Source 标签可切回查看 base64（沿用 `/file` 那条路，1 MB 上限照旧，仅供查看 base64 文本）。
2. 点开 SVG，Preview 渲染矢量图（不再走 `CodeView` 当文本看），且嵌入的 `<script>`/外链不会执行（用 `<iframe sandbox>` 加载 raw URL 兜底）。
3. 点开一个 `.xlsx` 文件（≤ 50 MB，含多个 sheet），Preview 出现表格视图：
   - 顶部可切换 sheet
   - 表格保留行号 / 列名（A / B / C …）
   - 单元格内容能选中复制
4. **超过 50 MB 的文件**：raw 路由返回 413 `too_large`，前端显示 “文件过大（X MB），无法预览”；不试图渲染半截内容。
5. **历史 commit 上的图片/Excel**：本轮**不支持**，Preview tab 直接显示 “历史版本暂不支持预览”，仍可在 Source / Diff 看 base64 / 二进制差异（现状）。
6. LogsView 里能看到本轮新增埋点的 **起止配对**：
   - `scope=file action=preview-image` 起止
   - `scope=file action=preview-xlsx` 起止
   - 至少有 **一次故意的 ERROR 触发**（例如把一个 fake `.xlsx` 文件丢进去，看到 `preview-xlsx 失败: <reason>`）

## 非目标 (Non-Goals)

- **不**做图片编辑（旋转/裁剪/缩放控件等），仅 “看” 即可。
- **不**做 Excel 写入/编辑/公式重算；只读渲染。
- **不**渲染 doc / docx / ppt / pdf / csv —— csv 走原有 Source 即可，本轮不扩。
- **不**改 `/file` 路由的 1 MB 上限，也不动它的 base64/JSON 协议（很多 diff/source 逻辑依赖它）。
- **不**支持 raw 路由读历史 ref；只读 WORKTREE。想看历史图片，本轮不解决。
- **不**做 raw 路由的 range / 流式分片优化（一次性 sendFile / readStream 流给浏览器即可，浏览器自己解码）。
- **不**做样式/合并单元格/颜色/图表的还原，只把数据读出来铺成网格。

## 实施步骤

> 步骤 1 是后端 raw 路由；2–3 前端识别 + 图片；4–5 Excel；6 埋点；7 类型检查 + 收尾。

1. **后端：新增 raw 流式路由**
   - 新文件 `packages/server/src/routes/raw-file.ts`，注册 `GET /api/projects/:id/raw?path=...`：
     - 复用 `getProject` / `safeResolve`（防 path traversal —— 沿用 `git-service.ts` 已有的实现）
     - `statSync` 检查存在 + 是普通文件 + `size <= 50 MB`，否则 404 / 400 / 413
     - 用扩展名查 MIME（图片 / Excel / 兜底 `application/octet-stream`），通过 `Content-Type` 头返回
     - 用 `reply.send(createReadStream(abs))` 让 Fastify 流式发出，不读进内存
     - 加 `Cache-Control: no-cache`（文件可能被 IDE 改写，不要缓存到看错版本）；不打 `serverLog`（每张图都打太吵，HTTP 访问日志已经覆盖）
   - 在 `server.ts` / 路由注册入口里挂上去。
   - **如何验证**：
     - `curl -I http://localhost:<port>/api/projects/<id>/raw?path=README.md` 返回 200 + 正确 Content-Type
     - 浏览器直接访问该 URL 能下载 / 显示文件
     - 故意传 `path=../../etc/passwd` 返回 4xx（safeResolve 拦截）
     - 传不存在的路径返回 404

2. **前端：API 帮助函数 + 扩展可预览类型**
   - `api.ts` 加 `projectRawUrl(projectId, path)` —— 拼出绝对 URL（基础 URL 沿用现有 `request` 用的 backend host），方便 `<img src>` / `fetch` 复用。
   - `FilePreview.tsx` 加 `isImagePath` / `isExcelPath`，纳入 `canPreview` 计算；`defaultTab` 在图片/Excel 时也取 `'preview'`。
   - 当 `ref` 不是 WORKTREE（or 显式传了 from/to）时，**不**把图片/Excel 当成 canPreview —— 历史版本本轮不支持，回退到现有 Source/Diff 行为。
   - **如何验证**：点开 png 后页签默认在 Preview；切到一个历史 commit 上的同一张 png，Preview 不出现或被禁用。

3. **前端：图片预览组件**
   - 新文件 `packages/web/src/components/ImagePreview.tsx`：
     - 输入 `{ projectId: string; path: string }`
     - 普通位图：`<img src={projectRawUrl(...)}>`，撑满容器、保持比例、支持滚动；`onError` → 显示错误占位
     - SVG：`<iframe srcDoc={undefined} src={projectRawUrl(...)} sandbox="" />`（不开任何 sandbox 权限），既阻止脚本，又能让浏览器按 svg 渲染
     - 顶部一行 footer 显示 `path · size`（size 从 `<img>.naturalWidth/Height` 或单独 HEAD 拿；本轮取简：HEAD 一次取 Content-Length 显示字节数）—— 如果 HEAD 实现起来啰嗦就只显示 path
   - 在 `FilePreview` body 里 `tab === 'preview' && isImage` 分支接 `<ImagePreview>`；**不再依赖 `file` 状态**（不去 fetch /file），避免无谓的 1 MB base64 拉取。
   - **如何验证**：浏览器看见图、SVG 不执行外部资源、Network 里只有一次 raw 请求（没有 /file 的 JSON 请求）。

4. **前端：装 xlsx 解析器（动态加载）**
   - `pnpm --filter @aimon/web add xlsx`（SheetJS community 版）
   - ExcelPreview 内 **动态 import**（`await import('xlsx')`），避免把 ~600 KB 包塞进首屏 bundle。
   - **如何验证**：`pnpm --filter @aimon/web build` 通过；初次打开 xlsx 时 Network 里多一个 chunk。

5. **前端：Excel 预览组件**
   - 新文件 `packages/web/src/components/ExcelPreview.tsx`：
     - 输入 `{ projectId: string; path: string }`
     - 挂载时 `fetch(projectRawUrl(...))` → `r.arrayBuffer()` → `XLSX.read(buf, { type: 'array' })`
     - 列出所有 sheet → 顶部 sheet 切换条；当前 sheet 用 `sheet_to_json({ header: 1 })` 拿二维数组直接铺成 `<table>`
     - 限制最多渲染 1000 行 / 50 列，超出显示 “共 N 行 / M 列，已截断到前 1000 × 50”
     - 错误捕获：`try { ... } catch(e)` → 显示错误，并触发 ERROR 日志
     - HTTP 413 / 404 等错误：识别状态码，给出对应文案
   - **如何验证**：含 2+ sheet 的 xlsx 切换正常；改后缀的 png 触发友好错误；超 50 MB 的伪造 xlsx 显示 “文件过大”。

6. **埋点（操作日志，硬性规则）**
   - `ImagePreview`：在 `<img>` 的 `onLoad` / `onError` 与挂载时机做配对 —— 挂载时 `pushLog({ level:'info', ..., msg:'preview-image 开始' })`，`onLoad` → 成功，`onError` → 失败（含 status code 之类）。`logAction` 不太适合（image load 不是 promise），**直接两次 `pushLog`** 是合理用法。
   - `ExcelPreview`：用 `logAction('file', 'preview-xlsx', async () => { fetch + XLSX.read }, { projectId, meta: { path, sheets, rows } })` 包整个解析过程（fetch + parse 是一组连续异步动作，适合 logAction）。
   - **如何验证**：浏览器 LogsView 看到 `scope=file action=preview-image` / `preview-xlsx` 的起止配对；故意触发一次损坏的 xlsx，看到 ERROR 行。

7. **类型检查 + 收尾**
   - 后端：`pnpm --filter @aimon/server build` 通过（TypeScript 严格类型）
   - 前端：`pnpm --filter @aimon/web build` 通过
   - 检查没有 `console.log` 残留、没有未用的 import、没有顺手改无关的文件
   - smoke 一下：`pnpm smoke:server` 不要因新路由挂掉

## 边界情况

- **路径穿越**：raw 路由必须用 `safeResolve`（与 `/file` 同款），传 `..` 越出项目根直接 4xx。
- **特殊文件**：socket / fifo / 设备文件 → `statSync` 后 `isFile()` 检查，非普通文件 400。
- **大于 50 MB**：raw 返回 413，前端识别 status 显示 “文件过大（X MB）” 占位，不渲染半截。
- **图片格式但内容损坏**：`<img onError>` → 显示 “图片解码失败”，仍可去 Source tab 看 base64。
- **SVG 含 `<script>` / 外链**：`<iframe sandbox="">` 浏览器自动屏蔽。
- **xlsx 文件实际是 zip 但不是 Excel**：`XLSX.read` 抛错 → catch → ERROR 日志 + 友好提示 “文件不是有效的 Excel”。
- **空 sheet**：sheet 存在但全空，渲染 “该 sheet 无数据”。
- **超大 sheet**（10 万行）：硬截断到 1000 × 50，显示总行列数（不影响 50 MB 文件本身能读，只是渲染裁剪）。
- **`.xls`（旧 BIFF）**：SheetJS 支持，扩展名识别多加一个分支即可。
- **历史版本（ref ≠ WORKTREE）**：本轮不支持。Preview tab 在这种情况下不出现，回退到现有 Source/Diff。
- **Diff tab 在图片/Excel 上的行为**：保持现状（`isBinary` 走 “二进制文件无法显示差异”），不在本轮改。
- **同一文件被 Excel 写入半途读到**：极罕见，读到的 zip 损坏 → catch → 错误提示。不做并发协调。

## 风险与注意

- **xlsx 包体积**：~600 KB minified。**通过动态 import 隔离**到 ExcelPreview 第一次挂载时再加载，不影响首屏；如果用户从不打开 Excel，这块代码永不下载。
- **SVG 沙箱**：`<iframe sandbox="">` 是浏览器原生隔离，但 SVG 里的相对路径资源（`<image href="./foo.png">`）无法解析（iframe src 已切换 origin 上下文）。绝大多数 SVG 是自包含的，可接受。
- **raw 路由不打 LogBus**：每访问一张图都打日志会噪声化 LogsView。HTTP 层（Fastify access log）已经覆盖访问记录，需要排查时去那里看。
- **CORS / 同源**：raw URL 与 `/api/projects/:id/file` 同源（同一 Fastify 实例），不需要额外 CORS。`<iframe sandbox="">` 即使在 sandbox 模式下加载同源资源也 OK（sandbox 屏蔽脚本但不屏蔽资源加载）。
- **缓存策略**：raw 路由发 `Cache-Control: no-cache`，浏览器仍会用 304 协商；不够就在前端 URL 上拼一个 `?v=<mtime>` query。第一版直接 no-cache + 不带 query，看实际行为再决定要不要加（**假设**：用户改图后 F5 刷新页签即可，不需要前端自动追踪 mtime）。
- **关键文件预估**：
  - 后端：`packages/server/src/routes/raw-file.ts`（新增）、`packages/server/src/server.ts`（注册路由）
  - 前端：`packages/web/src/components/FilePreview.tsx`（修改）、`packages/web/src/components/ImagePreview.tsx`（新增）、`packages/web/src/components/ExcelPreview.tsx`（新增）、`packages/web/src/api.ts`（加 `projectRawUrl`）、`packages/web/package.json`（加 `xlsx`）
- **假设：本仓库 Fastify 版本支持 `reply.send(stream)` 自动流式**（Fastify 4+ 默认支持）。Context 阶段确认一下版本；如果不支持，改用 `@fastify/static` 或手动 `reply.raw.write` + pipe。
- **假设：用户不需要保留 Excel 的格式（颜色 / 合并单元格 / 图表）**。只读纯数据足够覆盖 “看一眼内容” 的诉求。
