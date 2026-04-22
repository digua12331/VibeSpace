# 提示词库 · 计划

## 目标

给每个 SessionView 的顶部栏加一个 **📝 提示词** 按钮。点击弹出**提示词库对话框**：顶部搜索框、列表展示可用提示词（内置 + 用户自定义），每条右侧一个"发送"按钮 —— 点击后把对应 prompt 文本写进**当前 session 的 PTY stdin**，然后关闭对话框。

**定位差异**（跟已有的 `customButtons` 不重合）：
- `customButtons`（topbar 上常驻的彩色 chip）= 频繁触发的**短命令** / 固定按键（"清屏""回车"之类）
- `提示词库`（点开才弹的对话框）= 偶尔用的**长自然语言 prompt**（"审查这段代码的安全漏洞""为 X 写单元测试""把这段重构成更简洁的样子"）

### 验收标准

1. **场景 1（基本发送）**：在 Claude session 里点 📝 → 对话框出现 → 列表里 9+ 条内置 prompt 可见 → 点某条右边的"发送" → 终端输入端出现该 prompt 文本（不自动回车），对话框关闭
2. **场景 2（搜索）**：在对话框里打 "test" → 列表实时过滤到含 "test" / "测试" 的 prompt → 搜索框清空恢复全量
3. **场景 3（自定义）**：点"＋ 添加"弹一个编辑模态 → 填 `name` + `content` → 保存 → 列表里出现这条，刷新浏览器后仍在（localStorage 持久化）
4. **场景 4（编辑 / 删除自定义）**：自定义条目右侧 hover 出 ✎ / 🗑 → 编辑改名 / 删除；**内置条目不可编辑不可删**（只读标记）
5. **场景 5（键盘）**：对话框打开时 Esc 关闭；搜索框里回车提交列表**第一条**匹配的 prompt
6. **类型检查 + vite build 通过**

## 非目标（v1 不做）

- **项目独立的 prompt 集**：所有自定义 prompt 都是**全局**（跨项目共享），与 `customButtons` 的作用域一致
- **服务端存储 / 多机同步**：只用 localStorage，跨浏览器不同步
- **模板占位符**（`{filename}` `{selection}` 这种变量展开）：发就是整段原文本；用户需要的话自己在文本里写路径
- **按分类 / 标签分组**：v1 扁平列表，搜索就够
- **导入 / 导出 JSON**：未来要做，不在本轮
- **shell session 适配特殊格式**：shell 里发 prompt 没太大意义，但我们**仍允许**发（让用户自己决定）—— 不做专门的 shell 禁用
- **替换 `customButtons`**：两套机制共存

## 实施步骤

1. **新建 `web/src/prompts.ts`**：存储层 + 内置 prompt 常量
   - 10 条内置 prompt（代码审查、写测试、解释、重构、加错误处理、性能优化、文档化、找 bug、diff 解释、提交信息生成）
   - localStorage key `vibespace_user_prompts_v1`，存 `UserPrompt[]`（`{ id, name, content }`）
   - 读 / 写 / 订阅变更（模仿 `customButtons.ts`）
   - → verify: 单元风格验证 —— 浏览器 devtools 看 localStorage 值结构正确

2. **新建 `web/src/components/PromptLibraryDialog.tsx`**：对话框组件
   - Props: `{ open: boolean; onClose: () => void; onSend: (text: string) => void }`
   - UI: 顶部搜索框 + "＋ 添加" 按钮；中间滚动列表；列表每行显示 name + content 预览（最多 2 行 truncate）+ 右侧"发送"按钮；自定义条目 hover 出"✎""🗑"
   - 编辑态：列表切成一个 form（name input + content textarea + 保存 / 取消）
   - 搜索：子串匹配 name + content，不区分大小写
   - Esc 关闭；搜索框回车发送第一条
   - → verify: 手动点一遍场景 1-5

3. **改 `SessionView.tsx` 顶部栏**：加 📝 按钮 + 组件 mount
   - 按钮挂在现有 header 按钮区（跟重启 / 权限 / 关闭按钮一排）
   - 点击切换 `promptLibOpen` state
   - 点某条发送 → `aimonWS.sendInput(session.id, content)`（**不加 `\n`**，让用户检查后自己回车）
   - → verify: `tsc --noEmit` + 手动测

4. **类型检查 + 构建** → verify: `tsc --noEmit` 与 `vite build` 均绿

## 边界情况

- **超长 prompt**：目前 xterm 粘贴长文本没问题；`sendInput` 底层就是 WS 一帧 JSON，数万字符没问题
- **搜索命中 0 条**：显示"没有匹配的提示词"占位
- **没有自定义 prompt**：列表只显示内置；"＋ 添加"按钮仍在
- **localStorage 被禁 / 配额满**：静默失败，条目本轮显示但刷新后丢；不弹 alert（跟 `customButtons` 现有行为一致）
- **对话框打开时切换了 session tab**：对话框依附 `SessionView`（组件 unmount 时关掉）—— 切 tab 本质是 SessionView 隐藏不 unmount，对话框仍在但"发送"指向仍是原 session。可接受（用户能看到对话框说明他在这个 session 上下文里）
- **同一毫秒点两次发送**：组件里用 disabled flag 防抖（发一次后 `onClose`，不会二次触发）
- **内置 prompt 用户想改**：通过"＋ 添加"自己复制一条再改，不在内置上动手术（保证内置永远是已知状态）

## 风险与注意

- **跟 `customButtons` 定位区分**：在 plan 写清两套的分工，未来有人提"合并两套"时回看这个 plan
- **假设 1**：localStorage 可用（127.0.0.1 secure context，且我们其他功能 `customButtons` / `workbench_v3` 都在用）
- **假设 2**：内置 prompt 的内容**不国际化**（只中文为主，夹英文技术词）——跟当前产品定位一致
- **UI 位置假设**：SessionView header 当前已有若干按钮，再加一个不会挤爆（我会先 `Read` 确认 header 宽度余量）
- **不影响现有功能**：不改 `customButtons`、不改 PTY 协议、不动 store、不碰 sidebar
- **回滚成本**：低 —— 删组件 + 撤按钮 + 删 prompts.ts

## 决策点（需要你确认）

1. **存储位置**：只 localStorage 全局（不分项目、不上传 server）。OK 吗？
2. **内置 prompt 数量与粒度**：我会出 10 条常用的（见上），涵盖 review / test / refactor / explain / perf / doc / debug / commit-msg / diff / error-handling。觉得少可以多加；觉得太多可以砍
3. **发送后要不要 `\n`**（自动回车）**还是不加**（让用户检查再发）？我倾向**不加**，跟之前"发送到对话"的行为一致
4. **按钮位置**：SessionView 顶栏已有按钮区 —— 我倾向放在那里（跟 restart / 权限 一排）。或者你希望放在**每个 session tab 旁**（全局都能点）？
5. **自定义 prompt 可编辑、内置只读**：这个设计 OK 吗？还是你希望内置也能被用户覆盖（复杂度 +20%）

---

确认上述 5 点（回"都 ok"或改任意一条），我就进 Context 阶段。
