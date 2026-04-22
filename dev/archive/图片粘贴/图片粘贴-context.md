# 图片粘贴 · 上下文

## 关键文件（执行阶段只动这些）

### 新建

- **`packages/server/src/routes/paste-image.ts`**
  路由模块。一个端点 `POST /api/projects/:id/paste-image`，multipart 上传单张图，返回落盘后的项目相对路径。内部复用 `git-service.safeResolve` 做路径安全，复用 `fs-ops.ts` 的 `appendGitignoreEntry` 写 `.gitignore`（或直接 copy 该函数 —— 见"决策记录 #3"）。

### 修改

- **[`packages/server/src/index.ts`](packages/server/src/index.ts#L126-L132)**
  - 加 `import fastifyMultipart from '@fastify/multipart'`
  - 在 `await registerFsOpsRoutes(app)` 之后注册：
    ```ts
    await app.register(fastifyMultipart, {
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    })
    await registerPasteImageRoutes(app)
    ```

- **[`packages/server/package.json`](packages/server/package.json#L13-L22)** — 新增 `@fastify/multipart` 依赖（当前 Fastify 是 ^5.8.5，要选兼容版本 `^9.x`）

- **[`packages/web/src/api.ts`](packages/web/src/api.ts)** — 在文件末尾（FS operations 段之后）追加：
  ```ts
  export function uploadPastedImage(
    projectId: string,
    sessionId: string,
    blob: Blob,
    mime: string,
  ): Promise<{ relPath: string; absPath: string; bytes: number; mime: string }>
  ```
  内部走 `FormData` + `fetch`，**不用已有的 `request<T>()` helper**（它写死了 JSON content-type；multipart 需要让浏览器自动加 boundary）。

- **[`packages/web/src/components/terminal/SessionView.tsx`](packages/web/src/components/terminal/SessionView.tsx#L86-L110)** — Ctrl+V 分支扩展：
  - 现逻辑：`navigator.clipboard.readText().then(text => term.paste(text))`
  - 改后：先 `navigator.clipboard.read()` → 遍历 `ClipboardItem.types` → 命中白名单 MIME 则 `item.getType(mime)` 拿 blob → 前端 5MB 校验 → `uploadPastedImage` → `aimonWS.sendInput(id, formatForSession(agent, relPath, 'file'))`
  - 未命中图片 → 回退到 `navigator.clipboard.readText().then(term.paste)`（现有行为）
  - 读 clipboard 失败（权限） → 沿用现有 `catch(() => {})` 静默

- **[`packages/web/src/components/fileContextMenu.ts`](packages/web/src/components/fileContextMenu.ts#L28-L36)** — 把 `formatForSession` 从 module-internal 改为 `export`。没有逻辑改动。

### 已有可复用（不动，只引用）

- **[`packages/server/src/git-service.ts`](packages/server/src/git-service.ts#L194-L207)** — `safeResolve`（已 export）
- **[`packages/server/src/routes/fs-ops.ts`](packages/server/src/routes/fs-ops.ts)** 里的 `appendGitignoreEntry` 逻辑 —— 看是否直接 export 共享，见"决策记录 #3"
- **[`packages/web/src/ws.ts`](packages/web/src/ws.ts#L108-L110)** — `aimonWS.sendInput(sessionId, data)`，PTY stdin 薄封装
- **[`packages/web/src/components/dialog/DialogHost.tsx`](packages/web/src/components/dialog/DialogHost.tsx)** — `alertDialog({ variant: 'danger' })`

## 决策记录

每个决策后面答一句"资深工程师会不会觉得过度设计"—— 会的就砍。

1. **`@fastify/multipart` 而不是手动 multipart 解析** —— 合理。Fastify 官方插件 30 行接入，手动解析边界是重新造轮子。**不过度设计**。

2. **multipart 用 buffered（`file.toBuffer()`）而不是 streaming pipe 到磁盘** —— 合理。5 MB 上限 × 单文件，内存占用可控；streaming 要多维护"中途失败删半截文件"的清理逻辑。**不过度设计**。

3. **`appendGitignoreEntry`：导出共享 vs 各自复制** —— 选 **导出共享**。`fs-ops.ts` 已经实现了带去重的追加逻辑，paste-image 里再写一遍就是双份真源。把 `appendGitignoreEntry` 从 `fs-ops.ts` 提升成 export，新模块 import 复用，6 行改动值得做。**不过度设计**。

4. **文件名格式 `<ISO 毫秒>-<6 位随机>.<ext>`** —— 合理。去掉了 ISO 里的冒号（Windows 文件名非法），加随机后缀防同毫秒粘两张撞名。不用 UUID 是因为 ISO 时间戳对人眼可读，排查问题方便。**不过度设计**。

5. **前端不做 MIME 校验仅做 size 校验？还是两项都做？** —— **两项都做前端一次，server 再复查**。前端 MIME 白名单是为了"同时有图又有不支持的 MIME 时"快速跳过不上传，不是安全边界；server 端白名单才是真验证。**不过度设计**（前端这步是 UX 优化，不是防御）。

6. **返回 `relPath` 还是 `absPath`？** —— 返回**两个都带**。前端用 `relPath` 注入到 PTY；`absPath` 留给调试/日志，也便于以后做"打开文件夹"功能（不在本任务）。**略有未来味，但成本 1 行，留着不亏**。

7. **`formatForSession` 改 export vs 在 SessionView 里本地复制** —— 选 **改 export**。函数 6 行逻辑，两处复制等于要同步维护 AI/shell 格式判断，高度易错。**不过度设计**。

8. **5 MB 上限的来源** —— 跟 Claude Vision API 单图上限对齐（[调研源](https://platform.claude.com/docs/en/build-with-claude/vision.md)）。不是我们随意挑的数。

9. **`.vibespace/` 目录名和之前 server 路由用的前缀一致** —— 保持一致（过去 `.vibespace/pasted-images/` 是 plan 里就定的）。其他特性以后要落盘的话也用这个根目录。

## 依赖与约束

- **新增 npm 依赖**：`@fastify/multipart` —— Fastify 官方，无原生依赖、MIT License
- **与 Fastify 5.x 兼容**：`@fastify/multipart` 的 `^9.x` 是给 Fastify 5 的（调研调整后确定）；安装时 pnpm 会自动选对的 semver range
- **现有 Fastify 生态**：`@fastify/cors` / `@fastify/static` / `@fastify/websocket` 都是 v11 系列对 Fastify 5。multipart 只需跟 core 版本一致
- **浏览器约束**：`navigator.clipboard.read()` 需要 secure context。`http://127.0.0.1:8788` 满足（localhost 是 secure context 豁免）
- **xterm 现有 Ctrl+V 拦截器** 是 paste 分支的唯一入口；不需要额外加 `paste` 事件监听器
- **不影响其他现有功能**：
  - 不改 PTY 协议、不改 WS 协议
  - 不改 git-service（只引用已 export 的函数）
  - 不改 store
  - 不动 DialogHost / ContextMenu（只调用）
- **回滚成本**：低 —— 删一个路由、撤两处 import、Ctrl+V 分支恢复原样

## 非目标（复述）

已在 plan.md 写清。这里只列出来做 context 边界的 "此次不碰" 清单 —— 执行时对照：

- 自动清理旧图
- OSC 5522 / Anthropic Files API
- 多图粘贴（只第一张）
- 终端内缩略图预览
- 拖拽上传
- 非 AI agent 的特殊格式化（全当 AI 按 `@path` 走，shell 走 `"path"`）

---

确认（回一句）就进 Tasks 阶段开写。
