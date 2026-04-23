# Issues

记录在做主线任务时顺手发现的、跟当前任务无关的可疑问题。每条单行，按 `- [ ] / - [x]` 状态管理。

- [ ] 中文 IME composition 进行中按 Enter 会立即上屏并发送给 AI，导致中文打到一半就被误发（文件 packages/web/src/components/terminal/SessionView.tsx:320-326；上下文：onInputKey 仅判断 e.key === 'Enter'，未检查 e.nativeEvent.isComposing）
- [ ] migrate() 里 syncProjectsTable 每次都 DELETE FROM projects 触发 sessions 表 ON DELETE CASCADE 清空，导致 tsx-watch 重载一次就丢掉所有 sessions 行（文件 packages/server/src/db.ts:79-88；上下文：projects.json 存在时每次 migrate 都执行一次，stable 用 dist 不命中、dev tsx watch 命中。建议改成 UPSERT 避免级联）
