# 启动脚本彻底清理旧进程 · Context

## 关键文件

- `start.bat`（根目录）：现有清理在 L37-44（杀命令行含项目根的 node.exe）+ L46-52（端口兜底）。改动点：清理整体挪到 `pnpm install` 之前，单行 powershell 换成调 ps1。
- `scripts/start-cleanup.ps1`（新建）：进程快照 + 三规则圈杀 + 子孙展开 + 自身链保护。

## 决策记录

- **为什么独立 ps1 而不是继续塞 -Command 单行**：清理逻辑从 1 条规则变成 3 条 + 树展开，单行内嵌的引号转义（bat 里 `\"`）不可维护；-File 传参干净。不算过度设计——逻辑量决定的。
- **为什么用"旧 cmd（命令行含 bat 路径）+ 子孙展开"而不是逐条枚举进程名**：进程树覆盖 pnpm 主进程（命令行 `node ...pnpm.cjs dev:all` 不含项目路径）、dev:alt 的 `node scripts/dev-alt.mjs`（相对路径）、cmd shim、conhost 等所有形态，枚举名单永远列不全。
- **自保护**：从当前 powershell `$PID` 沿 ParentProcessId 走到顶，整条祖先链（含本次新 cmd、explorer）入保护集，圈杀与子孙展开都跳过保护集。
- **路径匹配大小写不敏感**（IndexOf OrdinalIgnoreCase）：原版 Contains 是大小写敏感的，Windows 路径不该敏感，顺带修正（属于本任务范围：匹配规则本身就是要改的代码）。
- **清理挪到 install 前**：旧 esbuild.exe / node-pty 锁文件会让 pnpm install / rebuild 失败，原脚本注释自己也承认 rebuild 必须在杀进程后。
- **bat 传 -Root 前先去掉尾部反斜杠**：`"%~dp0"` 以 `\` 结尾，`\"` 会被 PowerShell 参数解析吃掉引号。

## 依赖与约束

- Windows PowerShell 5.1（无 `&&`、无三元）；`Get-CimInstance Win32_Process` 一次全量快照，`-OperationTimeoutSec 30` 防 WMI 卡死。
- start.bat 必须保持 ASCII。
- stable / dev 双实例靠路径区分，$Root/$Bat 都是各自实例的绝对路径，互不波及。
