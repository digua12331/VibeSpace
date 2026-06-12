# 启动脚本彻底清理旧进程 · Context

## 关键文件

- `start.bat`（根目录）：现有清理在 L37-44（杀命令行含项目根的 node.exe）+ L46-52（端口兜底）。改动点：清理整体挪到 `pnpm install` 之前，单行 powershell 换成调 ps1。
- `scripts/start-cleanup.ps1`（新建）：进程快照 + 三规则圈杀 + 子孙展开 + 自身链保护。

## 决策记录

- **【执行中实测推翻原方案】WMI 在这台机器上不可用**：`Get-CimInstance Win32_Process`（带不带 -Filter、带不带 -OperationTimeoutSec）一律 30 秒超时；不带超时参数的裸查询 3 分钟不返回。原 start.bat 的清理因 SilentlyContinue 静默失败多时。**新方案全程零 WMI**，可用替代已实测：Get-Process 43ms、NtQueryInformationProcess 取父进程 <1s（含 Add-Type 编译）、Process.StartTime 8ms、Toolhelp 快照毫秒级。
- **PID 档案 + 子孙树击杀**（替代"命令行匹配"，因为无 WMI 拿不到命令行）：本次启动用 Toolhelp 快照查出 ps1 自己的父进程（= 运行 bat 的 cmd），记 `pid|StartTime.Ticks` 到 `.vibespace/start-bat.pid`；下次启动读档案 → StartTime 容差 3 秒核验（防 PID 复用误杀）→ 快照建 PID→PPID 图 → BFS 圈出旧 cmd 的全部子孙。
- **只杀白名单形态**（node.exe / esbuild.exe / cmd.exe / conhost.exe / powershell.exe）：防"用户在自己终端手跑过 bat，之后该终端在跑别的（msbuild/python），下次双击把它们误杀"。conhost 在白名单内 → 杀掉它即关掉旧双击窗口。
- **不杀旧根 cmd 本身**：它可能是用户的交互终端。双击场景的旧窗口靠两条路关闭：(a) conhost 被杀 → 控制台死 → cmd 跟着死；(b) pnpm 返回后 bat 跑 -CheckOwner，发现档案已被新实例改写 → `exit /b` 自关（交互终端场景 exit /b 只退脚本不关终端，安全）。
- **自保护**：保护集 = 自己 + 沿 PPID 走到顶的整条祖先链；同终端重跑 bat 时旧根是自己祖先，BFS 跳过保护集即不自杀。
- **esbuild 孤儿兜底**：esbuild.exe 可执行文件在项目 node_modules 下，Get-Process 的 Path 字段就能认出来，不需要命令行。node.exe 是全局安装路径认不出，孤儿 node 靠 bat 里 netstat 端口清理（加 /T）兜底。
- **清理挪到 install 前**：旧 esbuild / node-pty 锁文件会让 pnpm install / rebuild 失败，原脚本注释自己也承认 rebuild 必须在杀进程后。
- **bat 传 -Root 前去掉尾部反斜杠**：`"%~dp0"` 以 `\` 结尾，`\"` 会被 PowerShell 参数解析吃掉引号。

## 依赖与约束

- Windows PowerShell 5.1（无 `&&`、无三元、Get-Process 无 .Parent —— 父进程必须走 NtQueryInformationProcess / Toolhelp）。
- **本机 WMI 不可用是长期约束**，任何启动路径上的代码不要再依赖 Get-CimInstance / wmic（已沉淀到 dev/learnings.md）。
- start.bat 必须保持 ASCII。
- pidfile 放 `.vibespace/`（已被 gitignore 覆盖）。
- stable / dev 双实例路径不同 → 各自 pidfile / Root，互不波及。

## 过程备注

- 任务目录曾被外部动作（疑似并行「项目文件清理」会话或 UI 归档）移到 dev/archive，已移回 active 继续。
