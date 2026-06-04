# bat执行改用终端页签 · plan

## 背景

当前在文件树（`FilesView` / `ChangesList`）右键 `.bat` / `.cmd`，选"执行"时，前端调用 `api.execBatFile`，后端路由 `POST /api/projects/:id/fs/exec-bat` 通过 `cmd.exe /c start "" /D <dir> <abs>` **有意**弹出独立的 cmd 窗口（代码里注释明确说要模拟 Explorer 双击）。

但项目本身已经有基于 node-pty 的内置终端页签系统（`PtyManager` + `createSession` + `SessionView`），用户期望 bat 直接跑在一个新的 `cmd` 会话页签里，而不是独立窗口。

## 目标

把右键"执行" bat 的行为改成：**新建一个 `cmd` agent 的 PTY 会话作为终端页签，在该页签里执行这个 bat，日志直接流到页签里**。

### 可验证的验收标准（UI 可观察）

1. 启动 dev（`pnpm dev:alt`），在文件树里右键 `start.bat`（或任一 `.bat/.cmd`）→"执行"：
   - 浏览器里**不再弹独立 cmd 窗口**（任务管理器也看不到新的孤立 `cmd.exe` / `conhost.exe` 树）。
   - 项目 UI 的终端页签区**新增一个 `cmd·xxxxxx` 页签并自动聚焦**。
   - 该页签里能看到 bat 的输出（对 `start.bat` 会看到 "VibeSpace - AI monitor dashboard launcher" 横幅；对自己造的一个只 `echo hello` 的短 bat 会看到 `hello`）。
2. bat 在子目录里也能跑：在 `scripts/` 或任一子目录放一个 `demo.bat`（内容 `@echo off` + `echo from %cd% && echo bat at %~dp0`），右键执行后页签里输出两行，都能看到正确的相对路径语义（`%cd%` 应为 bat 的父目录，与原来双击等价）。
3. 路径含空格 / 中文也能跑：在 `stable鍓湰/`（仓库里已经有该中文目录）或新建一个 `有 空格/test.bat`，右键执行能正常跑完。
4. 失败路径（不存在的 bat / 权限问题 / 会话创建失败）会弹 `alertDialog`，不会静默。
5. TypeScript 类型检查通过：`pnpm -r typecheck`（或查看 `package.json` 里对应命令，必要时 `pnpm -r build` 也算）。

## 非目标 (Non-Goals)

- 不改别的终端相关行为（`SessionView`、`StartSessionMenu`、`DocsView` 派 Claude 流程等）。
- 不给新会话加新的"自定义标签 / 自动命名"特性（维持现有 `cmd·<shortTail>` 命名风格即可）。
- 不改 `start.bat` 本身（它跟本任务无关，只是个验收目标对象）。
- 不处理 Linux / macOS 下的行为（项目当前右键"执行"只对 `.bat/.cmd` 显示，平台本身就限定 Windows）。
- 不做"重用已有空闲 cmd 会话而不新建"这种优化 — 每次执行新建一个页签，简单清晰。

## 实施步骤

