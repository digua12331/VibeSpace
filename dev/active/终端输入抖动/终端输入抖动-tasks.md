# 终端输入抖动 · 任务清单

## v2（已废弃，保留历史）

- [x] 步骤 1 改底部输入容器为固定高度 + input 不受 IME 行高影响 → verify: 读 SessionView.tsx 443-454 的 diff，外层 div 含 `h-10`，`<input>` 含 `h-full leading-none`；其它 className 不变
- [x] 步骤 2 ResizeObserver 加尺寸差值阈值（Δw ≥ 1px 或 Δh ≥ 4px 才 fit + sendResize） → verify: 读 SessionView.tsx 217-224 附近 diff，effect 闭包内有 prevW / prevH 缓存，回调内有阈值短路
- [x] 步骤 3 跑类型检查 → verify: `pnpm -C packages/web exec tsc -b` 退出码 0，无新增错误（已通过，无输出 = 0）
- [x] 步骤 4 用户在浏览器手测验收（IME 连续输入不抖、WS 无 resize 帧、splitter 拖拽仍正常） → verify: 由用户在 UI 中操作并回报；本步保留 todo 直到用户确认 (v2 方案已废弃；v3 另起清单覆盖)

## v3（浮动输入框 + 非受控 + overflow-hidden，当前在执行）

- [x] 步骤 5 布局改造：外层 flex 容器加 `overflow-hidden`；在 topbar 下方、input 上方新增中间 `relative flex-1 min-h-0 overflow-hidden` 包装层；termHost 从 `flex-1 min-h-0 bg-[#1c1c1c] p-1` 改为 `absolute top-0 left-0 right-0 bottom-10 p-1 bg-[#1c1c1c] ...`（保留 onContextMenu / ref / isDead 透明度）；底部输入栏容器从 flex 子节点改为 `absolute bottom-0 left-0 right-0 h-10 z-10 flex items-center gap-2 px-3 border-t border-border/60 bg-white/[0.02]` → verify: 读 diff，上述三层结构到位；`pnpm -C packages/web exec tsc -b` 退出码 0；运行 dev server 在浏览器观察：topbar 高度不变，终端区视觉上到离底 40px 处止步，底部浮动输入栏覆盖那 40px
- [x] 步骤 6 输入框改非受控 + 吞字修复：删除 `const [inputValue, setInputValue] = useState('')`（L179）；`onInputKey` 改为 `if (e.nativeEvent.isComposing) return;` 然后 `aimonWS.sendInput(session.id, e.currentTarget.value + '\r'); e.currentTarget.value = ''`；`<input>` 删 `value` / `onChange`，只留 `ref` / `onKeyDown` / `disabled` / `placeholder` / `className` / `onMouseDown`；右键菜单 "添加到终端聊天"（onContextMenu inline 闭包里）改为 `queueMicrotask` 中直接 `el.value = (el.value ? el.value + ' ' : '') + text` → verify: 读 diff，`inputValue` / `setInputValue` 在 SessionView.tsx 内 grep 结果为 0；`pnpm -C packages/web exec tsc -b` 退出码 0
- [ ] 步骤 7 跑类型检查（全量） → verify: `pnpm -C packages/web exec tsc -b` 退出码 0，无任何新增/残留错误 **[blocked: 2026-04-24 跑 tsc 发现 `DocsView.tsx:372` 预先的 TS2322 错误阻挡退出码 0；本次 SessionView.tsx 改动无新增 TS 错误；已追加到 dev/issues.md；等用户决定是顺手修 DocsView 还是独立开任务]**
- [ ] 步骤 8 用户在浏览器手测验收 → verify: 由用户操作并回报。必须全部通过才能勾：(a) 中文 IME 连打 50 字（如"你好世界这是一段测试文本"）逐字上屏不吞；(b) 粘贴 500+ 字符长文本到输入框，`#session-view-<id>` 不出滚动条；(c) DevTools Network WS 面板：纯打字过程**无 resize 帧**；(d) 拖主 splitter / 侧栏 splitter / 改窗口尺寸，xterm cols/rows 正确更新；(e) 右键选区 → "添加到终端聊天"：文本追加到输入框末尾 + 焦点落到末尾；(f) PromptLibrary、自定义按钮、Enter、Shift+Enter 语义不变
