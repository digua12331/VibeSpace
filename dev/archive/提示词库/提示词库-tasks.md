# 提示词库 · 任务清单

> 仅由 AI 维护。每完成一步立即把 `- [ ]` 改成 `- [x]`。

- [x] 1. 新建 `web/src/prompts.ts`：10 条 `BUILTIN_PROMPTS` + discriminated union `Prompt` + CRUD + 订阅 + `listAllPrompts()` → verify: `tsc --noEmit` 通过
- [x] 2. 新建 `web/src/components/PromptLibraryDialog.tsx`：搜索 + 列表 + 发送按钮；"＋ 添加"按钮切到内嵌表单态；自定义条目 hover 出 ✎/🗑；删除走 `confirmDialog(danger)`；Esc / 外部点击关闭；搜索框 Enter 发送第一条 → verify: `tsc --noEmit` 通过
- [x] 3. 改 `SessionView.tsx` 顶栏：`⚙ 设置` 与 `⟳ 重启` 之间插 📝 按钮；加 `promptLibOpen` state；组件尾部挂 `<PromptLibraryDialog>`，`onSend` 走 `aimonWS.sendInput(session.id, text)`（不加 `\n`）+ 自动关闭 → verify: `tsc --noEmit` 通过
- [x] 4. 前端 `npx tsc --noEmit` 通过
- [x] 5. 前端 `npx vite build` 通过
