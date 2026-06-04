# 浮动输入框命令增强 · Plan

> 本任务建立在 `终端输入抖动` v3 之上（浮动输入框 + 非受控 + 粘贴图片已落地）。
> 目标：把浮动输入框打造成比 xterm 直接输入**更好用**的命令入口，替换旧的
> "顶部按钮直发 / 提示词直发 / xterm 原生输入"三条分岔路径，统一走输入框。

## 记忆扫描

`dev/memory/auto.md` 仅一条 hook-smoke 冒烟遗留，`dev/memory/manual.md` 空。**无相关条目**。

## 目标

用户在浮动输入框里能做到以下四件事，统一体验：

1. **打 `/` 弹斜杠命令菜单**（claude/codex/gemini 等 AI agent 各自的命令硬编码表；shell 类不触发）
2. **打 `@` 弹项目文件引用菜单**（调后端 `api.listProjectFiles` 一次拉全量，前端子串匹配）
3. **顶部"📝 提示词"选中 → 填入输入框**（当前是直发，改为填入 + focus，用户可编辑再 Enter）
4. **顶部自定义按钮点击 → 填入输入框**（当前是 `aimonWS.sendInput(cmd + '\r')` 直发，改为填入 + focus）

## 可验证的验收标准（必须能在浏览器里看到）

在一个活着的 claude session 浮动输入框里：

1. **斜杠命令**：
   - 光标在输入框开头，打 `/` → 下拉菜单出现，含 `/clear /login /logout /help /model /cost /compact /permissions /init /hooks /mcp /config /release-notes`（至少 claude 这 13 条）
   - ↑↓ 箭头键导航，Enter 或 Tab 选中，Esc 关闭，鼠标点击也能选
   - 选中 `/clear` → 输入框内出现文本 `/clear`，光标落在末尾，菜单关
   - 再按 Enter → 正常发送到 PTY
   - **IME composing 中打 `/` 不触发菜单**（避免日文/中文输入法中斜杠冲突）
   - 非开头位置（如 `abc/def` 的第二个斜杠）**不触发菜单**
   - codex session：菜单内容是 codex 自己的命令；shell/cmd/pwsh session：不触发菜单
2. **@ 文件引用**：
   - 光标在输入框空位置，打 `@` → 下拉菜单出现，列出项目全部文件（≤ 30 条可见，其余滚动）
   - 继续打字如 `@session` → 菜单即时过滤（子串匹配）
   - ↑↓ 导航、Enter/Tab 选中、Esc 关
   - 选中 `packages/web/src/components/terminal/SessionView.tsx` → 输入框里 `@` 被替换成 `formatForSession(agent, path, 'file')` 的结果（AI agent: `@packages/web/src/components/terminal/SessionView.tsx `；shell: `"packages/web/src/components/terminal/SessionView.tsx" `）
   - 光标落在插入的路径之后，菜单关
3. **提示词库**：
   - 点顶部 📝 提示词 → 对话框弹出，选一条 → 对话框关 + 输入框被填入 prompt 内容（覆盖原内容）+ 光标落在末尾 + 输入框获得焦点
   - **不自动发送**，用户按 Enter 才发
4. **自定义按钮统一插入**：
   - 点顶部任一自定义按钮 → 对应命令文本出现在输入框（替换原内容），光标末尾，不发送
   - Enter 才发
5. **菜单不跟 xterm 抢焦点**：popup 开着时按任何方向键都不会让 xterm 滚动历史
6. **类型检查**：`pnpm -C packages/web exec tsc -b` 无新增 TS 错误（DocsView 预先错误不算）

## 非目标 (Non-Goals)

- **不做 fuzzy 搜索**（只子串匹配）—— 大项目性能优化留到出问题再做
- **不做命令 usage/描述** 的 tooltip —— 只列命令名
- **不做自定义斜杠命令** —— 硬编码列表，将来若有需求再出独立任务
- **不改 xterm 直接输入的行为** —— 焦点在 xterm 里时一切照旧（Ctrl+V 粘贴图片路径也不变）
- **不改 WS 协议 / 后端 API**
- **不加"按钮改插入后"的回滚开关**（如 Shift+Click 直发）—— 保持一条路径；若用户要再加
- **不做命令收藏 / 历史命令** 上下键浏览上次输入
- **不做 @ 引用预览（hover 显示文件内容）**

