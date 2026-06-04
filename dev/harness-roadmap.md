# harness-roadmap

> VibeSpace 在 agent harness 谱系里的定位与改造路线图。
>
> 来源参照：`shareAI-lab/learn-claude-code` 的 12 层 harness 架构（s01–s12）。
>
> 本文档是**项目级**的，不属于任何单独 dev/active 任务；新立 harness 改造任务前先看一眼这里。

## 一、定位

**VibeSpace 不是 agent harness 本身，是 N 个 harness 进程的宿主**——同时托管 claude / codex / gemini / shell / pwsh 等 PTY 子进程。

所以"做 harness"对它的意思不是"在 VibeSpace 里再写一套 agent loop"，而是把 12 层 harness 里**进程内**的能力（subagent / context / mailbox / worktree …）外化成宿主端的 UI + 编排能力，让我们托管的这群 agent 能像 harness 化的团队那样工作。

## 二、12 层 × VibeSpace 全景对照

| harness 层 | 概念 | VibeSpace 处置 | 状态 | 对应任务 |
|---|---|---|---|---|
| **s01** Agent Loop | 单循环 | 不适用（loop 在 agent 进程里） | — | — |
| **s02** Tool Use | 工具注册 | 不适用 | — | — |
| **s03** TodoWrite | 计划先行 | Dev Docs 三段式（plan→context→tasks） | ✅ 项目原生 | 早期就有 |
| **s04** Subagents | 子任务隔离 | "subagent run 卡片"展示父 session 的 Task 调用 | 🟡 进行中 | `harness-subagent卡片与按需技能` Phase A |
| **s05** Skills | 按需知识注入 | `.aimon/skills/*.md` + task 关键词匹配；写 runtime prompt 文件 + env 路径 | 🟡 进行中 | `harness-subagent卡片与按需技能` Phase B |
| **s06** Context Compact | 历史压缩 | **劝退** | ❌ 不做 | 见下"劝退档"|
| **s07** Tasks 磁盘图 | 任务持久化 | Dev Docs `dev/active/<task>/` + task↔session 绑定 | ✅ 已做 | 项目原生 + `harness-task绑定与jobs面板` |
| **s08** Background Tasks | 异步守护 | JobsService（review）+ InstallJobManager（install）+ 📋 Jobs 面板 | ✅ 已做 | `harness-task绑定与jobs面板` |
| **s09** Agent Teams | 邮箱协作 | mailbox + MCP server inbox_send/read | 🟦 拆出未来评估 | 见下"未来评估"|
| **s10** Team Protocols | request/response 协议 | 与 s09 同步 | 🟦 拆出未来评估 | 与 s09 同 |
| **s11** Autonomous Agents | 自主认领 | **劝退** | ❌ 不做 | 见下"劝退档"|
| **s12** Worktree Isolation | 任务级 worktree | 完整 worktree + 独立分支 + DELETE gc | ✅ 已做 | `harness-worktree隔离` |

**项目级 agent 团队配置**：12 层 harness 落到 VibeSpace 自身开发流程时的"角色 × 工作流 × skill 触发"映射见 `dev/agent-team-blueprint.md`。该文档跟本 roadmap 配套读：roadmap 是"系统层做了什么"，blueprint 是"大哥怎么使用"。

**外加 VibeSpace 的宿主优势层**（不在 12 层里但很重要，全部项目原生）：
- 状态机（waiting_input 浏览器通知）
- 操作日志（LogsView + JSONL 落盘 30 天保留）
- 可持续记忆（auto.md / manual.md / rejected.md + 归档评审 + SessionStart hook 注入）
- 文件操作日志、权限抽屉、施工边界 glob
- 多 agent CLI 启动器（claude / codex / gemini / opencode / qoder / kilo / shell / pwsh）
- SCM 视图、性能面板、CLI 安装器

## 三、改造时间线

```
项目原生能力 (s03 / s07 / 宿主优势层)
    ↓
[第一波] s12 worktree 隔离  ✅ harness-worktree隔离
    ↓
[第二波] s07 强化 + s08 Jobs 面板  ✅ harness-task绑定与jobs面板
    ↓
[第三波·进行中] s04 subagent 卡片 + s05 skills  🟡 harness-subagent卡片与按需技能
    ↓
[未来评估] s09+s10 mailbox  🟦 spike → 立项
    ↓
[劝退] s06 / s11
```

