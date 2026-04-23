# 终端输入抖动 · Plan（v2，已对齐截图）

## 背景（更新）

用户截图确认：所谓"进度条"是中文输入法（IME）候选词浮窗 `1改变 2改编 3概念 …`，
它本身是系统级浮窗，但它的弹出 / 消失会让浏览器里底部 `<input>` 元素发生
sub-pixel 高度变化，沿 `flex-1` 链条传到上方 xterm 容器，触发：

`ResizeObserver` → `fit.fit()` → `aimonWS.sendResize()` → 后端 PTY SIGWINCH → AI agent 重绘
prompt → 用户看到"终端区域被拉长一下，下方多出一条状态/候选条"。

随着用户继续打字、IME 候选条出现/消失、上屏，整套 resize 来回触发，呈现"来回变化"。

## 目标

让"会话页签内的 xterm 终端区"和"底部输入栏"的尺寸**完全由手动拖拽分隔条决定**，
**不再被任何内容变化（IME、输入文本、placeholder、字号变更）触发的高度抖动连带 resize**。

### 可验证的验收标准（必须能在浏览器里看到）

1. 打开任意会话页签，在底部 `> type to send (Enter)` 输入框：
   - **中文 IME 连续输入** + 候选词浮窗反复出现：xterm 区域高度像素级稳定，底部输入栏高度恒定，AI agent 的 prompt 行不被重绘冲掉。
   - **粘贴 200+ 字符长文本**：同上不抖。
   - **切换中英文 / 反复退格**：同上不抖。
2. DevTools → Network → WS：打字过程中**不再有** `resize` 帧发出（仅在拖动 splitter 或窗口尺寸变化时才发）。
3. 手动拖拽主 splitter / sidebar splitter 改变窗口尺寸：xterm 仍然能正确 `fit`，cols / rows 正常更新。
4. 类型检查通过（命令在 Context 阶段确认；初步看是 `pnpm -C packages/web build` 或 `tsc --noEmit`）。

## 非目标 (Non-Goals)

- 不动 xterm 字体 / 字号 / 主题。
- 不修改 IME composition 时按 Enter 的发送语义（该问题真实存在但属另一任务，记入 `dev/issues.md`）。
- 不引入新的窗口管理库 / 状态机。
- 不让 input 自适应高度、不让终端自适应内容 —— 用户明确要求"固定就是固定"。

## 实施方案（核心思路：把"内容驱动的 resize"和"用户驱动的 resize"分开）

### 关键改动点（`packages/web/src/components/terminal/SessionView.tsx`）

1. **给底部输入容器写死高度**
   - 当前 (line 443-454)：`<div className="flex items-center gap-2 px-3 py-2 border-t border-border/60 bg-white/[0.02]">` —— 高度由 `py-2` + 内部 `<input>` 行高决定，IME 时会抖。
   - 改为显式 `h-10`（或 9，依视觉对齐定）；同时给 `<input>` 加 `h-full leading-none`，杜绝 IME 影响外层。

2. **让 ResizeObserver 只对"宽度变化"或"显著高度变化"做 fit**
   - 当前 (line 217-224) 的 ResizeObserver 任意尺寸变化都触发 `fit + sendResize`。
   - 改为：缓存上一次的 `width / height`，只有 `Δwidth >= 1px` 或 `Δheight >= 4px` 时才 fit。这样 IME 引起的 sub-pixel 高度抖被吞掉；splitter 拖拽引起的几十像素变化照常生效。
   - 数值 4px 是一个保守阈值（一行 xterm 约 16-18px），保证拖动 splitter 时绝不会失灵。

3. **给 termHost 容器加 `min-h-0` 已有，但补一层"高度由 flex 自动算"的保护**
   - 验证一下父链是否有 `flex-1 min-h-0` 完整闭环（已有），不需要新增。

> **方案简洁性自检（按 CLAUDE.md "外科改动" 要求）**：
> - 不引入 IME 事件 (compositionstart/end) 监听 —— 上面 1+2 已能解决问题，加 IME 监听是多余抽象。
> - 不动 store / props / 类型 —— 改动局限在 SessionView.tsx。
> - 不顺手优化任何相邻代码。

## 边界情况

- **死会话页签**（`isDead`）：input 被 disabled，但容器固定高度依然生效，不会引起视觉跳变。
- **页签切换 active → inactive → active**（line 266-277 的 `useEffect`）：那里的 `requestAnimationFrame` re-fit 必须保留，是激活后修正 stale 尺寸的，不在本次方案的"打字静默"逻辑覆盖范围（那是 active=true 期间）。
- **窗口最大化 / 最小化**：触发 ResizeObserver 上的 `Δwidth/Δheight` 远超阈值，照常 fit。
- **输入框获得焦点但没打字**：input 高度不变 → 不触发 ResizeObserver → 行为与现在一致。
- **极端窄屏 / 极端宽屏**：阈值 4px 不依赖屏幕尺寸，安全。

## 风险与注意

- **假设**：抖动确实由 input 高度变化引起，而非 xterm 自身在某些情况下会自我 resize。如果改完仍抖，需要在 ResizeObserver 回调里加日志验证 `entry.contentRect` 的来源元素，回滚到"加 IME 事件监听"的备用方案。
- **假设**：固定 `h-10` 不会破坏现有的视觉对齐（顶部 button bar 是 py-1.5、输入栏是 py-2，应该容得下）。Context 阶段会量一下 DOM 实际高度。
- **阈值 4px 的副作用**：在用户拖动 splitter **极慢** 时，可能出现一帧延迟才 fit。可接受，因为 ResizeObserver 还会继续触发后续帧。
- 另：`onInputKey` 在 IME composing 中按 Enter 也会发送 —— 中文输入法用户的常见痛点，**记入 `dev/issues.md`** 但不在此次任务做。
