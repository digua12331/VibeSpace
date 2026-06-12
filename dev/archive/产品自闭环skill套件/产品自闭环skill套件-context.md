# 产品自闭环 skill 套件 · Context（AI 自用）

## 关键文件

### 会改

- `packages/server/src/skills-service.ts`（全文 235 行，已读）
  - `parseFrontmatter` / `asStringArray`：保留不动
  - `skillsCache: Map<string, SkillsCacheEntry>`（L114）：key 当前是 `projectPath`，改造为扫描目录绝对路径
  - `readSignature(dir)`（L116-148）：已经是按 `dir` 工作，保留
  - `listSkills(projectPath)`（L150-204）：把 L154-203 的 signature+扫描+缓存逻辑抽成 `scanSkillsDir(dir)`；`listSkills` 变成 `scanSkillsDir(join(projectPath, SKILLS_SUBDIR))`
  - `pickSkillsForTask(projectPath, taskName)`（L210-221）：改为合并项目级 + 全局级
  - `buildRuntimePrompt`：不动
  - 新增：`GLOBAL_SKILLS_DIR`、`listGlobalSkills()`
- `packages/server/src/routes/sessions.ts`（L443-469 已读）
  - L461-469 `serverLog('info','skills','injected',...)`：`meta.skills` 当前是 `matched.map(s=>s.name)`，改成带 source 标注（`{name, source}[]`）。仅此一处一行级改动
- `package.json`（root）：`smoke:*` 脚本群，加一行 `smoke:global-skills`
- `README.md` / `README.zh-CN.md`：加"产品自闭环 skill 包"安装节

### 会新建

- `.aimon/global-skills/`（新目录，分发源，**不参与运行时扫描**）：5 个 skill md
  - `产品自闭环-总纲.md` / `捞需求-github-issues.md` / `本地实现-切分支改代码.md` / `录演示视频-hyperframes.md` / `发布-pr与社交平台.md`
- `scripts/global-skills-smoke.mjs`：wrapper，仿 `scripts/memory-parse-smoke.mjs`（spawn tsx 跑 server 里的 ts test）
- `packages/server/scripts/global-skills-test.ts`：测试逻辑，仿 `packages/server/scripts/memory-parse-test.ts`（import skills-service.ts 源码，`check()` 断言 + failures 计数，`mkdtempSync` 造临时目录）

### 只读不改

- `packages/server/src/routes/projects.ts:414`（`listSkills(proj.path)` 调用方——确认行为不变）
- `.aimon/skills/*.md`（6 个既有 skill，作为格式参考，不动）

## 决策记录

1. **测试用 smoke 脚本，不用单测框架** —— context 阶段发现：本项目无 vitest/jest，`packages/server/package.json` 无 `test` script，测试全走 `scripts/*-smoke.mjs` + `packages/server/scripts/*-test.ts`（tsx 跑）。plan 里写的 `skills-service.spec.ts` + `pnpm test` 不存在对应设施。改用项目既有 smoke 模式。**验收实质不变**（仍自动化测 5 场景、exit 0/1），形式贴合项目惯例 → 纯内部调整，不回头打扰大哥。

2. **抽 `scanSkillsDir(dir)` 而非写两套扫描** —— Codex 评审建议。`listSkills` 内部逻辑本就是"给定 dir 扫 md"，抽出来后 `listSkills` 和 `listGlobalSkills` 都是一行委托。缓存 Map 的 key 从 `projectPath` 改成扫描目录绝对路径——天然支持多目录缓存，不需要两个 Map。

3. **`GLOBAL_SKILLS_DIR` 支持 `AIMON_GLOBAL_SKILLS_DIR` env override** —— 仅为 smoke 脚本能指向临时目录、不污染真实 `~/.aimon/skills`。生产无此 env 时默认 `join(homedir(),".aimon","skills")`。这是测试可达性的最小必要钩子，不是投机性配置。

4. **发布卡点是文本约束，不做代码级锁** —— plan 已与大哥讲明残余风险。资深工程师视角：现在做代码级强制（拦截 git push / gh 命令）需要 hook 或 PTY 拦截，是为"尚未发生的问题"过度设计。skill 措辞强硬 + 要求写进 tasks.md 待办即可。

5. **注入日志只在既有 meta 里加 source 字段，不新增日志条目** —— 高频会话启动路径，不该加新埋点（auto.md 经验：高频路径慎加埋点）。`serverLog('skills','injected')` 既有条目里 `meta.skills` 升级为带 source 的结构即可。

6. **不做总纲外的第 6 个"契约"文件** —— 数据契约（分支名/artifact 路径/task 对应关系）写进 `产品自闭环-总纲.md` 一处，4 个分步 skill 引用它。不抽独立契约文件——只被引用一次的抽象是过度设计。

## 依赖与约束

- **`SkillEntry` 类型**：`{name, triggers, body}`（skills-service.ts L6-13）。注入合并时需要临时带 `source`，但 `SkillEntry` 本身不加字段——source 只在 `pickSkillsForTask` 返回时和日志 meta 里用，用一个 `{skill: SkillEntry, source: 'global'|'project'}` 的内部结构或并行数组。**倾向**：`pickSkillsForTask` 返回值保持 `SkillEntry[]` 不变（调用方 `buildRuntimePrompt` 依赖它），source 单独算给日志用——即 `pickSkillsForTask` 内部知道每个 skill 来源，但对外签名不变；日志那行在 sessions.ts 里需要 source，所以要么 `pickSkillsForTask` 多返回一份 source map，要么导出一个轻量 `pickSkillsWithSource`。**决定**：新增导出 `pickSkillsForTaskDetailed` 返回 `{skills: SkillEntry[], sources: Record<string,'global'|'project'>}`，`pickSkillsForTask` 保留为薄封装（只返 `.skills`）兼容 projects.ts 若有用；sessions.ts 改调 detailed 版。——*执行时若发现 pickSkillsForTask 仅 sessions.ts 一个调用方，则直接改签名，不留薄封装。已确认调用方：grep 显示仅 sessions.ts:451。故直接改 `pickSkillsForTask` 返回 detailed 结构，更新 sessions.ts 一处。*
- **缓存签名机制**：`readSignature` 已按 dir 算 mtime+filesSig，全局池天然复用。两个目录两条独立缓存项，无交叉失效问题。
- **`homedir()`**：Windows = `C:\Users\zh_zhang`。`join` 拼接。
- **tsx 可用性**：`pnpm exec tsx` 在 `packages/server` 下可用（memory-parse-smoke 已验证此路径）。
- **类型检查**：`pnpm --filter @aimon/server build`（tsc）——改 skills-service.ts / sessions.ts 后必须跑且零报错。
- **trigger 匹配**：substring、大小写不敏感（`haystack.includes(t.toLowerCase())`）——4 个分步 skill 的 trigger 关键词避免与日常开发任务名冲突。

## 边界回顾（执行时对照 plan 的边界情况段）

- 全局与项目同名 → stem 去重、项目覆盖
- 全局目录不存在 → `scanSkillsDir` 经 `existsSync` 返 []
- 坏 frontmatter → 既有 try/catch continue + 加 serverLog warn（当前坏文件是静默 continue，**需补一条 warn 日志**指明哪个文件坏了 —— 这是 plan 验收组 1.4 的要求）
- 缓存 key 改造 → smoke 必须断言 projects.ts 路径仍只拿项目级
