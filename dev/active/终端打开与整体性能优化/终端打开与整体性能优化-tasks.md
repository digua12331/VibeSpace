# 终端打开与整体性能优化 · 任务清单

## A. 前置：埋点 + 基线

- [x] A1. 扩展 perf-marks.ts 加 `markSessionSpawnStart` / `bindSessionSpawn` / `markSessionSpawnEnd`，在 StartSessionMenu.start() 点击时调 start + bind、SessionView 首次接到 replay 调 end → verify: LogsView 看到 `session-spawn 完成 (Nms)` 单行（待 D1 实测）
- [x] A2. routes/sessions.ts startSession 内加 5 个子步 logSpawnSubstep（isGitRepo / addWorktree / pickSkills / injectMcp / ptySpawn），meta 含 step/ms → verify: spawn 后 `packages/server/data/logs/<YYYY-MM-DD>.log` 有 step=ptySpawn / step=injectMcp 等日志（待 D 阶段实测）
- [x] A3. 跑 `pnpm -F @aimon/web build` 拿基线 chunk 大小，写到 context.md "基线数据" 段 → verify: index-CBPQK7bv.js = 1,165 kB（gzip 326 kB）已记入 context.md

## B. 前端首屏 bundle 拆分

- [x] B1. PrimarySidebar.tsx 11 个 view 改 React.lazy，根包一层 Suspense → verify: dist/assets 有 ScmView/FilesView/DocsView/.../SkillsView 11 个独立 chunk（已确认）
- [x] B2. EditorArea.tsx FilePreview / ChecklistEditor 改 lazy；SessionView.tsx PromptLibraryDialog 改 lazy → verify: dist/assets 有 FilePreview-*.js（37kb）/ ChecklistEditor-*.js（7kb）独立 chunk（已确认）
- [x] B3. vite.config.ts 加 manualChunks 三组 → verify: dist/assets 有 xterm-*.js（495kb）/ markdown-*.js（179kb）/ xlsx-*.js（424kb）三个独立 chunk（已确认）

## C. 后端 spawn 路径降延迟

- [ ] C1. pty-manager.ts 模块顶层加 `loadPty().catch(() => {})` fire-and-forget preload → verify: 服务启动后第一次 spawn 共享模式日志 `step=ptySpawn ms<30`（基线 ~320ms）
- [ ] C2. skills-service.ts 的 pickSkillsForTask 加 mtime 缓存（模块级 Map），日志 meta 含 `cache: 'hit'|'miss'` → verify: 第二次同 task 的 spawn 日志 `cache=hit, ms<2`
- [ ] C3. git-service.ts 的 isGitRepo 改 `fs.existsSync(path.join(root, '.git'))` → verify: worktree 模式 spawn 日志 `step=isGitRepo ms<2`

## D. 收尾验收

- [ ] D1. 浏览器手动开 3 次 spawn 验目标值（worktree ≤ 800ms / 共享首次 ≤ 50ms / 共享后续 ≤ 25ms），数据回填 context.md → verify: context.md "验收数据" 段有 3 行实测
- [ ] D2. `vite build` 对比基线，首屏 chunk 总和 ≤ 基线 60%，xlsx-*.js / markdown-*.js 不在首屏 → verify: context.md 有前后对比表
- [ ] D3. 切 sidebar 11 个 tab 全过一遍，体感无卡 → verify: Network 看到按需 chunk 加载
- [ ] D4. 派 `vibespace-browser-tester` 跑 D1-D3 三条 → verify: tester 返回 PASS/FAIL 报告附 plan
- [ ] D5. 类型检查全过：`pnpm -F @aimon/web build` + `pnpm -F @aimon/server build` → verify: 0 错误
- [ ] D6. write_files 白名单核对 `git diff --name-only HEAD` → verify: 只在 7 个白名单文件内（vite.config.ts / perf-marks.ts / PrimarySidebar.tsx / EditorArea.tsx / SessionView.tsx / pty-manager.ts / skills-service.ts / git-service.ts / routes/sessions.ts），任务文档目录(dev/active/终端打开与整体性能优化/) 不算越界
