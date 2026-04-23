# dev-docs-任务右键派发终端 · context

## 关键文件

本次改动只触碰一个文件：

- **`packages/web/src/components/sidebar/DocsView.tsx`**
  - `DocsView:93-572` —— 组件主体
  - `dispatchClaude:264-297` —— 既有的"新建 Claude session + 写剪贴板 + 弹提示"派单函数，直接复用
  - `buildSingleIssuePrompt:243-251` / `buildAllIssuesPrompt:253-262` —— 参考模板，在它们旁边新增 `buildContinueTaskPrompt`
  - `onArchive:209-224` —— 既有的归档函数（带 confirmDialog），菜单里直接复用
  - 任务行 `onContextMenu`：`452-455` —— **唯一要改的行为**，从直接调 `onArchive` 改为 `openContextMenu({...})`
  - 行尾 `📦` 按钮：`466-475` —— **不动**，保留 hover 一步归档入口

## 读取 / 不改：

- `packages/web/src/components/ContextMenu.tsx` —— 通过 `openContextMenu({ x, y, items })` 调用；已支持 icon / divider / danger / disabled / submenu，且内部已处理视口 clamp、ESC、外部点击关闭。
- `packages/web/src/components/fileContextMenu.ts` —— 作为调用范式参考（`ContextMenuItem[]` 的组织方式）。
- CLAUDE.md「上下文耗尽的衔接」节 —— 明确 prompt 用 `继续 <任务名>`，不再多写其它引导。

## 决策记录

### D1. 只加"派 Claude 继续任务" + "归档"两项，不堆更多菜单项

- **资深工程师视角**：堆更多项（打开 plan / 打开 context / 打开 tasks / 复制任务名 / ...）会让菜单臃肿；这些在行展开后已有独立按钮，不是右键菜单能解决的问题。
- **决定**：菜单只两项，配一个 divider。后续用户用着用着发现确实缺某项再加，不在本轮预支。

### D2. prompt 就是字面 `继续 <任务名>`，不加解释性前缀

- **资深工程师视角**：CLAUDE.md 已经告诉 AI "新会话里用户只需说 `继续 <任务名>`"，再追加 "请读取三个 md..." 之类等于在前端重新实现一遍本该由 AI 那边守则处理的行为，两边写重不利于长期一致。
- **决定**：`buildContinueTaskPrompt(name) => \`继续 ${name}\``，不多写。

### D3. 派发目标写死 Claude，不加 agent 选择 submenu

- **资深工程师视角**：本项目只有 Claude 能读 CLAUDE.md 里的 Dev Docs 守则；Codex/shell 收到 `继续 xxx` 不会按三段式工作流执行。给用户选 agent 只会诱导错误用法。
- **决定**：复用 `dispatchClaude`，不做 agent submenu。与 Issues 派单保持一致。

### D4. 保留行尾 hover `📦` 按钮（不删）

- **资深工程师视角**：新菜单里也放了"归档"，理论上行尾那枚按钮变成冗余；但删除它就是"顺手重构"，且 hover 一步归档对老用户仍是更快路径。按 CLAUDE.md「看到无关的死代码就提一嘴，不要删」原则不动。
- **决定**：不动。

### D5. 复用 `onArchive` / `dispatchClaude`，不重写

- 新菜单项的 `onSelect` 直接调这两个函数。不内联、不抽 hook、不做 props drilling。

### D6. 菜单图标：派 Claude 用 `🤖`、归档用 `📦`

- 与 Issues 侧 `🤖` / 行尾 `📦` 视觉语义对齐，用户已建立"🤖 = 派 Claude"的联想。
- **决定**：`🤖 派 Claude 继续任务` / `📦 归档`，归档不标 `danger` 颜色（归档不是删除，现有行尾按钮也不是红色）。

### D7. `onContextMenu` 里 `openContextMenu` 用 `e.clientX/clientY` 定位，不自己算偏移

- `ContextMenu.clampToViewport` 已处理溢出。前端只传鼠标坐标。

## 依赖与约束

- **不新增后端 API / route**：`dispatchClaude` 已经调 `api.createSession` + `navigator.clipboard.writeText`，够用。
- **不新增 store 字段**：`dispatching` 状态已存在，复用。
- **不改 `types.ts` / `api.ts`**。
- **类型检查命令**：项目前端使用 TypeScript，`verify` 步骤里跑 `pnpm --filter web typecheck`（若项目无此脚本，退回 `pnpm --filter web exec tsc --noEmit`；在 tasks 阶段先确认哪个命令实际存在再写入 verify）。
- **UI 验收**：必须在浏览器里实操右键 → 点菜单项 → 观察到新 Claude 终端 + 剪贴板有 `继续 <任务名>`。typecheck 不能替代。
