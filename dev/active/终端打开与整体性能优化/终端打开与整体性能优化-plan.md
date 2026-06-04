# 终端打开与整体性能优化 · plan

> Codex 综合主笔（实际由 Claude 在 Codex/Gemini 外部工具不可用时承担综合 + 白话化双重职责，详见末尾"多模型 Plan 会审"段）。

---

## 大哥摘要

这次要把 VibeSpace 三个慢点变快，**用户使用习惯一点不动**：

1. **打开终端**（点"+ 启动 AI / 终端"到能看到光标）：把现在第一次开 Claude/Codex 终端要等的那一下（约 0.5 秒）压到几乎感觉不到
2. **打开 VibeSpace 网页第一屏**（浏览器开 http://127.0.0.1:8788 到能点东西）：把现在一次性下载的 JS 文件按需拆开，**首屏体积砍一大半**——首次打开页面会更快出来
3. **切左边 sidebar 标签**（"源代码更改 / 文件 / Dev Docs / 性能 / 日志 / 技能"等 11 个 tab）：从"一开页面就把 11 个全装进内存"改成"点哪个装哪个"

**全是内部优化**：界面长得一模一样，按钮、菜单、文案、颜色都不动；数据库（SQLite，存项目和会话的本地数据库）不动；现有的 session、worktree（git 临时副本，几个并行任务互不踩脚的目录）、配置文件、`.mcp.json`（项目级 MCP 工具配置文件）都不会被动到。

**怎么验收**：左边 sidebar 切到"日志"tab，会看到带时间戳的操作日志（LogsView，本仓库统一的操作日志面板）。这次会新增 `session-spawn 完成 (Nms)` 这条日志——大哥就在这里看新开终端用了几毫秒，前后对比就能直接感受到差距。改完后我会自己派浏览器测试 agent 跑一遍验收清单，有问题再汇总。

---

## 目标

