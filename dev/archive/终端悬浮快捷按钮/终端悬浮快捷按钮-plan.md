# 终端悬浮快捷按钮 · Plan

## 大哥摘要

现在每个终端**右上角**有一排小按钮（🧹 清除、🕘 历史对话、还有你自己加的那些），点了就往终端里送一条命令。这次把它们**搬家**到下面那个白色悬浮输入框（你打字的那个框）的**正上方**，紧贴着输入框，鼠标抬手就能点。

加新按钮的入口**保持不变**：右上角 ⚙ 设置（PermissionsDrawer，"权限/按钮"抽屉）里的"🎛 按钮"tab，新增 / 编辑 / 勾选"显示"——勾上后就出现在输入框上方那一行。设置抽屉里的复选框文案会从"在顶栏显示"改成"在输入框上方显示"（只换文字，行为不变）。

你不会丢任何已有按钮：已经勾上的按钮直接搬过去，没勾上的继续躺在抽屉里。项目数据、会话历史、终端内容完全不动。

**验收一句话**：打开任意一个终端 → 顶栏不再有 🧹 清除 / 🕘 历史对话 → 输入框正上方多了一行常驻按钮，点一下命令就发出去（和原来一样的效果）。

## 目标

- 把所有 `showInTopbar=true` 的 customButtons 从 SessionView **顶栏**剪掉，迁移到悬浮输入框正上方一行渲染
- 维持点击行为不变（`aimonWS.sendInput` + `pushLog(scope:'session', 'quick-button 发送 ...')` 日志）
- 顶栏保留：状态徽章 / agent 名 / ⚙ 设置 / 📝 提示词 / ⟳ 重启 / ✕ 关闭
- PermissionsDrawer ButtonsTab 复选框文案改为"在输入框上方显示"（仅文案变更；**字段 `showInTopbar` 语义反转但名字不动**，避免数据迁移）

### 验收标准（浏览器可观察）

1. 启动 dev server，打开任意 Claude/Codex/Gemini/shell 终端，**顶栏右侧不再有 🧹 清除 / 🕘 历史对话按钮**
2. **悬浮输入框正上方**多了一行按钮，含 🧹 清除 / 🕘 历史对话（默认两个），紧贴输入框上沿
3. 点击 🧹 清除 → claude/codex/gemini agent 收到 `/clear`；shell/cmd/pwsh agent 收到 `clear`/`cls`/`clear`（行为与原顶栏按钮一致）
4. LogsView 看到一条 `scope=session level=info msg=quick-button 发送 🧹 清除` 日志（日志路径不变）
5. 进入 ⚙ 设置 → 🎛 按钮 tab：新增一个按钮（如"提交"，命令 `/commit`），勾选"在输入框上方显示"，关掉抽屉 → 输入框上方那行立刻多出"提交"按钮
6. 在按钮 tab 取消某按钮的"在输入框上方显示"勾选 → 输入框上方立即移除该按钮
7. **会话已结束（isDead）时**：按钮行隐藏（和原顶栏按钮的隐藏规则一致）
8. **0 个按钮显示时**：按钮行不渲染（不留空白）
9. **窄屏 / 按钮过多**：按钮行横向滚动可见，不换行、不挤压 xterm 高度
10. 刷新页面 → 按钮位置/数量/勾选状态不变（localStorage 持久化路径不变）

## 非目标

- **不改 customButtons schema**：`showInTopbar` 字段名保留，仅其在 ButtonsTab 的复选框 label 文案换成"在输入框上方显示"。避免 localStorage 数据迁移风险
- **不引入第二套放置位**（不新增 `showAboveInput` 字段、不让用户分别勾选"顶栏"和"输入框上方"）。当前需求是搬家不是叠加
- **不新增展开/折叠箭头**。用户原话"点击设置"指的就是现有的顶栏 ⚙ 按钮（PermissionsDrawer）。按钮行常驻显示（按勾选过滤），无展开/折叠状态
- 不动 xterm 内部生命周期 / 不动 IME 输入 / 不动 InputMenu（斜杠/@ 候选） / 不动按钮点击行为
- 不动 PermissionsDrawer 的其他 tab（权限 / Claude / Codex 等）

## 实施步骤

### 1. SessionView 顶栏剪掉 customButtons 渲染块

文件：`packages/web/src/components/terminal/SessionView.tsx:1162-1199`

剪掉 `customButtons.filter(b => b.showInTopbar).map(...)` 这整段（约 30 行）。顶栏 `<div className="flex items-center gap-1">` 内只剩 ⚙ 设置 / 📝 提示词 / ⟳ 重启 / ✕ 关闭（以及 isDead 分支不变）。

**verify**：浏览器顶栏右侧只剩系统按钮；TypeScript build 通过

### 2. 在悬浮输入框上方新增按钮行 `<div>`

文件：`packages/web/src/components/terminal/SessionView.tsx`

在现有 `inputBarRef` 的悬浮输入框 `<div>`（line 1301）**之前**插入按钮行：

```tsx
{!isDead && (
  <div
    className="absolute bottom-[76px] left-3 right-3 z-10 flex items-center gap-1 overflow-x-auto whitespace-nowrap pb-1"
  >
    {customButtons
      .filter((b) => b.showInTopbar)
      .map((b) => { /* 与原顶栏 map 完全相同的按钮 JSX，含 onClick / pushLog / className */ })}
  </div>
)}
```

布局确定值（关键，避免与 xterm 重叠）：
- xterm 区当前 `bottom: 72`（line 1297）→ 改为 `bottom: 112`（按钮行 32 高 + gap 8）
- 输入框（line 1303）`bottom-[32px]` **不变**
- 按钮行：`bottom-[76px]`（= 32 输入框底偏移 + ~36 输入框最小高 + 8 gap = 76）
- z-index：按钮行 `z-10`，与输入框同层（输入框已是 `z-10`）

