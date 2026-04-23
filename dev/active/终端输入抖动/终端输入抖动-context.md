# 终端输入抖动 · Context

## 关键文件（本次改动只允许碰这些）

- `packages/web/src/components/terminal/SessionView.tsx`
  - **L443-454** 底部输入容器 + `<input>`：把容器从内容驱动高度改成固定 `h-10`，给 `<input>` 加 `h-full leading-none`。
  - **L217-224** `ResizeObserver` 回调：加"上次尺寸 vs 本次尺寸"的差值阈值（Δw ≥ 1px 或 Δh ≥ 4px 才 fit + sendResize）。配套需要在 effect 闭包顶部新增两个 `let prevW = 0, prevH = 0` 缓存。
  - **L266-277** active 切换后的 re-fit：**保留**，与本方案不冲突（那次 fit 是 `display:visibility` 翻转后的必要修正，不走 ResizeObserver 路径）。

不动 `EditorArea.tsx`、不动 `Workbench.tsx`、不动 store / ws / api。

## 决策记录

### D1：为什么用"固定容器高度"而不是"加 IME 事件监听"

**两个方案都能解决问题，选简单的那个。**

- 备选 A（IME 事件）：在 input 上注册 `compositionstart` / `compositionend`，IME 期间 disconnect ResizeObserver。
- 选用 B（固定高度 + 阈值）：把根因（input 高度抖）直接消除，外加 ResizeObserver 阈值兜底。

A 需要 IME 事件 + ResizeObserver disconnect/reconnect 状态机，3 个 ref + 4 个事件监听。B 只改 className 和加 2 行阈值判断。**B 用代码量的零头解决同一个问题** —— 选 B。

> 资深工程师看到这个方案会不会觉得过度设计？
> 不会 —— 整个改动是一个 className 调整 + 一个 if 判断，没有新抽象、没有新 hook、没有新事件。

### D2：阈值 4px 的来由

xterm 一行高度 ≈ `fontSize × lineHeight ≈ 13 × 1.2 ≈ 16px`。
4px 远小于一行高度，不会让"少一行"的 splitter 拖动被吞；又远大于 IME 引起的 sub-pixel 抖（通常 < 1px）。
在两端都安全。不写成可配置项 —— 不做"以后可能用到"的灵活性。

### D3：为什么 Δw 用 1px 而不是 4px

xterm 列宽 ≈ `fontSize × 0.6 ≈ 7.8px`，比行高小一半。但更关键的是：**水平方向几乎没有 IME 抖动来源**，input 是 `flex-1` 横向铺满，IME 只影响纵向。1px 阈值已足够过滤浮点误差，又能精准响应横向拖拽。

### D4：固定 `h-10` 的视觉确认

当前底部输入栏实测高度 = `py-2 (8+8) + input 行高 (≈20)` ≈ **36px** ≈ Tailwind `h-9`（36px）。
顶部 button bar 用的是 `py-1.5` ≈ 30px。
拟选 `h-10`（40px）以**留 4px 余量**，避免 IME 在某些字号下溢出 `h-9` 引起 `overflow:hidden` 切割。
Context 阶段不重新跑 dev server 量像素，直接用经验值；执行阶段如果视觉上看着不对再降到 `h-9`。

## 依赖与约束

- **`@xterm/addon-fit`**：`fit.fit()` 内部会读 termHost 的 `clientWidth/clientHeight`，结果取整成 cols/rows。所以输入容器固定高度后，termHost.clientHeight 在打字时也固定 → fit 不再算出新值 → 即使我们误调一次 fit，cols/rows 也不会变 → sendResize 也不会变化。这是双重保险。
- **`react-resizable-panels`**：拖动 splitter 改变 panel 尺寸，最终通过 DOM 改变容器尺寸 → ResizeObserver 触发。我们的阈值不会吞掉这种变化（拖动单步通常 ≥ 一个像素到几十像素）。
- **后端 PTY (`aimonWS.sendResize`)**：现状是只要 ResizeObserver 触发就 send，频率高时会刷屏。改完之后 send 频率显著下降，与后端契约**完全兼容**（PTY 接收 SIGWINCH 是幂等的，少发不会造成问题）。
- **CLAUDE.md 工作流约束**：本任务涉及前端 UI，Plan 验收标准已包含"浏览器内可观察"项（IME 输入不抖、resize WS 帧 = 0）—— 满足前端硬性规则。

## 类型检查命令

`packages/web` 没有独立 `typecheck` 脚本，但 `build` 脚本是 `tsc -b && vite build`。
执行阶段的 verify 用：

```
pnpm -C packages/web build
```

如果只想跑类型检查不打包，可用：

```
pnpm -C packages/web exec tsc -b
```

二选一即可，本任务执行时用 `tsc -b` 更快。