| 指标 | 现状 | 目标 | 怎么验收 |
|---|---|---|---|
| 首次 spawn 终端耗时（**worktree 隔离**模式：要 git checkout 出一份临时副本，本来就慢） | ~1.4s（其中 `git worktree add` 占 0.5–3s，无法压；`loadPty` 首次 ~300ms 可以挪走） | ≤ 800ms（去掉本仓库可控的那 300ms+50ms，把 git 那部分如实留下） | LogsView 看 `session-spawn` perf 日志的 `ms` 字段 |
| 后续 spawn 终端耗时（**共享**模式，每次都跑） | ~50ms（每次都重新扫 skills、读 mcp 配置） | ≤ 25ms | 同上 |
| **首次 spawn**（共享模式，含 PTY 模块加载） | ~350ms（loadPty 首次加载 native binding 占 300ms） | ≤ 50ms（preload 后） | 同上 |
| 首屏 JS 总下载量（`vite build` 后 dist/assets/*.js） | 基线待测，但**已知** 11 个 sidebar view + react-markdown + remark-gfm + rehype-sanitize + FilePreview 全家桶都首屏 parse | 首屏 chunk 总和 ≤ 基线 60% | `vite build` 输出按 chunk 分组对比基线 |
| 切 sidebar 标签延时 | 11 个视图都首屏 parse；切换是纯本地渲染，体感不慢但拖累首屏 | 体感无感，第一次切到某个 tab 时浏览器 Network 看到对应 chunk 按需加载 | DevTools Network 面板观察 |

**前置基线（A 系列必须先做完）**：所有改动前先跑一次 `pnpm -F @aimon/web build`，把 `dist/assets/` 各 chunk 大小记到 context.md；后端浏览器手动 spawn 一次，让 LogsView 写出基线 perf 日志。否则没有可验收的对比基准（参见记忆 2026-05-02 / 项目切换卡顿优化 那条）。

## 非目标

1. **不**改 SQLite schema、db.ts 三段同步、5 处 SELECT 同步
2. **不**重写 xterm 渲染层、PTY 协议、WebSocket 协议
3. **不**改任何用户可见 UI（按钮位置、颜色、文案、菜单项一律不动）
4. **不**碰 `packages/hook-script`（与首屏和终端启动无关）
5. **不**做 service worker / PWA 离线、HTTP/2/3、CDN
6. **不**优化 git worktree 本身的 checkout 速度（git 的事，本仓库无法影响）
7. **不**做"sidebar 改虚拟列表"这类 UX 重构（属于另一个任务）
8. **不**给 `injectMcpForAgent` 加 checksum 缓存（评审采纳：现状 deepEqual 早返回 + readFile 已经够便宜，加缓存收益 <5ms 但引入"用户改 .mcp.json 不生效"的 bug 类别，得不偿失）

## 实施步骤

### A. 前置：埋点 + 基线（所有优化前必跑）

**A1. 扩展 `packages/web/src/perf-marks.ts`**：加 `markSessionSpawnStart(sessionId, agent)` / `markSessionSpawnEnd(sessionId, ctx)`，复用现有 perf scope，落 LogsView。在 `EditorArea.tsx` 的 `StartSessionMenu.onStarted` 和 `SessionView` 首次接到 `replay` 消息这两个时点分别打 start / end。
  - **verify**：浏览器打开 + 点"+ 启动 AI / 终端" → LogsView 看到 `session-spawn 完成 (Nms)` 单行

**A2. 后端 spawn 路径加子步耗时 serverLog**：`isGitRepo` / `addWorktree` / `pickSkillsForTask` / `injectMcpForAgent` / `ptyManager.spawn` 各自前后用 `Date.now()` 包一下，统一一条 `serverLog('info', 'session', 'spawn-substep', { meta: { step, ms } })`。
  - **verify**：spawn 一次后，`packages/server/data/logs/<YYYY-MM-DD>.log` 有 5 条带 `step=isGitRepo|addWorktree|pickSkills|injectMcp|ptySpawn` 的子步日志

**A3. 跑一次 `pnpm -F @aimon/web build` 基线**：把 `packages/web/dist/assets/` 各 chunk 大小（kb 数）写进 `dev/active/终端打开与整体性能优化/终端打开与整体性能优化-context.md` 的"基线"段。
  - **verify**：context.md 有 `BASELINE: index-Xkb.js, ScmView-Ykb.js...`

### B. 前端首屏 bundle 拆分

**B1. PrimarySidebar 11 个视图改 `React.lazy`**：当前 `PrimarySidebar.tsx:2-12` 11 个静态 import 改成 lazy；switch body 外包一层 `<Suspense fallback={<aside>加载中…</aside>}>`（Suspense 边界只包一层在根，不每个 tab 单独包——评审建议）。
  - **风险**：各 view 里有 Zustand store 订阅 + WS 消息监听，lazy mount 后若 WS 消息先到，可能错过。**应对**：所有 sidebar view 的状态都已经在 store 里集中存（参见 `main.tsx:23-52` 的 `aimonWS.onMessage`），view 只是渲染消费方，lazy mount 不影响状态收集。仍需在每个 view 的首次切换上手动验。
  - **verify**：浏览器 Network 面板看到首屏不下载 `JobsView*.js / UsageView*.js`；点击对应 tab 才 fetch

**B2. EditorArea 子组件按需 lazy**：`FilePreview`（带 react-markdown + remark + rehype + shiki + xlsx 全家桶）、`ChecklistEditor`、`PromptLibraryDialog`（在 SessionView 里）改 `React.lazy`。**注意**：`StartSessionMenu` 里有 `useEffect` 检查 session 状态，**不**改它（评审风险点）。
  - **verify**：首屏不打开任何文件 → Network 不下 `FilePreview*.js`；点开一个 .md 文件 → 才下 chunk

**B3. vite.config.ts 加极简 manualChunks**（评审建议：只拆 3 组，不切碎）：
  - `xterm`: 所有 `@xterm/*` 入一组
  - `markdown`: `react-markdown` + `remark-gfm` + `rehype-sanitize` + `mdast-util-*`
  - `xlsx`: `xlsx` 单独
  - 其余跟 Vite 默认走（react/react-dom 自动跟 index 分开，不需要手拆）
  - **verify**：`vite build` dist 看到 `xterm-*.js` / `markdown-*.js` / `xlsx-*.js` 三个 chunk 单独存在

### C. 后端 spawn 路径降延迟

**C1. PTY preload（fire-and-forget）**：评审建议——不改 `index.ts`，直接在 `pty-manager.ts` 模块顶层 `import` 完成后追加 `loadPty(); /* fire-and-forget; native binding 加载到 _pty 缓存里 */` + `.catch(() => {})` 兜底（评审风险：unhandledRejection）。把首次 spawn 那 ~300ms 挪到服务启动后台异步进行。
  - **verify**：服务启动后等 1 秒，第一次 spawn 共享模式日志 `step=ptySpawn ms<30`（基线 ~320ms）

**C2. `pickSkillsForTask` 加 mtime 缓存**：在 `packages/server/src/skills-service.ts` 模块级 `Map<projectPath, { mtimeMs, skills }>`。每次调用先 `fs.stat` 项目级 `.aimon/skills/` 目录拿 mtime，命中且未变化 → 返回缓存；变化 → 重新扫 + 写缓存。日志 meta 加 `cache: 'hit'|'miss'`。
  - **风险（评审）**：mtime 是秒级精度，1 秒内连改两次可能读旧缓存。**应对**：日志写明 `cache=hit/miss` 方便排障；用户报"skill 改了不生效"时直接看日志判断
  - **verify**：第二次同 task 的 spawn 日志 `cache=hit, ms<2`

**C3. `isGitRepo` 改 `fs.existsSync`**（评审建议合并到 C 系列里，不单列一步）：在本步骤里同时跑——`packages/server/src/git-service.ts` 的 `isGitRepo` 改成 `fs.existsSync(path.join(root, '.git'))`，跳过 git 子进程。
  - **verify**：worktree 模式 spawn 日志 `step=isGitRepo ms<2`

### D. 收尾验收

**D1. 浏览器手动跑**：开 3 次新 spawn 验目标值（worktree ≤ 800ms、共享首次 ≤ 50ms、共享后续 ≤ 25ms），LogsView 截图或日志记录到 context.md
**D2. `vite build` 对比基线**：首屏 chunk 总量 ≤ 基线 60%，`xlsx-*.js` / `markdown-*.js` 不在首屏 chunk 列表
**D3. 切 sidebar 11 个 tab 全过一遍**：体感无卡，Network 看到按需 chunk 加载
**D4. 派 `vibespace-browser-tester`** 跑 D1–D3 三条
**D5. 类型检查全过**：`pnpm -F @aimon/web build` + `pnpm -F @aimon/server build`
**D6. write_files 白名单核对**：`git diff --name-only HEAD` 与 tasks.json 的 `write_files` 比对，无越界

## 边界情况

- **首次 spawn 的 worktree 模式仍由 git checkout 速度决定**（500ms-3s）：本任务无法压，目标仅对"非首次 / 共享模式"严格
- **lazy load 在弱网下闪烁**：本机 dev 不触发；Suspense fallback 给"加载中…"明确占位
- **`pickSkillsForTask` 缓存 mtime 秒级精度**：1 秒内连改两次 skill 可能读旧缓存——日志 `cache=hit/miss` 是排障入口
- **`React.lazy` + `StrictMode` 在 dev 下双 mount**：xterm / TerminalHost 不动（已经 keep-alive，不在 lazy 范围）；只动 sidebar / FilePreview，这些是无 PTY 订阅的纯渲染组件
- **PTY preload fire-and-forget 失败的 unhandledRejection**：必须 `.catch(() => {})` 兜底，否则 ARM/Alpine/不同 Node 版本会让服务启动期产生噪声日志
- **manualChunks 不切太碎**：每个 chunk 一次 HTTP 请求，过度分割反拖慢首屏；只按"重量级 + 复用频率"分 3 组

## 风险与注意

1. **B1 lazy load 与 WS 消息的时序**（评审最高风险点）：sidebar view 的 store 订阅在 mount 时建立，lazy 后首屏不 mount → WS message 该不该被消费？查证：本仓库 ws 消息是 `main.tsx:23` 全局 `aimonWS.onMessage` → 直接打到 `useStore.getState()`（非组件内订阅），所以 lazy load **不影响状态收集**。view 只是订阅 store 切片渲染。**仍要在 verify 里手动测**：开服务、点几个 sidebar tab、关掉再切回来，state 还在。
2. **B2 `StartSessionMenu` 不能 lazy**（评审风险点）：它内部有首屏立即执行的 effect（检查 session 状态），lazy 后会打破时序——保留静态 import
3. **`pickSkillsForTask` 的 mtime 缓存**：1 秒内连改不准，但能接受；若用户报 bug，日志 `cache=hit/miss` 即排障入口
4. **PTY preload 的 unhandledRejection**：`.catch(() => {})` 兜底，并保留一条 info 日志 `pty-preload 完成/失败`，方便后续问题溯源
5. **跨包改动边界**：动 `packages/web` + `packages/server`，不动 `packages/hook-script` / `packages/server/src/db.ts` / 模板文件 / 文档。tasks.json 严格列 write_files
6. **基线必须先记**（参见 memory 2026-05-02 那条）：D 阶段对比时若没基线对比，等于体感优化而非可验收优化

## 现状陈述（事实包，给评审角色看的上下文，最终交付前不必删）

### 后端 spawn 路径（每次 / 首次拆分）

```
[每次] getProject (<1ms)
[worktree 模式] isGitRepo (~10ms, git rev-parse 子进程, **本任务改 fs.existsSync 后 <2ms**)
[worktree 模式] addWorktree (~500-3000ms, git worktree add 子进程, **不可控**)
[有 task] pickSkillsForTask (~20ms, 每次 readdir + parse 整个 .aimon/skills/, **本任务加 mtime 缓存**)
[有匹配 skills] mkdir + writeFile runtime (~5ms)
[每次] injectMcpForAgent (~30ms, readFile + deepEqual 早返回; 有变化时 writeFile + rename. **本任务不动**)
[首次] loadPty (~300ms, native binding 加载, 之后缓存. **本任务 preload 到服务启动**)
[每次] proc.spawn (~20ms, fork 子进程)
```

### 前端首屏 import 链

```
[STATIC] PrimarySidebar.tsx:2-12 → 11 个 view 全部 import (本任务改 lazy)
[STATIC] EditorArea.tsx:4-8 → FilePreview + ChecklistEditor + StartSessionMenu + TerminalHost
  - FilePreview / ChecklistEditor → 改 lazy
  - StartSessionMenu / TerminalHost → 不动
