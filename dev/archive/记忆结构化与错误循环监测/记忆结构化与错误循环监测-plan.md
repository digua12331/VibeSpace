# 记忆结构化与错误循环监测 · Plan

## 大哥摘要

这次做两件事：

第一，把「记忆」tab 里一行行的经验记录（auto.md，AI 归档任务时自动总结出来的经验）升级成带标签的小记录，之后能按类别（比如"踩坑"/"约定"/"操作流程"）、严重度、关联文件来过滤查找。

第二，让系统自己盯着重复报错——同一类错误在当前这次启动后连续出现 3 次，就在「记忆」tab 顶部弹一张提醒卡片，告诉你"这个错误最近老出现，要不要把它写成一条 manual.md（你手动维护的长期经验文件）经验？"。点卡片会把建议草稿复制到剪贴板，并打开 manual.md，由你决定要不要粘进去——**不会自动改你的文件**。

做完后你主要在「Dev Docs」侧栏的「记忆」tab 验收：能按类别筛经验、顶部能看到重复错误提醒、卡片能关闭或标记已读。

这次不会改老的 28 条 auto.md 经验，不会自动写 manual.md 或 CLAUDE.md（项目规则文件），也不会动现有"会话启动时自动塞经验给 Claude"的 10KB 上限。

## 目标

1. 结构化经验仍保持 auto.md 单行格式，但支持行尾标签 schema（格式约定）：`[category=...; severity=...; files=...]`。标签用分号分隔，`files` 内部用逗号分隔，路径不得含逗号；解析只认行尾最后一个方括号段，正文里出现类似 `[category=...]` 不应被误吃。验收：用老格式、新格式、正文含方括号三类样例跑 memory-service 相关测试，均能正确解析。
2. 老格式 auto.md 条目必须继续显示，默认视图不丢失；缺标签条目归入「未分类 / 未标严重度 / 无关联文件」兜底项。验收：浏览器打开「记忆」tab，默认能看到老条目，筛「未分类」也能看到未标标签条目。
3. 归档评审产出的经验允许带 category/severity/files 标签，但不强制。验收：模拟 LLM（大模型，负责产出经验文本）输出有标签、无标签、多行、表格等情况，extractLessons 只接受合法单行经验，不因缺标签阻塞归档回退链路。
4. MemoryView 增加 category/severity/files 过滤能力。验收：浏览器里能用下拉或筛选控件筛出指定类别、严重度、关联文件，也能一键回到「全部」。
5. 错误循环检测按 `(scope, action, projectId?)` 聚合错误；缺字段时回退到 `(scope, action)`；后端 serverLog 没有 action 时，用 msg 前 32 字符的 hash 作为 fallback action。验收：同 key 在 1 小时窗口内累计 3 次 error 触发 1 次告警，不同 projectId 不误聚合；缺 action 的后端错误也能稳定聚合。
6. 错误告警只作为当前服务进程运行期间的提醒，不作为审计记录；服务重启后内存状态清零。验收：重启服务后旧告警计数不再触发，UI 文案明确表达「当前运行期间检测到」。
7. 告警广播和展示完整可用：后端发 WS（浏览器和后端之间的实时消息通道）`error-pattern-alert`，前端维护 alerts 数组，上限 50 条，告警卡片可关闭或标记已读。验收：浏览器在「记忆」tab 顶部看到告警卡片，能点开复制 manual.md 草稿并关闭/已读，长期触发不会超过 50 条。
8. 告警本身要进入操作日志。验收：触发重复错误后，LogsView 能看到告警记录，`packages/server/data/logs/YYYY-MM-DD.log` 里也能看到对应 JSONL（每行一条 JSON 日志）记录。
9. UI 改动必须可观察可点击。验收：在浏览器里完成「筛选记忆」「触发重复错误告警」「关闭/已读告警」「复制 manual.md 草稿」四个动作，并在 LogsView 看到相关起止配对日志。

