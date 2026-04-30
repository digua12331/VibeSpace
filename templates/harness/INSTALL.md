# Harness 配置安装指南

把 VibeSpace 这套 "项目级 agent 团队 + 按需 skill" 配置一键带到**别的项目**里。

## 它装了什么

| 路径 | 文件 | 用途 |
|---|---|---|
| `.claude/agents/vibespace-*.md` | 7 个 | claude Task 工具可派的项目级 subagent（route-author / db-scribe / ui-decorator / smoke-author / browser-tester / explorer / rules-auditor）|
| `.aimon/skills/*.md` | 6 个 | session 启动时按 task name 关键词匹配注入的领域知识（`AIMON_SESSION_PROMPT_PATH`）|
| `dev/harness-roadmap.md` | 1 个 | 12 层 harness × 项目落点对照表 + 已做/劝退/未来评估档 |
| `dev/agent-team-blueprint.md` | 1 个 | 工作流阶段 × 角色 × skill × harness 层 的总图 |
| `.aimon/CUSTOMIZE-harness.md` | 1 个 | 装完之后的**改造清单**——告诉你哪些段是 VibeSpace 特定的、必须按你项目改 |
| `.gitignore` | +1 行 | 加 `.aimon/runtime/` 忽略（spawn 时生成的 prompt 文件，不该入库）|

## 它**不**装的

- VibeSpace 的源码本身（这是模板，不是 fork）
- `dev/active/` / `dev/issues.md` / `dev/learnings.md` / `dev/memory/` （这些是 VibeSpace 自己的工作目录内容，跟你项目无关）
- `CLAUDE.md`（VibeSpace 自己的 CLAUDE.md 含 Dev Docs 三段式工作流；要装这部分用 VibeSpace UI 的 "应用 Dev Docs 工作流" 按钮，或手动从 VibeSpace 仓库拷 `packages/server/src/dev-docs-guidelines.ts` 里的内容）
- 后端 / 前端 hook 集成（即"session 启动时自动按 task 注入 skill" + "claude Task 工具上报 subagent 卡片"——这是 VibeSpace 宿主才有的能力；其他项目装了 skill / agent 文件后，**用法是直接 claude session 里手动派 vibespace-* subagent**，没有自动注入）

## 装哪些项目合适

✅ **合适**：

- 用 claude code 开发的中大型项目
- 你想给团队（或未来的自己）留一份"哪种活该派哪个 subagent"的明确指引
- 项目有反复出现的套路（"加 route" / "改 db" / "写 smoke" 这种），值得固化成 agent

⚠️ **不太合适**：

- 一次性脚本 / 玩具项目（agent 配置维护成本 > 节省的时间）
- 不用 claude code 的项目（agent 文件无意义，只剩 skill 还能当文档看）
- 项目栈跟 VibeSpace 完全不一样（Python / Rust / Go / Vue）—— 模板里 70% 的内容（fastify route / SQLite / React badge）需要重写。这种情况不如**把 vibespace-rules-auditor 拷过去当起点，其它从 0 写**。

---

## 选项 A：用安装脚本（推荐）

### Windows / PowerShell

```pwsh
# 在 VibeSpace 仓库根
.\templates\harness\install.ps1 -Target "C:\path\to\your\project"
```

### Linux / Mac / Git Bash on Windows

```sh
# 在 VibeSpace 仓库根
bash templates/harness/install.sh "/path/to/your/project"
```

脚本会：
1. 创建目标目录的 `.aimon/skills/` / `.claude/agents/` / `dev/` 子目录（已存在则跳过）
2. 把 13 个文件 + roadmap + blueprint 拷过去；**目标已存在同名文件则跳过 + 列出冲突清单**让你手动 diff
3. 给目标 `.gitignore` 加 `.aimon/runtime/` 一行（已有则跳过）
4. 把 `CUSTOMIZE-harness.md` 放到目标 `.aimon/`

跑完输出"完成 + 改造提示"。

---

## 选项 B：手动拷贝

如果脚本不能跑（环境特殊 / 跨网络拷贝），手动 4 步：

```sh
# 假设 SRC 是 VibeSpace 仓库根，TARGET 是你的项目根
cp -r $SRC/.aimon/skills      $TARGET/.aimon/
cp -r $SRC/.claude/agents     $TARGET/.claude/
cp $SRC/dev/harness-roadmap.md $TARGET/dev/
cp $SRC/dev/agent-team-blueprint.md $TARGET/dev/
cp $SRC/templates/harness/CUSTOMIZE.md $TARGET/.aimon/CUSTOMIZE-harness.md
echo ".aimon/runtime/" >> $TARGET/.gitignore
```

---

## 装完之后必读

`<your-project>/.aimon/CUSTOMIZE-harness.md`——它列出 13 个文件里**每段是 VibeSpace 特定还是通用**，以及怎么按你项目栈改造。**不读这份就用 = 你的 subagent 会建议你跑 `pnpm smoke:worktree`，但你项目没这命令**。
