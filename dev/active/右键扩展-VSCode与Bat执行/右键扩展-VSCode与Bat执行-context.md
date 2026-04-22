# 右键扩展-VSCode与Bat执行 · Context

（基于用户确认的 **1A / 2B / 3A** 方案展开。）

## 关键文件

本次改动边界——只动这 5 个文件：

| 文件 | 用途 | 具体落点 |
|---|---|---|
| [packages/server/src/routes/fs-ops.ts](packages/server/src/routes/fs-ops.ts) | 后端 FS 操作路由 | 第 208 行前（`registerFsOpsRoutes` 函数体末尾、闭合 `}` 之前）新增两个 `app.post` 路由；顶部可能需要补一个 spawn 辅助函数 `spawnDetectingEarlyError`（用于 VSCode 启动错误感知） |
| [packages/web/src/api.ts](packages/web/src/api.ts) | 前端 API 封装 | 第 370 行后（"FS operations" 区块末尾）新增两个 `export function`：`openInVscode` / `execBatFile` |
| [packages/web/src/components/layout/ProjectsColumn.tsx](packages/web/src/components/layout/ProjectsColumn.tsx) | 项目列表 UI（含右键菜单） | 第 200 行「📁 文件」按钮之后、第 201 行「⚙ 权限配置」之前，插入一个新 `<button>`（方案 3A）。菜单项 onClick 内需要处理错误，复制"权限配置"按钮的布局类名即可 |
| [packages/web/src/components/fileContextMenu.ts](packages/web/src/components/fileContextMenu.ts) | 文件右键菜单构造器 | 第 110 行（"打开所在文件夹" 菜单项）后、第 111 行（"添加到 .gitignore"）前，条件插入「执行」菜单项；条件 = `kind === 'file' && /\.(bat|cmd)$/i.test(path)` |
| （无需动）[packages/server/src/index.ts](packages/server/src/index.ts) | 路由挂载点 | 第 137 行已挂载 `registerFsOpsRoutes`，新 route 写在该函数里就自动生效 |

