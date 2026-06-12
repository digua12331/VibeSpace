# 启动脚本彻底清理旧进程 · 任务清单

- [ ] 新建 scripts/start-cleanup.ps1（快照圈杀 + 子孙展开 + 自身链保护） → verify: powershell -File 手工跑一遍，不报错、不杀当前窗口
- [ ] 改 start.bat：清理挪到 pnpm install 前，调用 ps1 替换原单行清理 → verify: 模拟旧实例（起一个 dev 服务 + 一个旧 bat 窗口）后跑清理，旧进程被杀、新链存活
- [ ] 端到端：连续启动两次验证旧实例被清、新实例正常 → verify: 第二次启动输出 killing stale 行，端口无占用
