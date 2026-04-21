# Dev Docs 工作流

本项目启用了 **Dev Docs 三段式工作流**。当用户提出一个**新功能、重构、bug 修复或任何非平凡的改动**时，你 **不要立刻改代码**，按以下流程推进：

## 1. Plan 阶段 — 先规划

1. 从用户描述里提炼一个简短的 **任务名**（允许中文；禁止含 `/ \ : * ? " < > |`）。如果不确定就先问用户。
2. 创建目录 `dev/active/<任务名>/`（若不存在）。
3. 写入 `dev/active/<任务名>/<任务名>-plan.md`，内容包含：
   - **目标**：这个任务要解决什么问题、验收标准。
   - **实施步骤**：有序列表，粗粒度即可。
   - **风险与注意**：已知的坑、需要确认的假设。
4. **停下**，把 plan 呈给用户看，等 **用户确认或提出修改**。不要进入下一阶段。

## 2. Context 阶段 — 上下文盘点

用户确认 plan 后，写入 `dev/active/<任务名>/<任务名>-context.md`，内容包含：

- **关键文件**：会读/会改的文件清单，尽量附上相关符号或行号范围。
- **决策记录**：为什么选 A 不选 B，权衡是什么。
- **依赖与约束**：上游 API、数据结构、兼容性要求。

写完同样 **停下**，等用户再次确认 context 无误。

## 3. Tasks 阶段 — 清单 + 执行

用户确认 context 后，写入 `dev/active/<任务名>/<任务名>-tasks.md`：

```markdown
# <任务名> · 任务清单

- [ ] 步骤 1
- [ ] 步骤 2
- [ ] 步骤 3
```

然后 **开始执行**。执行规则：

- 每完成一个步骤，**立即** 把对应行从 `- [ ]` 改成 `- [x]`，再做下一步；不要批量勾。
- 过程中若发现 plan 或 context 有遗漏，**先更新对应 md 文件**，再继续。
- 若途中发现 tasks 需要拆分或新增，随时修改 `tasks.md`。

## 规则与边界

- `tasks.md` 由你 (AI) 独占维护，人类只读，不要等用户手动勾选。
- `plan.md` 和 `context.md` 两边都可改；用户若手动编辑了，以他们的版本为准。
- 任务完成（所有 `- [ ]` → `- [x]`）后 **不要自动归档**，等用户在 UI 的「Dev Docs」侧栏里点归档。
- 若用户在对话里明确说"小改动"/"就一行"/"按你想法做"，可以 **合并 plan+context 为一次输出**（两个文件都写，但合并一轮确认），再进入 tasks 阶段。**不能跳过写文件**。
- 琐碎到连任务都不构成的请求（格式化、改一个 typo、答疑），可以绕过本流程直接做。

## 上下文耗尽的衔接

如果你感觉上下文窗口快满：

1. 把当前进度和下一步明确写入 `tasks.md`（未完成的项 `- [ ]` 加备注说明卡在哪）和 `context.md`（新决策、新发现的文件）。
2. 告诉用户"上下文接近上限，请开新会话只说『继续 <任务名>』，我会读完三个 md 无缝接上。"
3. 新会话里，用户只需说 `继续 <任务名>`，你就先读 `dev/active/<任务名>/` 下三个 md，再继续。

## 开始一个新任务的首个动作

收到需求后，第一步 **不是读代码**，而是：

1. 心里过一遍上面的流程。
2. 告诉用户你将以任务名 `<xxx>` 启动 Plan 阶段。
3. 然后去读代码、写 plan.md。

---

# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
