# 修复后端启动 · 任务清单

- [x] 1. 预清理所有 AIkanban-main / AIkanban-stable 下的残留 node 进程 → verify: `tasklist /V` 里不再出现命令行含 `F:\KB\AIkanban-main\` 或 `F:\KB\AIkanban-stable\` 的 node.exe
- [x] 2. 改写 `F:\KB\AIkanban-main\start.bat`：加入身份判断（含 stable → stable 身份）、按身份选端口/脚本/URL、PowerShell 祖先追溯 kill、按身份端口兜底清 LISTENING → verify: 文件内容包含 `findstr /I "stable"`、`AIMON_PORT` 分支、`Get-CimInstance Win32_Process`、按 `%~dp0` 匹配 `CommandLine` 的过滤
- [x] 3. 在 main 下干跑一次 start.bat 只到身份识别阶段，确认 echo 出的身份和端口正确 → verify: 输出 "[VibeSpace] identity=dev, backend=9787, web=9788"（通过在脚本末临时 exit 或在测试时 Ctrl+C 在身份 echo 之后）
- [x] 4. 正式启动 main 的 start.bat，验证后端起来 → verify: `netstat -ano | findstr ":9787 "` 和 `":9788 "` 都有 LISTENING；`curl http://127.0.0.1:9787/health` 返回 2xx
- [x] 5. 把 `start.bat` 从 main 手动复制到 stable（本次测试用，不走 sync-to-stable）→ verify: 两个文件 md5 相同
- [x] 6. 在 stable 下启动 start.bat（main 保持运行），验证双端共存 → verify: 8787/8788/9787/9788 四个端口全部 LISTENING；两个浏览器窗口分别能访问对应前端，顶栏无红条
- [x] 7. 验证精准清理：关掉 stable 的窗口后重新跑 stable 的 start.bat，confirm main 的 node PID 没变 → verify: 重启前后 `Get-CimInstance Win32_Process | Where CommandLine -like '*AIkanban-main*'` 的 PID 集合一致
- [x] 8. 测试收尾：关掉两个 start.bat，再跑一次各自的 start.bat，确认 idempotent → verify: 再启动一次，仍能正常 LISTENING，没有 EADDRINUSE 报错
- [x] 9. 输出 handoff 摘要 + 告知 commit / sync-to-stable 的后续动作（由用户决定何时执行）→ verify: 本轮末尾出现摘要段