## 非目标

1. 不接 Evolver，不把这次能力扩展成自动改规则或自动进化系统。
2. 不回写迁移老 28 条 auto.md，只做向后兼容解析和显示兜底。
3. 不破坏 SessionStart hook（会话启动时自动注入记忆的机制）的 auto 末尾 30 条 + manual 全文 + 10KB 上限。
4. 不自动写 manual.md 或 CLAUDE.md，只提供复制草稿和打开文件入口，由主理人决定是否沉淀。
5. 不引入持久化数据库，错误循环检测先做内存态 MVP（最小可用版本）。
6. 不做 cluster（多进程部署，多个服务进程同时跑）支持；单进程假设写入风险。

## 实施步骤

### 任务 A：结构化经验

1. 升级 memory-service 的解析与类型：保留现有单行经验格式，新增可选 category/severity/files 字段，LINE_RE 拆成「基础经验行」+「行尾最后一个标签段」两层解析；验证：新增单元测试覆盖老格式、新格式、正文方括号、files 逗号分隔、路径含逗号拒绝或忽略。
2. 调整 review-runner 的 prompt 和提取逻辑：提示评审仍必须一条经验一行，可选补充 `[category=...; severity=...; files=...]`，extractLessons 宽进严出，缺标签不失败；验证：用有标签、无标签、非法多行、markdown 表格输出跑提取测试，合法行保留，非法行丢弃。
3. 更新 API 和前端数据结构：MemoryEntry 增加可选字段，getMemory 返回结构化字段，老条目默认 category=unknown 或前端映射为「未分类」；验证：接口返回老条目和新条目都能被前端渲染。
4. 更新 MemoryView 过滤 UI：增加类别、严重度、关联文件筛选，默认「全部」，提供「未分类 / 未标严重度 / 无关联文件」兜底；验证：浏览器在「记忆」tab 能切换筛选并看到列表变化，老条目不消失。
5. 确认 SessionStart 注入不变：仍按 auto.md 文本末尾 30 条 + manual 全文注入，不额外读取索引文件；验证：跑 hooks 相关测试或直接调用 buildSessionStartAdditionalContext，确认输出仍受 10KB 上限控制。

### 任务 B：错误循环检测

1. 在 log-bus 增加内存 ErrorPatternMonitor：阈值常量集中放 monitor 内部，固定为 1 小时窗口内至少 3 次、24 小时冷却、前端 alerts 上限 50，本轮不暴露 UI 配置；验证：单元测试覆盖 3 次触发、2 次不触发、冷却期不重复触发。
2. 定义聚合 key：优先 `(scope, action, projectId?)`，缺 projectId 时用 `(scope, action)`，缺 action 时用 msg 前 32 字符 hash 作为 fallback action；验证：不同 projectId 不误聚合，缺 action 的 serverLog error 仍能形成稳定 key。
3. 把监控挂到 error 日志路径：serverLog 写入和 broadcast 后异步调用 monitor，监控逻辑用 try/catch 包住，异常必须吞掉并 serverLog 一条 warn，绝不反向打断 serverLog；验证：故意让 monitor 抛错，原始 error 日志仍能落盘和广播，并多一条 warn。
4. 触发告警时广播 WS `error-pattern-alert` 并记录 alert 日志：同 key 冷却期内不重复广播，告警日志也写入 JSONL 便于文件回放；验证：连续 3 次同 key error 只看到一次告警，日志文件有对应 alert 记录。
5. 前端 store 增加 alerts 状态：容量上限 50，支持新增、关闭、已读；WS 收到 `error-pattern-alert` 后进入状态；验证：模拟 60 条告警后只保留最新 50 条，关闭/已读后 UI 状态正确。
6. MemoryView 顶部增加告警卡片：显示「当前运行期间检测到」的重复错误提醒，点击可生成 manual.md 草稿、复制到剪贴板并打开 manual.md 文件入口，不自动写文件；验证：浏览器里能看到卡片、复制草稿、关闭/已读，manual.md 内容不会被自动修改。
7. 按操作日志规则补齐 UI mutation 日志：复制草稿、关闭/已读等用户主动动作使用 logAction 包装，后端 alert 使用 serverLog；验证：LogsView 看到 `scope` 和 `action` 的起止配对，失败分支至少触发一次 ERROR。

