# 工作流方法论提取为skill · 计划

## 大哥摘要

- 把 CLAUDE.md 里 7 条**通用方法论**（三段式骨架、多模型 Plan 会审、外科式改动+熔断、白话化、操作日志方法论、`dev/active/<任务名>/` 目录约定、**极小/小/默认三档量级判定**）抽出来，做成一个**全局 skill**（Skill = Claude Code 按关键词加载的提示词包；用户级 = 装在 `~/.claude/skills/`，所有未来项目都能用）。
- 用项目里现成的 `skill-creator`（专门造 skill 的小助手）来管理创建过程。
- **不动你能感知的任何东西**——VibeSpace 的现有界面、会话、数据、操作日志一律不变。
- **双轨保护**：CLAUDE.md 里通用部分**不删**，仍然作为 VibeSpace 的 100% 强制规则；skill 是给其他项目当种子。
- 验收点（你能在哪里看到效果）：
  1. `~/.claude/skills/dev-docs-workflow/SKILL.md` 文件存在
  2. VibeSpace 的 CLAUDE.md 顶部加一行"本项目额外遵守 dev-docs-workflow skill 中的通用方法论"
  3. 在你电脑的**别的项目**里新开 Claude Code 会话，说"我要加个新功能"——能看到 `dev-docs-workflow` skill 被自动加载（系统提示里会列出来）

## 目标

把 7 条通用方法论从 CLAUDE.md 抽离成全局可复用的 skill：

1. **极小/小/默认三档量级判定**（接到需求第一步 AI 自决，不问用户；极小=直接动手；小=写三文件不停等；默认=走完整流程只在 plan 后停一次）
2. Dev Docs 三段式骨架（plan→context→tasks 三文件 + verify 字段 + tasks.json 同步）
3. 多模型 Plan 会审（Claude 调研 → Gemini+Codex 评审 → Codex 综合主笔 → Claude 白话化兜底）
4. 外科式改动 + 熔断 2-3 次（只碰必须碰的，连续失败两次停手）
5. 白话化输出（术语括号解释、大哥摘要段、技术分叉自决不打扰非技术用户）
6. 操作日志起止配对的方法论（不绑定具体函数名，只描述"任何 mutation 都要 begin/end 配对 + ERROR 路径"）
7. `dev/active/<任务名>/` 目录约定（含归档迁移策略、任务名规范）

**验收标准**：
- `~/.claude/skills/dev-docs-workflow/SKILL.md` 创建成功
- frontmatter（YAML 元数据头）的 `description` 命中"新功能/重构/bug 修复/非平凡改动/计划/任务清单"等关键词
- VibeSpace 的 CLAUDE.md 顶部加一行指向该 skill
- 在其他项目新会话里能被自动列入可用 skill 清单

## 非目标

- **不**把 VibeSpace 专属内容塞进 skill：`dev/issues.md`、`packages/web/src/logs.ts` 的 `logAction`、`packages/server/data/logs/` 落盘路径、`vibespace-*` agent 调度表、`dev/memory/auto.md` 自动评审——这些**仍留在** CLAUDE.md
- **不**删 CLAUDE.md 里的通用方法论部分（双轨并存，本轮纯增量）
- **不**改业务代码、UI、数据库、API、操作日志埋点

## 实施步骤

1. 创建任务目录 `dev/active/工作流方法论提取为skill/`，写 plan/context/tasks/tasks.json
2. 调用 `Skill skill-creator`，把 6 条方法论作为材料喂给它，请它产出 skill 骨架（含 description 优化）
3. 跟随 skill-creator 引导，把内容落盘到 `~/.claude/skills/dev-docs-workflow/SKILL.md`（如果 skill-creator 不直接落盘，由我手动 Write）
4. 在 VibeSpace 的 CLAUDE.md 顶部加一行"本项目额外遵守 dev-docs-workflow skill 中的通用方法论"
5. 写 handoff 摘要给大哥

## 边界情况

- skill-creator 可能要求交互式输入——按已有材料直接回答，不再回头问大哥
- Windows 路径 `~/.claude/skills/` 实际是 `C:\Users\Administrator\.claude\skills\`，落盘前确认目录存在
- 若 skill 名 `dev-docs-workflow` 已被占用，fallback 到 `surgical-dev-flow`
- skill-creator 若要求跑 eval 测试，请它跳过——本轮只产文件

## 风险与注意

- **触发不稳定**：skill 是 description 命中才加载。所以本轮是**双轨**——CLAUDE.md 仍然是 VibeSpace 的硬性 100% 规则；skill 是其他项目的种子
- **维护成本**：以后改一条方法论要在 CLAUDE.md 和 skill 两边同步——已知风险，先接受
- **skill 体量**：6 条全部塞进去可能超 skill 推荐长度。如果超了，按重要性排序，把次要细节挪到 reference 文件

## 多模型 Plan 会审

跳过：本任务无业务代码改动、无大方向分叉、用户已给定明确范围与归宿（6 条材料 + 全局 + 用 skill-creator 管理），属小档执行类。Codex/Gemini 评审在此场景价值低于其调用成本。
