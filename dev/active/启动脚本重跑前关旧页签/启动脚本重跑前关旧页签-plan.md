# 启动脚本重跑前关旧页签 · plan

## 大哥摘要
项目列表里每行那个 ▶（一键启动）按钮，现在每点一次就新开一个跑 start.bat 的终端页签，点几次就堆几个。
本次改成：再点同一个项目的 ▶ 时，先把上一次它开的那个 bat 终端页签自动关掉，再开新的——同一个项目永远只留最新那一个启动终端。
不动你已有的别的终端、别的项目，也不动任何数据；纯页签管理。

## 目标
- 同一项目重复点 ▶（或在「设置启动脚本」弹窗里再次保存并运行），旧的启动终端页签先关、再开新的。
- 验收（浏览器可观察）：
  1. 对某项目点 ▶ → 出现一个 cmd 终端页签跑 start.bat；再点一次 ▶ → 旧页签消失、只剩新的一个（不是两个）。
  2. 不同项目各点一次 ▶ → 互不影响，各保留各自一个启动终端。
  3. 若旧启动终端已被大哥手动关掉，再点 ▶ 不报错，正常开新的。
  4. LogsView 看到：关旧时 `scope=session action=stop`（meta.reason=relaunch-start-script）起止配对，起新时 `scope=fs action=run-bat` 起止配对。

## 非目标
- 不改文件右键里「运行 .bat/.cmd」的行为（那是运行任意文件，不该互相关闭）。
- 不动后端 start-script 路由 / projects.json 存储。
- 不持久化"上次启动会话"到磁盘——页面整刷后丢失跟踪属可接受降级（旧会话由后端自己存活，刷新后再点只是关不掉上一个，和现状一致）。

## 实施步骤
1. `runExecutable.ts`：加模块级 `Map<projectId, sessionId>` 记最近一次启动脚本会话；`runBatFile` 返回新建会话 id；新增 `runProjectStartScript(projectId, path)` = 关旧（若仍存活/仍在页签）+ 跑新 + 记账。 → verify: web build 过
2. `ProjectsColumn.tsx` onLaunch、`StartScriptDialog.tsx` saveAndRun 两处启动入口改调 `runProjectStartScript`。 → verify: web build 过 + 浏览器三条行为分支

## 边界情况
- 首次启动：无旧记录 → 直接开新。
- 旧会话已被手动关：store.sessions 里找不到 → 跳过关闭、清记录、照常开新。
- 旧会话已 stopped/crashed 但页签还在：不调 deleteSession（已死），直接 removeSession 把页签摘掉。
- 关旧失败（后端报错）：不阻塞开新，最多多留一个旧页签。

## 风险与注意
- 跟踪用模块级 Map，整页刷新后丢失——属已知降级，写进非目标。
- 关旧走 `session/stop` 日志 + `fs/run-bat` 日志，保持现有埋点形态。

## 多模型 Plan 会审
跳过：小档任务（改一个已有按钮行为，2-3 文件，无破坏性变更，易回滚），按 CLAUDE.md 小档不调外部模型。