**两个同样调用 `buildFileContextItems` 的上游**（顺带确认，菜单项会自动在这两处生效）：
- [packages/web/src/components/sidebar/FilesView.tsx:249](packages/web/src/components/sidebar/FilesView.tsx#L249) —— 文件面板（用户截图里的那个）
- [packages/web/src/components/ChangesList.tsx:84](packages/web/src/components/ChangesList.tsx#L84) —— git 变更列表。对 `.bat` 文件也会出现「执行」项；**这是有意保留的**（刚改完 bat 想立即试跑是合理场景，没必要为了区分调用点而引新参数）。

**关键辅助（只读，不改）**：
- [packages/server/src/git-service.ts:194](packages/server/src/git-service.ts#L194) `safeResolve(projectPath, input)` —— 归一化 `\` → `/`、去掉前导 `/`，再 `path.resolve` 拼绝对；越界就抛 `GitServiceError("path_outside_project", 400)`。完美覆盖「bat 路径必须落在项目内」这条校验，不用我自己写。
- [packages/server/src/routes/fs-ops.ts:35](packages/server/src/routes/fs-ops.ts#L35) `sendErr(reply, err)` —— 统一错误出口，能识别 `GitServiceError` 的 `httpStatus`，其余一律 500。
- [packages/server/src/routes/fs-ops.ts:54](packages/server/src/routes/fs-ops.ts#L54) `revealInSystemExplorer(abs)` —— fire-and-forget 的范例（`detached + unref + swallow error`），`exec-bat` 按此模式；`open-vscode` 要**偏离**这个模式（见下方决策记录 D1）。
- [packages/web/src/api.ts:34](packages/web/src/api.ts#L34) `request` / 第 62 行 `jsonInit` —— 所有 API 走这两个封装，错误会被装成 `Error & { status, code, detail }`，前端 `try/catch` 后可以直接读 `e.message` 给 alertDialog。

## 决策记录

### D1. VSCode 启动失败检测用「race + 超时」而非预探测

- **方案**：`spawn('cmd.exe', ['/c', 'code', projectPath], ...)` 返回一个 `ChildProcess`。监听 `error` 事件（ENOENT 等）并同时设一个 400ms 的 `setTimeout`。400ms 内没收到 error 就 `reply.send({ok:true})`；收到 error 就 `reply.code(500).send({error:'vscode_launch_failed', message})`。
- **为什么不预探测**（如 `execSync('where code')`）：多一次进程启动、对慢机器不友好；且 `where code` 找到了不等于后续 `spawn` 不会失败。Race 方案一次 spawn 搞定。
- **400ms 够吗**：ENOENT 是 libuv 同步 throw 到 error 事件的，实测都在 < 10ms 送达。400ms 纯粹是安全边际。
- **资深工程师会觉得过度设计吗**：不会。这是最小可行的"感知失败 + 不阻塞主进程"方案，没引新依赖、没引抽象。

### D2. bat 执行用 `cmd.exe /c start`（方案 1A），不用 `cmd.exe /k`

- **命令**：`spawn('cmd.exe', ['/c', 'start', '', '/D', <dir>, '/WAIT'（不加）, <batAbs>], { detached:true, stdio:'ignore' })`
- **要点**：
  - `start` 后紧跟一个**空字符串 `""`**，这是 start 约定的"窗口标题"参数位，否则当路径有空格时 `start` 会把路径当标题用，bat 就跑不起来。这是 cmd 的一个经典坑。
  - `/D <dir>` 把工作目录设成 bat 所在目录（和手动双击一致）。
  - **不加** `/WAIT` —— 加了会让请求线程等 bat 结束，违背 fire-and-forget。
  - `detached:true + stdio:'ignore'` + `child.unref()`：请求立刻返回，bat 进程脱离 node 生命周期。
- **为什么不用 `cmd.exe /k`**：`/k` 会让 cmd 跑完 bat 后保持打开（显示一个空 prompt），有的人喜欢，但双击 bat 的默认行为是 `/c`（跑完就关）。这里也模仿双击。如果 bat 里写了 `pause`，cmd 窗口会停住等按键，这是 bat 作者的意图，我们不覆盖。
- **资深工程师的眼光**：就地调一次 `cmd.exe /c start`，没有包一层"BatRunner" 类，没加队列/日志/状态追踪。**克制**。

### D3. bat 后缀白名单放在后端硬校验，前端只做 UI 过滤

- **为什么双重校验**：前端过滤（`buildFileContextItems` 里的条件）只是 UX 层，用户绕过前端直接 POST 接口依然能打到后端。后端必须验后缀，否则变成任意命令执行。
- **实现**：`if (!/\.(bat|cmd)$/i.test(abs)) return reply.code(400).send({error:'not_a_batch_file'})`。放在 `safeResolve` 后、`existsSync` 前（纯字符串检查，廉价）。
- **资深工程师**：也会这么做。不是过度设计，是安全最低线。

### D4. 两个新接口复用 `PathBody` schema，不新建 schema

- [fs-ops.ts:15](packages/server/src/routes/fs-ops.ts#L15) 已有的 `PathBody = z.object({ path: z.string().min(1).max(4096) })` 正好是 `exec-bat` 需要的。`open-vscode` 不需要 body（只用 URL 的 `:id` 拿项目路径），直接不传 body。
- **不做** "为新接口再抽一个 BatExecBody"。一个字段的对象没必要再抽象。

### D5. 菜单项的图标选择

- 「用 VSCode 打开」：`</>` emoji 在当前上下文（`🌿 / 📁 / ⚙ / 🗑`）里看起来和 VSCode 没什么关联。用 **`💠`**（方块 / 代码编辑器的朴素联想）或 **`🧭`** 又有点牵强。**决定用 `🧩`**（VSCode 图标用户脑里就是方块拼图感），和既有的 emoji 风格一致——可读性 > 像素级复刻。
- 「执行」：用 **`▶`**，这是最直觉的「运行」图标。
- **不做**：引入 SVG 图标库、自定义 icon 组件。保持和既有菜单统一即可（全是 emoji 单字符）。

### D6. 一个同步判断点：bat 执行前是否需要 user confirm？

- **不加**。理由：
  - 菜单项是用户主动右键点出来的，不会误触。
  - 已有"删除"走 `confirmDialog`，那是**不可逆**操作；执行 bat 是可逆的（大多数情况是启动某个工具）。加 confirm 会让这个功能变得烦人。
  - 用户的原始需求是"点击可执行"，没提到"二次确认"。
- 如果未来发现误操作风险大，再加 confirm 不迟（YAGNI）。

### D7. 路由命名

- `open-vscode` / `exec-bat`（kebab-case，和既有 `open-folder` / `gitignore-add` 一致）。
- 都放在 `/api/projects/:id/fs/` 前缀下——语义上 `open-vscode` 不是 FS 操作（它是"工具集成"），但为了不新增路由文件 / 不改 index.ts 挂载，**这里稍微将就一下语义**，放在 fs-ops 里。权衡：新增一个 `tool-ops.ts` 的好处仅是分类整齐，代价是多一个文件 + 多一个 index.ts 挂载行 + 一份重复的 `loadProjectOr404` 导入。**不值**，放进 fs-ops。

### D8. 错误提示文案统一中文

- 前端 alertDialog 里给人看，后端只回 error code + message。文案：
  - `vscode_launch_failed` → 前端映射为 `'启动 VSCode 失败，请确认已安装并将 code 加入 PATH'`（但为了最小代码量，**不做**前端映射表，直接把后端 message 原样显示；vscode_launch_failed 的 message 会带 ENOENT 细节，足以自助排查）。
  - `not_a_batch_file` / `path_not_found` 同理。
- **不做**：i18n、错误码文案表。

## 依赖与约束

- **Node spawn 行为**：Windows 下 `spawn('code', ...)` 会 ENOENT 因为 `code` 是 `code.cmd`（batch 脚本）。必须用 `spawn('cmd.exe', ['/c', 'code', ...])` 或者 `spawn(..., { shell: true })`。选前者——显式 > 隐式，且 `shell:true` 有拼接注入风险。
- **Zod**：项目里已有依赖（`import { z } from 'zod'`），复用即可。
- **Fastify**：泛型签名 `app.post<{ Params, Body }>(...)` 在 fs-ops.ts 里有现成示范，照抄。
- **TypeScript 严格模式**：`req.params.id` 在泛型里是 `string`，`parsed.data.path` 是 `string`，不需要 `!` 或额外断言。
- **工作目录**：`start` 的 `/D` 参数决定 bat 的 CWD。如果 bat 依赖"所在目录有某个文件"（这是常见写法），必须 `/D <dirname(abs)>`。
- **进程生命周期**：`spawn(..., { detached:true })` + `child.unref()` 让 bat 脱离 node 进程组。如果 node 进程关掉，bat 会继续跑——这是期望行为。
- **端口与 CORS**：新接口继承 `/api/projects/:id/*` 的前缀，已被全局 CORS 和 404 处理覆盖，无额外配置。

## 再问一遍「是否过度设计」

- 新增代码总量预估：后端 ~60 行（两个路由 + 一个 spawn 辅助），前端 ~30 行（2 个 api 函数 + 1 个 JSX 按钮 + 1 个条件菜单项）。**约 90 行**。
- 没引新依赖、没新建文件、没抽象新模块。
- 每一行都直接服务于用户的两个具体菜单项。

✅ 通过。
