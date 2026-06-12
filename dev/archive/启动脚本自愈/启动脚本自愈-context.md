# 启动脚本自愈 · context

## 关键文件

- `start.bat`（行 29-42）：唯一改动点。
  - 行 29-30：`set FIRST_RUN= / if not exist node_modules set FIRST_RUN=1`
  - 行 32-38：`pnpm install`（保持不动）
  - 行 39-42：`if defined FIRST_RUN ( ... rebuild ... )` ← 替换这段
- `sync-to-stable.bat`（行 130-167）：阅读以确认 sync 行为，不修改。
  - 行 137-145：选 target ref（stable-* tag 优先）
  - 行 148-149：检测 pnpm-lock.yaml 是否变化
  - 行 157-166：变化才跑 install + rebuild
- `packages/server/src/db.ts:20`：`getDb()` 第一行 `new Database(...)` 抛错的位置——不修改，仅作背景。
- `packages/server/src/index.ts:49`：`getDb()` 调用点——不修改，仅作背景。

## 决策记录

**Q1：检测哪些 native 模块的二进制？**
- 选项 A：仅检测 `better-sqlite3`
- 选项 B：检测 `better-sqlite3` + `@homebridge/node-pty-prebuilt-multiarch`
- **选 A**：观察到的故障是 better-sqlite3，且它单独缺失就足以让后端启动失败；node-pty 缺失只影响开会话（更软、更显式）。rebuild 命令本身两个都重编译，所以 A 触发时也会同时修好 node-pty。资深工程师视角："为不会发生的场景写检测" → 不做。

**Q2：检测的实现方式？**
- 选项 A：`dir /s /b` 通配 + `for /f` 解析
- 选项 B：PowerShell 一行调用
- **选 A**：start.bat 已经混用 batch 和 powershell；这条检测用纯 batch 更轻、更快、不再开一个 powershell 进程。`dir /s /b ... 2^>nul` 是 batch 里的标准模式。

**Q3：是否保留 `FIRST_RUN` 变量？**
- 不保留。新逻辑（"binding 不存在就 rebuild"）天然覆盖 `FIRST_RUN` 的语义——首次安装时 binding 当然不存在，自然触发 rebuild。多保留一层冗余检查就是过度设计。

**Q4：dev 副本（路径含 `dev`、不含 `stable`）会不会受影响？**
- 同样受益。dev 也用同一份 start.bat（路径判断在脚本里做，rebuild 段不分 dev/stable）。dev 副本的 native 绑定缺失了同样会自愈。

**资深工程师过度设计自检**：本次只换一个判断条件，无新抽象、无新参数、无新文件。✓ 通过。

## 依赖与约束

- **运行环境**：Windows，cmd.exe + PowerShell（PowerShell 5.1 或更高）。`dir /s /b ... 2^>nul` 在所有 Windows cmd 都支持。
- **pnpm 版本**：项目锁定 `pnpm@10.20.0`（`package.json` packageManager 字段），其 store 结构为 `node_modules/.pnpm/<name>@<version>/node_modules/<name>/`，与本次 dir 通配假设一致。
- **Node ABI**：当前用 Node 22.18.0（NODE_MODULE_VERSION=127）。better-sqlite3@12.9.0 + @homebridge/node-pty-prebuilt-multiarch@0.13.1 都需要按当前 Node ABI 编译。
- **行尾约束**：start.bat 必须保留 CRLF（Windows batch）。Edit 工具仅替换内容，不动行尾，安全。
- **sync-to-stable 隐含约束**：dev 工作树必须 clean（行 67-78），且必须存在至少一个 stable-* tag（否则会 fallback 到 origin/main，变成把 main HEAD 整个推上去）。本次会新打 `stable-2026-05-06` 满足这个约束。
