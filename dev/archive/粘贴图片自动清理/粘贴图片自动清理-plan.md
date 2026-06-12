# 粘贴图片自动清理 · Plan

## 大哥摘要

把你粘贴到对话里那些图片（存在每个项目根的 `.vibespace/pasted-images/` 这个隐藏文件夹里）做个**自动到期清理**——每次启动 VibeSpace 时，后端跑一遍，把超过"保留天数"的图片删掉，避免越攒越多。

同时在窗口右下角的状态栏（footer，目前有"重置布局""通知"那一排小按钮）旁边加一个**齿轮图标 ⚙ 设置**，点开是一个小弹窗，里面第一项就是"粘贴图片保留天数"，可以改成 1 / 3 / 7 / 30 天或者关掉（永不清理）。

默认值定为 **1 天**（贴你原话——"清理上一天的图片"）。

需要担心动到你现有什么数据吗？**不会**：清理只看 `.vibespace/pasted-images/` 这一个目录，里面的图本来就是临时缓存（项目已经把它加进 `.gitignore`，不进版本管理）；别的代码、文档、配置文件一律不碰。即使误删了某张图，你也可以重新粘贴。

## 目标

1. VibeSpace 后端启动时，自动遍历所有项目，删除 `.vibespace/pasted-images/` 目录下超过保留天数的图片（按文件 mtime 判断）。
2. 右下角状态栏加齿轮按钮 ⚙，点开"设置"弹窗，里面有"粘贴图片保留天数"配置项（1 / 3 / 7 / 30 / 不清理）。改了立即落盘并生效（下次启动时按新天数清理；当时不立刻清，避免误删刚粘的图）。
3. 清理动作走操作日志（`scope=cleanup action=paste-images-prune` 的起止配对），LogsView 能看到"删了几张、跳过几个项目、耗时多少"。

### 可验证的验收标准

- [验收 A] 浏览器打开 VibeSpace → 状态栏右下角能看到 ⚙ 设置按钮 → 点开弹出"设置"对话框 → 里面有"粘贴图片保留天数"下拉选项 → 切到"3 天"再切回"1 天"→ 弹窗里的值在刷新后仍记得。
- [验收 B] 在 `dev/memory/` 或任意项目的 `.vibespace/pasted-images/` 手工塞一张 mtime 改成 3 天前的 png（命令：`touch -d "3 days ago" xxx.png`），重启后端 → 文件消失；mtime 改成 12 小时前的 png 重启后端 → 仍在。
- [验收 C] 浏览器 LogsView 里能看到一条 `scope=cleanup action=paste-images-prune 开始 / 成功 (Nms)` 的起止配对日志，meta 里有 `deleted: N, scannedProjects: M`。
- [验收 D] 设置项切到"不清理" → 重启后端 → mtime 3 天前的 png 仍在 → LogsView 里 prune 日志显示 `skipped: retention=off`。

## 非目标

- **不做**手动"立刻清理"按钮（怕误触）；用户想强清就把保留天数设小再重启。
- **不做**每项目独立配置（保持全局统一，避免设置面板复杂化）。
- **不做**清理其他类型缓存（worktree、output、日志等都有各自的生命周期，本任务只管粘贴图片）。
- **不做**通用"设置面板"框架——弹窗就一个对话框，里面先放这一个设置项；以后再有别的全局设置再扩。

## 实施步骤

1. **后端：保留天数配置存储**（新文件 `packages/server/src/app-settings.ts`）
   - 配置存到 `data/app-settings.json`（紧挨 `data/projects.json`）；首次读取时若文件不存在返回默认 `{ pasteImageRetentionDays: 1 }`。
   - 暴露 `getAppSettings()` / `setAppSettings(patch)` 两个同步函数，writeFile 用 atomic 写法（先写 `.tmp` 再 rename）。
   - 验证：单元测试不强求；通过实施步骤 4 的接口往返手测。

2. **后端：粘贴图片清理函数**（在 `packages/server/src/routes/paste-image.ts` 新增 `pruneOldPastedImages()` 或单独抽到 `packages/server/src/paste-image-cleaner.ts`）
   - 逻辑：读 `getAppSettings()` 的保留天数；若为 `0`（即"不清理"）就走 `serverLog skipped` 直接返回；否则 `listProjects()` 拿到所有项目，逐个项目扫 `<project>/.vibespace/pasted-images/`，删除 `mtime < now - retention*86400000` 的文件；单个项目目录不存在或扫描失败就跳过 + warn 日志，不阻塞别的项目。
   - 全程包一个 `serverLog('info','cleanup','paste-images-prune 开始')` 起 + 终（成功/失败/skipped），meta 含 `deleted, retentionDays, scannedProjects, durationMs, errors[]`。
   - 验证：在 `index.ts` 接入后看 LogsView 起止配对 + meta 数字符合预期。

3. **后端：服务器启动时调用一次清理**（改 `packages/server/src/index.ts`）
   - 在 `await app.listen(...)` 之后、`serverLog backend listening` 后面，调一次 `pruneOldPastedImages()`（不 await，fire-and-forget，避免阻塞 listen），错误用 `serverLog error` 记录。
   - 验证：`pnpm dev` 启动 server，看 LogsView 是否在启动几秒内出现起止配对日志。

