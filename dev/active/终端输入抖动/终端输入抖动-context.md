# 终端输入抖动 · Context（v3）

## 关键文件（本次改动**只允许**碰这一份）

- `packages/web/src/components/terminal/SessionView.tsx`
  - **L179** `const [inputValue, setInputValue] = useState('')` → **整行删除**（非受控）。
  - **L372-378** `onInputKey` 函数：改成读 `e.currentTarget.value`，发完 `el.value = ''`；用 `e.nativeEvent.isComposing` 保护 IME 中的 Enter。
  - **L480-516** 中间结构（termHost 的 div + 底部输入栏 div）：拆成"relative wrapper + 绝对定位 termHost + 绝对定位浮动输入栏"三层，细节见下方"布局 diff 草图"。
  - **L488-514** `buildTerminalSelectionMenu` 的 "添加到终端聊天" 回调（在 onContextMenu 里的 inline 闭包，约 L492-502）：把 `setInputValue(...)` 改成直接写 `inputRef.current.value`，配合 `setSelectionRange`。
  - **L518-530** 底部输入容器 + `<input>`：改成 `absolute bottom-0 left-0 right-0 h-10 z-10 ...`；`<input>` 去掉 `value` / `onChange`，只留 `ref` + `onKeyDown` + `onCompositionStart/End` 不需要（用 `isComposing` 就够）。

**盘点确认**：`inputValue` / `setInputValue` 在整个 `packages/web/src` 只有两个地方：
- `SessionView.tsx` 自己（删光）
- `components/dialog/DialogHost.tsx:138/155/181/215/217`（独立对话框自己的 state，**不要动**，与终端无关）

不动 `EditorArea.tsx`、不动 `Workbench.tsx`、不动 `store`、`ws`、`api`、`customButtons`、`PromptLibraryDialog`。

## 布局 diff 草图

改之前（v2 当前状态）：
```tsx
<div className="absolute inset-0 flex flex-col bg-bg ...">         // 外框，flex 列
  <div className="...topbar py-1.5...">...</div>                    // 顶部按钮条
  <div ref={termHostRef} className="flex-1 min-h-0 bg-[#1c1c1c] p-1" />
  <div className="flex items-center gap-2 px-3 h-10 border-t ...">  // ← 就是这个 flex 子节点
    <span>{'>'}</span>
    <input value={inputValue} onChange={...} ... />
  </div>
</div>
```

改之后（v3）：
```tsx
<div className="absolute inset-0 flex flex-col bg-bg overflow-hidden ...">  // +overflow-hidden 兜底
  <div className="...topbar py-1.5...">...</div>                              // 不动
  <div className="relative flex-1 min-h-0 overflow-hidden">                   // 新增中间包装
    <div
      ref={termHostRef}
      className="absolute top-0 left-0 right-0 bottom-10 p-1 bg-[#1c1c1c] ..."
      onContextMenu={...}   // 原 onContextMenu 搬到这里
    />
    <div className="absolute bottom-0 left-0 right-0 h-10 flex items-center gap-2 px-3 border-t border-border/60 bg-white/[0.02] z-10">
      <span className="text-subtle text-xs">{'>'}</span>
      <input
        ref={inputRef}
        onKeyDown={onInputKey}
        disabled={isDead}
        placeholder={isDead ? '会话已结束' : 'type to send (Enter)'}
        className="flex-1 h-full leading-none bg-transparent text-sm font-mono placeholder:text-subtle disabled:opacity-50 outline-none"
        onMouseDown={() => setShowExitInfo(true)}
      />
    </div>
  </div>
</div>
```

## 决策记录

### D1：为什么 termHost 用 `bottom-10` 而不是 `pb-10`

读过 `@xterm/addon-fit` 的编译产物（`packages/web/node_modules/@xterm/addon-fit/lib/addon-fit.mjs` 第 17 行）：

```js
r = window.getComputedStyle(this._terminal.element.parentElement)
l = parseInt(r.getPropertyValue("height"))
// 然后减的是 this._terminal.element（xterm 自己创建的内部元素）的 padding
// 不是 parentElement（我们的 termHost）的 padding
```

**关键发现**：FitAddon 读的是 termHost 的 `computed height`，但只减 **xterm 内部元素**的 padding，**不减 termHost 自己的 padding**。

- 若用 `pb-10`：`computed(termHost).height` 在 `box-sizing: border-box` 下通常返回的是"外部高度减 padding"，但 CSSOM 规范允许返回 border-box，存在浏览器差异。用 `pb-10` 把"对不对"绑定在这个模糊点上，不安全。
- 若用 `absolute bottom-10`：termHost 的 box 物理上就比容器短 40px（定位算出来的），`computed height` = 容器高 - 40px，**与 padding 无关**，FitAddon 算出的 rows 正好是可视区行数，xterm 不会画到浮动输入框下面。

**选 `bottom-10` + `top-0 left-0 right-0`**。`p-1` 保留（termHost 自己的边距，给 xterm 元素留 4px 视觉呼吸；xterm 内部元素的 padding 是 0，FitAddon 在那一侧减 0，这 4px 不在 FitAddon 的视野里，但会在视觉上把 xterm canvas 向内缩一点——与当前一致）。

> 资深工程师会不会觉得过度设计？不会——多打 5 个字符（`bottom-10` vs `pb-10`），换来的是"不依赖 getComputedStyle padding 语义"的确定性。

### D2：为什么选非受控而不是"受控 + composition 屏蔽 setState"

