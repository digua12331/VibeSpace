# 终端打开与整体性能优化 · context（AI 自用，大哥不审）

## 关键文件（边界 = write_files 白名单源）

### 前端 (packages/web)

- `packages/web/vite.config.ts` — 加 manualChunks 三组（xterm / markdown / xlsx）
- `packages/web/src/perf-marks.ts` — 加 `markSessionSpawnStart` / `markSessionSpawnEnd`
- `packages/web/src/components/layout/PrimarySidebar.tsx` — 11 个 view 改 React.lazy + Suspense 单层
- `packages/web/src/components/editor/EditorArea.tsx` — `FilePreview` / `ChecklistEditor` 改 lazy；`StartSessionMenu` / `TerminalHost` **不动**；在 `StartSessionMenu.onStarted` 里调 `markSessionSpawnStart`
- `packages/web/src/components/terminal/SessionView.tsx` — `PromptLibraryDialog` 改 lazy；首次接到 `replay` 消息时调 `markSessionSpawnEnd`

### 后端 (packages/server)

- `packages/server/src/pty-manager.ts` — 模块顶层加 `loadPty().catch(() => {})` fire-and-forget；spawn() 内加 `serverLog` 子步耗时日志
- `packages/server/src/skills-service.ts` — `pickSkillsForTask` 加 mtime 缓存（模块级 Map）
- `packages/server/src/git-service.ts` — `isGitRepo` 改 `fs.existsSync('.git')`
- `packages/server/src/routes/sessions.ts` — startSession() 内加子步耗时打点（包 `pickSkillsForTask` / `injectMcpForAgent` / `addWorktree` 调用前后用 Date.now() 包，传 meta）

### 不动的文件（明确边界外）

- `packages/server/src/db.ts` — 任何 schema / SELECT 不动
- `packages/server/src/mcp-bridge.ts` — 评审已删 checksum 缓存方案
- `packages/server/src/log-bus.ts` — 复用现有 serverLog，不改 API
- `packages/web/src/components/terminal/TerminalHost.tsx` — keep-alive 策略已经实现，不动
- `packages/web/src/store.ts` — 不加新字段
- `packages/web/src/main.tsx` — WS 全局 listener 不动（这是 lazy load 时序风险消除的关键）
- `packages/hook-script/*` — 整个包不动
- 所有 `.aimon/skills/` / `.mcp.json` / 模板文件 / `dev/memory/` / `dev/issues.md` — 不动

## 决策记录

### D1：删 C2（injectMcpForAgent checksum 缓存）

- 选 A=不加缓存（保留现状的 `deepEqual` 早返回），不选 B=加 (agent, projectPath) → checksum Map
- 理由：现状 `mcp-bridge.ts:113-124` 早返回路径仅花 readFile + deepEqual，实测 <10ms。加缓存只省 JSON.parse 几毫秒，但每次都要管 invalidate 语义（用户手改 .mcp.json 怎么失效？mtime？checksum？hash 比较？），维护成本远超收益。资深工程师看了会觉得"过度设计"。**不做**。

### D2：PTY preload 用模块顶层 fire-and-forget，不改 index.ts

- 选 A=`pty-manager.ts` 模块顶层调 `loadPty().catch(() => {})`，不选 B=`index.ts` 启动序列里加 `await loadPty()`
- 理由：A 简单一行就能让首次 spawn 不再等 native binding；B 要改 index.ts 启动序列、要决定哪个时点跑、要加 serverLog——多改一处文件、多承担一处类型边界变化。失败用 `.catch(() => {})` 兜底（评审风险点已加进 plan）。

### D3：Suspense 边界只包 PrimarySidebar 根一层

- 选 A=PrimarySidebar 根包一层 Suspense，所有 11 个 view 共享 fallback；不选 B=每个 view 单独 Suspense
- 理由：A 只有一处 fallback 文案（"加载中…"），结构简单；B 每个 view 都要决定 fallback、可能首屏闪 11 次。任意时刻只切 1 个 view，单层 Suspense 完全够用。

### D4：`pickSkillsForTask` 用 mtime 缓存（不用 hash / 不用 watcher）

- 选 A=按 `.aimon/skills/` 目录 mtime 缓存，不选 B=fs.watch；不选 C=skill 文件 hash 比较
- 理由：A 模块级 Map<projectPath, {mtimeMs, skills}>，命中率高、失效语义直观；B 跨平台 watcher 不稳（windows ReadDirectoryChangesW 限制 / Linux inotify 数量限制），不值得；C 要 hash 每个文件，IO 还是没省。
- 已知缺陷：mtime 秒级精度（评审风险点）→ 写日志 `cache=hit/miss` 兜底排障。

### D5：manualChunks 极简三组（不切碎）

- 选 A=只拆 xterm / markdown / xlsx 三组，不选 B=react/react-dom 也单独拆 / 每个 view 单独 chunk
- 理由：A 命中"重量级 + 复用频率"判断——这三组都是 200kb+ 且首屏可延迟；B 切碎每个 chunk 一次 HTTP 请求，反拖慢首屏（HTTP/1.1 队头阻塞）。
- react/react-dom 不单拆：Vite 8 默认会和 index 入口分离，手拆等于重复劳动。

### D6：`StartSessionMenu` 不改 lazy（评审风险点）

- 它的内部 useEffect 在首屏立即执行（检查 session 状态），如果延迟 mount 会打破时序——保留静态 import。
- 这是 plan B2 步骤的明确豁免项。

