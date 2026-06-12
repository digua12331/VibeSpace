# 运行 Python 文件 · plan

## 背景与定位

让用户能在 VibeSpace 里**一键运行打开的 .py 文件**，输出实时显示在新 session tab 里（xterm，可看 traceback、可 Ctrl+C、可继续输入）。VibeSpace 是 PTY-session 模型，不是 Jupyter。这个能力的形态对应**与已有的 `.bat / .cmd` "执行" 右键菜单同款**——`fileContextMenu.ts:126-155` 已经验证过这条路：开 cmd session → 等 120ms 兜底 conpty → WS sendInput `cd /d "<dir>" && "..."\r`。

memory 扫过无相关条目；manual.md 里的"小功能直接改"偏好不适用（这条改动牵动 FilePreview + fileContextMenu + 操作日志埋点 + 跨平台行为，不是一行改）。

## 目标

让 .py 文件能在 VibeSpace 里通过点击触发执行，输出可见、错误可见、能中断。

**可验收标准（浏览器可观察）：**

1. 在打开任意 `.py` 文件的 FilePreview 顶栏看到 ▶ 按钮（仅 `.py` 显示，其它扩展名不显示）。
2. 点 ▶ 后，右侧 tab 列表出现一个新 cmd session tab，xterm 内**能看到**：
   - `cd /d "<py 文件所在目录>"` 然后 `python "<filename.py>"` 的命令行原文
   - 该 .py 的 stdout / stderr 输出（verify 时跑一个 `print("hello"); raise RuntimeError("boom")` 的脚本，`hello` 和 traceback 都要看到）
3. 在 LogsView 看到 `scope=fs action=run-python` 的 **起止配对** 各一条。
4. 故意点一个根本不存在的 .py（比如手改 path 参数）→ LogsView 出现 `ERROR fs run-python` 一条。**或**：在没有 python 的环境（临时 PATH 把 python 摘掉）→ session tab 内能看到 cmd 的 `'python' 不是内部或外部命令` 提示，且这次不算前端的 ERROR（cmd 报错不会回流，跟 .bat 的现状一致；这是已知 trade-off）。
5. 跨平台：在 Windows 上走 cmd + `python` 路径；在 macOS / Linux 上走默认 shell + `python3`。**不阻塞 v1**——本次仅交付 Windows 路径，非 Windows 路径仍然显示 ▶（避免 platform fork），但跑出来的命令在 *nix 终端里也能 work（`cd "<dir>" && python3 "<file>"`）。

## 非目标

- **不**做 Python REPL session 入口（B 方案），不动 StartSessionMenu。
- **不**做 markdown 内联代码块 ▶（C 方案）、不做 jupyter 风 kernel 状态保留。
- **不**做参数对话框 / 环境变量编辑 / 工作目录自选——v1 直接 `cd` 到脚本所在目录用默认 PATH `python`，参数为空。
- **不**做 venv 探测 / 项目级 `.python-version` 兼容——用户明确说"机器上的 py"，即 PATH 上的全局 python。
- **不**改后端——复用现有 `createSession` + WS `sendInput`，不新建路由、不动 cli-catalog、不动 pty-manager。
- **不**做停止/重启 ▶ 按钮——session tab 自带关闭按钮，不重复建轮子。
- **不**碰右键菜单的"执行" .bat 那套（保持原状）；新加的 ▶ 入口位置见「实施步骤 §2」。

## 实施步骤

### 1. 在 FilePreview header 里加 ▶ 按钮（前端唯一改动）

文件：`packages/web/src/components/FilePreview.tsx`

- 加 `isPythonPath(p)`（`/\.py$/i`）。
- header（行 194-225）右侧 tab 区前面加一个独立按钮 `▶ 运行`，仅 `isPython` 时渲染；样式参考已有 `TabButton`，但配色用浅绿（区分 tab 切换与"动作"）。
- onClick 走一个新工具函数 `runPythonFile(projectId, path)`（位置：放在 `fileContextMenu.ts` 同目录下新建 `runPython.ts`，便于复用，但单独文件不算大动）。
  - **决策**：放新建文件不放 fileContextMenu.ts 内。理由：fileContextMenu.ts 名字字面是"右键菜单专用"，新放进去要么改文件名要么名实不符；新文件 < 50 行，不构成抽象债。
- verify：在浏览器打开 `packages/web/src/types.ts`（保证不是 .py，▶ 不出现）→ 切到任意 .py 文件 → ▶ 出现。

### 2. 实现 `runPython.ts`

复制 fileContextMenu.ts:126-155 的 `.bat` "执行"逻辑，把 cmd 命令体换掉：

