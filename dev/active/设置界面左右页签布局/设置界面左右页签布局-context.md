# 设置界面左右页签布局 · Context

## 关键文件

- `packages/web/src/components/SettingsDialog.tsx`（唯一改动文件）
  - 行 122-379：组件状态 + effects + 各 handler，**不动**。
  - 行 396-773：return 的 JSX，**本次只改这里**。
    - 外层 overlay div（397-401）保留。
    - 内层 dialog div（402-407）：`w-[460px] … overflow-y-auto` → 改成左右 flex 框架，加宽。
    - 标题「设置」（408）保留，放进左栏顶部或弹窗头部。
    - 5 个 `<section>`：
      - 粘贴图片保留天数（410-428）→ 通用
      - 会话冬眠（430-478）→ 终端
      - 终端快捷键（480-545）→ 终端
      - 桌面通知（547-575）→ 通用
      - 飞书机器人（577-745）→ 飞书
    - error 提示（747-751）：是 app-settings 保存的错误，跟「保存」按钮一起放底部 footer。
    - footer 取消/保存（753-770）：跨页签共用，固定在右侧内容区底部或弹窗底部。

## 决策记录

- **页签状态用一个本地 `useState<'general'|'terminal'|'feishu'>('general')`**，不引任何 tab 库、不抽组件。section 内容靠条件渲染（`activeTab === 'x' && (...)`）。资深工程师视角：单文件 3 个页签，抽 Tab 组件/库是过度设计，直接条件渲染最简。
- **所有字段 state 维持在组件顶层**（现状就是），切页签只是条件渲染、不卸载 → 输入不丢，无需额外保活逻辑。
- **footer（取消/保存 + app error）放右侧内容区底部、固定不滚**，因为「保存」存的是 retention/hibernation/keybindings（横跨通用+终端两个页签），不能塞进单个页签里。飞书有自己的保存按钮，留在飞书页签内不动。
- **布局**：内层 dialog 改 `flex`；左栏固定宽（约 150px）竖排页签按钮；右栏 `flex-1` 且 `overflow-y-auto`。整窗 `w-[720px] max-w-[90vw] max-h-[88vh]`。
- **不加操作日志**：纯布局 + 本地 UI 状态切换，属豁免（无 mutation、无行为变更）。现有 `logAction` 调用原样保留。

## 依赖与约束

- 无新增依赖。复用现有 tailwind 工具类与 `fluent-acrylic / fluent-btn / rounded-win` 等项目既有 class。
- 类型检查/构建命令：`pnpm -F @aimon/web build`（参考 auto.md：web 包无独立 typecheck，用 build 作类型检查验收）。
- 选中态高亮配色沿用项目调色板（accent / border / muted），不发明新色。