## 实施方案

### 新增文件

1. `packages/web/src/components/terminal/InputMenu.tsx`  
   —— 通用下拉菜单组件，斜杠命令和 `@` 文件引用**共用**（避免做两个差不多的 popup）
   - Props: `open`, `items`, `selectedIndex`, `onSelect`, `onClose`, `anchorRect`
   - 键盘交互由外部 input 的 `onKeyDown` 统一转发进来，**菜单自己不装 listener**（简单，避免焦点冲突）
   - 定位：`position: fixed`，`bottom: viewport.h - anchorRect.top + 4px`（弹在输入框正上方）

2. `packages/web/src/components/terminal/slashCommands.ts`  
   —— 每 agent 的斜杠命令硬编码表。**最终版**（由用户 /help 截图 + 高置信训练数据提供；来源见注释）：
   ```ts
   export const SLASH_COMMANDS: Record<AgentKind, readonly string[]> = {
     // 4 条来自 Claude Code /help general 截图，其余为通用高置信命令
     claude: [
       '/help', '/clear', '/model', '/compact', '/cost', '/init',
       '/config', '/permissions', '/hooks', '/mcp',
       '/powerup', '/keybindings', '/feedback', '/btw',
     ],
     // 用户未提供，暂以高置信公共命令兜底，后续由 issues 迭代
     codex: ['/help', '/clear', '/model'],
     // 37 条顶级命令完整取自用户 /help 截图
     gemini: [
       '/about', '/agents', '/auth', '/bug', '/chat', '/clear',
       '/commands', '/compress', '/copy', '/docs', '/directory', '/editor',
       '/extensions', '/help', '/footer', '/shortcuts', '/hooks', '/rewind',
       '/ide', '/init', '/mcp', '/memory', '/model', '/permissions',
       '/plan', '/policies', '/privacy', '/quit', '/resume', '/stats',
       '/theme', '/tools', '/skills', '/settings', '/tasks', '/vim',
       '/setup-github', '/terminal-setup',
     ],
     // 其它 AI agent 暂无可靠命令来源，留空让 popup 不触发
     opencode: [], qoder: [], kilo: [],
     // shell 类：/ 是路径分隔符，不触发菜单
     shell: [], cmd: [], pwsh: [],
   }
   ```
   **注**：codex 列表后续拿到 `/help` 截图再补，issues.md 追加一条追踪。

### 改动的现有文件

**`packages/web/src/components/terminal/SessionView.tsx`**（**本任务唯一要改的现有文件**）

**核心：加一个 `menu` state 统一管两个 popup 的显示**
```ts
type MenuState =
  | { kind: 'none' }
  | { kind: 'slash', filter: string, selected: number }
  | { kind: 'mention', filter: string, selected: number, files: string[] }
const [menu, setMenu] = useState<MenuState>({ kind: 'none' })
```

因为我们是**非受控** input，不能 watch `inputValue` 变化触发 menu；改为在 input 的 `onKeyUp` 里读 `el.value` + 光标位置，判断：

```
const v = el.value
const cursor = el.selectionStart ?? v.length
// 找光标左侧最近的触发字符
// slash: 光标前一个字符是 '/' 且其前一个是空格或 cursor=1
// mention: 光标前寻找最近的 '@'，且 '@' 前是空格或位置 0
```

触发后设置 `menu` state，菜单通过 portal 渲染在 input 上方。

**键盘交互统一在 `onInputKey`（已有函数）里加分支**：
- `menu.kind !== 'none'` 时：`↑/↓` 改 selected，`Enter/Tab` 选中插入，`Esc` 关菜单，其他键（字母/删除）正常输入，输入后 `onKeyUp` 会重新计算 menu 状态和 filter
- `menu.kind === 'none'` 时：走原有 Enter 发送逻辑

**选中插入的实现**：拿当前触发字符（`/` 或 `@`）的位置，把从触发字符到光标的子串替换成选中项：
```
// for slash: replace "/xxx" → "/clear"
// for mention: replace "@xx" → `@path/to/file `
el.value = v.slice(0, triggerPos) + replacement + v.slice(cursor)
```

