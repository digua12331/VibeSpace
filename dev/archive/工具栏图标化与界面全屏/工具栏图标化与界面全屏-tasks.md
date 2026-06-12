# 工具栏图标化与界面全屏 · 任务清单

- [x] 步骤 1 EditorArea triggerLabel 改「+」 → verify: 行 326 prop 值为 "+"
- [x] 步骤 2 EditorArea EmptyState 文案同步 → verify: 行 431 不再含「启动 AI / 终端」
- [x] 步骤 3 StartSessionMenu 删 +missingCount span → verify: 📦 按钮内仅 emoji
- [x] 步骤 4 index.css 删 App frame 块 → verify: 文件无 `.app-frame` / `#root{padding`
- [x] 步骤 5 Workbench 去 app-frame class → verify: 根 div className 无 app-frame
- [x] 步骤 6 前端类型检查 → verify: tsc -b 通过 (EXIT=0)
