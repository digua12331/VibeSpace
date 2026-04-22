# 右键扩展-VSCode与Bat执行 · Plan

## 目标

给当前看板前端补两个右键菜单项，让项目与文件面板能直达本地工具：

1. **项目列表右键菜单** 新增「用 VSCode 打开此项目」：点击后后端调用 `code <project.path>`，在本地 VSCode 中打开该项目根目录。
2. **文件列表右键菜单** 对 `.bat` / `.cmd` 文件新增「执行」：点击后后端以该 bat 所在目录为 CWD 启动它。

### 可验证验收标准

- [V1] 在 [ProjectsColumn.tsx](packages/web/src/components/layout/ProjectsColumn.tsx) 右键任一项目，菜单里能看到新按钮；点它后 VSCode 会在 1~2 秒内弹出并打开该项目路径。
- [V2] 在文件面板右键一个 `.bat`（仓库根下就有 [start.bat](start.bat) 和 [_tp.bat](_tp.bat) 可测），菜单里能看到「执行」；点它后能观察到 bat 运行（新开的 cmd 窗口或其副作用）。
- [V3] 右键非 `.bat/.cmd` 文件时，菜单里**不出现**「执行」项。
- [V4] 后端接口对非法路径（跨目录、项目不存在、文件不存在、后缀非 `.bat/.cmd`）返回对应 4xx，不会越权执行。
- [V5] `pnpm -r build` 通过；前端按钮布局与既有 4 项风格一致。

## 非目标 (Non-Goals)

- **不做** 执行结果回显：不把 bat 的 stdout/stderr 推回前端或终端面板；本轮只管"启动"。若未来要看输出再另起任务。
- **不做** VSCode 之外的 IDE 支持（Cursor / WebStorm / Trae 等）。
- **不做** 执行任意脚本：只针对 `.bat` 和 `.cmd`，不扩到 `.ps1 / .sh / .py`。
- **不做** 对 VSCode 路径的自定义配置项：假设 `code` 在 `PATH` 里（Windows 安装时默认勾选）。失败就报错给用户，不做 fallback 探测。
- **不做** 跨平台：本项目已声明 Windows 优先（用户截图 + start.bat 存在），macOS/Linux 的 "用 VSCode 打开" 与 "执行 bat" 都不在本轮。

## 实施步骤

1. **后端 · 新增路由 `POST /api/projects/:id/fs/open-vscode`** —— 在 [packages/server/src/routes/fs-ops.ts](packages/server/src/routes/fs-ops.ts) 第 208 行前新增；复用 `loadProjectOr404` 拿到项目路径，用 `spawn` 调起 `code` 命令（Windows 下需走 `cmd.exe /c code <path>`，因为 `code` 是 `code.cmd`，`spawn` 直接调会 ENOENT）。参照 `revealInSystemExplorer` 的 detached + unref + swallow error 模式。
   - verify：`curl -X POST http://localhost:<port>/api/projects/<id>/fs/open-vscode` 返回 `{ok:true}` 且 VSCode 弹出。

2. **后端 · 新增路由 `POST /api/projects/:id/fs/exec-bat`** —— 接收 `{ path: string }`；安全校验三件套：`safeResolve` 限定在项目内、`existsSync` 确认文件存在、后缀必须是 `.bat` 或 `.cmd`（小写比较）。执行方式待用户定（见 §澄清）。
   - verify：POST 合法路径返回 `{ok:true}`；后缀非白名单返回 400；路径跨目录返回 400/403。

3. **前端 · api.ts 加两个封装** —— 在 [packages/web/src/api.ts](packages/web/src/api.ts) 第 370 行附近，按 `openInFolder / deleteEntry` 的同款模式加 `openInVscode(projectId)` 和 `execBatFile(projectId, path)`。
   - verify：TS 类型通过 `pnpm -r build`。

4. **前端 · ProjectsColumn.tsx 加菜单项** —— 在 [ProjectsColumn.tsx](packages/web/src/components/layout/ProjectsColumn.tsx) 第 222 行（"删除项目" 那个 button）前插入一个新 `<button>`，位置放「权限配置」和「删除项目」之间比较自然（或放在「文件」后面，待用户定顺序）。图标用 `</>`，文案「用 VSCode 打开」。失败用 `alertDialog` 提示，参照 `openInFolder` 的错误处理。
   - verify：浏览器里右键项目，能看到新项，点击 VSCode 弹出；后端 500 时前端弹错误对话框。

