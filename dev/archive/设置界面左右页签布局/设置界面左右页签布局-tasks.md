# 设置界面左右页签布局 · 任务清单

- [x] 步骤 1：加 `activeTab` 状态，内层 dialog 改左右 flex 框架（左栏页签列 + 右栏内容区），加宽到 720px → verify: 浏览器打开设置见左右两栏，左侧三个页签按钮成形
- [x] 步骤 2：5 个 section 按分组（通用 / 终端 / 飞书）拆进 activeTab 条件渲染，footer 取消/保存 + app error 固定右栏底部 → verify: 点不同页签右侧内容切换，五块内容全在
- [x] 步骤 3：左侧页签按钮选中态高亮 + 点击切 activeTab；切页签改过的值不丢（state 在组件顶层，条件渲染不卸载） → verify: 在终端页签改冬眠分钟数，切到通用再切回，值仍在
- [x] 步骤 4：`pnpm -F @aimon/web build` 通过；`git diff --name-only HEAD` 仅 SettingsDialog.tsx → verify: build 成功，无越界文件