## 四、劝退档

记录"为什么不做"，避免半年后重新争论。

### s06 · Context Compact
**它想解决什么**：AI 跑久了上下文塞满，重启失忆。

**为什么不做**：让 codex / gemini 给 claude 写"刚才的对话摘要"——AI 给 AI 写笔记**不靠谱**：可能听漏、误解、自己脑补。失忆你**知道自己失忆**会重新核对；错忆你**以为自己记得**按错的接着干，比失忆更危险。

**已有替代**：Dev Docs 工作流里 AI 自己会把进度写进 tasks.md；重启时人工说"继续 X 任务" → AI 读三个 md 接着干。再加 AI 摘要层是叠床架屋。

**复活条件**：除非有非常具体的"必须长跑且不能中断让 AI 自己写 tasks.md"的场景；目前看不到。

### s11 · Autonomous Agents
**它想解决什么**：dev/issues.md 堆 20 条，自动派 agent 消化，省点按钮。

**为什么不做**：节省的"派活动作" < 增加的"审核 + 返工"动作。worktree 能保护主仓不被污染（前置 s12 已做），但 worktree 内 agent 还是可能跑飞——10 个分支里 4 个改坏、3 个绕开核心约束、2 个死循环烧 token、1 个误删数据库——你早上来要一条条 review。

**更深的反对**：vibe coding 的乐趣在"我跟 AI 一起想"，把活全外包给守护进程会失去"知道项目在往哪走"的感觉。三周后看不懂自己的代码库。

**已有替代**：DocsView 任务行右键"派 Claude 继续任务" + 当前已有的 task↔session 绑定按钮足够。

**复活条件**：项目规模膨胀到一个人 review 不过来 + 有非常清晰的"agent 能完全独立完成不需 review 的任务类型"——比如纯文档同步、依赖版本 bump、机械重命名。这些场景出现时再立项。

## 五、未来评估档

记录"暂时不做但有 trigger 才做"。

### s09+s10 · Inter-Session Mailbox
**为什么暂时不做**

最初打算合并到 `harness-subagent卡片与按需技能` 任务的 Phase B。复审后拆出：

- 文件系统 mailbox（`<project>/.aimon/inbox/<sessionId>/*.json` + tmp+rename 原子写）实现风险极低
- **真正不确定的是协议链**：MCP 标准走 stdio，本地 server 想暴露 HTTP/SSE 端点让 claude/codex 当 MCP server 来调是非标做法
- 即使协议链通了，**agent 是否会主动调 inbox_send/read 取决于训练**（模型能力问题，不是 harness 工程问题）
- 两个不确定性都没消除前做完工程，最差结果是"server 端齐全 / agent 端不动"——半成品

**复活 trigger（任一）**：
1. 实际工作流里频繁出现"让 codex 做完后端、claude 做完前端互相接力"
2. claude/codex 官方文档明确支持 HTTP/SSE 形式的 MCP server
3. 出现 agent 间通信的**具体业务需求**（不是"听起来很 cool"）

**先做 spike（半天预算，不立项）**

- 起最简单的 stdio MCP server，只暴露一个 `inbox_send` tool
- 在本机 claude `--mcp-config` 加它
- 跑 prompt "请给会话 X 发个 hello"
- claude 会调 → 立项做完整 mailbox + UI
- claude 不会调 → 这条路死掉，本档移到劝退档

## 六、给未来 AI 的指引

下次接到"做 harness 改造 / agent 协作"这类需求：

1. **先看本文档**：判断目标层是否已做 / 已劝退 / 已拆出评估
2. **不要重复争论**：劝退档里写过理由的不要再开 plan；除非用户明确说"我有新场景，重新评估"
3. **新立项前更新本档**：开新任务前，把它的目标层在表格里改成 🟡 进行中并填任务名；交付后改 ✅；劝退后挪到劝退档
4. **保持表格简洁**：本文档不是变更日志（变更日志看 git log + dev/archive）；只反映"现状 + 决策"
