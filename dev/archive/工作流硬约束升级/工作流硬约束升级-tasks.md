# 工作流硬约束升级 · 任务清单

> 仅由 AI 在推进过程中维护；人类读，不改。本任务自身践行新规则——每步声明 read_files / write_files，最后跑 git diff 自校验。

- [x] 步骤 1：CLAUDE.md 加 tasks.json 模板的 read_files/write_files 字段 + 执行时硬性规则段加两条新规则（读写白名单 + 破坏性变更协议）→ verify: grep 命中（行 155/163/171/190/191）
- [x] 步骤 2：CLAUDE.md plan 第 1 步加 ARCHITECTURE.md 扫描 + handoff 段加 diff 校验要求 → verify: grep 命中（行 286/302）
- [x] 步骤 3：AGENTS.md 同步步骤 1+2 全部内容 → verify: grep 命中 7 条（读写白名单 / 破坏性变更协议 / read_files / dev/ARCHITECTURE.md / git diff --name-only）
- [x] 步骤 4：.aimon/docs/team-agent-harness-dev-docs-workflow.md 同步 → verify: grep 命中 3 个关键词
- [x] 步骤 5：派 vibespace-explorer 完成 → verify: 事实清单 4 节齐全（拓扑/跨包通讯/既定模式/关键文件索引）；纠正了主线对"IIFE 模板"的口误（实际为 StatusBadge.tsx 字典式配色）；明确三包无 workspace npm 互引，全靠 HTTP/WS
- [x] 步骤 6：dev/ARCHITECTURE.md 落盘 → verify: 187 行（≤300）；4 节标题全部命中（行 7/21/74/136）
- [x] 步骤 7：dev/issues.md 追加 AGENTS.md "Codex 配置分层"段问题 → verify: 第 24 行新条目已写入
- [x] 步骤 8：self-test diff 校验 → verify: 输出贴在本文件末尾，所有改动在白名单内

## 步骤 8 输出（self-test）

### `git diff --name-only HEAD`（已 tracked 文件的修改）

```
.aimon/docs/team-agent-harness-dev-docs-workflow.md
AGENTS.md
CLAUDE.md
dev/issues.md
```

### 已 tracked 改动核对

| 文件 | 来自 | write_files 白名单 |
|---|---|---|
| `.aimon/docs/team-agent-harness-dev-docs-workflow.md` | 步骤 4 | ✅ |
| `AGENTS.md` | 步骤 3 | ✅ |
| `CLAUDE.md` | 步骤 1+2 | ✅ |
| `dev/issues.md` | 步骤 7 | ✅ |

### 新建文件（`dev/` 在 `.gitignore` 行 12 内，被 git 忽略不显示在 diff 里）

| 文件 | 来自 |
|---|---|
| `dev/ARCHITECTURE.md` | 步骤 6 |
| `dev/active/工作流硬约束升级/工作流硬约束升级-plan.md` | plan 阶段 |
| `dev/active/工作流硬约束升级/工作流硬约束升级-context.md` | context 阶段 |
| `dev/active/工作流硬约束升级/工作流硬约束升级-tasks.md` | tasks 阶段（本文件） |
| `dev/active/工作流硬约束升级/工作流硬约束升级-tasks.json` | tasks 阶段 |

**结论**：所有改动都在本任务 `write_files` 白名单内，无越界文件。**新规则在自身任务上首次跑通**。