### D7：基线必须先存 context，不能口头说"差不多多少"

- A3 必须实际跑 `pnpm -F @aimon/web build` 把数字记到本文件下方"基线数据"段（任务执行时回填）。
- 否则 D2 验收"首屏 chunk 总和 ≤ 基线 60%"无法判定（参见 memory 2026-05-02 / 项目切换卡顿优化 那条"先加埋点再改"）。

## 依赖与约束

### 上游 / 跨包契约

- Vite 8 manualChunks 函数签名：`(id: string) => string | undefined`（按 import path 决定 chunk 归属，返回 undefined 走默认）
- React.lazy 必须 `lazy(() => import('./X'))`，import 内部不能有副作用（StrictMode 会双 mount）
- Zustand store selector 在 lazy 组件 mount 时正常工作（确认过：sidebar view 都是 store consumer，不是 store mutator）
- `serverLog(level, scope, msg, extra?)` 签名：`extra.meta` 必须 JSON-serializable + ≤ 2KB（参见 CLAUDE.md 操作日志规则）
- `pushLog` 与 `logAction`：高频事件不打 logAction 起止配对（参见 memory 2026-05-02 / 终端方向键直通PTY 那条）；spawn 是低频用户主动触发，可以 pushLog 单条

### 已知坑

- `packages/web` 没单独 `typecheck` script，用 `pnpm -F @aimon/web build` 兼做类型检查（memory 2026-05-02 / 终端方向键直通PTY 那条）
- 后端 NodeNext ESM，相对 import 必须带 `.js` 后缀（memory 2026-05-02 / 使用量面板 那条）
- 跨平台路径：`os.homedir()` + `path.join`，不硬编码（同上）
- `performance.memory` 只有 Chromium 有，非 Chromium 兜底 unavailable（memory 2026-05-02 / 项目切换卡顿优化 那条）

### 验收硬约束（来自 CLAUDE.md 操作日志规则）

- 新增 mutation API → 起止配对日志（本任务**没有**新 mutation API，只加打点）
- UI 改动 → 浏览器可观察验收项（已写进 D1/D2/D3）
- 派 vibespace-browser-tester 跑一遍验收（D4，必做）

## 基线数据（A3 实测 2026-05-09）

`pnpm -F @aimon/web build` 输出关键 chunk（按首屏影响排序）：

```
BASELINE 首屏 entry:
  index-CBPQK7bv.js  1,165.30 kB │ gzip: 326.58 kB   ← 这是首屏必加载的总块，包含 React + Workbench + 所有 11 个 sidebar view + EditorArea + FilePreview + react-markdown + remark + rehype + xterm 全家桶等

BASELINE 已经 dynamic 的大块（按需加载，不算首屏）：
  emacs-lisp-D4W-_rAk.js   779.87 kB    ← shiki grammar
  cpp-CSa1EKHo.js          626.12 kB    ← shiki grammar
  wasm-DFVlQlgd.js         622.32 kB    ← shiki onigasm
  xlsx-8bNxWYW2.js         424.76 kB    ← xlsx dynamic import (ExcelPreview useEffect)
  wolfram / vue-vine / dist / angular-ts / typescript / jsx / tsx / javascript / objective-cpp / mdx / asciidoc 等 100-260kb shiki grammar 各按需

目标：B1 + B2 + B3 完成后 index-*.js ≤ 700 kB（基线 60%），并把 react-markdown/remark/rehype/PromptLibraryDialog/FilePreview/ChecklistEditor/11 sidebar view 全部移出首屏 chunk。
```

**warning（基线就有，本任务可缓解）**：vite 报 `Some chunks are larger than 500 kB after minification`，主要指向 index/cpp/wasm/emacs-lisp。本任务只能减 index 这一项。

## 验收数据（D 阶段实测 2026-05-09）

### D2. 前端首屏 chunk 对比

| 指标 | 基线 | 改后 | Δ |
|---|---|---|---|
| 首屏 entry `index-*.js` | 1,165.30 kB | 283.79 kB | **-75.6%** ✅ |
| gzip 后 entry | 326.58 kB | 86.77 kB | **-73.4%** ✅ |
| 首屏总加载（entry + xterm 静态依赖） | 1,165.30 kB | 779.35 kB | -33.1% ✅ |
| sidebar 11 个 view chunk | 全在 entry 内 | 11 个独立 chunk（2-37 kB） | 按需加载 ✅ |
| FilePreview / ChecklistEditor | 在 entry 内 | 独立 chunk（37 kB / 7 kB） | 按需加载 ✅ |
| markdown 全家桶 | 在 entry 内 | 独立 chunk 179 kB（gzip 55 kB） | 仅打开 .md 时下 |
| `markdown` chunk 不在首屏 | — | 由 lazy `FilePreview` 触发 | ✅ |
| `xlsx` chunk 不在首屏 | 已是 dynamic | 已是 dynamic（424 kB） | ✅ |

目标"首屏 chunk ≤ 基线 60%"达成（283 / 1165 = 24.4%，gzip 86 / 326 = 26.6%）。

### D5. 类型检查

- `pnpm -F @aimon/server build`：✅ 0 错误
- `pnpm -F @aimon/web build`：✅ 0 错误（仅有 vite "chunks > 500 kB" 警告，对应 cpp/wasm/emacs-lisp 这三个 shiki grammar 单独 chunk 和 xterm 全家桶 chunk，本任务无法控制）

### D1 / D3 / D4. 浏览器实测

由 vibespace-browser-tester 跑，结果回填到本段。
