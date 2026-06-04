# 终端悬浮快捷按钮 · Context

> AI 自用上下文盘点。给执行阶段对照边界、归档评审产出记忆、跨会话衔接。

## 关键文件

- `packages/web/src/components/terminal/SessionView.tsx`（1382 行，**主改**）
  - 顶栏渲染区 line 1117-1210：剪掉 customButtons map 块（line 1162-1199）
  - xterm host div line 1262-1299：把 `style={{ bottom: 72 }}` 改成 `bottom: 112`
  - 悬浮输入框 div line 1301-1319：**之前**新增按钮行 `<div>`
  - 已 import：`customButtons`、`resolveCommand`、`BUTTON_COLOR_CLASSES`、`pushLog`、`aimonWS`、`wrapBracketedPaste`（全部按钮行需要的依赖已就位）
- `packages/web/src/components/PermissionsDrawer.tsx`（1739 行，**只改文案**）
  - ButtonsTab function line 789+
  - 顶部说明文字 line 822 附近
  - 单按钮复选框 label line 922-928 附近
- `packages/web/src/customButtons.ts`（190 行，**只加注释**）
  - 字段 `showInTopbar` 定义 line 23-24 附近
  - default seeds line 72-91 不动（🧹 清除 / 🕘 历史对话）

## 决策记录

### D1：搬家 vs 叠加 → **搬家**

只复用现有 `showInTopbar` 字段、改渲染位置 + 文案，不动 schema、不做数据迁移。已勾选按钮直接出现在新位置。备选（叠加双位）改动 +30% 且当前需求不需要双位，已排除。

**资深工程师视角**：这是最简单的实现，不是过度设计。仅一个字段语义反转、一行注释说明、两处文案翻译。

### D2：是否新增"折叠/展开"按钮 → **不新增**

用户原话"点击设置"指现有顶栏 ⚙（PermissionsDrawer）。按钮行常驻显示，按 `showInTopbar` 过滤；不存在展开/折叠状态。否则会和顶栏 ⚙ 混淆且增加无意义状态。

### D3：字段名是否一并改为 `showAboveInput` → **不改**

只改语义不改名字。改名字会让所有用户的 localStorage 历史数据失效（`isValid` 检查不通过 → 按钮丢失）。在 `customButtons.ts` 字段注释加一行"实际指：是否在输入框上方显示"足够告知后来读代码的人。

### D4：按钮行行为 → **复制顶栏的按钮 JSX**，不抽组件

只有一处使用，抽组件反而增加阅读成本。直接 copy onClick / pushLog / className 字典。符合本仓库外科式改动原则（auto.md 多处条目印证）。

### D5：按钮行的展开/折叠状态 → **无**，常驻显示

只按 `showInTopbar` 过滤；用户可在 ⚙ 设置里逐个勾选。0 按钮时整行不渲染（避免空白条）。

### D6：日志路径 → **完全不动**

`pushLog({scope:'session', msg:'quick-button 发送 ...'})` 已经在用，照搬。按钮行的显示/隐藏（取决于 showInTopbar 勾选变化）是纯视图状态，不需要 logAction 起止配对。

### D7：xterm bottom 值 → **72 → 112**（按钮行 ~32 + gap 8）

72 给输入框（高 ~36 + 底偏移 32 + 顶部一点 gap）。按钮行加进来后，xterm 必须再上移 40px 才不被遮挡。布局值锁死在 plan 实施步骤 2 不再讨论。

## 依赖与约束

- **localStorage schema**：`aimon_custom_buttons_v1` 字段不动；`isValid` 验证逻辑（line 100-118）不动；旧数据无缝兼容
- **跨终端同步**：`onCustomButtonsChange` 订阅已经被 SessionView 用（line 不详但已有），新按钮行复用同一份 state，无需额外订阅
- **xterm 高度自适应**：xterm 区是 `absolute top-0 left-0 right-0 bottom: 112`，fit-addon 会自动算行数；不会因 bottom 改变出 bug
- **z-index / pointer-events**：
  - xterm host: 默认（auto）
  - 按钮行: `z-10`（与输入框同层，按钮在上方区域，输入框在下方区域，不重叠）
  - 输入框: 已是 `z-10`
- **PermissionsDrawer 关闭后状态同步**：用户改完勾选 → onCustomButtonsChange 触发 → SessionView 内 state 重新过滤渲染（既有行为）
- **isDead 状态**：复用 SessionView 现有 `isDead` 变量；与顶栏 customButtons 隐藏条件保持一致

## 边界对照（执行时不要越界）

只动 3 个文件：
1. `packages/web/src/components/terminal/SessionView.tsx` — 主改（删顶栏块 / 新增按钮行 / 改 xterm bottom）
2. `packages/web/src/components/PermissionsDrawer.tsx` — 文案微调
3. `packages/web/src/customButtons.ts` — 仅注释

**不动**（即使顺手看到）：
- `customButtons.ts` 的 schema / 默认 seeds / `isValid` / localStorage key
- `PermissionsDrawer.tsx` 的其他 tab
- SessionView 的 useEffect / 键盘处理 / xterm 初始化 / 输入区其他逻辑
- 任何与本任务无关的 import / 样式调整

收尾时 `git diff --name-only HEAD` 必须只看到这 3 个文件（外加可能的 build 产物 tsbuildinfo）。
