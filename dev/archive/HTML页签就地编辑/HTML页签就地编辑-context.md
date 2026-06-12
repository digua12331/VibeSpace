# HTML页签就地编辑 · context

## 关键文件（改动边界）

### 后端
- `packages/server/src/routes/fs-ops.ts` — **改**。在 `registerFsOpsRoutes()` 函数体内新增 `PUT /api/projects/:id/fs/write-file`。复用同文件现有：`loadProjectOr404`、`PathBody`/zod、`sendErr`、`HUB_PROJECT_ID` 拒绝、`serverLog` 起止。从 `git-service.js` 已 import `safeResolve` / `toRepoRelative` / `bustStatusCache`。`writeFile` 已从 `node:fs/promises` import。`existsSync` 已 import。
  - 参考行：`gitignore-add`(187-243) 与 `entry-delete`(245-310) 是最贴近的模板（守卫 + serverLog 起止 + bustStatusCache）。
- `packages/server/src/index.ts` — **不改**。`registerFsOpsRoutes` 已在 :276 挂载，新 route 写进函数体自动生效。

### 前端
- `packages/web/src/api.ts` — **改**。加 `writeProjectFile(projectId, path, content)`，仿现有 `getProjectFile`(~414)。POST/PUT 用现有 fetch 封装风格。
- `packages/web/src/components/htmlPreviewPicker.ts` — **改**。现有注入脚本（IIFE，`__aiPickerInstalled__` 守卫，mouseover/click capture，postMessage `__aiPicker__`）。新增编辑模式分支：监听父→子 message（enter-edit/exit-edit/request-save），编辑态 `document.body.contentEditable`，保存时清理自身 + 序列化 + 回传 `__aiSave__`。click capture 的 preventDefault 要受"是否编辑态"门控。
- `packages/web/src/components/HtmlPreview.tsx` — **改**。现有 props `{projectId, path, content, truncated}`。加 `editable?: boolean`。顶栏加「预览/编辑」切换 + 「保存」按钮 + 本地 `editing`/`dirty` state。保存走 `logAction('html-preview','save-file', fn, ctx)`（已 import logAction）。postMessage 给 iframe 用 `iframeRef.current?.contentWindow?.postMessage`。
- `packages/web/src/components/FilePreview.tsx` — **改**。`<HtmlPreview>`(283-291) 多传 `editable={isWorktree && !file.truncated}`。`isWorktree`(53) 已有。

## 决策记录

- **写文件路由放 fs-ops.ts 而非新建文件**：fs-ops 已是"项目级文件系统 mutation"的聚集地（open-folder/gitignore/delete/open-in-browser），写文件天然属于这里。新建 route 文件是过度拆分。
- **不放宽 sandbox（不加 allow-same-origin）**：allow-same-origin + allow-scripts 并存 = 沙箱失效，iframe 脚本可触达父窗。改为序列化发生在 iframe 内、只回传 HTML 字符串。这是安全底线，不为"父窗直接读 contentDocument 更省事"而妥协。
- **dirty 状态做局部，不动 store EditorTab**：tab 级脏标记要改 store 数据模型 + 所有渲染 tab 的地方，是只用一次的跨组件抽象，违背"不做没人要求的灵活性"。MVP 局部 state 够用；tab 上的小圆点是 nice-to-have，本轮不做。
- **保存只覆盖已存在文件、不新建**：避免就地编辑变成"任意写文件"接口扩大攻击面；新建文件不是本任务需求。
- **冲突检测不做**：MVP 最后写入者胜。做版本号/mtime 比对是为不太可能在本场景发生的并发写写防御，过度设计。已知局限，写在这。
- **序列化保真不追求**：DOM 翻 HTML 必然归一化格式。不引入 source-position 精确 patch（那是一大坨复杂度），轻量档接受格式变动 + 复杂页面警告。

## 依赖与约束

- `safeResolve(projectPath, input)`：把相对路径解析为项目内绝对路径，越界抛 `GitServiceError`（git-service.ts:246）。
- `toRepoRelative(projectPath, abs)`：返回项目内相对路径，项目根返回空 → 用来拒绝写根（git-service.ts:261）。
- `bustStatusCache(proj.path)`：写文件后让 git status 缓存失效，否则 ChangesList 不刷新。
- iframe srcDoc 模式：父子 postMessage 用 `'*'` origin（srcDoc 的 iframe 是 null origin），消息要带自定义标记（`__aiPicker__` / `__aiSave__`）并校验 `e.source === iframeWin` 防串扰。
- 前端 mutation 必须 `logAction`；后端 mutation 必须 `serverLog` 起止配对（CLAUDE.md 硬性）。
- 已知局限（写给未来）：编辑期间文件被外部改动会被覆盖（最后写入者胜）；序列化会重排格式。
