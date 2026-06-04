# 修复开发启动器依赖缺失

## 主理人摘要

这次要修的是 Windows 启动器 `start.bat` 在开发模式下打不开仪表盘的问题。  
做完后，你直接双击或运行 `start.bat`，应该能正常拉起后端和网页，不会再在黑窗里报 `Cannot find module 'cross-spawn'`。  
这次不动你的项目数据，也不改页面样式；主要是把启动路径里对一个容易失效的第三方包依赖去掉，让启动更稳。  

## 目标

- 找到 `start.bat` 触发 `Cannot find module 'cross-spawn'` 的直接原因，并把修复方案落到仓库里。
- 验收标准：
  - 运行 `pnpm dev:alt` 或 `start.bat` 时，不再因为 `cross-env` / `cross-spawn` 缺失而立即退出。
  - 开发环境能继续进入 `pnpm -r --parallel run dev`，并看到服务开始监听端口。
  - 主理人可在浏览器打开 `http://127.0.0.1:9788` 验收仪表盘能拉起。

## 非目标 (Non-Goals)

- 不处理与本次报错无关的前端页面、后端业务逻辑。
- 不顺手重构整套开发脚本，只修当前启动失败链路。
- 不改 stable 模式（稳定副本）的行为，除非验证发现同一问题也会影响它。

## 实施步骤

1. 复核报错链路，确认是锁文件正常但本地 `node_modules`（依赖安装目录）里 `cross-env` 的依赖链接残缺。verify: 读取 `pnpm-lock.yaml`、`package.json` 和 `node_modules/.pnpm` 结构。
2. 改启动路径，避免 `start.bat` 在开发模式下强依赖 `cross-env` 才能设置环境变量。verify: 运行对应启动命令，确认不再出现 `Cannot find module 'cross-spawn'`。
3. 补最小必要说明并做回归验证。verify: 再跑一次 `start.bat` 或等价命令，确认服务继续启动并能访问开发地址。

## 边界情况

- `node_modules` 整体损坏时，单靠脚本绕过 `cross-env` 也可能还会在别的包上失败，需要区分“这次已修”与“安装目录整体坏了”。
- stable 模式仍使用 `dev:all`，要确认这次改动不会误伤它原本的启动方式。
- Windows 批处理（bat 脚本）里的中文环境变量值需要保留原有编码兼容性。

## 风险与注意

- 假设：本次缺包是本地依赖链接残缺，而不是锁文件本身损坏；当前检查结果支持这个假设。
- 假设：开发模式需要的环境变量都可以直接在 `start.bat` 里设置，不必依赖 `cross-env`（跨平台设环境变量的小工具）。
- memory 引用：
  - `dev/memory/manual.md` 2026-04-24：小功能/小任务可直接处理，不必停下来等确认。
  - `dev/memory/manual.md` 2026-04-30：对主理人的说明要翻译成“你能看到什么变化”，不拿内部实现分叉打扰主理人。
