# 提交详情头收进叹号弹窗 · 任务清单

- [x] 步骤 1：store.ts 的 EditorTab 加可选字段 commitSubject；GitGraph.onCommitClick 传 c.subject → verify: `pnpm -F @aimon/web build` 类型检查过 ✓
- [x] 步骤 2：EditorArea 页签 isCommit 分支 basename 改 f.commitSubject||'(无提交说明)'，title 带完整说明 → verify: build 过 ✓（浏览器验收并入步骤 4）
- [x] 步骤 3：CommitDetailView 移除顶部提交头，文件清单列头加 ❗ 按钮 + 就地弹出面板（点外/Esc 关闭），内容=原提交头 → verify: build 过 ✓（浏览器验收并入步骤 4）
- [x] 步骤 4：白名单核对 ✓（我的 4 文件 store.ts/GitGraph.tsx/EditorArea.tsx/CommitDetailView.tsx 均在范围内；diff 里其余 7 文件属并行任务「终端快捷键自定义」未提交改动，未触碰）；浏览器验收 blocked：browser-use MCP 不可用（Root CDP client not initialized），已在 handoff 说明需手动验
