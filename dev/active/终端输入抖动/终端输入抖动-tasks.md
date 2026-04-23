# 终端输入抖动 · 任务清单

- [x] 步骤 1 改底部输入容器为固定高度 + input 不受 IME 行高影响 → verify: 读 SessionView.tsx 443-454 的 diff，外层 div 含 `h-10`，`<input>` 含 `h-full leading-none`；其它 className 不变
- [x] 步骤 2 ResizeObserver 加尺寸差值阈值（Δw ≥ 1px 或 Δh ≥ 4px 才 fit + sendResize） → verify: 读 SessionView.tsx 217-224 附近 diff，effect 闭包内有 prevW / prevH 缓存，回调内有阈值短路
- [x] 步骤 3 跑类型检查 → verify: `pnpm -C packages/web exec tsc -b` 退出码 0，无新增错误（已通过，无输出 = 0）
- [ ] 步骤 4 用户在浏览器手测验收（IME 连续输入不抖、WS 无 resize 帧、splitter 拖拽仍正常） → verify: 由用户在 UI 中操作并回报；本步保留 todo 直到用户确认
