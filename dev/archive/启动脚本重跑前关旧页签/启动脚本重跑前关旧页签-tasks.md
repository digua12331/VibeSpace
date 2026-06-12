# 启动脚本重跑前关旧页签 · 任务清单

- [x] 1. runExecutable.ts：runBatFile 返回会话 id + 模块级 Map + runProjectStartScript/closePrevStartBat → verify: `pnpm -F @aimon/web build` 过
- [x] 2. ProjectsColumn.onLaunch、StartScriptDialog.saveAndRun 改调 runProjectStartScript（含 import） → verify: build 过；浏览器：同项目连点 ▶ 只剩一个启动终端 / 不同项目互不影响 / 旧终端手动关掉后再点不报错；LogsView 见 session/stop(reason=relaunch-start-script) + fs/run-bat 配对
