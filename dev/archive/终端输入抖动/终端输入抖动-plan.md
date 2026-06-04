# 终端输入抖动 · Plan（v3，浮动输入框 + 吞字）

> v2（固定 h-10 + ResizeObserver 阈值）已实现并通过类型检查，但用户手测仍然报告
> "吞字 + 界面抖动"，step 4 未 verify。诊断认为 v2 只处理了"抖动的一种来源"
> （flex 链路 sub-pixel 扰动），没处理两个真正让用户难受的根因：
>
> 1. **吞字** = 受控 `<input>` + 中文 IME composing 期间 React re-render 打断合成态 → 丢字。
> 2. **抖动的另一条路径** = 任何让 `<input>` 或其父容器发生高度扰动的事件（比如聚焦状态、IME 候选条与浏览器的相对位置），只要输入框仍在 flex 链路里，就仍有机会通过 flex 再分布影响 termHost。
>
> v3 的思路是**把 input 彻底从 flex 链路里摘出去** + **从 React 受控变成非受控**，
> 同时补上"整个会话视图不允许出现滚动条"的硬约束。

## 目标

1. 底部输入框物理上**悬浮**在 xterm 终端区域上方（绝对定位，不再占用 flex 列布局），
   所以输入框自身任何高度/内部变化**都不可能**再通过 flex 链路传到 termHost。
2. 中文 IME 连续输入**不再吞字**：输入框改为**非受控**（读 ref，不触发 SessionView re-render）。
3. **终端会话视图的外框长宽完全固定**：不论输入多长、IME 候选条多高，整个
   `session-view-<id>` 容器**永远不出现滚动条**。输入内容溢出只允许在 `<input>`
   自己内部做原生横向滚动（无可见滚动条），不向外扩散。

## 可验证的验收标准（必须能在浏览器里看到）

1. 打开任意会话页签，在底部输入框：
   - **中文 IME 连续打 50 字**（比如 "你好世界这是一段测试文本"）：逐字上屏，**不丢任何一个字**；xterm 区域 cols/rows 不变；AI agent 的 prompt 行不重绘。
   - **粘贴 500+ 字符长文本**：输入框内部横向滚（不显示滚动条即可），xterm 区域不变，`session-view-<id>` 容器不出现任何滚动条。
   - **IME 候选条反复出现/消失**：xterm 区域像素级稳定。
2. DevTools → Elements 选中 `#session-view-<id>` → Computed：`overflow` 链路上至少有一层 `overflow: hidden`，整个视图不可滚动。
3. DevTools → Network → WS：纯打字过程**无 `resize` 帧**；只有拖 splitter / 改窗口尺寸时才发。
4. 拖主 splitter、左右侧边栏 splitter、窗口 resize：xterm 仍正确 fit，cols/rows 更新正常。
5. 右键终端选区 → "添加到终端聊天"：文本正确追加到输入框末尾，光标落到末尾，输入框获得焦点。
6. PromptLibrary 发送、自定义按钮发送、Enter 发送、Shift+Enter 不发送：全部保持原语义。
7. 类型检查通过：`pnpm -C packages/web exec tsc -b` 退出码 0。

## 非目标 (Non-Goals)

- 不动 xterm 字体/字号/主题/scrollback。
- 不改 WS 协议、不动 `aimonWS` 任何接口。
- 不改顶部 button bar、不改右侧 PermissionsDrawer、不改 PromptLibraryDialog 内部。
- 不让输入框可拖拽/可折叠/可移动——就是固定悬浮在底部，高度 `h-10`。
- 不引入 IME 事件抽象层或 input 组件库，所有改动局限在 `SessionView.tsx`。

## 实施方案

### 改动点集中在 `packages/web/src/components/terminal/SessionView.tsx`

#### 1. 布局：把底部输入条从 flex 子节点改成绝对定位悬浮层

当前（v2 已落地）：
```tsx
<div className="absolute inset-0 flex flex-col bg-bg ...">
  <div>topbar</div>
  <div ref={termHostRef} className="flex-1 min-h-0 p-1" />
  <div className="flex items-center gap-2 px-3 h-10 border-t ...">
    <input ... />
  </div>
</div>
```

改为：
```tsx
<div className="absolute inset-0 flex flex-col bg-bg overflow-hidden ...">
  <div>topbar</div>
  <div className="relative flex-1 min-h-0 overflow-hidden">
    <div
      ref={termHostRef}
      className="absolute inset-0 p-1 pb-10 bg-[#1c1c1c] ..."
    />
    <div className="absolute bottom-0 left-0 right-0 h-10 flex items-center gap-2 px-3 border-t border-border/60 bg-white/[0.02] z-10">
      <input ref={inputRef} ... />
    </div>
  </div>
</div>
```

关键点：
- 外框加 `overflow-hidden` → 保证"视图永远不滚"。
- 新增 `relative flex-1 min-h-0 overflow-hidden` 中间包装 → 给 termHost 和 floating input 提供定位上下文。
- termHost 从 `flex-1` 改为 `absolute inset-0`，padding 从 `p-1` 改为 `p-1 pb-10`（底部留 40px 给浮动输入框）。
- 输入框容器从 flex 子节点改为 `absolute bottom-0 ... h-10 ... z-10`，彻底脱离 flex 链路。

#### 2. FitAddon 行数自动适配

`@xterm/addon-fit` 的 `fit()` 内部用 `getComputedStyle(host)` 减去 padding 计算 rows。
termHost `pb-10`（40px）会被自动扣除 → xterm 只占 termHost 可视区的上 `height - 44px`
（含 `p-1` 的 4px 上下各一份），正好不被浮动输入框覆盖。**不用手动改 fit 逻辑**。

