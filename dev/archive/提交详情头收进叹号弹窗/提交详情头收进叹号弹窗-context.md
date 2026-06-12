# 提交详情头收进叹号弹窗 · Context

## 关键文件（改动边界）

- `packages/web/src/store.ts`
  - `EditorTab` interface（line 70-82）：加可选字段 `commitSubject?: string`。
  - `editorTabKey`（line 84-97）：**不改**——key 不含 subject，避免同一提交因 subject 不同产生重复标签。
  - `openFile`（line 503-516）：**不改**——已 `{...t}` 透传，新字段自动带上。
- `packages/web/src/components/GitGraph.tsx`
  - `onCommitClick`（line 202-208）：`openFile({...})` 调用加 `commitSubject: c.subject`。`c: GraphCommit` 有 `subject`（line 314 已用 `row.commit.subject`）。
- `packages/web/src/components/editor/EditorArea.tsx`
  - 页签渲染（line 203-209）：`isCommit` 分支 `basename` 改 `f.commitSubject || '(无提交说明)'`；`title` 带完整说明 + 短哈希。line 224-230 的 `@短SHA` chip 保留不动。
- `packages/web/src/components/CommitDetailView.tsx`
  - 移除「提交头」整块（line 116-140 的 subject/作者·日期·shortSha/合并标记/body）。
  - 文件清单列头「N 个文件」行（line 145-147）左侧加 ❗ 按钮 + 组件内弹出面板。
  - 面板内容 = 原提交头字段（subject / author / date / shortSha / 合并提交标记 / body）。
  - `shortDate` / `StatusBadge` / `FileRow` / `FileDiff` 不动。

## 决策记录

- **页签提交说明从哪来**：选「开标签时从 GraphCommit.subject 带上 EditorTab」而非「页签去读 commitDetailCache」。后者是异步缓存，首帧可能为空 → 页签先显示占位再闪变；前者开标签即有值、立即正确，且 GraphCommit 本就在手。资深视角看不算过度设计——只加一个可选字段，零新抽象。
- **弹窗不复用 BranchPopover 组件**：BranchPopover 走 portal + anchor rect，是给"侧栏 chip 弹到屏幕坐标"用的。本场景按钮和面板同在 CommitDetailView 内，直接 `relative` 容器 + `absolute` 面板 + 组件内 `useState` 即可，点外/Esc 关闭逻辑照抄（约 10 行 useEffect）。引入 portal 是过度设计。
- **key 不含 subject**：保证"同一次提交只开一个标签"语义不变。
- **不加操作日志**：弹窗开合是纯本地 view state，无 mutation/无 async，按 CLAUDE.md 操作日志豁免清单（纯样式/展示调整）处理。

## 依赖与约束

- `CommitDetail`（types.ts line 489）extends `CommitSummary`：有 `subject/author/date/shortSha/body/parents`，弹窗所需字段全有。
- `GraphCommit` 有 `subject`（GitGraph 已消费）。
- TypeScript 类型检查命令：`pnpm -F @aimon/web build`（packages/web 无独立 typecheck script，沿用 build 作类型门，见 auto.md 2026-05-02 经验）。
- 破坏性变更协议：`EditorTab` 加**可选**字段向后兼容，不删改现有字段；改完 grep 确认无消费方因新字段报错。
