# 会话启动模板-yaml 化 · Plan

> Memory 扫过：`dev/memory/auto.md` 最近条目仅有"hook 冒烟"占位条，与本任务无关；`dev/memory/manual.md` 的"小功能直接改"豁免规则不适用——本任务涉及新增 yaml 解析层 + 后端路由 + 前端 UI 改 + session 首条 prompt 注入，量级明显超出"右键菜单加一项"。

## 背景

大哥在调研 `warpdotdev/warp` 后想把"启动 session"演进成 yaml 化模板。Warp 的 `workflows` 仓库（warpdotdev/workflows）schema 字段：`name / command / arguments / tags / description / source_url / author / shells`。我们对接时**只取语义合身的子集**（name / description / arguments 不立即支持参数化，先记字段）。

当前 `StartSessionMenu.tsx` 启动 session 时只关心三件事：
- 选哪个 agent（claude / codex / gemini / shell / cmd / pwsh / …）
- 要不要 worktree 隔离
- 任务名（用于匹配 skill）

**没有"模板"这个一等公民概念**。本任务把"模板"作为新维度引入。

## 目标

让用户能在"启动 session"菜单里**一键挑一个预设组合**——不用每次手填任务名 + 勾隔离 + 选 agent + 进 session 后再敲首条 prompt。模板存 `dev/templates/*.yaml`，仿 Warp workflows schema 的精简版。

### 验收标准（浏览器可观察）

1. 项目根 `dev/templates/` 放一份示例 `bug-fix.yaml`；启动菜单顶部出现一栏 "📋 模板"，里面有一行"📋 修复 bug"。
2. 点"📋 修复 bug" → 菜单里"任务名"输入框被填成模板里的 `taskName`、"工作区隔离"复选框按模板设置自动勾上、"AI Agent" 列表里模板指定的那个 agent 高亮成"待启动"。
3. 用户点 agent → session 启动 → 进入 session 后，第一帧的输入框被预填模板里的 `firstPrompt`（用户回车就能发；不发也行，可改）。
4. LogsView 能看到 `scope=session action=template-pick` 起止配对（成功）和 `scope=session action=start` 起止配对（成功）。
5. 故意写一份格式错的 yaml（比如缺 `name` 字段）→ 启动菜单照常打开，那条模板不显示，LogsView 出现 `scope=server action=template-load` 的 ERROR 配对。
6. 删掉 `dev/templates/` 目录 → 启动菜单里 "📋 模板" 整栏隐藏（不显示空状态），其余功能不受影响。

### 用户看得见的变化（白话版，给大哥）

- 启动按钮点开后菜单顶部多一栏"📋 模板"。
- 点模板会"代你填好"任务名、隔离开关，进 session 后第一句话也会代你打好（用户按回车就发）。
- 模板从项目根 `dev/templates/` 文件夹里读 yaml 文件，文件夹不存在或是空的就当没这功能、菜单里也不出现这一栏。

## 非目标 (Non-Goals)

- **不**做模板编辑器 UI（本轮直接编辑 yaml 文件即可）。
- **不**做参数化（Warp 的 `{{argument}}` 占位符）；模板里写啥就原样塞进 session。
- **不**对接 commands.dev 或任何外部模板市场。
- **不**做"全局/用户级模板"——只支持项目级 `dev/templates/*.yaml`。
- **不**重构 StartSessionMenu 现有 skill 匹配逻辑；预填任务名后 skill 注入照走原路。

## 实施步骤

1. **定 yaml schema + 写规约文档**：在 `docs/session-templates.md` 写一份精简 schema（必填 `name` / `agent` / 可选 `description / taskName / isolation / firstPrompt`），并附 1 份示例。
   - verify: 人工读一遍 docs，确认字段够用、措辞大哥能看懂。

2. **后端：加路由 `GET /api/projects/:id/session-templates`**：扫项目根 `dev/templates/*.yaml`，逐文件解析，zod 校验失败逐条 `serverLog level=warn scope=server action=template-load`，整体永远 200 + 数组。
   - verify: 在测试项目放 `bug-fix.yaml` + 一份缺 `name` 的坏 yaml；curl 端点 → 返回 1 条；LogsView 看到 1 条 warn 配对。
   - verify (类型): `pnpm -F @aimon/server tsc --noEmit` 通过。

3. **前端类型 + 客户端函数**：`packages/web/src/types.ts` 加 `SessionTemplate` 类型；`api.ts` 加 `listSessionTemplates(projectId)`。
   - verify: `pnpm -F @aimon/web tsc --noEmit` 通过。

4. **前端 UI：StartSessionMenu 顶部插入"📋 模板"栏**：菜单打开时拉模板列表；点模板项执行"预填动作"——`setIsolationOn / setTaskName` 各赋值；如果模板里指定了 `agent` 且该 agent 已安装，就把 agent 列表里那条按钮高亮（不自动启动；让用户最后点一下确认）。空列表整栏隐藏。预填动作要 `pushLog scope=session action=template-pick`。
   - verify: 浏览器点 "📋 修复 bug" → 字段预填、agent 行高亮、LogsView 配对完整。