4. **后端：读写设置的 REST 路由**（新文件 `packages/server/src/routes/app-settings.ts`，并在 `index.ts:148-173` 区块插入 `registerAppSettingsRoutes`）
   - `GET /api/app-settings` → `{ pasteImageRetentionDays: number }`
   - `PUT /api/app-settings` → body `{ pasteImageRetentionDays?: number }`，zod 校验整数 0–365；写盘后 `serverLog info settings update` 起止配对，返回最新整体配置。
   - 验证：`curl 127.0.0.1:8787/api/app-settings` 看返回；PUT 后再 GET 值对得上。

5. **前端：API client + types**（改 `packages/web/src/api.ts` + `packages/web/src/types.ts`）
   - `types.ts` 加 `AppSettings = { pasteImageRetentionDays: number }`
   - `api.ts` 加 `getAppSettings()` / `updateAppSettings(patch)`
   - 验证：TypeScript 编译通过。

6. **前端：设置弹窗组件**（新文件 `packages/web/src/components/SettingsDialog.tsx`）
   - 用现有 `DialogHost`（`packages/web/src/components/dialog/DialogHost.tsx`）的模式做一个 modal；标题"设置"；内容暂时一项："粘贴图片保留天数"，下拉选项 `1 / 3 / 7 / 30 天 / 不清理`（值 `1 / 3 / 7 / 30 / 0`）。
   - 打开时调 `getAppSettings()` 拉当前值；用户改完点保存 → `logAction('settings','update-paste-image-retention', async () => updateAppSettings({...}))`；保存成功 toast / 直接关闭弹窗。
   - 验证：手测打开/切换/保存/重开值持久。

7. **前端：状态栏加 ⚙ 按钮**（改 `packages/web/src/components/layout/Workbench.tsx` footer 区块）
   - 在 footer 右侧（"重置布局" 和 "通知" 那组）插入一个 ⚙ 设置按钮，title="设置"；点击 → `openSettingsDialog()`。
   - 验证：浏览器看按钮位置、点击弹窗。

8. **联调收尾 + 浏览器验收**
   - `pnpm --filter @aimon/web type-check`（如有此 script）/ `pnpm --filter @aimon/server type-check` 或 build 必须过。
   - AI 自派 `vibespace-browser-tester` 跑验收 A/C/D（B 用 bash 手测）。
   - `git diff --name-only HEAD` 比对 `write_files` 白名单，无越界。

## 边界情况

- **项目目录已被外部删除**：`listProjects()` 返回里有，但磁盘上 `<project_path>` 已不存在 → `readdir` 抛 ENOENT → 当作"跳过这个项目"warn 一句，继续。
- **保留天数 = 0**：含义是"不清理"，直接 skip，不能误解为"立刻全删"。zod 校验里 0 是合法值，业务逻辑专门 if 早退。
- **保留天数极大（如 365）**：基本等同于"不清理"，但允许；不限制上限边界以外的极端值（zod 校验里硬限 0–365）。
- **clock skew**：依赖系统时钟正常；如果用户系统时钟错乱，清理逻辑可能误删/不删，本任务不处理这种异常环境。
- **`.vibespace/pasted-images/` 里非粘贴图片产物**：极少见，但万一有人手动塞了文件——清理只看 mtime，过期就删；这是该目录的设计契约（临时缓存），不做白名单。
- **并发**：启动时跑一次 + 用户改设置后只更新数值（不主动重跑清理），不存在并发删除。
- **首次启动 `data/app-settings.json` 不存在**：返回默认值 `{ pasteImageRetentionDays: 1 }`，不主动创建文件（直到第一次 PUT 写入），避免冷启动 IO。

## 风险与注意

- 清理操作触及"用户文件系统真实删除"，必须严格限定路径前缀（只在 `<project_path>/.vibespace/pasted-images/` 内 unlink，并校验 `path.join` 后的绝对路径仍以该前缀开头）。这是本任务的**唯一高风险点**。
- 项目记忆 `auto.md` 里多条提到"操作日志必须起止配对 + 失败分支"——清理失败、设置保存失败都要 ERROR 路径日志，验收时人工触发一次（如把 `.vibespace/pasted-images` 改成只读，看是否报 ERROR）。
- `auto.md` 2026-05-02 "外部能力注入失败不阻塞主流程" → 清理函数 fire-and-forget，启动失败不让 server crash，但要 ERROR 日志。
- UI 改动按 `manual.md` 2026-05-06：交付前 AI 自派 `vibespace-browser-tester` 跑浏览器验收（A/C/D），不要丢给大哥自己测。
- 设置弹窗这次只放一项，组件命名要预留扩展（如 `SettingsDialog` 而不是 `PasteImageSettingsDialog`），以后加全局设置直接往里塞。

## 多模型 Plan 会审

> 跳过：本任务量级偏小（典型默认档底端：1 个新功能、约 7–8 个文件、无跨包契约变更），三模型协作的 marginal value 低于外部调用成本。Claude 单独写 plan，按 manual.md 2026-04-30 "外部工具失败/不适用回退 Claude 单写"惯例处理。