5. **前端 · fileContextMenu.ts 加条件菜单项** —— 在 [fileContextMenu.ts](packages/web/src/components/fileContextMenu.ts) 第 158 行（return 数组末尾）前，根据 `kind === 'file'` 且 `path` 以 `.bat` 或 `.cmd` 结尾（忽略大小写），插入「执行」项，图标 `▶`。点击后 `try/catch` 包 `api.execBatFile`，失败走 `alertDialog`。为了视觉分组，考虑放在 "打开所在文件夹" 下面。
   - verify：右键 `start.bat` 能看到「执行」；右键 `README.md` 看不到。

6. **回归检查** —— `pnpm -r build` + 手动点一次既有的「打开所在文件夹」「权限配置」，确认没被改动影响。
   - verify：构建通过、旧菜单行为不变。

## 边界情况

- **`code` 不在 PATH**：`spawn` 会触发 `error` 事件（ENOENT）。我们会把这个错误**同步感知**（不能按 `revealInSystemExplorer` 那样完全 fire-and-forget），否则前端永远看到 ok。方案：给 spawn 加一个短时的 error 监听 + 延迟判定，或者改成 `exec('where code')` 预探测。**偏好方案**：直接监听 `spawn` 返回的 `ChildProcess` 的 `error` 事件并 race 一个 200~500ms 的 setTimeout：若 200ms 内没有 error 就认为启动成功，回 ok；若 error 则回 500 带 message。这点需要用户确认是否可接受（见 §澄清）。
- **VSCode 已经打开同一窗口**：`code <path>` 默认会在现有窗口打开；想新窗口得加 `-n`。按常识不加，跟系统默认行为走。
- **bat 路径含空格**：`spawn` 用数组形式传参天然安全，不需要手动转义。
- **bat 本身报错/无限循环**：不在本轮关心（Non-Goal 之一），我们只管启动。
- **用户反复双击菜单**：会起多次进程；本轮不做防抖（简单点先）。
- **bat 文件被删后执行**：`existsSync` 拦住，返 404。
- **`kind === 'dir'` 时路径以 `.bat` 结尾**（目录名就叫 `foo.bat`）：要求 `kind === 'file'`，不给目录挂「执行」。
- **符号链接 / 大小写**：`safeResolve` 已经做 realpath 归一化，沿用即可。
- **项目根不是 git 仓库**：与两个路由都无关，不做处理。

## 风险与注意（含待澄清假设）

### 需要用户确认的 3 个点（**请你拍板**）

1. **bat 执行方式 —— 新开可见 cmd 窗口 / 后台静默**？
   - A. **新窗口（推荐）**：`spawn('cmd.exe', ['/c', 'start', '"bat"', '/D', <dir>, <batAbs>], { detached:true, stdio:'ignore' })` —— 用户能看到输出、交互（`pause` 能等）。start.bat 这种明显是给人看的。
   - B. **后台静默**：`spawn('cmd.exe', ['/c', batAbs], { cwd:dir, detached:true, stdio:'ignore' })` —— 跑完就没了，用户看不见任何东西。
   - 我倾向 A。

2. **VSCode 启动失败的处理**？
   - A. **同 revealInSystemExplorer，fire-and-forget**：不监听 error，前端永远 ok。优点简单；缺点"code 没装"时用户一脸懵。
   - B. **短时 race 监听 error（推荐）**：200ms 内没 error 视作成功；否则 500 带 message，前端 `alertDialog` 提示「未找到 VSCode，请确认已安装并把 code 加入 PATH」。
   - 我倾向 B。

3. **「用 VSCode 打开」菜单位置**？
   - A. 放在「📁 文件」和「⚙ 权限配置」之间（按"打开相关功能"聚类）。
   - B. 放在「⚙ 权限配置」和「删除项目」之间。
   - C. 菜单顶部（第一项）。
   - 我倾向 A。

### 其他风险

- 本项目我只读了 `fs-ops.ts / api.ts / ProjectsColumn.tsx / fileContextMenu.ts` 四个"关键文件"。若路由注册还需要在 [packages/server/src/index.ts](packages/server/src/index.ts) 显式挂载新接口，会涉及到这个第五个文件（看样子 fs-ops 已经在 `registerFsOpsRoutes` 里注册了，我只是在同一个函数里加新 route，应该**不需要**动 index.ts，但等 context 阶段再确认一次）。
- `safeResolve` 和 `toRepoRelative` 的具体行为我还没读 [git-service.ts](packages/server/src/git-service.ts)，默认相信它按名字做的事就是"把相对路径落到项目根内、防目录遍历"。context 阶段会打开确认。