1. **前端 — 改 `fileContextMenu.ts` 的执行项**（文件：`packages/web/src/components/fileContextMenu.ts`）
   - 把 `onSelect` 从 `api.execBatFile(...)` 改成：
     1. `const s = await api.createSession({ projectId, agent: 'cmd' })`
     2. `useStore.getState().addSession(s)` + `useStore.getState().setActiveSession(projectId, s.id)`
     3. `aimonWS.subscribe([s.id])`
     4. 组装命令行并 `aimonWS.sendInput(s.id, cmdLine)`，其中 `cmdLine` 形如：
        - 无子目录：`"start.bat"\r`
        - 有子目录（如 `scripts/foo.bat`）：`cd /d "scripts" && "foo.bat"\r`
        - 反斜杠替换 `/` → `\`
     5. 为避免 conpty 启动早期丢输入，`sendInput` 前 `setTimeout` ≈ 120ms 一次（经验值，不做可配置）。
   - 验证：读源码确认 `useStore.getState()` 在非组件文件里已有先例（`logs.ts`、`main.tsx`）。
2. **前端 — 删除孤儿 API**（文件：`packages/web/src/api.ts`）
   - 删除 `execBatFile` 导出（无其他引用，grep 过）。
   - 验证：`grep -r "execBatFile" packages/web/src` 应无匹配。
3. **后端 — 删除孤儿路由**（文件：`packages/server/src/routes/fs-ops.ts`）
   - 删除 `POST /api/projects/:id/fs/exec-bat` 整块（含前面几行注释）。
   - 如果删掉后 `spawn` / `dirname` / `existsSync` / `statSync` 有 import 变成无引用，顺手清掉 import（属于本次引入的孤儿）。
   - 验证：`grep -r "exec-bat\|execBat" packages/server/src` 应无匹配，`pnpm --filter @aimon/server build`（或 `tsc`）通过。
4. **整体类型检查 + 浏览器冒烟**
   - 跑一次项目层面的 TypeScript 构建作为 `verify`（静态类型语言硬规则）。
   - 浏览器里按上面"验收标准"第 1-4 条手动点一遍。

## 边界情况

- **路径含空格**：`cd /d "<dir>" && "<file>"` 用双引号包裹即可。cmd 在双引号内对空格和 `&` 字面处理。
- **路径含中文**：conpty + UTF-8 前端，主流 Windows 11 上正常。若显示乱码，本任务不负责修复（`chcp 65001` 是 bat 自己该做的事，`start.bat` 里已经有）；但至少要能启动、执行并产生输出。
- **路径在项目根**（无子目录）：直接 `"file.bat"\r`，不 cd。
- **极早 sendInput 被 conpty 丢弃**：用 120ms 延迟作为 pragmatic 兜底；如果测出来仍然丢，在 tasks 阶段补 retry / 等 WS ACK 机制。
- **用户短时间重复右键执行**：每次都新建一个页签，可能造成页签堆积 — 明确作为接受的副作用，不优化。
- **会话创建失败 / WS 未连接**：`createSession` 会抛，按原有 `alertDialog(..., '执行失败')` 流程处理。WS 未连接时 `sendInput` 会进 outbox 稍后回放，但此时会话已建，页签会显示 "connecting" 状态，是可观察的降级，不做额外处理。

## 风险与注意

- **假设 1**：`useStore.getState()` 在 `fileContextMenu.ts`（非 React 组件）里调用合法。已在 `logs.ts` 验证过这种用法。
- **假设 2**：`cmd` agent 的 PTY 启动后短时间内能接受输入。上面用 120ms `setTimeout` 兜底；真翻车的话 tasks 阶段换成 "订阅 WS 的第一条 `output` 事件后再发送" 的方案。
- **假设 3**：新建会话默认 cwd = 项目根（已在 `routes/sessions.ts:195` 确认 `cwd: proj.path`），所以我们用项目相对路径 + 前置 `cd /d` 即可，不用改后端。
- **波及面**：改动局限在 `fileContextMenu.ts` + `api.ts` + `fs-ops.ts` 三个文件，不动 `ContextMenu.tsx` / `FilesView.tsx` / `ChangesList.tsx` / `PtyManager` / `SessionView`。
- **不在本次范围**：如果未来想把"重用空闲 cmd 会话而不是每次新建"作为行为，另起任务。

## 需要用户拍板的选择点

1. **每次执行都新建一个 cmd 页签** vs. **尝试复用已有 cmd 页签**？
   - 推荐前者，简单无状态。
2. **执行后是否关闭 cmd 页签**？
   - 推荐：**不关闭**。bat 跑完留在 `cmd>` 提示符，方便看日志、重跑。（和现有 Explorer 双击行为一致，双击窗口也不会自动关。）
3. **是否顺手把现有独立窗口弹窗入口（`execBatFile` + `/fs/exec-bat`）删掉**？
   - 推荐：**删掉**。本任务改动让它们彻底无调用方，留着就是死代码。grep 过确认无其他引用。如果你还想保留作为"弹独立窗口"的备选，就留；请告诉我取舍。
