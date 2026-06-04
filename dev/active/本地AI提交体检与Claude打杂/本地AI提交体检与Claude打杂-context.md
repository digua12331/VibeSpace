# 本地AI提交体检与Claude打杂 · Context（AI 自用）

## 关键文件（= 本次改动边界）

新建：
- `packages/server/src/local-ai-service.ts` — provider 枚举 + 可达性探测 + OpenAI 兼容 chat + 体检逻辑（规则扫描 + 模型补充）。
- `packages/server/src/routes/local-ai.ts` — 机器级 `/api/local-ai/*` 路由（providers / models / commit-check）。
- `scripts/local_ai_ask.py` — Claude 打杂 CLI（连 Ollama/LM Studio，仅标准库，UTF-8）。
- `.claude/skills/localai/SKILL.md` — Claude 打杂技能说明（含"只做简单杂活"硬边界）。

修改：
- `packages/server/src/index.ts` — import + `registerLocalAiRoutes(app)`（仿 250–280 行 registerXxx 序列）。
- `packages/server/src/git-service.ts` — 加一个导出函数 `getWorkingDiff(projectPath)`（跑 `git diff HEAD --no-color`，复用 `runGitOrThrow`，内部函数无法跨文件调用，故新增导出）。
- `packages/web/src/api.ts` — `getLocalAiProviders` / `getLocalAiModels` / `localAiCommitCheck`（仿 `request<T>` + `jsonInit`）。
- `packages/web/src/types.ts` — `LocalAiProvider` / `LocalAiModelsResult` / `CommitCheckResult` 类型。
- `packages/web/src/components/ChangesList.tsx` — 提交区（452–514 行附近）加 provider/model 下拉 + 「🩺 AI 体检」按钮 + 结论显示。

## 已核对的接口事实

- `git-service.ts`：`runGitOrThrow(projectPath,label,args,ms)` 是**内部**函数（未导出），所以要新增一个导出的薄封装跑全树 diff；`getChanges` 返回的 `ChangeEntry` 只有 `path/status`，**没有 size** → 未跟踪/暂存大文件检测要在 service 里用 `fs.stat`；二进制可从 diff 文本 `Binary files ... differ` 判定。
- 机器级路由范式：`routes/skill-market.ts` 用 `app.get("/api/skill-market/...")`，`index.ts` 里 `await registerSkillMarketRoutes(app)`。
- 后端日志：`serverLog(level, scope, msg, {projectId, meta})`；`git.ts::runLogged` 是 start/end 配对范式，直接仿。
- 前端日志：`logAction(scope, action, fn, {projectId, meta})`；`ChangesList.tsx::withBusy` 已用它包 git mutation，体检按钮仿 withBusy 但**不**做 `load()`（体检不改树）。
- 前端 API：`request<T>(path, init?)` + `jsonInit('POST', body)`（api.ts 头部）。
- `projectId` 在 ChangesList 是 prop，直接复用，不新增全局状态。
- 构建/类型门槛：`pnpm -F @aimon/web build`（前端）、后端 build（`pnpm -F @aimon/server build` 或仓库等价）。

## 决策记录（含"会不会过度设计"自检）

1. **不做 provider 生命周期管理**：只连用户自管的 Ollama/LM Studio，砍掉旧文档整套启停。资深工程师视角：符合 KISS，不过度。
2. **provider 固定枚举 + env 覆盖 URL，前端只传 id**：防 SSRF（服务端伪造请求攻击）。比"前端传 baseUrl"少一个攻击面，不算过度，是必要。
3. **规则扫描（密钥脱敏 + 大文件/二进制）+ 模型补充** 的混合，而非纯靠模型：小模型不稳，确定性毛病用规则保底；密钥不发原文给模型。规则保持薄（几条正则 + fs.stat + 二进制串匹配），不抽象成可配置引擎——只本次用，避免过度。
4. **体检范围 = 全部工作区改动**：对齐提交按钮"无暂存时暂存全部并提交"的现状，大哥已确认默认。
5. **provider/model 偏好存 localStorage**：是真实偏好（跨刷新保留），非瞬时状态，localStorage 合适；不进 DB，无迁移。
6. **首版只认 `/v1/models`**，不兼容 Ollama 私有 `/api/tags`：避免范围膨胀；老 Ollama 按"不可达"提示升级。
7. **`local_ai_ask.py` 不复用旧 `local_ai_chat.py`**：旧脚本绑定 Marvis 端口探测，与本次 provider 模型不同；新写更干净，旧脚本保留不动（避免破坏性变更）。

## 依赖与约束

- Ollama / LM Studio 均暴露 OpenAI 兼容 `/v1/chat/completions` 与 `/v1/models`；只用这两个标准端点，不碰各家私有 generate API。
- 体检是**只读**操作（读 diff + 调本地 AI），不写仓库、不改数据库 → 不属"破坏性变更协议"范围；但属"新增 UI 操作"，logAction/serverLog 起止配对为硬性。
- diff 截断：UTF-8 安全 + 整文件边界 + "已截断"标记。
- 交付不跑 browser-use 自动验收（2026-06-03 偏好），门槛=build+类型检查；UI 由大哥手动验。