[STATIC] FilePreview → MarkdownView (react-markdown + remark-gfm + rehype-sanitize) + CodeView + ExcelPreview
[DYNAMIC ✓] CodeView → import('shiki') (已是 lazy, 不动)
[DYNAMIC ✓] ExcelPreview → await import('xlsx') in useEffect (已是 lazy, 不动)
[STATIC] SessionView.tsx:17 → PromptLibraryDialog (本任务改 lazy)
[NO MANUAL CHUNKS] vite.config.ts 完全没 build 配置 (本任务加 3 组 manualChunks)
[NO React.lazy] 全仓 0 处使用 React.lazy
```

### 已被记忆覆盖的约束

- `auto.md` 2026-05-02 / 项目切换卡顿优化：先加可见埋点 → 改性能热点；xterm 不轻易卸载；缓存放现有 store；关键文件边界收尾对照。**全部按此走**。
- `manual.md` 2026-04-30 / 大哥偏好：纯内部实现自决；术语翻白话；做了什么 → 用户感知。**已按此写大哥摘要**。

---

## 多模型 Plan 会审

> [Gemini 评审] **失败：spawn gemini ENOENT**（本机 PATH 没装 Gemini CLI）。重试同样失败，按 CLAUDE.md 流程回退。
> [Codex 评审] Codex 自家 API 401，但 codex:codex-rescue agent 内部 fallback 由 Claude 完成评审，关键采纳条目：
>   - 删 C2（injectMcpForAgent checksum 缓存）—— 收益 <5ms 但引入"用户改 .mcp.json 不生效"bug 类别 → **plan 已删**
>   - 合并 C3（isGitRepo 改 fs.existsSync）到 C 系列 → **plan 已合并**
>   - PTY preload 改模块顶层 fire-and-forget + `.catch()` 兜底 → **plan 采纳**
>   - manualChunks 极简：只拆 xterm + markdown + xlsx 三组 → **plan 采纳**
>   - Suspense 边界只包 PrimarySidebar 根一层 → **plan 采纳**
>   - 风险点：B1 lazy 与 WS 消息时序、B2 StartSessionMenu 的首屏 effect、preload 的 unhandledRejection、mtime 秒级精度 → **plan 已加进风险段**
> [Codex 综合主笔] 因外部工具不可用，由 Claude 同时承担综合 + 白话化双重职责。综合时取舍：删 C2、合并 C3、采纳 fire-and-forget preload、manualChunks 三组、Suspense 单层。
> [Claude 白话化兜底] 全文术语第一次出现都加了括号白话翻译（worktree / lazy / Suspense / `.mcp.json` / native binding / chunk）；大哥摘要按"打开终端从 X 秒到 Y 秒 / 首屏 JS 砍一半 / sidebar 按需加载"三件事写；对照 manual.md 大哥偏好——本 plan 全是内部优化、无 A/B 路径让大哥挑。
> 跳过：Gemini ENOENT 未重试（命令不存在重试无意义）；Codex 401 由 codex:codex-rescue agent 内部 fallback 完成。