**verify**：浏览器看按钮行紧贴输入框上沿；xterm 内容向上推 40px 不被遮挡

### 3. 按钮行的视觉/交互细节

- 单按钮 className 沿用 `BUTTON_COLOR_CLASSES[b.color]` + `fluent-btn px-2 py-0.5 text-xs rounded border disabled:opacity-50`
- 按钮文字过长 → 单按钮加 `max-w-[180px] truncate`
- `overflow-x-auto + whitespace-nowrap` 让多按钮横向滚动；窗口很窄时不撑破布局
- 0 按钮（`filter(...).length === 0`）→ 整个 `<div>` 不渲染（避免空白条占位）
- isDead → 整个按钮行不渲染（一致于现有顶栏行为）

**verify**：手动添加 8 个按钮 + 窄窗口（700px）→ 横向能滚；删光所有按钮 → 输入框上方无残留空白

### 4. PermissionsDrawer ButtonsTab 文案微调

文件：`packages/web/src/components/PermissionsDrawer.tsx`（line 922-928 附近）

把 `showInTopbar` 复选框的 label 文案从"在顶栏显示"（或类似）改成"在输入框上方显示"。**字段名 `showInTopbar` 不动**——保留意图，把 label 文案翻译过来。

ButtonsTab 顶部说明文字（line 822 附近："自定义会显示在每个终端顶部栏上的快捷按钮"）也对应改成"自定义会显示在输入框上方的快捷按钮"。

**verify**：抽屉 → 按钮 tab → 复选框 label 是新文案；说明文字也对齐

### 5. 类型检查 + 浏览器自测 + tester agent 验收

- `pnpm -F @aimon/web build`（前端类型检查 + 构建）
- AI 自己派 `vibespace-browser-tester` 跑上面 10 条浏览器验收，有问题再回来修
- handoff 时附 `git diff --name-only HEAD` 真实输出

## 边界情况

- **0 按钮**：按钮行不渲染（不要渲染一个空 `<div>`，否则 80px 高度空白）
- **isDead 会话**：按钮行隐藏（语义：会话结束后没有 PTY 可发命令；同时避免 disabled 按钮压住输入框上方）
- **按钮文字超长**：单按钮 `max-w-[180px] truncate`
- **按钮个数 >10**：横向滚动，不换行（换行会动态撑破 xterm 高度，体验更差）
- **窄屏（< 700px 终端宽）**：左右 padding `left-3 right-3` 保留，按钮区裁短，横向滚条出现
- **subagent runs 行同时显示**：subagent runs 在顶部 banner（SessionView line 1212），不占底部，不冲突
- **多 tab/多终端**：customButtons 通过 `onCustomButtonsChange` 订阅（已有），新增/删除按钮跨终端立即同步（行为不变）
- **localStorage 旧值**：`showInTopbar` 字段含义反转但名字保留，旧数据无需迁移，已勾选的按钮直接出现在新位置

## 风险与注意

- **R1（高）**：xterm 底边必须从 72 → 112 同步上调，否则 xterm 内容被按钮行盖住。布局值已锁死在实施步骤 2
- **R2（中）**：SessionView 是强耦合区域（auto.md 多条记忆警告），改动只动渲染层（JSX），**不动 useEffect / xterm 初始化 / 输入键盘处理器**
- **R3（低）**：字段 `showInTopbar` 在代码里语义反转（从"顶栏"变成"输入框上方"），未来读这段代码的人可能误解。**已接受**——比加新字段 + 数据迁移简单得多。在 `customButtons.ts` 字段注释加一行"实际指：是否在输入框上方显示"
- **R4（低）**：Codex 评审提到"用户原话『点击设置』是否需要新增折叠箭头"——经我重读原话，"设置"就是顶栏 ⚙（PermissionsDrawer），不需要新增折叠按钮。已写进非目标
- **备选方案**（若大哥不喜欢搬家）：保留顶栏按钮 + 新增独立"输入框上方按钮"位（schema 加字段 `showAboveInput`、ButtonsTab 加第二组勾选）。改动范围大约 +30%，但顶栏视觉不动

## 多模型 Plan 会审

> [Codex 评审] "推荐方案最简：复用 `showInTopbar` 标志，只改渲染位置 + ButtonsTab 文案，不动 schema、不做数据迁移、localStorage 旧值直接生效。"
>
> [Codex 评审] "HIGH RISK：新行若放在 `bottom: 76px`，与 xterm 底边 `bottom:72px` 只差 4px，极易被 xterm 内容遮挡——必须把 xterm 区的 `bottom` 同步上调。"
>
> [Codex 评审] "新增的'设置/展开'gear 按钮位于输入框附近，视觉上与顶栏 ⚙ 极易混淆——plan 应明确两者的关系。"
>
> [Codex 评审] "按钮行的展开/折叠应为纯本地 UI state，不需要 logAction 起止配对——可豁免日志埋点。"
>
> [Gemini 评审] 跳过：`spawn gemini ENOENT`（本机 gemini CLI 未安装）。按 CLAUDE.md 规则失败不阻塞，由 Claude 自己承担"找漏点"职责。
>
> [Claude 综合 + 白话化] 采纳 Codex 推荐：搬家方案（不改 schema），布局值锁死 xterm `bottom: 112` / 按钮行 `bottom: 76` / 输入框 `bottom: 32`；明确"点击设置"指现有顶栏 ⚙，**不引入新折叠按钮**；按钮行展开/折叠状态不存在（常驻显示）。备选方案保留在风险段供大哥反向选择。