#### 3. 吞字：输入框改为非受控

当前 `inputValue` state 的所有消费点：
- `<input value>` / `<input onChange>` 受控绑定 → **改成非受控**（只留 `ref`）。
- `onInputKey` Enter 发送 → 改读 `inputRef.current?.value ?? ''`，发完 `inputRef.current.value = ''`。
- 右键菜单 "添加到终端聊天" → 改成直接操作 DOM：
  ```ts
  const el = inputRef.current
  if (!el) return
  el.value = (el.value ? el.value + ' ' : '') + text
  el.focus()
  el.setSelectionRange(el.value.length, el.value.length)
  ```
- `inputValue` state 本身可以**整个删掉**（`const [inputValue, setInputValue]` 及其所有引用）。

吞字根因：受控模式下每个 keystroke → `setInputValue` → SessionView 整棵 re-render → React
重新把 `value` 属性 diff 回 `<input>`。IME composing 中这个 diff 会让浏览器认为合成态
被打断，丢字。非受控彻底断开这条链：打字过程零 React re-render。

IME 额外补一道：`onKeyDown` 里用 `e.nativeEvent.isComposing` 保护 Enter，避免候选中按 Enter 误发送：
```ts
function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.nativeEvent.isComposing) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    const el = e.currentTarget
    aimonWS.sendInput(session.id, el.value + '\r')
    el.value = ''
  }
}
```

#### 4. 输入溢出不产生外部滚动条

`<input>` 本身是单行、原生 overflow 不显示滚动条；但需要确认：
- 外框 `overflow-hidden` 已加 → 兜底。
- 输入框容器 `h-10` 固定 → IME 候选条是系统级浮窗，不会撑高容器。
- 不加任何 `overflow-x: auto`（否则会出滚动条）。

> **方案简洁性自检**（按 CLAUDE.md "外科改动"）：
> - 不引入 compositionstart/end 事件监听（用 `nativeEvent.isComposing` 足够）。
> - 不引入 useRef 新 hook（复用现有 `inputRef`）。
> - 不抽新组件、不改 store、不改 ws、不改 api。
> - 删代码多于加代码（`inputValue` state 整个删）。

## 边界情况

- **死会话页签**（`isDead`）：input `disabled`，非受控模式下 disabled 仍然生效；浮动容器 `h-10` 依然绝对定位，不会触发布局变化。
- **页签 active → inactive → active**：已有 `requestAnimationFrame` re-fit 逻辑 ([SessionView.tsx:318-329](packages/web/src/components/terminal/SessionView.tsx#L318-L329)) 保留不动。非受控模式下切页签不会清空输入内容（DOM value 不随 React 状态走），这是想要的行为。
- **ResizeObserver 回调**：v2 阈值（Δw ≥ 1px / Δh ≥ 4px）保留，作为双保险——虽然 flex 链路断了，但如果 termHost 父包装的尺寸真变了（splitter 拖动），该 fit 还会 fit。
- **窗口极窄 / 终端区高度 < 40px**：浮动输入框仍然覆盖 termHost 底部 40px，termHost 可视 rows = 0。xterm 会显示空白，这种尺寸整个 UI 本就不可用，不单独处理。
- **右键 "添加到终端聊天"** 当前用 `setInputValue((prev) => ...)`，改 DOM 直接写入后视觉效果等价；`queueMicrotask` 的 focus/setSelectionRange 逻辑不再需要包一层——但为保险先保留 `queueMicrotask` 包法，确保 React 本轮 render flush 后再操作 DOM。
- **PromptLibraryDialog.onSend**：它已经直接调 `aimonWS.sendInput`，根本不碰 input，无需改动。
- **自定义按钮**：同上，直接 `aimonWS.sendInput(session.id, cmd + '\r')`，不碰 input。

## 风险与注意

- **风险 1：非受控导致其它 React 逻辑拿不到最新 input 值。**
  现状逐点核查：只有 Enter 发送和右键追加用到，两处都直接读 DOM；PromptLibrary / 自定义按钮不走 input。结论：没有暗处依赖 state。
- **风险 2：删掉 `inputValue` state 后，useStore / 其它 hook 是否有订阅？**
  抓 "inputValue" grep 确认只在 SessionView 本文件出现（见 Context 阶段盘点）。
- **风险 3：`pb-10` 的 tailwind 值是否真的 40px。**
  tailwind 默认 `pb-10 = 2.5rem = 40px`，与 `h-10` 严格匹配，不会差一像素。
- **假设 1**：FitAddon 真的减 padding 算 rows。回顾其源码是 `elementStyle.getPropertyValue('padding-...')` 减掉 —— 成立。如果 Context 阶段读源码发现不成立，备用方案是给 termHost 套一层 `inset-0 bottom-[40px]` 的 inner div 做隔离。
- **假设 2**：`e.nativeEvent.isComposing` 在所有主流浏览器（Chromium/Edge/Firefox）可用 —— 可用，自 2018 年就是 Web 标准属性。
- **已知副作用：用户切到其它页签回来，输入框里残留上次没发的文本。**
  这是非受控的自然行为，实际上对用户友好（草稿不丢），保留。
- **v2 step 4 未 verify**：直接在 v3 里一并被新的验收标准覆盖，旧 tasks.md step 4 改为 `blocked`（原因：方案已升级到 v3，以新清单为准）。
