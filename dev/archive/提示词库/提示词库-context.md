# 提示词库 · 上下文

## 关键文件（执行阶段只动这些）

### 新建

- **`packages/web/src/prompts.ts`**
  - 导出 `BUILTIN_PROMPTS: Prompt[]`（10 条硬编码，`readonly`）
  - 导出 `UserPrompt` 类型 `{ id, name, content }`；`Prompt = BuiltinPrompt | UserPrompt`（带 `builtin: true` / `false` 区分）
  - `getUserPrompts()` / `setUserPrompts(list)`：读写 localStorage `vibespace_user_prompts_v1`
  - `addUserPrompt(input)` / `updateUserPrompt(id, input)` / `deleteUserPrompt(id)`：增改删
  - `onUserPromptsChange(listener)`：订阅变更（跨组件同步，参考 [`customButtons.ts#L167`](packages/web/src/customButtons.ts#L167)）
  - **内置 prompt 初稿**（中文为主，Claude-friendly）：
    1. 代码审查（找安全漏洞 / 性能问题 / 设计缺陷）
    2. 为 `@<path>` 写单元测试（覆盖边界情况）
    3. 解释这段代码：`@<path>`
    4. 重构：让代码更简洁但不改行为
    5. 加错误处理与参数校验
    6. 性能优化（分析瓶颈并给出方案）
    7. 补充文档 / JSDoc / 函数注释
    8. 找这段代码的 bug（列出可疑之处）
    9. 解释最近一次 git diff 做了什么
    10. 基于当前暂存变更生成 commit 信息（Conventional Commits）

- **`packages/web/src/components/PromptLibraryDialog.tsx`**
  - Props: `{ open: boolean; onClose: () => void; onSend: (text: string) => void }`
  - 布局：固定宽 `w-[520px] max-w-[90vw]` × 高 `max-h-[70vh]` 居中 modal，`fluent-acrylic` 风格，参考 [`NewProjectDialog.tsx`](packages/web/src/components/NewProjectDialog.tsx)
  - 顶部：搜索 input + "＋ 添加"按钮
  - 中间：列表 `overflow-auto`。每行：`name`（一行）+ `content`（2 行 truncate 预览）+ 右侧"发送"按钮；自定义条目 hover 出 ✎ 🗑
  - 编辑态（add / edit）：把列表换成 form（`<input name>` + `<textarea content>` + 保存 / 取消）。不单开第二个 modal，避免嵌套
  - Esc 关闭；搜索框 `Enter` 发送第一条命中；对话框外点击关闭
  - 删除走 [`confirmDialog(danger)`](packages/web/src/components/dialog/DialogHost.tsx)

### 修改

- **[`packages/web/src/components/terminal/SessionView.tsx`](packages/web/src/components/terminal/SessionView.tsx#L344-L360)**
  - 顶栏按钮区（⚙ 设置 左侧，或 ⚙ 设置 与 ⟳ 重启 之间，位置我选 **设置之后、重启之前**）加 📝 按钮
  - `const [promptLibOpen, setPromptLibOpen] = useState(false)`
  - 在组件末尾（`{showPerm && <PermissionsDrawer ... />}` 旁）挂 `<PromptLibraryDialog open={promptLibOpen} onClose={...} onSend={(text) => { aimonWS.sendInput(session.id, text); setPromptLibOpen(false) }} />`
  - 不加 `\n`（用户确认后自己回车）

### 已有可复用（不动，只引用）

- **[`packages/web/src/ws.ts#L108-L110`](packages/web/src/ws.ts#L108-L110)** — `aimonWS.sendInput(id, data)`
- **[`packages/web/src/components/dialog/DialogHost.tsx`](packages/web/src/components/dialog/DialogHost.tsx)** — `confirmDialog({ variant: 'danger' })` 用于删除确认
- **[`packages/web/src/customButtons.ts`](packages/web/src/customButtons.ts)** — 模板：localStorage JSON 序列化 + 订阅模式；prompts.ts 直接复刻这套结构
- `fluent-acrylic` / `rounded-win` / `shadow-dialog` / `animate-fluent-in` — 现有 CSS 类，统一风格

## 决策记录

每条都答过"资深工程师会不会觉得过度设计"——会的就砍。

1. **`prompts.ts` 独立模块（不塞进 `customButtons.ts` 或 `store.ts`）** —— 合理。两者功能不同（customButtons 是短命令按钮、prompt 是长文本库），塞一起会让 API 含糊。**不过度设计**。

2. **`Prompt` 用 discriminated union（`builtin: true` / `false`）而不是两个独立类型** —— 合理。列表渲染时要区分"可编辑 vs 只读"，用 discriminator 比 `instanceof` / 运行时判断更干净。**不过度设计**。

3. **不走 store，只用 localStorage + module-level pub/sub** —— 合理。Prompt 库跟 session / project 的 zustand state 没耦合，做成 store slice 是为了"某一天想让 perf 面板也显示 prompt 数"之类投机性需求。参考 `customButtons.ts` 现有做法。**不过度设计**。

4. **内置 prompt 硬编码在 .ts 里，不搞 JSON 配置文件** —— 合理。10 条固定内容，多一个 `fetch('/prompts.json')` 就是纯粹增加了解耦成本没带来价值。**不过度设计**。

5. **编辑态复用同一 modal 的内部切换（不新开 DialogHost 二级 modal）** —— 合理。嵌套 modal 在视觉和 escape 键处理上都会复杂化（Esc 关哪层？）。同 modal 内切状态简单直接。**不过度设计**。

6. **"删除"走 `confirmDialog` 二次确认** —— 合理。自定义 prompt 没备份，误删不可逆；二次确认成本 1 行代码。**不过度设计**。

7. **搜索框 Enter 发送第一条** —— 合理。快捷发送的自然语义；不这么做用户要移手到鼠标。**不过度设计**。

8. **"＋ 添加 / 保存 / 取消" 文案而不是 i18n 框架** —— 合理。整个产品 UI 文案都是中文硬编码，现在上 i18n 就是背离当前产品定位。**不过度设计**。

9. **按钮位置"⚙ 设置"之后、"⟳ 重启"之前** —— 按使用频率分档：设置（少用）→ 📝 提示词（中等）→ 重启（偶尔）→ 关闭（最右危险操作）。符合直觉。

10. **shell session 也显示 📝 按钮**（非禁用）—— 合理。用户偶尔可能想发个"帮我 grep 一下 xxx"之类给某个命令行工具。限制使用者没必要。

## 依赖与约束

- **无新增 npm 依赖**。纯内置 React + localStorage API
- **localStorage key**：`vibespace_user_prompts_v1`。"v1" 前缀留出以后 schema 迁移空间；当前不打算做迁移逻辑，结构变了就重置（跟 `aimon_workbench_v3` 同策略）
- **localStorage 容量**：假设用户自定义 prompt ≤ 50 条、每条 ≤ 10KB，总量 ~500KB，远低于浏览器 5MB 限额
- **订阅模式线程安全**：listener Set + loop fire，跟 `customButtons.ts` 一致；没有异步边界
- **不影响现有功能**：不碰 `customButtons` / PTY 协议 / store / sidebar / SCM
- **回滚成本**：低 —— 删 2 个新文件 + 撤 SessionView 的 3 处改动（import / 按钮 / mount）

## 非目标（复述 —— 执行阶段对照）

- 项目独立 prompt 集（全部全局）
- 服务端存储 / 跨机同步
- `{filename}` 等模板变量展开
- 分类 / 标签
- 导入 / 导出 JSON
- 内置 prompt 被用户覆盖（想改就"＋ 添加"复制一条）
- 替换 `customButtons`（两套共存）

---

确认无误（回一句）就进 Tasks 阶段开写。
