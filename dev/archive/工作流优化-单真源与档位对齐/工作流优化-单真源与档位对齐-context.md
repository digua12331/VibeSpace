# 工作流优化-单真源与档位对齐 · Context

## 关键文件

- `packages/server/src/docs-service.ts`：`deriveStatus`（加 checked===0→todo）+ `summarizeTask` 进度推导改为以 md 复选框为准，json 仅 blocked/兜底。
- `CLAUDE.md`（项目，100% 权威）：tasks 同步规则（原 171-172）+ 任务量级（原 319-322）。
- `AGENTS.md`：同上两处镜像。
- `packages/server/src/dev-docs-guidelines.ts`：分发给其它项目的规则模板，同上两处（转义反引号）。
- `F:\VibeSpace\CLAUDE.md`（仓库外，装配产物，会被 SessionStart 注入）：三模型会审段 → 双模型 + 上述两处。

## 决策记录

- **为什么是 md 单真源而非 json 单真源**：工作流哲学一贯"md 为真源"（handoff、上下文接力、人读都靠 md），json 是机器派生物。故让进度从 md 推导，json 退化为结构 + 白名单容器。blocked 是 md 复选框唯一表达不了的状态，保留 json 承载它——这是最小代价的折中，不是过度设计。
- **为什么逐处小编辑而非整块替换 F:\VibeSpace\CLAUDE.md**：降低 exact-match 出错面，且该文件在仓库外，外科式改动更稳。
- **drift 方向选 dual 不选 triple**：大哥明确选双模型；且仓库内三份本就是双，掉队的是外部那份，对齐成双改动面最小。
- **Gemini 作为 CLI agent 的能力保留**：review-runner/cli-catalog 里的 gemini 是产品功能（可选 AI 终端 + 归档评审兜底），与"规划会审三模型"是两回事，不动。

## 依赖与约束

- docs-service 进度推导是 DocsView 看板徽章的数据源，改动需保证 todo/doing/done/blocked 四态仍正确。
- F:\VibeSpace\CLAUDE.md 亦可由 Dev Docs 侧栏"重装"从 dev-docs-guidelines.ts 重新装配（已更新生成器，重装结果与手改一致）。