## 边界情况

1. 老条目无标签：必须继续显示，默认「全部」包含它们，并能在「未分类 / 未标严重度 / 无关联文件」里被筛出。
2. LLM 不按 prompt 出标签：缺标签不算评审失败，extractLessons 继续接受合法单行；多行、表格、非法格式丢弃，不扩大修复范围。
3. 正文里出现方括号：解析只认行尾最后一个标签段，正文中的 `[category=...]` 不应改变 lesson 正文。
4. files 字段解析歧义：只支持逗号分隔，路径不得含逗号；遇到含逗号路径按非法标签处理，保留正文但不解析 files。
5. 错误日志无 action：后端直接 `serverLog('error', scope, msg)` 的路径用 msg 前 32 字符 hash 作为 fallback action，避免全挤到一个空 action。
6. 不同 project/session 是否误聚合：projectId 纳入 key；sessionId 暂不纳入默认 key，避免同一项目同类错误被拆太碎。若后续发现误报，再单独升级。
7. 日志风暴：1 小时 3 次触发后进入 24 小时冷却，同 key 不重复广播；前端 alerts 上限 50，避免页面长期运行无限增长。
8. WS 断线重连补发：本轮不做历史补发，断线期间错过的告警只能从落盘 JSONL 查；UI 文案不承诺告警历史完整。
9. cluster 多进程分裂：当前按 fastify 单进程处理；未来多进程时每个进程各自计数，可能重复或漏聚合，本轮只在风险里说明。

## 风险与注意

1. 最大风险是把 review-runner 的自由文本输出变成半结构化协议（介于纯文本和严格数据之间的格式）。处理原则是宽进严出：标签是可选增强，不让缺标签污染 codex/gemini 回退链路。
2. LINE_RE 升级要非常克制，只做兼容解析，不改 auto.md 的主体存储机制；否则会影响 SessionStart tail 注入和归档评审追加。
3. 监控逻辑不能反向打断 serverLog。所有 ErrorPatternMonitor 入口必须 try/catch，异常吞掉并补一条 warn 日志。
4. 告警刷屏风险通过 24 小时冷却、前端 50 条上限、关闭/已读控制；不要先做复杂配置。
5. MemoryView 同时承载记忆管理和错误告警，职责会稍混杂，但作为 MVP 可接受；后续拆 Logs/Health 页面不在本轮。
6. manual.md 是主理人独占，本轮只能复制草稿和打开文件，不自动写入，不把误报沉淀成长期规则。
7. 告警状态只存在当前服务进程内存里，重启清零；落盘 JSONL 能回放 alert 日志，但不恢复 monitor 计数。

## 多模型 Plan 会审

> [Codex 评审] 保留行尾标签、内存态错误循环检测、缺标签不阻塞归档，并把告警做成复制草稿而不是自动写 manual.md/CLAUDE.md。
> [Codex 综合主笔] 采纳行尾标签和内存监控两条独立链路，放弃单独索引文件、自动写规则、UI 配置阈值和多进程支持，以降低同步和误报风险。
> [Claude 白话化兜底] 重写大哥摘要段（修正告警归属——是在「记忆」tab 顶部而非 LogsView，并补了 auto.md 的白话翻译、点卡片后的具体行为说明）；目标段 schema 加括号"格式约定"；其余 Codex 实施步骤、风险列表、决策记录未动。
跳过：gemini CLI 未安装（spawn ENOENT），不重试