**提示词接入**：
```ts
// PromptLibraryDialog 的 onSend 改：
onSend={(text) => {
  const el = inputRef.current
  if (!el) return
  el.value = text
  el.focus()
  el.setSelectionRange(text.length, text.length)
  setPromptLibOpen(false)
}}
```

**自定义按钮接入**：
```ts
// 当前：onClick={() => aimonWS.sendInput(session.id, cmd + '\r')}
// 改为：
onClick={() => {
  const el = inputRef.current
  if (!el) return
  el.value = cmd
  el.focus()
  el.setSelectionRange(cmd.length, cmd.length)
}}
```

**`@` 打开时拉文件**：惰性——第一次打开 `@` menu 时才调 `api.listProjectFiles(session.projectId)`，结果缓存在 `useRef<string[] | null>` 里；菜单关后内存里留，下次打开不再拉（避免重复拉大项目）。**不做刷新**——用户若新增文件想看到，下次重开 session 再说（非目标已说明）。

## 边界情况

- **空项目 / `listProjectFiles` 报错**：`@` 菜单显示 "无文件" 占位 + 原因；Esc 关。
- **项目文件 > 2000 条**：filter 子串匹配用 `for 循环 + .includes`，在 3 万条文件上也能 20ms 内过；不做虚拟滚动，列表只 `slice(0, 30)` 显示。
- **输入框宽度很窄（< 200px）**：菜单 `min-width: max(280px, anchorRect.width)`，必要时横向挤出输入框也无妨（`position: fixed` 不被 overflow clip）。
- **多个 session 并存**：每个 SessionView 有自己的 menu state 和 input ref，互不影响。
- **session inactive（页签切走）**：外层 `visibility: hidden + pointerEvents: none`，菜单自动不可见；切回来菜单状态若为 open，**手动 reset 成 `{kind: 'none'}`** on active false（useEffect 里加）。
- **IME composing + `/`**：前面 v3 已有 `e.nativeEvent.isComposing` 守卫 Enter，这里触发 menu 的判断也要加 `if (composing) return`。
- **Shift+Enter**：本任务不发送（保持 v3 原语义 `!e.shiftKey`），菜单开着时 Shift+Enter 如何？—— menu 开着时 Shift+Enter 当成"选中插入"等同 Enter，避免菜单开着时还能用 Shift+Enter 换行（输入框是单行也没换行概念）。
- **粘贴大段含 `/` 的代码**：粘贴走 onPaste，不走 onKeyUp 的触发检测 → **不会误触**。
- **菜单开着时点击输入框外**：外点关（监听 mousedown，target 不在菜单和 input 内则 close）。

## 风险与注意

- **风险 1：斜杠命令列表过期**。claude/codex/gemini 会不定期加/改命令，硬编码表会老化。**接受**——不做动态探测（增加后端复杂度，性价比低）。每季度可视需要手工更新一次。
- **风险 2：`@` 匹配子串可能不够"智能"**。用户期望 fuzzy（如 `@svc` 能匹配 `packages/server/src/routes/...`）。**先发子串版，观察反馈**，真不够再加 fuse.js（多 ~10KB gzip）。
- **风险 3：非受控 input 下检测光标位置**。`el.selectionStart` 在 IME composing 时行为未定义——前面已加 `isComposing` 守卫，触发只发生在 commit 后，此时 selectionStart 正常。
- **风险 4：菜单 portal 位置在 `position: fixed`**——主 splitter 拖动时 input 位置变化，菜单 anchorRect 跟不上。**方案**：每次菜单 render 时读 `inputRef.current.getBoundingClientRect()`；拖 splitter 时用户通常不会同时挂着菜单，不做 resize 跟踪。
- **假设 1**：`api.listProjectFiles` 返回形状是 `{files: string[]}` 或类似（Context 阶段读实际 API 签名确认）。
- **假设 2**：按钮接入的"填入不发送"是用户真正想要的语义。如果 A 后面发现"某些命令就想秒发"，再加 Shift+Click 直发；不在此任务加（非目标已说明）。
