# 终端悬浮快捷按钮 · 任务清单

- [x] 步骤 1：customButtons.ts 加字段注释（showInTopbar 语义说明） → verify: 注释明确"实际指：是否在输入框上方显示"
- [x] 步骤 2：SessionView.tsx 顶栏剪掉 customButtons map 块 → verify: customButtons 渲染删除；顶栏只剩 ⚙/📝/⟳/✕
- [x] 步骤 3：SessionView.tsx 新增按钮行 div + xterm bottom 同步上调 → verify: 按钮行 `bottom-[76px]`；xterm style.bottom 72→112；按钮行复用按钮 JSX
- [x] 步骤 4：SessionView.tsx 边界处理（isDead 隐藏 / 0 按钮不渲染 / overflow-x-auto / 单按钮 max-w-[180px] truncate） → verify: 等浏览器手测
- [x] 步骤 5：PermissionsDrawer.tsx ButtonsTab 文案改"在输入框上方显示" → verify: 抽屉里看到新文案
- [x] 步骤 6：跑 pnpm -F @aimon/web build 类型检查 → verify: build 成功无 error（1.52s）
- [x] 步骤 7：派 vibespace-browser-tester 跑 plan 10 条浏览器验收 → 10/10 SKIP（子代理无 browser-use MCP，非代码问题）；待大哥手动验收
- [x] 步骤 8：git diff --name-only HEAD 边界检查 → 本任务实际改 3 个文件（SessionView / PermissionsDrawer / customButtons），diff 里其余 8 个是**会话开始前**就有的未提交残留（log-bus / ws-hub / StartSessionMenu / ProjectsColumn / perf-marks / store / ws / tsbuildinfo），不是本任务范围
- [x] 步骤 9：交付 handoff（大哥摘要 + diff 行） → 本回复末尾
