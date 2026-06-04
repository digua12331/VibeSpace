# HTML预览页签 · 任务清单

- [x] 1. 抽离 `dispatchClaude` 到 `packages/web/src/utils/dispatchClaude.ts`，DocsView 改用 → verify: `pnpm -C packages/web exec tsc -b` 通过；肉眼 diff：DocsView 除 import + 删本地函数 + 两处调用改成 options 对象外无其它改动
- [x] 2. 新建 `packages/web/src/components/htmlPreviewPicker.ts`，导出 `HTML_PREVIEW_PICKER_SCRIPT` 模板字符串（hover outline + capture-phase click + computeSelector + postMessage） → verify: 写完后用到步骤 3/5，本步骤单测不做，typecheck 通过即可
- [x] 3. 新建 `packages/web/src/components/HtmlPreview.tsx`：iframe sandbox + srcdoc 注入 + 父侧 message 监听 + 内嵌对话框骨架（字段 + 按钮，暂不接派单）→ verify: `tsc -b` 通过；组件单独渲染不报错
- [x] 4. 改 `FilePreview.tsx` 加 `isHtmlPath` 判定 + preview 分支走 HtmlPreview；html 默认 tab 仍为 source → verify: `tsc -b` 通过（✓）；浏览器验证留给 Step 7 端到端一起做
- [x] 5. 对话框接入派单逻辑 + 操作日志埋点 → verify: 代码已在 HtmlPreview 内；`tsc -b` 通过（✓）；浏览器日志配对留给 Step 7 一起验
- [ ] 6. 人工触发一次派单失败（比如 devtools 里把 `navigator.clipboard.writeText` monkey-patch 成 reject + 禁网新建 session；或选"直发"到一个刚被关掉的 session，会命中"目标终端已不存在或已停止"抛错）→ verify: LogsView 看到 `dispatch-modification 失败` ERROR 条目 [需你在浏览器里跑]
- [ ] 7. 最终 `pnpm -C packages/web exec tsc -b` + 浏览器走一次完整流程（打开 html → Preview → 选元素 → 新建终端派单 / 直发活跃终端派单）+ 写 handoff 摘要 → verify: typecheck 0 error（✓）；两条分支都能把 prompt 送达终端 [需你在浏览器里跑]
