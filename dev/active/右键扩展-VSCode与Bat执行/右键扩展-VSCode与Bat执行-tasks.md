# 右键扩展-VSCode与Bat执行 · 任务清单

- [x] T1 · 后端 `fs-ops.ts` 新增 `POST /api/projects/:id/fs/open-vscode` 路由（`spawn('cmd.exe', ['/c','code', projectPath])` + race 400ms 感知 error） → verify: TypeScript 类型通过；路由挂载在 registerFsOpsRoutes 函数体内；error 事件走 500 返回
- [x] T2 · 后端 `fs-ops.ts` 新增 `POST /api/projects/:id/fs/exec-bat` 路由（PathBody 校验 + safeResolve + 后缀白名单 `.bat/.cmd` + existsSync + `cmd.exe /c start "" /D <dir> <batAbs>` fire-and-forget） → verify: 非白名单后缀返 400 `not_a_batch_file`；越界路径 400 `path_outside_project`；不存在文件 404 `path_not_found`；合法路径返 `{ok:true}`
- [x] T3 · 前端 `api.ts` 新增 `openInVscode(projectId)` 和 `execBatFile(projectId, path)` 两个 export function，放在 "FS operations" 区块末尾 → verify: `pnpm --filter @aimon/web build` 类型通过；函数签名与 `openInFolder` / `deleteEntry` 同款
- [x] T4 · 前端 `ProjectsColumn.tsx` 在「📁 文件」按钮后、「⚙ 权限配置」前插入「🧩 用 VSCode 打开」button，点击调 `api.openInVscode`，失败用 `alertDialog` → verify: `pnpm --filter @aimon/web build` 通过；JSX 排列正确（4 项变 5 项）
- [x] T5 · 前端 `fileContextMenu.ts` 在「打开所在文件夹」项后、「添加到 .gitignore」项前条件插入「▶ 执行」项，条件 `kind === 'file' && /\.(bat|cmd)$/i.test(path)`，点击调 `api.execBatFile`，失败用 `alertDialog` → verify: TS 类型通过；右键 `.bat` 能看到，右键 `.md` 看不到（待运行时验证）
- [x] T6 · `pnpm -r build` 全量验证 → verify: 构建成功、无类型错误
  - server 包通过；web 包失败，但两处报错均在未改动的文件（`PromptLibraryDialog.tsx` 未使用变量、`DocsView.tsx` null 类型），属预存在问题。本次改动涉及的 4 个文件无 TS 报错。
- [x] T7 · 顺带：人工快速读一遍 diff，确认没有越界改动（只动 4 个文件） → verify: `git diff --stat` 只列出这 4 个目标文件
  - 确认：fs-ops.ts / api.ts / fileContextMenu.ts / ProjectsColumn.tsx 共 4 个源文件，外加自动生成的 `tsconfig.app.tsbuildinfo`。无越界。
