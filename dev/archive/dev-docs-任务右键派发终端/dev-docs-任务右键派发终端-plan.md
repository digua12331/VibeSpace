# dev-docs-任务右键派发终端 · plan

## 目标

在 Dev Docs 侧栏「任务」tab 里，右键一个任务时弹出 **右键菜单**，至少包含「派 Claude 继续任务」一项：点击后按现有 Issues 派单路径，新建一个 Claude 终端、把 `继续 <任务名>` 写入剪贴板并聚焦，让用户在终端里 Ctrl+V + 回车即可让 AI 按 CLAUDE.md 约定读取 `dev/active/<任务名>/` 下三份 md 继续执行。

### 可验证的验收标准（UI，在浏览器里能观察）

1. `pnpm --filter web dev` 启动前端，打开 Dev Docs → 任务 tab。
2. **右键任一任务行**：弹出菜单（不再立刻触发归档弹窗），菜单里可见「派 Claude 继续任务」「归档」两项。
3. 点「派 Claude 继续任务」：
   - 右侧终端区新出现一个 Claude session 并被聚焦（与 Issues 派单同一路径，可复用）。
   - 弹窗提示"已新建 Claude 终端…请在终端里按 Ctrl+V 粘贴、再按回车发送"。
   - 剪贴板内容恰好是 `继续 <任务名>`（在终端里 Ctrl+V 能看到这串）。
4. 点「归档」：行为与现状一致（弹 confirmDialog → 归档）。
5. 右键菜单外点击 / ESC / 滚动 → 菜单消失（`ContextMenu` 已自带）。
6. `pnpm --filter web typecheck`（或项目对应 TS 检查命令）通过。

## 非目标 (Non-Goals)

- 不改 Issues tab 的右键 / 派发逻辑（它是按钮 hover 触发，不是右键菜单，本轮不动）。
- 不派发给 Codex / 其他 agent —— 与现有 Issues 派单保持一致，仅 Claude。
- 不新增"派发并自动发送回车"的后端能力 —— 沿用"剪贴板 + 手动粘贴回车"两步法，和 Issues 一致。
- 不在菜单里堆"打开 plan / context / tasks"这些项 —— 行点击展开后已经有独立按钮，避免菜单臃肿。

## 实施步骤（粗粒度）

1. **在 `DocsView.tsx` 里引入 `openContextMenu` + `ContextMenuItem`**。
   - 验证：文件 import 增加一行，typecheck 通过。
2. **构造"派 Claude 继续任务" prompt 辅助函数 `buildContinueTaskPrompt(task: string)`**，返回字符串 `继续 <任务名>`。
   - 放在 `DocsView.tsx` 内部，和 `buildSingleIssuePrompt` / `buildAllIssuesPrompt` 并列。
   - 验证：typecheck 通过。
3. **替换任务行的 `onContextMenu` 处理逻辑**：由直接调 `onArchive` 改为 `openContextMenu({ x, y, items: [...] })`，菜单项包含：
   - `📋 派 Claude 继续任务` → `dispatchClaude(buildContinueTaskPrompt(t.name), '已派 Claude 继续任务')`
   - `divider`
   - `📦 归档` → `onArchive(t.name)`（danger 样式可不加，保留现有归档确认弹窗即可）
   - 验证：右键弹菜单、两项都可点、点"继续"后新建 Claude 终端并写剪贴板。
4. **保留**行尾 hover 的 📦 归档按钮（老入口不动），确保熟悉老 UX 的用户仍有一步归档路径。
5. **UI 自测 + typecheck**。

## 边界情况

- **任务名包含特殊字符**：CLAUDE.md 已禁止 `/ \ : * ? " < > |`，不用在前端再做转义。
- **`done` 状态的任务右键**：仍允许"派 Claude 继续任务" —— 用户可能想让 AI 做收尾 / 补测试 / 重启一轮。不禁用，但在 tooltip 里写一句"已完成任务也可以继续（AI 将按上下文自行判断）"。
- **dispatching 正在进行中再次右键点派发**：现有 `dispatching` 标志会把菜单项置灰 / 派单失败时弹红色对话框，这部分复用 `dispatchClaude`，不新增状态。
- **剪贴板写入失败**（非 secure context / 权限被拒）：`dispatchClaude` 已有 fallback —— 把 prompt 内容直接塞进弹窗，用户手动复制。无需在本任务里处理。
- **右键位置贴近视口边**：`ContextMenu` 内部的 `clampToViewport` 已处理。
- **切换项目 / 任务列表刷新**：菜单弹出后若任务行被重渲染，菜单是 fixed 定位在 `window.mousedown` 时会自动关闭，无幽灵项点击风险。

## 风险与注意

- **破坏性 UX 变更（需用户拍板）**：当前代码里任务行 `onContextMenu` **直接触发归档**（`DocsView.tsx:452-455`）。引入右键菜单后，"右键 = 立即归档"变成"右键 → 点归档菜单项 → 确认弹窗"，对已有肌肉记忆的用户多一步。
  - 我的倾向：**替换成菜单**（菜单里有"归档"），理由是：
    1. 右键本来就有对应的"确认弹窗"，说明这一步是有意让用户二次确认的，菜单多一点点延迟不改变意图。
    2. 加上了更有价值的"派 Claude 继续任务"主入口。
    3. 行尾 hover 的 📦 按钮保留，"鼠标扫过点一下"这条一步路径依然在。
  - 请用户确认是否接受此取舍；若不接受，备选方案是 **Shift + 右键** 才出菜单，普通右键仍立即归档（会更复杂、也更隐蔽）。
- **菜单项文案**：我用「派 Claude 继续任务」，与 Issues 侧「🤖 派 Claude 处理此问题」同构；图标用 `📋` 或 `🤖` 都可——倾向 `🤖` 与 Issues 视觉一致，便于用户建立"🤖 = 派 Claude"的联想。
- **prompt 内容**：CLAUDE.md 规定"新会话里，用户只需说 `继续 <任务名>`"，因此 prompt 就直接写 `继续 <任务名>`，**不要再追加"请读取 xxx md"等多余引导**，避免覆盖工作流约定里的隐含行为。
- **假设**：`dispatchClaude` 目前对所有任务都适用（无需额外参数），复用即可；不新增后端 API、不新增 route。
- **不溢出**：本任务只改 `packages/web/src/components/sidebar/DocsView.tsx`，不应动 server / store / api / CLAUDE.md。
