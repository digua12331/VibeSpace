# 图片粘贴 · 计划

## 目标

让浏览器端 xterm 终端在 **Claude Code / Codex / 其他 AI agent session** 里支持 **Ctrl+V 粘贴图片**。原生 Claude Code 在本地终端已有此功能；我们这个**浏览器 + PTY 远程**场景下它失效（参考 [Claude Code issue #42712](https://github.com/anthropics/claude-code/issues/42712) 和社区方案 [cc-clip](https://github.com/ShunmeiCho/cc-clip) / [clipssh](https://samuellawrentz.com/blog/clipssh/)），这个任务要补上这个洞。

### 验收标准

用能观察的行为表达：

1. **场景 1（PNG 截图）**：在 Windows 截图工具截一张图 → 回到浏览器 xterm（已有 Claude session 在跑） → 按 Ctrl+V → 终端里出现 `@.vibespace/pasted-images/<ts>-<rand>.png ` 字样（末尾带空格、光标停在那），**不自动回车**；项目目录下对应 `.png` 文件实际生成；用户接着打"请描述这张图"再回车，Claude 回应能看到图片内容。
2. **场景 2（纯文本粘贴不变）**：复制一段代码 → 粘贴 → 仍走原 `term.paste(text)`，跟现在一模一样，不会误触上传。
3. **场景 3（shell session）**：在 `pwsh`/`cmd`/`shell` session 里粘贴图片 → 上传成功 → 终端里出现 `"<path>" `（带引号带尾空格），**不走 `@` 语法**。
4. **场景 4（超限拒绝）**：粘贴一张 > 5 MB 的图 → 弹出 `alertDialog` 提示"图片超过 5 MB 上限"，终端里不出现任何路径。
5. **场景 5（MIME 校验）**：把 SVG 或 PDF 塞进剪贴板 → 前端能检测到不是白名单 MIME → 不上传不插入，降级到文本粘贴或空操作（参考"边界情况"）。
6. **首次粘贴自动补 `.gitignore`**：项目 `.gitignore` 如无 `.vibespace/` 行，server 在写图成功后顺手追加；再粘不重复追加。
7. **类型检查 + vite build 均通过**。

## 非目标（v1 不做）

- **自动清理旧图**：不做 TTL 清理、不做 LRU；磁盘占用靠用户手动清（`.vibespace/pasted-images/` 直接删就行）或以后补
- **OSC 5522 协议支持**：等 Claude Code 原生支持再说
- **Anthropic Files API / `file_id` 路线**：当前 HTTP multipart + 本地磁盘更简单，不引 beta SDK
- **多图粘贴**：`ClipboardItem[]` v1 只取第一张；剩下的忽略
- **终端内图片缩略图预览**：不在 xterm 里渲染图片，只插入路径文本
- **拖拽上传**：是另一套 `onDragOver/onDrop` 逻辑，不在本任务里
- **非 AI / 非 shell agent 的特化处理**：`gemini` / `opencode` / `qoder` / `kilo` 按 AI 一档走 `@<path>`

## 实施步骤

### 服务端

1. **装依赖 `@fastify/multipart`** → verify: `pnpm add -F @aimon/server @fastify/multipart` 完成，`server/package.json` 可见新增行
2. **在 `server/src/index.ts` 注册 multipart plugin** → verify: `import fastifyMultipart from '@fastify/multipart'` + `await app.register(fastifyMultipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } })`；`tsc --noEmit` 通过
3. **新建 `server/src/routes/paste-image.ts`** 实现 `POST /api/projects/:id/paste-image` → verify: curl 一个 PNG 上传，返回 `{ relPath, absPath, bytes, mime }`，磁盘文件存在且大小一致
   - MIME 白名单：`image/png` / `image/jpeg` / `image/gif` / `image/webp`（SVG 不列入）
   - 存储路径：`<project>/.vibespace/pasted-images/<YYYY-MM-DDTHH-MM-SS-mmm>-<6位随机>.<ext>`（`<ISO>` 冒号替换成 `-`）
   - 写完后检查 `.gitignore`，若无 `.vibespace/` 行则追加（复用 `fs-ops.ts` 里 `appendGitignoreEntry` 的模式 —— 或直接 import 重用）
4. **`index.ts` 注册路由** → verify: `await registerPasteImageRoutes(app)` 加入 `index.ts` 的注册序列；`tsc --noEmit` 通过

### 前端

5. **`web/src/api.ts` 加 `uploadPastedImage(projectId, sessionId, blob, mime)`** → verify: 函数签名返回 `Promise<{ relPath: string; ... }>`；`tsc --noEmit` 通过
6. **改 `SessionView.tsx` 的 Ctrl+V 拦截器** → verify: 代码里 paste 分支先 `navigator.clipboard.read()`，遍历 types 找 `image/*`，命中则上传 + 注入；未命中则回退到原 `readText` + `term.paste`
   - 上传前本地检查 `blob.size > 5*1024*1024` → `alertDialog`、return
   - 上传成功 → `aimonWS.sendInput(session.id, formatForAgent(agent, relPath))`
   - 复用 `fileContextMenu.ts` 里已有的 `formatForSession(agent, path, 'file')` 函数（AI → `@path ` / shell → `"path" `）—— 可能需要 `export` 出来或在新模块里复制一行（外科式，不强行复用）
   - 失败（权限 / 网络 / 服务端拒绝）→ `alertDialog(danger)`，不写入任何内容，不 fall through 到文本
7. **类型检查 + 构建** → verify: `tsc --noEmit` 服务端前端都过，`vite build` 过

## 边界情况

- **剪贴板里同时有图和文本**：优先图，忽略文本（用户意图是粘图）
- **剪贴板里是 URL**（比如从网页复制图片，剪贴板里是 `https://...`）：`clipboard.read()` 拿不到 blob，退化成"粘贴链接文本"。可接受
- **非 secure context**（`http://` 非 localhost）：`navigator.clipboard.read()` 会拒绝。本项目绑 `127.0.0.1:8788`，满足 secure context 豁免。不是问题
- **浏览器拒绝剪贴板权限**：降级到文本粘贴（原 catch 分支），无额外提示
- **上传过程中 session 被关掉**：上传仍完成（server 落盘 ok），但 `sendInput` 时 PTY 已死 —— `sendInput` 内部走 WS，若 session 已从内存移除，server 端会记 "no live session" 错误；前端不显式处理（同现有 `sendInput` 路径一样吞掉）
- **同一毫秒连续两次粘贴同一张图**：文件名 `<ISO 毫秒>-<6 位随机>` 碰撞概率极小；即便真撞了 `writeFile` 会覆盖，结果仍可用
- **剪贴板是 SVG / PDF / 其他非白名单 MIME**：前端过滤白名单后不命中 → 回退到 `readText`（可能是空）→ 相当于无操作
- **Windows Snipping Tool 的裁剪图**：实测剪贴板里 MIME 是 `image/png`，命中白名单 OK
- **5 MB 边界**：前端先查 `blob.size`（快失败，省一次上传）；server 端 `@fastify/multipart` 的 `limits.fileSize` 是第二道防线
- **图片在 cwd 外**：不会发生 —— 所有图都落在 `<project>/.vibespace/pasted-images/` 之下，Claude Code 以项目根为 cwd，`@<rel>` 路径解析安全

## 风险与注意

- **5 MB 上限**：对应 Claude Vision API 单图上限。超了上传就算成功 Claude 也会拒，没必要放宽
- **`.gitignore` 自动追加**：写 `.vibespace/` 一行。如果用户项目已有 `.gitignore` 格式严格（比如某些 monorepo 工具），追加会改动它。预期影响可控 —— 就加一行，有明确分隔
- **`@fastify/multipart` 的 streaming vs buffering**：v1 用 `file.toBuffer()` 同步拿全量 —— 5 MB 以下内存占用可接受；不引 streaming（会让代码复杂）
- **路径注入的 escape**：路径里如果有空格 / 特殊字符，AI 的 `@path` 语法应该能吃（Claude Code 遇空格会按文件名语义处理），shell 的 `"path"` 双引号足够；但文件名由我们生成（只用 `A-Za-z0-9-.`），无特殊字符风险
- **假设** 1：Claude Code 当前版本接受 `@<相对路径>` 能正确读图。已由调研源 [MCPcat 指南](https://mcpcat.io/guides/reference-other-files/) 佐证
- **假设** 2：`navigator.clipboard.read()` 在 Chromium + Firefox 127.0.0.1 下工作。Chromium 确认支持；Firefox 近版本支持（需要用户交互触发，Ctrl+V 算交互）
- **依赖面**：新增 `@fastify/multipart`，无原生依赖、无 transitive 破坏风险
- **与其他模块的耦合**：只碰 `SessionView.tsx` 的 Ctrl+V 分支、新增 1 个 route、1 个 api 客户端函数。不改 pty-manager / ws-hub / 其他 session 相关代码

---

**plan 已按新 CLAUDE.md 结构补齐 5 段。用户在对话中已口头确认核心决策，此文件为"定稿"**。下一步：写 context.md。
