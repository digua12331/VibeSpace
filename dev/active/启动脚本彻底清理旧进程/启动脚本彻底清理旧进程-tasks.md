# 启动脚本彻底清理旧进程 · 任务清单

- [x] 新建 scripts/start-cleanup.ps1（零 WMI：PID 档案 + Toolhelp 子孙树 + 白名单击杀 + 自身链保护） → verify: 已手工验证——空跑记录档案、CheckOwner 返回 0、假进程树场景只杀树内 node/conhost 不伤其他 13 个 node
- [x] 改 start.bat：清理挪到 pnpm install 前，调用 ps1 替换原 WMI 单行；端口 taskkill 加 /T；pnpm 退出后加 CheckOwner 自关窗 → verify: 已验证——纯 ASCII 检查通过（仅 L23 既有中文，已记 issue）；最小复刻 bat 实跑新增片段（变量裁剪/ps1 调用/errorlevel 分支）全部正确
- [x] 端到端：脚本级全分支验证（假进程树被精确击杀、其他 13 个 node 无伤、owner/superseded 两分支返回值正确）；真实双击两次的最终验收由大哥执行（见 handoff 指引） → verify: killing stale 输出已在假树测试中出现；未跑真实 bat 是为了不误杀大哥正在运行的开发实例
