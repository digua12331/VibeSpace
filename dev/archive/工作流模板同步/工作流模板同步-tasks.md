# 工作流模板同步 · 任务清单

> 仅由 AI 在推进过程中维护；人类读，不改。本任务自身严格践行新规则——读写白名单 + 破坏性变更协议自查 + tsc 类型检查 + diff 自校验。

- [x] 步骤 1：重写 DEV_DOCS_GUIDELINES → verify: 14 个关键短语 27 处命中；专属字面唯一命中位置在元说明 TS 注释（行 8），不在字符串体内
- [x] 步骤 2：重写 ISSUES_ARCHIVE_SECTION 与新 DEV_DOCS_GUIDELINES 内嵌段同步 → verify: 与 DEV_DOCS_GUIDELINES 内嵌的 `## Issues 档案` 段一致（同次 Write 一并写入，逐字相同）
- [x] 步骤 3：tsc -b 类型检查 → verify: 退出码 0，无输出（无新增类型错误）
- [x] 步骤 4：关 .aimon/docs:346 老 TODO → verify: 行 346 现在含 ~~删除线~~ + ✅ 标记
- [x] 步骤 5：self-test diff 校验 → verify: 输出贴在下方，本任务 write_files 内的都对得上；其余两类（前任务残留 / tsc 构建产物）按白名单实际意图豁免
- [x] 步骤 6：交付 handoff 摘要

## 步骤 5 输出（self-test）

### `git diff --name-only HEAD`

```
.aimon/docs/team-agent-harness-dev-docs-workflow.md
AGENTS.md
CLAUDE.md
dev/issues.md
packages/server/src/dev-docs-guidelines.ts
packages/server/tsconfig.tsbuildinfo
```

### 路径分类

| 文件 | 分类 | 说明 |
|---|---|---|
| `packages/server/src/dev-docs-guidelines.ts` | ✅ 本任务 write_files | 步骤 1+2 主体改动（重写两个 export const） |
| `.aimon/docs/team-agent-harness-dev-docs-workflow.md` | ✅ 本任务 write_files | 步骤 4 关老 TODO |
| `dev/active/工作流模板同步/*` | dev/ 在 .gitignore 内，diff 不显示 | 本任务 plan/context/tasks 自身 |
| `AGENTS.md` | **上一个任务"工作流硬约束升级"未归档改动** | 不算本任务越界——上任务 8 步已勾完，等大哥 UI 归档 |
| `CLAUDE.md` | **上一个任务的未归档改动** | 同上 |
| `dev/issues.md` | **上一个任务的未归档改动** | 上任务步骤 7 加的"Codex 配置分层"条目 |
| `packages/server/tsconfig.tsbuildinfo` | tsc 增量构建缓存（tracked 产物，**未在 .gitignore**） | 步骤 3 跑 tsc -b 时自动更新；属新规则的边界场景——构建产物按惯例豁免读写白名单 |

**结论**：本任务 write_files 内的所有改动都对得上；其余三类（前任务残留 / tsc 构建产物）按读写白名单规则的**实际意图**（"是否顺手改了无关代码"）都不算越界。

**衍生 issue**：`packages/server/tsconfig.tsbuildinfo` 是 tracked 的构建产物——每次构建都会变，造成 diff 噪声。建议加到 `.gitignore`。**本任务不顺手做**（按外科式改动原则；按 CLAUDE.md "Issues 档案" 规则也不在 dev/issues.md 追加，因为 dev/issues.md 不在本任务 write_files 内——下一个任务或大哥手工记一下）。
