# 提交图右键发送到对话 · Context

## 关键文件

- `packages/web/src/components/GitGraph.tsx`（**唯一改动文件**）
  - `GitGraph()` 组件已用 `useStore` 拿 `selectedChange`/`selectChange`/`openFile`；新增取 `sessions`/`liveStatus`。
  - 提交行渲染在 ~285–324 行的 `<ul>`/`<li>`，`<li>` 已有 `onClick={() => onCommitClick(row.commit)}`，本次加 `onContextMenu`。
  - 新增 `handleCommitContext` 函数 + `aliveAiSessions` 派生逻辑。

## 复用的现成件（不改）

- `packages/web/src/components/ContextMenu.tsx` → `openContextMenu({ x, y, items })` + `ContextMenuItem` 类型。三态菜单（disabled / 直发 / submenu）样板见 `fileContextMenu.ts::buildFileContextItems` 的 `sendItem`。
- `packages/web/src/sendToSession.ts` → `sendToSession(projectId, { id, agent }, text, { scope, meta })`：切 tab、激活 session、`queuePendingInput`，内部已 `logAction('<scope>', 'send-to-session', …)` 产生起止配对。
- `FilesView.tsx::aliveSessions`（230–239）：过滤 `s.projectId===projectId && liveStatus 非 stopped/crashed`，map 成 `{ id, agent }`。本次照搬，额外排除 shell（`shell`/`cmd`/`pwsh`）。

## 决策记录

- **菜单构建内联在 GitGraph，不新建 `commitContextMenu.ts`**：逻辑只有两项菜单、单处调用，抽独立文件属一次性抽象，过度设计。文件右键之所以独立成文件是因为它有删除/gitignore/执行等近 10 项且被多处引用。
- **发送内容 = `提交 <shortSha> "<subject>" `**：`GraphCommit` 没有 body，subject+shortSha 是现有能拿到的最有信息量组合；带哈希让 AI 能定位具体提交。
- **scope='graph'**：与文件右键的 `scope='files'`、Dev Docs 的 `scope='docs'` 区分来源，便于 LogsView 排障（沿用 auto.md 2026-05-02「不同 scope 区分入口」那条经验）。
- **排除 shell 会话**：提交标题是中文描述，发给 raw shell 无意义，与 `fileContextMenu` 的 `SHELL_AGENTS` 处理一致。
- **加「复制提交信息」**：纯礼貌兜底，让无存活会话时菜单不至于只剩一个灰项；复制是只读非 mutation，记一条 info 日志即可，不强制起止配对。

## 依赖与约束

- `useStore` 的 `sessions: SessionMeta[]`（含 `id`/`projectId`/`agent`/`status`）、`liveStatus: Record<id,status>`。
- 本仓库 web 侧类型检查命令：`pnpm -F @aimon/web build`（无独立 typecheck script）。
