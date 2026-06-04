# 浮动输入框命令增强 · Context

## 关键文件（本次改动只碰这三份：2 新 + 1 改）

### 新增

1. **`packages/web/src/components/terminal/slashCommands.ts`**（新文件，~50 行）
   - 导出 `SLASH_COMMANDS: Record<string, readonly string[]>`（见 plan 最终版命令表）
   - 导出 `getSlashCommands(agent: string): readonly string[]`，未命中返回 `[]`（因为 `AgentKind = string` 不是 union，Record 不能 exhaustive）
   - 无依赖、无副作用，纯数据模块

2. **`packages/web/src/components/terminal/InputMenu.tsx`**（新文件，~100 行）
   - Props：
     ```ts
     interface Props {
       open: boolean
       anchorRef: React.RefObject<HTMLElement | null>
       items: string[]            // 展示文本（含 '/' 或 '@' 前缀 + 路径）
       selectedIndex: number
       onPick: (index: number) => void
       onHover: (index: number) => void   // 鼠标 hover 同步高亮
       maxRows?: number           // 默认 10
     }
     ```
   - **不装键盘监听**（外部 input 的 `onKeyDown` 统一转发），避免焦点抢夺
   - 渲染：`createPortal` 到 `document.body`，`position: fixed`，每次 render 读 `anchorRef.current.getBoundingClientRect()` 计算 top/left
   - 定位：`left = rect.left`，`bottom = viewport.height - rect.top + 4`（弹在 input 上方，间距 4px）
   - `min-width: Math.max(280, rect.width)`
   - 外点关：挂全局 `mousedown`，target 不在 menu DOM 内就 `onPick(-1)` 表示取消（约定 -1 = close）
   - 有 `items.length === 0` 时显示"无匹配"占位，仍保持 open

### 改动

3. **`packages/web/src/components/terminal/SessionView.tsx`**（唯一要改的现有文件）

   改动清单：
   - **新 import**：`InputMenu`, `SLASH_COMMANDS`（或 `getSlashCommands`）, `ProjectFilesResult`（用于类型）, `listProjectFiles`（api）
   - **新状态**（单一 useState）：
     ```ts
     type MenuState =
       | { kind: 'none' }
       | { kind: 'slash', trigger: number, filter: string, selected: number }
       | { kind: 'mention', trigger: number, filter: string, selected: number }
     const [menu, setMenu] = useState<MenuState>({ kind: 'none' })
     const filesRef = useRef<string[] | null>(null)  // 惰性缓存
     ```
     `trigger` = 触发字符（`/` 或 `@`）在 input.value 中的下标
   - **新处理函数**（写在 `onInputKey` 同区块，约 L370-388）：
     - `detectTrigger(el)`：读 `el.value` + `el.selectionStart`，判断是否处于 slash/mention 触发区；返回新 `MenuState`
     - `pickSlash(cmd: string)`：把 `value[trigger..cursor]` 替换成 `cmd`，更新 selectionRange 到插入末尾，`setMenu({kind:'none'})`
     - `pickMention(path: string)`：同理，替换成 `formatForSession(agent, path, 'file')`
   - **修改 `onInputKey`**（L370-379）：
     - menu 开启时拦截：`↑/↓` 改 `selected`，`Enter/Tab` 触发 `pickSlash/pickMention`，`Esc` 关菜单
     - menu 关闭时走原逻辑（`isComposing` 守卫 + Enter 发送）
   - **新事件 `onKeyUp`/`onInput`**：在字符已写入 `el.value` 后重新调用 `detectTrigger` 更新 menu state。用 `onInput` 最稳（IME composing 提交后才触发）。
   - **修改 PromptLibraryDialog.onSend**（约 L539-542）：
     - 从 `aimonWS.sendInput(session.id, text); setPromptLibOpen(false)` 改为：把 `text` 写入 `inputRef.current.value`，focus，光标落末尾，关对话框（**不发送**）
   - **修改自定义按钮 onClick**（约 L460）：
     - 从 `onClick={() => aimonWS.sendInput(session.id, cmd + '\r')}` 改为"写入输入框 + focus + 光标末尾"（抽一个本地 helper `fillInput(text)` 共用）
   - **active→inactive 时重置 menu**（加在已有 `useEffect(..., [active, session.id])`）：`setMenu({kind:'none'})`

## 数据 & API 确认（Context 阶段盘点）

- `api.listProjectFiles(projectId)` → `Promise<ProjectFilesResult>`，关键字段：
  ```ts
  {
    gitEnabled: boolean
    files: ProjectFileEntry[]    // { path: string, git, dirty, staged }
    heavyDirs: string[]
    total: number
    truncated: boolean
    limit: number
  }
  ```
  **只取 `files[].path` 用于 mention 匹配**，其它字段忽略。`truncated` 时前端**不提示**（非目标之一）。
- `formatForSession(agent, path, 'file')` → 返回 `@<path> `（AI agent）或 `"<path>" `（shell 类），**末尾带空格**，正好作为 mention 插入分隔。
- `SLASH_COMMANDS[agent]` 为 `[]` 时（shell/cmd/pwsh/opencode/qoder/kilo）—— `detectTrigger` 检查到 list 空即不进入 slash 触发状态。

## 决策记录

### D1：为什么 InputMenu 不装自己的键盘监听

