# 归档评审与记忆 · Plan (v0 草稿)

> 状态：**等用户确认**。本 plan 有若干关键叉口需要你定方向，不是写完就开工。

## 背景

大哥是 vibe coder。任务完成归档时，目前只是 `rename` 把 `dev/active/<任务名>/` 整体移到 `dev/archive/<任务名>__<时间戳>/`——无任何"复盘、蒸馏、沉淀"步骤。

`dev/active/施工边界/施工边界-plan.md` 末尾的"下游 P5"记下了决策方向：
- **自动触发 + 自动写 `dev/memory/lessons.md`**
- 双模型强制（写代码的 AI 不能评审自己）
- `lessons.md` 分区：`auto/` vs `manual/`
- "一键撤回最近 N 条自动规则"入口

现在要把 P5 从备忘变成实做。但 P5 原话只有方向，**具体机制需要你拍几个关键决策**才能开工。

## 目标

让 vibe coder 在点"归档"时，项目自动跑一轮评审，把这次任务值得沉淀的经验（坑、约定、套路）自动写入 `dev/memory/lessons.md`。之后起新任务时这些 lessons 能被 AI 自动读到（通过 CLAUDE.md 引用链或 hook 注入）。评审结果大哥可一键撤回，避免污染长期记忆。

### 可验证的验收标准（v0 提议，最终以你定的路子为准）

**记忆基础设施**：
1. 项目根下存在 `dev/memory/lessons.md`（不存在就自动创建），内部分 `## auto` / `## manual` 两节
2. CLAUDE.md 增加一段指令："每个任务 Plan 阶段必须先读 `dev/memory/lessons.md`"——可观察：新起任务时 AI 在 plan.md 里引用过 lessons 条目
3. UI 新加 Dev Docs 侧栏「记忆」tab，能看到 auto / manual 两节所有条目，支持"撤回最近 N 条自动条目"按钮（浏览器可观察）

**归档评审**：
4. 归档按钮点一下 → UI 弹窗显示评审进行中 → 完成后 lessons.md auto 节新增 0–N 条
5. 评审产出的 lessons 条目在 UI 上可见来源任务名（便于溯源）
6. 类型检查两条命令都 exit 0

**回滚**：
7. 「撤回最近 N 条」按钮能把 auto 节最近 N 条移到 `dev/memory/rejected.md`（保留历史，不直接删）

## 关键决策叉口（必须你先定，才能写 tasks）

### D1. 评审由哪个模型跑？

项目里**没有后端异步调 Gemini/Codex/GPT 的封装**。要"双模型强制（写代码的不评自己）"，有三条路：

- **A. 后端走 HTTP 直连外部 API**（Gemini / OpenAI / Anthropic key）
  - 需要 API key 注入（环境变量 / UI 填）
  - 需要联网、要付费、要管 rate limit
  - 可做到"点归档 → 自动出结果"真无人值守
  - **代价**：新增一个后端 HTTP client 抽象 + 密钥存储机制

- **B. 后端 spawn 第二个 CLI**（例如 `codex exec < prompt.md` 一次性运行）
  - 复用现有 CLI installer / spawn 基础设施（pty-manager.ts）
  - 不需要 API key，走 CLI 登录态
  - Codex CLI 需装好、登录好；Gemini CLI 同理
  - 可做到无人值守，但依赖用户本地 CLI 可用
  - **代价**：比 A 轻，但执行耗时长、产出解析有不确定性

- **C. 弱"自动"**：归档时 UI 弹窗给一段评审 prompt，大哥 **手动** 粘到 Gemini / Codex / ChatGPT 里，回来贴回 UI
  - 零代码复杂度
  - 不是真"自动"，但解耦度最高
  - vibe coder 可能嫌麻烦

**建议**：从 B 起步（代价最低、且"双模型"物理成立——写代码的是 Claude，评审的是 Codex/Gemini）。A 留作后续。C 太弱、违背"自动触发"原话。

**你选 A / B / C？**

---

### D2. 评审触发时机

- **同步阻塞**：点归档 → 评审跑完（可能几十秒到几分钟）→ 归档完成
  - 用户体验：等待明显、但结果线性清晰
- **异步**：点归档 → 立即归档完成 → 后台评审 → 完成后通知 + 写 lessons
  - 用户体验：归档即时反馈；但评审结果延后出现，可能被遗忘
- **可取消**：归档后台起评审，UI 给"查看进度 / 取消"按钮

**建议**：**异步 + UI 状态提示**。归档是"人已经满意"的语义节点，不该被 AI 评审卡住。评审产出一条 toast + 「记忆」tab 新增条目。

**你选同步 / 异步 / 异步+取消？**

---

### D3. 记忆的存储格式

- **单文件 `dev/memory/lessons.md`，内部用二级标题分节**
  ```markdown
  ## auto
  - [2026-04-23 / 施工边界] 别在 `migrate()` 里 `DELETE FROM projects` —— 会通过 CASCADE 把 sessions 表全炸（issues.md）
  
  ## manual
  - vibe coder 偏好 "出问题先停下问，别自己选一个方向跑远"
  ```
  - 优点：一份文件，人读 + grep 都顺
  - 缺点：撤回时要原地改文件，格式易坏

- **两个独立文件 `dev/memory/auto.md` + `dev/memory/manual.md`**
  - 优点：撤回只碰 auto.md、结构干净
  - 缺点：读时需要 cat 两份

**建议**：两文件方案。外加 `dev/memory/rejected.md`（撤回后的归档池，不直接删）。

**你选单文件 / 双文件 / 其它？**

---