5. **session 首条 prompt 注入**：`api.createSession` 的请求体加可选字段 `firstPrompt: string`；后端 `routes/sessions.ts` 在 session 起来后，把它经现有 PTY 写入通道喂进去（不自动按回车——保持"用户能改了再发"的语义；具体怎么喂参考 worktree-smoke 已有写法）。
   - verify: 启动后 session 第一帧能看到那条命令在输入栏里，光标位置正确，按回车正常执行。
   - verify: 不带 `firstPrompt` 启动时行为完全等同改前。

6. **冷启动样本**：在 `dev/templates/` 放 2 份示例（`bug-fix.yaml`、`new-feature.yaml`）。
   - verify: 删了菜单空、加回来菜单有，全程零报错。

7. **类型检查 + smoke**：`pnpm -F @aimon/server tsc --noEmit && pnpm -F @aimon/web tsc --noEmit`；如果有相关 smoke（`scripts/worktree-smoke.mjs` 等），跑一次确认 session 启动路径没退化。
   - verify: 全绿。

## 边界情况

- `dev/templates/` 目录不存在 → 端点返回 `[]`，前端整栏隐藏，无 warn 无 error。
- 单个 yaml 解析失败 → 不抛、不阻塞其他模板，warn 一条带文件名。
- yaml 里 `agent` 引用的 CLI 用户没装 → 模板项依然显示但点击后只预填字段、agent 选择不动（用户自己挑装了的）。
- yaml 里 `isolation: true` 但项目不是 git 仓库 → 模板项依然显示但 `setIsolationOn(true)` 后 UI 现有的"非 git 项目禁用隔离"逻辑会把开关置回（不需要本任务额外处理，已有保护）。
- `firstPrompt` 含 `{{argument}}` 占位符 → 本轮**不解析**，原样塞入；docs 里写"参数化暂不支持"。
- yaml 文件名含特殊字符或非 utf-8 → 跳过 + warn。

## 风险与注意

### 关键风险（必须在 context 阶段确认）

- **firstPrompt 怎么"喂"进刚起的 session 是核心未知**：需要读 `packages/server/src/routes/sessions.ts` 看 createSession 流程，以及 SessionView/EditorArea 怎么把字符发到 PTY。git status 显示这两个文件当前都是 **modified 未提交状态**——`packages/server/src/routes/sessions.ts` / `packages/web/src/components/editor/EditorArea.tsx` / `packages/server/src/routes/hooks.ts` / `packages/server/src/db.ts` / `packages/web/src/api.ts` / `packages/web/src/types.ts` / `packages/web/src/components/StartSessionMenu.tsx`。**强假设**：这是大哥最近在做的"worktree 隔离 / 任务绑定 / 后台 Jobs 面板"那一波（最近一次 commit `1a17f23` 提到了），还没收尾。本任务再去碰 sessions.ts / EditorArea.tsx **会跟未提交改动撞**。
   - 应对：context 阶段第一件事就是确认这些未提交改动是不是收尾了；没收尾就**先停**，把决定权交给大哥——选一条：(a) 等他先 commit；(b) 本轮先做 step 1-4（不碰 step 5 的注入逻辑），把"模板预填字段"做掉，"喂首条 prompt"留到后续；(c) 把未提交改动先 stash，他事后再续。

### 假设

- 后端 monorepo 内已有 yaml 解析能力或可加最小依赖（首选 `yaml` 包，零依赖、纯 ESM）。如果项目大哥不想加新依赖，回退方案是手写一个 60 行内的极简 yaml 子集解析器（只支持 string/bool/object 三层），但**不推荐**——心智负担更高。
- session 启动后存在某个"首帧输入"的可写入点——后端有 PTY 通道（PTY = 伪终端，Web 上模拟一个真实终端），前端有 `aimonWS` 之类的 WS（WebSocket，浏览器跟服务器的双向长连接）已经能发字符。
- 项目根 = 后端 routes 已经知道的 `project.path`，扫 `dev/templates/` 直接拼路径即可。

### 可能波及"关键文件"之外的模块

- `packages/web/src/logs.ts` 不需要改（`logAction` 已通用）。
- `packages/server/src/log-bus.ts` 不需要改。
- `dev/templates/` 是新建目录，不会跟既有任何流程冲突。

## 用户感知差异分叉（需要大哥拍板）

按 CLAUDE.md，只有"用户看得见的不同"才该让大哥选。下面列两条：

### 分叉 A：选了模板后是否"自动启动 session"
- **A1（默认推荐）**：模板项点击只**预填字段**，agent 行高亮提示"按这个就能起"。用户最后再点 agent 确认。
  - 好处：所见即所得，预填错了也来得及改；跟现有"先勾再点"的菜单节奏一致。
- **A2**：模板项点击直接**起 session**（用模板里指定的 agent）。
  - 好处：少一次点击。
  - 坏处：万一模板里 agent 没装、隔离开关跟项目状态打架，得退回去重选；且没法在启动前临时改任务名。

### 分叉 B：模板列表的入口位置
- **B1（默认推荐）**：放在启动菜单**顶部**（"工作区隔离"开关之上），独立一栏 "📋 模板"。
  - 好处：醒目；用户一眼能看到"今天有几个预设可挑"。
- **B2**：放在启动菜单**底部**"📦 安装更多 CLI…"那一节附近。
  - 好处：菜单更紧凑、不打扰只想随便起一个 session 的用户。
  - 坏处：模板会被忽略、推广不出去。

如果大哥没特别意见，按 **A1 + B1** 落地；他要换组合就回这条 plan 改。