```ts
// pseudo
const s = await api.createSession({ projectId, agent: 'cmd' })
// store + ws.subscribe + activate tab — 同 .bat
await new Promise(r => setTimeout(r, 120))   // conpty 兜底
const winPath = path.replace(/\//g, '\\')
const slash = winPath.lastIndexOf('\\')
const dir  = slash >= 0 ? winPath.slice(0, slash) : '.'
const file = slash >= 0 ? winPath.slice(slash + 1) : winPath
const line = `cd /d "${dir}" && python "${file}"\r`
aimonWS.sendInput(s.id, line)
```

包一层 `logAction('fs','run-python', …, { projectId, meta: { path } })`，**起止 + 失败 ERROR** 自动产生（CLAUDE.md 操作日志规则要求）。

verify：跑一个会 print + 抛异常的 .py，xterm 看到 stdout 与 traceback；LogsView 看到 起 + 止 各一条。

### 3. 操作日志埋点

包在 `logAction('fs', 'run-python', async () => { ... })` 里。失败分支：
- `createSession` 失败 → 自动 ERROR 一条
- `sendInput` 不会 throw（aimonWS 内部 swallow），但 createSession 已能 cover 主路径

verify：手动改前端 path 参数到不存在的项目 id → LogsView 出现 `ERROR fs run-python`。

### 4. 收尾验收

按目标 §1-§4 在浏览器实跑一遍 happy + 失败两条路径。

### 5. 类型检查

`pnpm --filter @aimon/web exec tsc -b --noEmit`（项目 README 没列出统一 typecheck 命令，先用 web 包 build 内置的 tsc；如果发现项目根有 `pnpm typecheck` 之类的脚本，改用根脚本）。

## 边界情况

- **路径含中文 / 空格**：`"..."` 包裹已处理，cmd 的 `cd /d` 和 `python` 都接受 quoted path。
- **路径含双引号**：罕见，复用 .bat case 的现状（不做特殊转义），如有问题作为后续 issue 而不是 v1 阻塞。
- **打开的是 commit 历史快照（`ref` 不是 WORKTREE）**：脚本可能不在磁盘上 / 不是当前 worktree 版本。**v1 决定**：仍然显示 ▶，但点了之后跑的是磁盘上的当前 worktree 文件——这跟 `cd /d <dir> && python <file>` 的本质是一致的。如果想做"基于历史 ref 跑"会复杂得多（要先 git show 到临时文件），不在范围。**记到「运行 Python 文件-context.md」决策记录里**。
- **文件未保存的内存修改**：FilePreview 是只读，无此情况。
- **没装 python**：cmd session 内会原样回显 `'python' 不是内部或外部命令`，用户能自己看到。不做提前探测（提前探测要么调 server 要么走 cli-installer 那套，过度）。
- **同一文件连点 ▶ 多次**：每次开新 session，不防抖，符合"按一次跑一次"直觉。

## 风险与注意

- **跨平台**：v1 写 `cd /d "<dir>" && python ...`，**`/d` 是 cmd 专属**。在 *nix 上等价物是 `cd "<dir>" && python3 ...`。我倾向 v1 **写死 Windows 路径**（项目 README 也写明 macOS/Linux 是 experimental），但需要你确认是否要现在就分平台。如果要，多一个 `navigator.userAgent` / 后端探测平台的判分支。**默认决定：写死 Windows，加注释说明非 Windows 用户暂时点击 ▶ 会跑出 `cd /d` 报错，作为已知限制**。
- **conpty 120ms 兜底**：参考 .bat 现成数字；如果发现部分机器吞字，再调长。
- **cmd session 也会在 LogsView 产生 `session start` 起止条目**——这跟手动 +启动菜单一致，不是新噪声。
- 没有需要写进 CLAUDE.md / dev/learnings.md 的跨任务结论——本次完全沿用 .bat 现成模式。

## 待你决定的开关（plan 阶段唯一卡点）

1. **入口位置**：
   - 甲 · **只在 FilePreview header 加 ▶**（你一开始的字面要求；与 .bat 在右键菜单不对称）
   - 乙 · **header ▶ + 右键菜单"执行"两个都加**（与 .bat 形态一致，多一行右键菜单代码）
   - 丙 · **只加右键菜单"执行"**（最对称，但 ▶ 按钮在 header 里更显眼）

   **我倾向甲**：你 A 选项的字面就是"文件预览的 ▶ 按钮"，且 .bat 走右键是历史选择不必拉齐。但乙的工程量也只多 5 行，等你定。

2. **跨平台**：v1 是否就分 Windows / *nix 两条命令？
   - 是 → 我加一个简单的 `navigator.platform` 判断，*nix 走 `cd "<dir>" && python3 "<file>"`
   - 否 → 写死 Windows，*nix 用户暂时不能用，README 不动

   **我倾向否**（项目本就 Windows 优先，最小代价）。

确认这两个开关后我进 Context 阶段。