### D4. "新任务自动读 lessons" 怎么强制

让 AI 起新任务时一定能看到 lessons，有两条路：

- **A. 改 CLAUDE.md**：加一句"Plan 阶段的第一步是读 `dev/memory/auto.md` + `dev/memory/manual.md`，把相关条目点出来"。依赖 AI 自觉性。
- **B. 用 hook**：在 Claude 的 `SessionStart` 或 `UserPromptSubmit` hook 里自动把 lessons 塞进 context（系统提示词侧）。vibe coder 不需要信任 AI 自觉。

**建议**：**A + B 双保险**。CLAUDE.md 加指令（治本），hook 做 belt-and-suspenders。B 复用现有 hook 基础设施（aimon-hook.mjs），成本低。

**你选 A / B / A+B？**

---

### D5. 撤回"最近 N 条"怎么理解

- 按时间戳倒序取最新 N 条（`lessons.md` 里每条需要带时间戳）
- 按归档任务倒序，"撤掉最近一次归档产出的所有条目"
- 按用户在 UI 上勾选的条目

**建议**：三种都支持，但 UI 主入口是"勾选具体条目→撤回"（最直观）。快捷键/按钮再加"撤回最近一次归档的全部条目"（最常用场景）。

**你选哪种 / 组合？**

---

### D6. 评审 prompt 怎么写

评审产出啥：从一次归档的任务目录（plan.md / context.md / tasks.md + 改动过的源文件）里蒸馏"**换个任务还会再踩的坑 / 约定 / 套路**"——也就是 CLAUDE.md 第 152 行写的标准。

Prompt 骨架建议：
```
你正在评审一次已完成的任务。以下是该任务的 plan / context / tasks 三份文档，以及改动的关键文件。
输出 0–5 条 lesson，每条单行，格式：
  - [<日期> / <任务名>] <一句话结论>（上下文：<为什么会踩坑>）
只写"换一个任务还会用到的"结论。跟当前任务绑死的细节（某个 bug 修法 / 临时 workaround）不写。
如果没有值得沉淀的，输出空。
```

**你看这个骨架 OK 吗？有没有要加的维度（例如"安全/性能/可维护性"各一条）？**

---

## 非目标（本轮不做）

- 不做"记忆全文搜索"UI。当前规模（按字面拼接）够用。
- 不做"记忆条目评分 / 投票"。自动产出 + 人工撤回就够。
- 不做"记忆跨项目共享"。每个项目的 `dev/memory/` 独立。
- 不改 `dev/issues.md` 的联动链（问题面板保持原样）。
- 不做多语言 / 国际化。中文单语。
- **不做归档前置双检**。本 plan 只做"归档后蒸馏"，评审跑失败不阻塞归档。

## 实施步骤（粗粒度，等 D1–D6 定了再写 tasks）

1. **记忆基础设施**：`dev/memory/` 目录 + 三个 md 文件 auto.md / manual.md / rejected.md 的骨架；后端 CRUD（list / append / rollback）
2. **UI「记忆」tab**：DocsView 加一个 tab，列条目、撤回按钮；浏览器可观察
3. **评审 runner**：后端实现 D1 选的路线（HTTP / spawn CLI / 手动），产出蒸馏结果
4. **归档触发评审**：现有 archive 路由里追加一个 fire-and-forget 评审 job；job 完成后 append 到 auto.md
5. **CLAUDE.md / hook 注入**：D4 选的方案落地
6. **撤回机制**：UI 按钮 + 后端 rollback 路由
7. **类型检查 + 端到端手工验收**

## 边界情况

- **评审 runner 崩了 / 超时**：归档继续成功，UI 给一条 warning toast "评审失败（<原因>），请手动运行 <命令>"
- **空归档**（任务目录里只有 plan/context/tasks，没改任何源文件）：评审照跑，但 prompt 里显式告知"本任务无源文件改动"，让模型决定是否有 lesson 可产出
- **大任务目录**（改动源文件 > 50 个）：截断 / 分批。具体策略等 D1 定了再细化（HTTP 和 CLI 的 context window 策略不一样）
- **并发归档**：两个项目同时归档两个任务 → 评审 job 排队 / 并行（看 D2 选啥）
- **CLAUDE.md 已被用户手动改过很多**：加指令时别覆盖，找个合适位置追加（避开既有 "# Dev Docs 工作流" 的核心段落）

## 风险与注意

- **D1 路线 B 的副作用**：后端 spawn CLI 进程，进程要管生命周期（pty-manager 已有，但评审 job 不是交互式 session，复用可能别扭）
- **双模型"严格性"**：CLAUDE.md 说"写代码的 AI 不能评审自己"。如果 vibe coder 所有会话都用 Claude（codex / gemini 没装），则 P5 直接失效降级到 A+Gemini 外部 API 或 C 手动粘贴。**这是大哥的物理前提**，plan 要显式交代。
- **记忆"失真漂移"**：模型自动蒸馏可能把一次性坑写成普遍规则。对策：标记来源任务 + UI 撤回 + 定期大哥扫一遍。这轮不做扫描提醒，留作后续。
- **"跨任务知识沉淀"已有 CLAUDE.md 第 145-152 行的手动规范**。本 plan 的自动化 **不是替换**，而是 **补强**：AI 自觉 + 归档蒸馏双通道，让 vibe coder 不全靠 AI 自觉。这点 plan 和 CLAUDE.md 里都要显式写清楚。

## 外部审查

_（用户未触发"多模型/第二意见"关键词，本轮跳过外部审查。如需跑，告诉我"让 gemini / codex 看看"。）_
