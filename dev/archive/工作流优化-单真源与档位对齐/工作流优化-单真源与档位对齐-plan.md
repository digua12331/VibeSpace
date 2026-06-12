# 工作流优化-单真源与档位对齐 · Plan

## 大哥摘要

这次不改产品功能，只改"AI 自己干活的规矩"（CLAUDE.md 工作流），落实你点头的三件事：①统一会审用双模型（Claude+Codex，不再带 Gemini）；②任务进度只以 tasks.md 复选框为准，不再让 AI 同时维护两份文件容易对不上；③把"默认走全流程"的门槛抬高，更多小改动直接走快档不啰嗦。你能看到的变化：以后小的 UI 改动不再每次都跑一长串流程；看板进度照常显示，不受影响。

## 目标

- 消除"双模型 vs 三模型"在多份规则文件间的版本漂移，统一为双模型。
- tasks 状态单真源：md 为唯一真源，json 只留结构 + 白名单 + blocked，后端看板进度改为数 md 复选框。
- 抬高默认档门槛：单文件/1–3 文件、无破坏性、易回滚的改动归小档。

验收：`pnpm -F @aimon/server build` 通过；仓库内无残留"三模型会审/三方协作"；看板徽章（DocsView 进度）仍正常显示 todo/doing/done/blocked。

## 非目标

- 不改产品功能、不改 Gemini 作为可选 CLI agent 的能力（review-runner 的 gemini 兜底等保留）。
- 不重写整段工作流，只动会审/任务量级/tasks 同步三处规则文本 + 一处后端进度推导。

## 实施步骤

1. 后端 `docs-service.ts::summarizeTask`：进度从 tasks.md 复选框推导，json 仅供 blocked + md 空时兜底。→ verify: server build 过。
2. 三份仓库内规则镜像（CLAUDE.md / AGENTS.md / dev-docs-guidelines.ts）同步改 #2 #3 两处文本。→ verify: grep 旧句无残留。
3. 仓库外 `F:\VibeSpace\CLAUDE.md` 把三模型段落 + #2 #3 对齐成双模型/新规则。→ verify: grep 三模型无残留。

## 边界情况

- tasks.md 还没写复选框、只有 json 时：保留 json 兜底，避免徽章显示 0/0。
- blocked 状态：md 复选框表达不了，保留 json 该步 status=blocked 作为唯一例外。

## 风险与注意

- 进度推导逻辑变更属内部行为，无新 mutation，不需要操作日志。
- 多份镜像必须同改，否则又制造新漂移（本次已覆盖 4 份规则文件）。

## 多模型 Plan 会审

> 跳过：本任务是工作流规则自身的对齐改动（含一处低风险后端进度推导），方向已由大哥在对话中确认（双模型 + 三处优化"都要"），未另派外部模型。
