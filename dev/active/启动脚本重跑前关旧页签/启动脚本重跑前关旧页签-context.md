# 启动脚本重跑前关旧页签 · context

## 关键文件
- `packages/web/src/components/runExecutable.ts`
  - `runBatFile(projectId, path)` L17-39：起 cmd 会话 → addSession/setActiveSession/subscribe → 120ms → sendInput 跑 bat。当前返回 void，内部不暴露新会话 id。
  - 改：返回新会话 id；加模块级 `startBatSessionByProject: Map<string,string>`；新增 `runProjectStartScript` + 内部 `closePrevStartBat`。
- `packages/web/src/components/layout/ProjectsColumn.tsx`
  - `onLaunch` L171-189：getStartScript → resolved 则 `runBatFile`，否则弹 StartScriptDialog。改调 `runProjectStartScript`。import L8。
- `packages/web/src/components/StartScriptDialog.tsx`
  - `saveAndRun` L63-91：setStartScript 后 `runBatFile`。改调 `runProjectStartScript`。import L4。
- 关闭会话参照：`editor/EditorArea.tsx::closeSessionTab` L139-193——dead 则只 removeSession，alive 则 `api.deleteSession(id)` + removeSession，包 `logAction('session','stop',...)`。
- store：`useStore.getState()` 有 `sessions` / `liveStatus` / `removeSession`(L746)。

## 决策记录
- **为什么不把关旧塞进 runBatFile**：runBatFile 还被 `runExecutableFile`（文件右键运行任意 bat）复用，那条路不该"关上一个"。只在"项目启动脚本"语义的新包装 `runProjectStartScript` 里做关旧，职责清晰，不波及文件运行。资深工程师视角：没有过度设计，就是一层薄包装 + 一个 Map。
- **为什么用模块级 Map 不扫 store**：store 里 cmd 会话没有"我是启动脚本起的"标记，扫 agent==='cmd' 会误杀文件运行/手动开的 cmd。显式记账最稳。Map 放模块级（非组件 ref）以跨组件重挂存活。
- **不持久化**：写到磁盘/localStorage 属过度设计；整页刷新后丢跟踪与现状同（现状本来就不关旧），可接受。

## 依赖与约束
- `api.deleteSession(id, opts?)` 已存在；非隔离 cmd 会话不需要 gc。
- `logAction(scope, action, fn, ctx)` 起止配对；关旧 scope=session action=stop，起新 scope=fs action=run-bat（runBatFile 内已埋）。