菜单和 `<input>` 是**两个焦点可达 DOM**。若菜单自己监听 `keydown`，会和 input 的 keydown 抢事件——要么菜单偷走输入键（打不了字），要么 input 偷走箭头（不能导航）。

选择："单源 keydown" —— 只有 input 装 `onKeyDown`，菜单从 props 接收 `selectedIndex`。菜单本身仅渲染 + 鼠标点击转发。代码量少、焦点规则清晰，React 受控模式常见做法。

### D2：为什么用 `onInput` 而非 `onChange` / `onKeyUp` 检测触发

- `onChange`：非受控 input 在 React 里对 `onChange` 支持不如受控好；且 IME 中间态也会触发，扰动 trigger state。
- `onKeyUp`：IME composing 中每次 keyup 都触发，trigger 计算会乱；compositionend 事件又要额外挂。
- `onInput`：**浏览器 native event**，composition 提交后才发一次，语义正好是"文本真正变了"。非受控 input 用 `onInput` 读 `el.value` 是标准做法。

选 `onInput`。composing 中不触发，避免 IME 下误弹菜单。

### D3：惰性拉文件 vs 每次打开 mention 都拉

拉全量 `listProjectFiles` 在大项目上几十 ms 到几百 ms。每次打开 `@` 都拉 → 打字感觉卡顿。  
方案：**第一次 `@` 打开时拉一次，存 `filesRef.current`**，此后命中缓存。会话级缓存——SessionView unmount 时自动 GC。
代价：用户新增文件在同一 session 中看不到。**接受**（非目标已写）。未来可加一个"刷新"按钮，不在本期。

### D4：InputMenu 的 items 里直接存展示文本，还是存结构化对象

候选 A：`items: Array<{ key: string, display: string, value: string }>`，可分 key 和 render。  
候选 B：`items: string[]`（当前选）——slash 命令 display = value，mention 的 display 和 value 都是 path。

选 B。当前两种触发的 item 都能用单字符串描述，不需要额外 display/key。若将来要显示命令描述/文件 git status icon，再升级为 A。不做提前抽象。

### D5：mention 触发的光标检测规则

- 光标左扫找最近的 `@`，直到遇到空格或开头
- 若 `@` 前一个字符是非空白（如 `foo@bar` 邮箱）—— **不触发**（降低误触）
- 触发范围内若有空格 → 失败（用户已离开 mention context）
- slash 同理：光标左扫找 `/`，要求 `/` 前是空白或开头

### D6：按钮改"填入"后，如何保持"1 Enter 即发"的体感

用户原来点按钮是"点完即发"。改成填入后，多按一次 Enter。  
**补偿**：填入后 **input 自动 focus + 光标落末尾**，用户下意识按 Enter 没有迟滞感；且现在可以先看一眼命令、改一下再发，比原来更安全。

不加 Shift+Click 直发兜底（非目标）。若用户真抱怨再加。

### D7：PromptLibraryDialog 填入时，是**覆盖** 还是**插入到光标**

prompt 通常是完整段落（如"请审查我刚才改动的代码..."），不应与用户已有输入拼接。  
**覆盖**。和"自定义按钮填入"行为一致——清空后写入 prompt 内容。若用户有未发内容，弹 prompt 前他会自己决定。

### D8：menu 开着时，xterm 滚动/光标如何

input 获得焦点 → xterm 未聚焦 → 方向键不影响 xterm。本来就这样，无需额外处理。仅需在 input 的 onKeyDown 里对 `↑/↓/Enter/Tab/Esc` 调 `e.preventDefault()` 防止默认（input 上 ↑/↓ 本就没有默认行为，但 Tab 会切焦点——必须 preventDefault）。

## 依赖与约束

- **`@xterm/addon-fit` / ResizeObserver**：不受本次改动影响（布局没动）。
- **`aimonWS.sendInput`**：只在 input 的 Enter 路径调用；按钮、提示词、菜单选择**都不直接调**（改成写 input.value）。
- **`api.listProjectFiles`**：一次性调用，结果体积取决于 `total`（项目 10000 文件时 JSON 可能 ~1MB；网络传输几百 ms）。不做分页。若真慢，后续加 loading 状态即可（非本期）。
- **`AgentKind = string`**：不是 union，`Record<AgentKind, ...>` 等同 `Record<string, ...>`，编译器不能做 exhaustive check——用 `getSlashCommands(agent)` helper 兜底未知 key。
- **tsconfig / tsc -b**：无新增类型错误即通过（前置 `DocsView.tsx:372` 预先错误仍然存在，非本任务范围）。
- **CLAUDE.md 前端硬性规则**：验收标准已有"浏览器内可观察"多条（斜杠菜单、@ 菜单、提示词填入、按钮填入、类型检查）—— 合规。

## 类型检查命令

```
pnpm -C packages/web exec tsc -b
```

## 旧任务 / issues 处理

- **`终端输入抖动` v3**：独立归档路径。本任务**不依赖其 step 8 手测通过**——v3 修的是抖/吞/滚动条/粘贴图片，本任务加的是命令增强，语义正交。两者合并测也可，分别测也可。
- **`dev/issues.md` 追加一条**：`codex` 斜杠命令列表缺 `/help` 输出来源，暂以 3 条通用命令兜底，后续补充。
- **`DocsView.tsx:372` TS2322**：仍然不在本任务范围。
