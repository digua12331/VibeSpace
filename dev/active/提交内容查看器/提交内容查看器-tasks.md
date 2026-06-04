# 提交内容查看器 · 任务清单

- [x] 步骤 1：store 扩 `EditorTabKind` 加 `'commit'`，新增 `commitDetailCache` + `setCommitDetailCache`，import CommitDetail → verify: `pnpm -F @aimon/web build` 通过 ✓
- [x] 步骤 2：新建 CommitDetailView 组件（提交头 + 文件清单 + 选中文件 diff，含三态/竞态/根提交空树/长路径截断）→ verify: build 通过 ✓
- [x] 步骤 3：EditorArea 渲染区按 kind 分支渲染 CommitDetailView，标签显示"提交 @sha" → verify: build 通过 ✓
- [x] 步骤 4：GitGraph onCommitClick 改为开 commit 标签 + 清掉旧半空操作/占位注释 → verify: build 通过；git status 仅含白名单 3 改 + 新建 CommitDetailView.tsx（tsbuildinfo 为构建缓存产物）✓
- [x] 步骤 5：浏览器验收 → 大哥明确指示"不需要去测试"，跳过自动浏览器验收，留待大哥自验（dev server 已起在 8790 供其点验，可随时关）
