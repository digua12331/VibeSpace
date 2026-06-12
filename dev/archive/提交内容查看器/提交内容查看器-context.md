# 提交内容查看器 · Context

## 确认的方案

大哥选**方案 A**：点提交在右侧编辑区开「提交详情」标签。**关键修正**：因为 `openFile` 是单标签槽位（`openFiles: [tab]` 每次替换），若点文件再 `openFile` 开 diff 会把提交详情标签顶掉。所以提交详情标签**自包含**——文件清单 + 选中文件 diff 都在这一个标签内渲染（用 DiffView 直接渲染 patch），点文件不走全局 openFile。这正好就是给大哥看的预览形态。

## 关键文件（改动边界）

- `packages/web/src/store.ts`
  - `EditorTabKind`（L67）：`'file'` → `'file' | 'commit'`。
  - 新增 `commitDetailCache: Record<string, Record<string, CommitDetail>>` + `setCommitDetailCache(projectId, sha, detail)`（仿 `projectGraphCache` L302-303 / setter）。需 import `CommitDetail`。
  - `openFile`（L491）现有逻辑已支持 `kind`（`t.kind ?? 'file'`），`editorTabKey`（L83）已 Pick `kind` → commit 标签 key 唯一、重复点同提交不重开。无需改 openFile 本体。
- `packages/web/src/components/CommitDetailView.tsx`（新建）
  - props `{ projectId, sha }`；SWR 从 `commitDetailCache` 取，miss 时 `getProjectCommit` 拉取写回。
  - 布局：顶部提交头（subject/author/date/shortSha，多父时一句"与第一父提交比较"）＋左侧文件清单（复用 ChangesList StatusBadge 风格：状态徽标+路径+`+add/-del`）＋右侧选中文件 diff（`getProjectDiff` → `DiffView`）。
  - 三态：加载/出错/空；清单区与 diff 区各自独立滚动；长路径 truncate+title。
  - 竞态：commit 拉取 & 单文件 diff 拉取各用 `cancelled` 标记，连点不串台。
  - 根提交无父：`from = EMPTY_TREE('4b825dc642cb6eb9a060e54bf8d69288fbee4904')`。
- `packages/web/src/components/editor/EditorArea.tsx`
  - L344 渲染区：`activeFile.kind === 'commit'` → `<CommitDetailView>`，否则 `<FilePreview>`。lazy import（仿 FilePreview L16）。
  - L200-242 标签渲染：commit 标签显示"提交 @shortSha"而非文件名/📄。
- `packages/web/src/components/GitGraph.tsx`
  - `onCommitClick`（L202）：删掉把 `selectedChange.path` 塞 subject 的半空操作 + L217-219 `void openFile` 占位注释；改为 `selectChange({path:c.sha, commitSha:c.sha, ref:c.sha})`（仅供行高亮）＋ `openFile({projectId, path:c.sha, kind:'commit', commitSha:c.sha})`。

## 决策记录

- **diff 在标签内渲染，不开全局文件标签**：单槽位 openFile 决定了这是唯一不互相顶掉的做法，也更贴合预览。不引入"多标签/钉住"机制（过度设计）。
- **缓存放 store 按 projectId+sha 分桶**：符合 auto.md「轻量项目级缓存放 store、不引查询库」。单文件 diff 不缓存（量小、按需取即可，避免 cache 膨胀）。
- **不埋 logAction**：展开/查看是纯只读，非 mutation，按 CLAUDE.md 豁免清单不埋点。
- **不动提交图 SVG 连线算法**：方案 A 本就不碰，零回归风险。
- **EMPTY_TREE 作根提交基准**：git 标准空树 hash，`git diff <empty> <sha>` 是通用写法。

## 依赖与约束

- 后端零改动：`GET /commits/:sha`（CommitDetail）、`GET /diff?path&from&to`（DiffResult）已就绪。
- `getProjectDiff` 对重命名(R)/复制(C)用新路径取 diff——最易翻车假设，验收 3 实测。
- `pnpm -F @aimon/web build` 为类型门禁（无独立 typecheck，auto.md 2026-05-02 经验）。