两条路都能消掉 re-render 打断 IME：
- 备选 A（受控 + composing flag）：加 ref 标记 `composingRef.current`，`onChange` 中若 composing 就跳过 `setInputValue`，`compositionend` 后 `setInputValue(el.value)` 同步一次。
- 选用 B（非受控 + ref）：直接把 `inputValue` state 删光，Enter 时读 `el.value`，发完 `el.value = ''`。

A 需要 1 个 ref + 3 个事件监听 + 条件分支；B 直接减少一个 state，**代码变少**。且 B 根除 re-render（不只是 composing 期间屏蔽），连非 IME 场景下的每键 re-render 也一并消掉——对整个终端 UI 都是净正反馈。

资深工程师自检：**B 明显更简**。选 B。

### D3：`e.nativeEvent.isComposing` 保护 Enter 的边界

用户用中文 IME 输入，按空格选候选词时，浏览器会触发 `keydown` 事件其 `isComposing=true`（候选面板激活中）。若不屏蔽，Enter 在候选中会被当作"发送"，误触风险高。加一行 `if (e.nativeEvent.isComposing) return` 消除此类误发。已在 plan.md 中明确为副作用修复，不算本次新做功能。

### D4：`overflow-hidden` 加在哪几层

用户硬约束：整个 `#session-view-<id>` 不可出现滚动条。实际可能溢出的地方：
- **外层** `absolute inset-0 flex flex-col` → 加 `overflow-hidden`（最外层兜底）。
- **中间 relative 包装** → 加 `overflow-hidden`（防止 termHost / 浮动层因 position 算错位而溢出）。
- **termHost** 自身不加 `overflow-hidden`：xterm 有自己的 scroll buffer（鼠标滚轮滚终端历史），termHost 设 overflow-hidden 可能（理论上不会，但）与 xterm 的内部滚动冲突，保守不加。

两层足够；xterm 内部的滚动是 xterm 的责任，不是我们的。

### D5：右键 "添加到终端聊天" 的改写

当前（L492-502）：
```ts
setInputValue((prev) => (prev ? prev + ' ' + text : text))
queueMicrotask(() => {
  const el = inputRef.current
  if (!el) return
  el.focus()
  const len = el.value.length
  el.setSelectionRange(len, len)
})
```

改为（去掉 state，直接改 DOM；`queueMicrotask` 不再必需但保留以对齐原时序）：
```ts
queueMicrotask(() => {
  const el = inputRef.current
  if (!el) return
  el.value = (el.value ? el.value + ' ' : '') + text
  el.focus()
  el.setSelectionRange(el.value.length, el.value.length)
})
```

**为什么保留 queueMicrotask**：原代码在 React 事件回调里，保留微任务包裹可以确保上下文菜单关闭的 DOM 操作先完成，再操作 input。v3 删了受控 state，理论上可以直接同步做；但这点时序与本次治抖/治吞无关，**按外科改动原则不顺手调整**。

## 依赖与约束

- **`@xterm/addon-fit` 源码路径**：`packages/web/node_modules/@xterm/addon-fit/lib/addon-fit.mjs`。version 见 `packages/web/package.json`。FitAddon 行为上面已读清：只减 xterm 内部元素的 padding，不减 termHost 的 padding。**这是 D1 决策的事实依据**，不要再质疑。
- **`react-resizable-panels`**：主 splitter、侧栏 splitter 拖动，最终通过 DOM 改变 SessionView 父容器尺寸 → ResizeObserver 观察 termHost → Δw/Δh 超阈值 → fit → sendResize。v3 阈值沿用 v2 的（Δw ≥ 1px / Δh ≥ 4px）——**保留这段阈值逻辑**，本次不动。
- **`aimonWS.sendResize` / `sendInput` / `subscribe` / `requestReplay`**：全部保持原调用方式和参数，不改。
- **`PromptLibraryDialog.onSend`**：已经绕开 input 直接发，不受本次改动影响。
- **自定义按钮 `showInTopbar`**：同上，直接发，不动。
- **tsconfig 和类型检查**：`pnpm -C packages/web exec tsc -b` 退出码 0 即算 type 过。删 `inputValue` state 后，React `useState` import 是否还有其他使用？看 L167-168 有 `useState(false)` 两处（`showPerm`、`promptLibOpen`），`useState(true)` 有 `showExitInfo`，`useState(false)` 有 `confirmClose`，`useState<CustomButton[]>` 有 `customButtons`。**`useState` 仍然被多处用到**，不要顺手删 import。
- **Tailwind**：`bottom-10` = 2.5rem = 40px；`h-10` = 2.5rem = 40px。两者严格匹配，termHost 的 `bottom` 偏移正好接住浮动输入栏的顶部。
- **CLAUDE.md 工作流**：本任务有前端 UI 改动，验收标准里已含"浏览器内可观察"项（打 50 字不吞、无 resize 帧、容器无滚动条）——合规。

## 类型检查命令（执行阶段 verify 用）

```
pnpm -C packages/web exec tsc -b
```

## 旧 tasks 的处理

- v2 `终端输入抖动-tasks.md` step 4 原为 `- [ ]`。执行阶段开始前先把该行改成 `- [x]` 并在行尾加标注 `(v2 方案已废弃；v3 另起清单覆盖)`，同时 json 侧对应项改为 `done`——避免两版任务清单并列让面板混乱。
- v3 步骤将**追加**到 `终端输入抖动-tasks.md` 末尾（步骤 5 起），不覆盖历史。`终端输入抖动-tasks.json` 的 `steps` 数组同步追加。
