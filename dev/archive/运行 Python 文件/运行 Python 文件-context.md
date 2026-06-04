# 运行 Python 文件 · context

## 关键文件

**会改：**

- `packages/web/src/components/FilePreview.tsx`
  - 行 24-38 附近 `isMarkdownPath` 等 sniff 函数旁，加一个 `isPythonPath`。
  - 行 192-225 `header` 的 `useMemo`（tab 区域）—— 在 tab 按钮行 207 那一行的左侧、`{showDiffTab && …}` 之前，插入仅 `isPython` 时渲染的 `▶ 运行` 按钮。
  - import 行 1-10 加 `import { runPythonFile } from './runPython'`。
- `packages/web/src/components/runPython.ts`（**新建**，< 50 行）
  - 一个导出函数 `runPythonFile(projectId: string, path: string): Promise<void>`。
  - 内部：`logAction('fs','run-python', async () => { createSession + addSession + setActive + ws.subscribe + 120ms 等待 + sendInput })`，meta 带 path。
  - 错误捕获：抛出后由 logAction 自动落 ERROR；调用方再用 `alertDialog` 弹"运行失败: …"对话框，与 .bat 现状一致。

**会读（参考但不改）：**

- `packages/web/src/components/fileContextMenu.ts:126-155` — `.bat` "执行"实现，是 `runPython.ts` 的直接模板。
- `packages/web/src/api.ts:createSession` — agent='cmd' 不需要额外参数。
- `packages/web/src/ws.ts:108-110` — `aimonWS.sendInput(id, data)`，`data` 字符串末尾的 `\r` 即回车。
- `packages/web/src/store.ts:addSession / setActiveSession / setActiveTabKind` — 复用 .bat 的状态写入序列。
- `packages/web/src/logs.ts:logAction` — 起止配对 + 失败 ERROR + meta 透传，已经够用。
- `packages/web/src/components/dialog/DialogHost.ts:alertDialog` — 失败弹窗。
- `packages/web/src/components/sendToSession.ts` — 注意：它走 `queuePendingInput`（用户还要按 Enter 才发），**不适合**这次的"立即执行"场景，不要走它。

## 决策记录

### D1 · 不改后端

复用现有 `POST /api/sessions { agent: 'cmd' }` + WS `input`，不新增路由、不动 cli-catalog、不动 pty-manager。

理由：`.bat` "执行"已经踩通过这条路（在仓库里活了至少几个迭代），相同模式 add 一个 `.py` 分支零边际改动。要新增后端（如 `POST /run-python`）会带来 PTY 二次封装、参数 schema、错误传递、跨平台 spawn 等等额外面，**全是过度工程**——一个右键功能不应该长成新的 RPC。

> 资深工程师审视："会不会过度设计？"——不会。这是减法不是加法，复用已有抽象。

### D2 · 新建 `runPython.ts` 而不是塞进 `fileContextMenu.ts`

`fileContextMenu.ts` 字面是"右键菜单 builder"。这次 ▶ 入口在 FilePreview header 不在右键菜单，硬塞会让文件名实不符。

新文件 < 50 行，**不构成抽象债**——因为它本身就是一个具体动作（`runPythonFile`），不是为"将来更多 run-X"留口子。如果以后真要 run-perl / run-node，再讨论是否抽统一的 `runFileInShell(cmd, file)`。

> 资深工程师审视："是不是只用一次的抽象？"——单文件单导出，不是抽象。是把 .bat 那段就地扁平的逻辑挪到独立模块里，便于 FilePreview 和 fileContextMenu（如有需要）将来都能调用，不引入额外间接层。

### D3 · ▶ 按钮放在 tab 按钮区前面（不放右边角落）

`header` 行 207-221 的 tab 按钮区已经是右上角。把 ▶ 紧挨在 `Diff / Source / Preview` 左边，可以共享 padding 和 `flex items-center gap-1`。视觉上是"动作 + 视图"的关系，比另起一个右角按钮自然。

> 资深工程师审视："是不是没人要的灵活性？"——不是。就一个按钮，不做位置可配置，不做样式 props。

### D4 · 历史 ref 快照下 ▶ 也显示，跑的是 worktree 文件

FilePreview 可以打开 commit 历史里的 .py（`ref` 不为 `WORKTREE`）。我们**不**根据 ref 隐藏 ▶，因为：

- 隐藏的话用户预期不一致——".py 怎么有时候有 ▶ 有时候没"。
- 跑的版本永远是磁盘上的当前文件——这跟 cmd 终端里手敲 `python xxx.py` 完全一致，不是 bug 是"你是从哪打开的预览"和"你跑哪个版本的脚本"在 VibeSpace 里就分离的本来设计。

代价：用户在历史快照预览里点 ▶，实际跑了 worktree 版本，可能产生认知摩擦。**v1 接受**——hover ▶ 时的 `title` 写"运行磁盘上当前 worktree 版本的此文件"，把语义讲清楚。

### D5 · 不做 venv 探测、不做参数对话框

用户原话"机器上的 py" → PATH 上的 `python`。venv 探测要扫 `.venv/Scripts/python.exe` / `venv/bin/python` / 项目根 `pyproject.toml` 的 `[tool.poetry] / [project]`，每条都是分支，每个分支都要测。**用户没要，不做**。

参数 / 环境变量 / 工作目录同理——v1 简单到极致，需要用户后续提了再做。

### D6 · 写死 Windows，cd /d 不分平台

按你刚才确认。`runPython.ts` 写一个 `cd /d "<dir>" && python "<file>"` 就完事；非 Windows 用户点 ▶ 会在他们的 shell 里看到 `cd: -d: invalid option`，**作为已知限制写到 plan §风险**，不补 README。

如果未来有 macOS/Linux 需求，再补一个 `process.platform === 'win32'` 分支即可，**改一处不破坏接口**。

## 依赖与约束

- **依赖现成**：`api.createSession`、`aimonWS.subscribe`、`aimonWS.sendInput`、`useStore.getState().{addSession,setActiveSession,setActiveTabKind}`、`logAction`、`alertDialog`。无新装包、无 schema 改动。
- **conpty 兜底 120ms**：复用 .bat 现状数字。比这小有可能丢前几字节。
- **路径 quoting**：`"..."` 包裹覆盖空格 / 中文。双引号在路径里的边界 case 不处理（与 .bat 保持一致）。
- **session 级联状态**：spawn 出来的是普通 cmd session，跟手动开 cmd 走完全一样的状态机：`starting → running → idle → stopped`（python 进程退出后 cmd 会回到 idle，session 还活着；用户关 tab 会再走 stopped）。
- **操作日志契约**（CLAUDE.md 操作日志规则）：
  - `scope=fs`、`action=run-python`
  - 起：`info` `run-python 开始`
  - 止：`info` `run-python 成功 (Nms)`
  - 失：`error` `run-python 失败: …` + `meta.error = { name, message, stack }`
  - meta：`{ path, projectId }`，绝不塞文件内容
- **类型检查**：`pnpm --filter @aimon/web exec tsc -b --noEmit`（项目根没有统一 typecheck 脚本）。

## 不在范围

- 不动 `EditorArea.tsx`（只通过 FilePreview 间接受影响）。
- 不动 `StartSessionMenu.tsx`、不动 cli-catalog、不动 pty-manager。
- 不动 `fileContextMenu.ts`（甲方案下右键菜单不加"执行"）。

确认 context 后我进 Tasks 阶段。
