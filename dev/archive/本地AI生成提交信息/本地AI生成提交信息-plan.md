# 本地AI生成提交信息 · plan

## 大哥摘要

- 现在「源代码管理」面板提交框下面那排是「🩺 AI 体检」（让本地小模型挑改动里有没有忘删的调试代码/密钥之类低级毛病）。你不要这个——**这次把它整块删掉**，换成你真正想要的：提交信息框旁边加**一个「✨ 生成」按钮**，点一下，本机的 AI（Ollama / LM Studio，就是你自己电脑上开着的那种本地模型，不联网）读一遍当前还没提交的改动，自动写一句中文提交说明填进框里。你看一眼，行就点「提交」。**AI 只帮你填字，提交动作还是你手点**——不会自动提交、不会偷偷推送、不动你任何数据和分支。
- 「选哪个本地 AI、用哪个模型」从面板**挪进「设置」**里配一次就行，平时提交面板清清爽爽只剩一个生成按钮。
- 全程在你电脑本地跑，改动内容不出本机，不需要联网、不需要任何密钥。

## 目标与验收标准

**浏览器里能看到/能点的验收项（必须逐条可观察）：**

1. 打开右上角「设置」→ 多出一处「本地 AI（提交信息）」配置：能选后端（Ollama / LM Studio）和模型；关掉设置再打开，还记得上次选的。
2. 「源代码管理」面板提交信息框旁边出现「✨ 生成」按钮。本地 AI 没开 / 没选模型 / 工作区没改动时，按钮置灰并有提示文案。
3. 有未提交改动 + 本地 AI 已就绪时点「✨ 生成」→ 按钮转圈 → 提交框被自动填入一句中文提交说明；可手动改后照常点「提交」走完整提交流程。
4. 旧的「🩺 AI 体检」按钮和它旁边那两个下拉（后端 / 模型）从面板**彻底消失**。
5. LogsView（浏览器内的操作日志面板）能看到 `scope=ai action=commit-message` 的**起止配对**日志；故意把本地 AI 关掉再点「✨ 生成」→ 能看到一条 `error` 日志 + 提交面板出现红字错误提示。

**代码层验收：**

- 前端类型检查 `pnpm -F @aimon/web build` 通过。
- 后端类型检查（`pnpm -F @aimon/server build` 或等价 tsc）通过。
- `grep commit-check` 在 `packages/` 源码里无残留（旧路由 / 旧函数 / 旧类型全部清干净）。

## 非目标（本轮不做）

- 不做文档里臆想的「内置 llama-server 引擎」那套（自启停本地推理进程）——本轮只连用户自管的 Ollama / LM Studio。
- 不做流式逐字输出（转圈 → 一次性填好即可）。
- 不动提交 / 推送 / 暂存 / 撤销等任何现有 git 操作按钮。
- 不在 UI 里下载或管理模型。

## 实施步骤（每步带验证）

1. **后端服务**：`packages/server/src/local-ai-service.ts` 新增 `runCommitMessage(projectPath, provider, model)` —— 复用 `getWorkingDiff` 取改动、按字符预算截断、用「写提交说明」的 system prompt 调现有 `chat()`，取输出首个非空行 trim 作为 message，空则抛可重试错误；返回 `{ message, truncated }`。同时**删除** `runCommitCheck` 及其专用辅助（`scanDiff` / `SECRET_PATTERNS` / `DEBUG_PATTERNS` / `scanLargeFiles` / `parseModelJson` / 体检版 `SYSTEM_PROMPT` / `CommitCheckResult`）。→ verify: 后端 tsc 通过。
2. **后端路由**：`packages/server/src/routes/local-ai.ts` 把 `POST /commit-check` 换成 `POST /commit-message`，`serverLog` 起止配对 `scope=ai` `action=commit-message`，失败分支带 `meta.error`。→ verify: grep 确认无残留 `commit-check`。
3. **前端 api/types**：`api.ts` 的 `localAiCommitCheck` → `localAiCommitMessage`；`types.ts` 的 `CommitCheckResult` → `CommitMessageResult { message; truncated }`。→ verify: 随前端 build 一起过类型。
4. **设置弹窗**：`SettingsDialog.tsx` 通用页签里加「本地 AI（提交信息）」小节：后端 + 模型两个下拉，打开时拉 providers/models，选择写入 `localStorage`（沿用现有 `vibespace.localai.provider` / `vibespace.localai.model` 两个 key）。→ verify: 选完关闭再开仍记得（浏览器观察）。
5. **提交面板**：`ChangesList.tsx` 删掉整块体检 UI（两下拉 + 体检按钮 + 结果区）及其 state/effect；在提交框区域加「✨ 生成」按钮，从 `localStorage` 读 provider/model，用 `logAction('ai','commit-message',…)` 调接口，成功后 `setMessage(result.message)`。本地 AI 不可用 / 无改动时置灰。提交框已有手写内容时，先弹确认再覆盖。→ verify: 浏览器走通验收项 2/3/4/5。
6. **文档对齐**：更新 `docs/local-ai-commit-message.md`，删掉「内置引擎」臆想段，标注模型选择已移到设置。→ verify: 人读一致。

## 边界情况

- 本地 AI 未启动：`providers` 探测不可达 → 按钮置灰 + 提示「未检测到本地 AI，去设置选 / 先启动」。
- 工作区无改动：后端返回 400；前端也按 `totalChanges===0` 置灰。
- 模型输出多行 / 带前后缀客套话：只取首个非空行并 trim。
- diff 过大：按字符预算截断，`truncated=true`（message 仍可用，提示可弱化）。
- 提交框已有用户手写内容：覆盖前先 `confirmDialog` 确认，避免吞掉用户已打的字。

## 风险与注意

- **删 `/commit-check` 路由属破坏性变更（HTTP 路由删除）**：已 grep 确认仅前端 `ChangesList` / `api.ts` 自引用、无其它消费方，用户已明确授权删除体检功能。
- `localStorage` 作为模型选择的真源：设置弹窗与提交面板都读同一组 key，两边 key 常量必须一致（抽到共享常量或各自声明都行，但要对齐）。
- 本地小模型质量参差：生成的提交说明可能粗糙——这是预期内的，用户本就要手动过目再提交，不追求完美。

## 多模型 Plan 会审

跳过：本任务为小档（1:1 镜像现有 commit-check 管线 + 挪两个下拉 + 删旧 UI，改动收敛、易回滚），未调外部模型，由 Claude 单独成稿。唯一破坏性点（删体检路由）已 grep 确认无外部消费方并经用户授权。
