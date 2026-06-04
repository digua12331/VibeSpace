# 技能管理面板（Claude 草案，未定稿）

> 这是 plan 三模型会审的"事实包 + Claude 起草"，给 Gemini / Codex 看的输入。最终 plan.md 由 Codex 综合主笔后由 Claude 白话化兜底。

## 大哥摘要（草案）

- VibeSpace 现在能开多个 AI（Claude / Codex / OpenCode），它们各自有"技能仓库"——一个个文件夹，里面装着说明书教 AI 怎么干活；这次给你加一个**技能管理面板**，能在浏览器里看见、装上、卸下这些技能。
- 你能在左侧 ActivityBar 多看到一个 🧩 入口；点开就两栏：上面"项目里有的"、下面"全局装的、可以点一下塞进当前项目的"。
- 不会动到你已有的项目数据，只是读和管理 `.claude/skills/`、`.codex/skills/`、`.opencode/skill[s]/` 这几个文件夹。
- 第一期不做"上网搜技能 + 一键下载"那个市场（GitHub topic:skill / skills.sh）—— 等你点头要，我再做第二期。

## 与上游 skill-manager 的对照

参考 https://github.com/cgx2012/skill-manager，关键约定：

- 一个 skill = 一个文件夹，里面必有 `SKILL.md`，可选 YAML frontmatter（`name` / `description`）。
- 三个 agent 的目录约定（与上游 `AGENT_SKILL_DIRS` 对齐）：
  - `claude-code`: project = `.claude/skills/`，global = `~/.claude/skills/`
  - `codex`: project = `.codex/skills/`，global = `~/.codex/skills/`
  - `opencode`: project = `.opencode/skill/` 或 `.opencode/skills/`，global = `~/.config/opencode/skill[s]/`、`~/.agents/skill[s]/`
- 上游核心 5 个能力：scan-project / scan-global / add（copy 或 symlink）/ remove / parse-manifest。
- 上游还有"本地库 + 市场搜索 + 下载"——本期不做，作为第二期。

## 与本仓库现有 `skills-service.ts` 的边界

现有 `packages/server/src/skills-service.ts` 管的是 **`.aimon/skills/<name>.md`**（单文件 + YAML frontmatter `triggers` 字段），由 SessionStart hook 按 task name 模糊匹配自动注入。**这是 VibeSpace 内部机制，不是 Anthropic 标准的 skill。**

本期新增的是 **Anthropic 标准 skill**（文件夹 + SKILL.md），是 AI CLI 自己消费的，跟 `.aimon/skills` 是两层：

- `.aimon/skills/` → VibeSpace hook 注入（task 触发）
- `.claude/skills/`、`.codex/skills/`、`.opencode/skill[s]/` → AI CLI 自身的 skill 系统

**两套并存，互不替换。** 命名上严格区分：现有服务保留原名；新增服务叫 `skill-catalog-service.ts`，路由前缀 `/api/skill-catalog/*`，前端 view 叫 `SkillsView`（UI 文案直接叫"技能"——大哥不需要分清这俩，他从面板看到的就是 AI CLI 那套）。

## 目标 + 验收（草案）

**核心 UI 行为（浏览器可观察）**：
1. 左侧 ActivityBar 多一个 🧩 入口，点开侧栏切到"技能"。
2. 顶部三选项卡（Claude / Codex / OpenCode），切换不同 agent。
3. 当前 agent 下分两组：
   - **项目技能**（来自 `<projectPath>/.claude|.codex|.opencode/skills/`）：每条显示名字、描述、来源标记 P，行尾有"卸载"按钮。
   - **全局技能**（来自 `~/.claude/skills/` 等）：每条显示名字、描述、来源标记 G，行尾有"装到本项目"按钮（带 copy / symlink 两种模式的下拉）。
4. "添加自定义路径"按钮：弹一个输入框，让用户粘贴磁盘上任意 SKILL 文件夹路径，校验存在 + 含 SKILL.md 后装到项目。
5. 操作后列表自动刷新；删除 / 添加要弹确认对话框（仿 DocsView 用 `confirmDialog`）。

**操作日志（LogsView 可观察）**：
- 前端 `logAction('skills', 'add' | 'remove' | 'scan' | 'add-from-path', ...)` 起止配对。
- 后端 `serverLog('info', 'skills', 'skill-add 开始/成功/失败', ...)`，含错误分支。
- 失败分支至少人工触发一次（如装一个已存在的 skill 触发 409，把日志在 LogsView 看到）。

**类型检查**：`pnpm -C packages/server typecheck` + `pnpm -C packages/web typecheck` 均通过。

## 非目标（这期不做）

- 不做联网搜索（GitHub / skills.sh），不做市场 UI、不做 git clone 下载流。
- 不做"集中本地库"（`~/SkillManager/{official,custom}`）—— 全局技能直接作为可装来源就够。
- 不替换、不动 `skills-service.ts` 与 `.aimon/skills/`。
- 不做 gemini / qoder / kilo 等其他 agent 的 skill 路径（上游也没做）。
- 不在 SessionView / 终端里直接显示 skill 状态（与 `.aimon/skills` 注入分离，避免混淆）。

## 实施步骤（粗粒度）

1. **后端 service** — `packages/server/src/skill-catalog-service.ts`
   - 路径表常量 `AGENT_SKILL_DIRS`（与上游对齐）。
   - `scanProjectSkills(projectPath, agentType)` / `scanGlobalSkills(agentType)` / `parseManifest(skillPath)` / `addSkill(srcPath, projectPath, agentType, useSymlink)` / `removeSkill(skillName, projectPath, agentType)`。
   - `parseManifest` 支持 YAML frontmatter（仿 upstream 的简化解析，名字 / 描述）+ 无 frontmatter 兜底（首行作名字）。
   - `addSkill`：mkdir target dir / 检查源存在 / 检查目标不存在（否则 throw 'already_exists'）/ Windows 下 symlink 失败时回退到 copy，并把"建议开开发者模式或用复制"塞进错误 detail。
   - `removeSkill`：lstatSync 区分 symlink 和目录，分别 unlinkSync / rmSync。
   - verify: `pnpm -C packages/server typecheck` 通过；写一个最小单测（vi.test 或 node:test）扫一个临时目录的 skill。

2. **后端路由** — `packages/server/src/routes/skill-catalog.ts`
   - `GET /api/skill-catalog/scan?projectPath=&agentType=` → 项目技能列表
   - `GET /api/skill-catalog/global?agentType=` → 全局技能列表
   - `POST /api/skill-catalog/add` body: `{ srcPath, projectPath, agentType, useSymlink }` → 装入项目
   - `DELETE /api/skill-catalog/remove` body: `{ skillName, projectPath, agentType }` → 从项目卸载
   - `GET /api/skill-catalog/manifest?path=` → 单个 skill manifest
   - 全部走 zod 校验；agentType 限定 `'claude-code' | 'codex' | 'opencode'`。
   - 每个 mutation 用 `serverLog` 起止配对 + ERROR 分支带 `meta.error`。
   - verify: 后端起来后 `curl http://127.0.0.1:8787/api/skill-catalog/scan?...` 返回 JSON。

3. **注册路由** — `packages/server/src/index.ts`
   - import + `await registerSkillCatalogRoutes(app)`。

4. **前端 API + 类型** — `packages/web/src/api.ts` + `types.ts`
   - 新增 `Skill`、`SkillSource`、`SkillAgentType` 类型。
   - 新增 `scanProjectSkills` / `scanGlobalSkills` / `addSkillToProject` / `removeSkillFromProject` 客户端函数。
   - verify: web typecheck 通过。

5. **前端 SkillsView** — `packages/web/src/components/sidebar/SkillsView.tsx`
   - 仿 `DocsView.tsx` 样式（border / list row / pill / 操作按钮）。
   - 顶部 agent 切换 tab；下面两段 list（项目 / 全局）。
   - "添加自定义路径"按钮 → `confirmDialog` 风格的输入对话框（DialogHost 是否支持 prompt？要补 → 子任务）。
   - 行尾按钮：项目行显示"卸载"，全局行显示"装到项目"+"复制 / 链接"切换。
   - 所有 mutation 用 `logAction` 包装。
   - verify: 浏览器看到面板、能点能动；LogsView 看到 `scope=skills` 的起止配对。

6. **挂载入口** — `packages/web/src/store.ts` + `ActivityBar.tsx` + `PrimarySidebar.tsx`
   - `Activity` 类型加 `'skills'`。
   - ActivityBar 加一行 `{ id: 'skills', icon: '🧩', label: '技能' }`。
   - PrimarySidebar 在 activity === 'skills' 时渲染 `<SkillsView />`。

7. **README 双语补丁**
   - Highlights 加一句：浏览器面板里管理 Claude / Codex / OpenCode 的 skill。
   - Architecture 段的路由列表 + Service 列表各加一行。
   - verify: README.md / README.zh-CN.md 同步更新（auto.md 强约定）。

8. **手工浏览器实操验收**（标 "待主理人手动验收"）
   - 在一个真实项目下点装 / 卸 / 添加自定义路径 / 触发 409 错误，看 LogsView 起止配对 + ERROR。

## 边界情况

- 项目目录不存在 → scan 返回空数组（不 throw）。
- agentType 不在白名单 → 400。
- add 时 srcPath 不存在 → 404 + 人话错误。
- add 时 target 已存在 → 409 + 提示"已经装过了"。
- remove 时是 symlink → unlinkSync；是目录 → rmSync recursive。
- Windows 创建 symlink 没权限 → 捕获 EPERM，提示"建议改用复制模式或开 Windows 开发者模式"。
- SKILL.md 缺 frontmatter → 用文件夹名作 name、空 description。
- 路径含中文 / 空格 → 走 path.join 不拼字符串、不 shell 注入；不 execSync。
- OpenCode 项目目录有两种候选（`skill` / `skills`）→ scan 全扫，add 写第一个候选（与 upstream 对齐）。
- 跨盘符 symlink → 先尝试，失败回退到 copy 并提示。

## 风险与注意

- **概念混淆风险高**：现有 `.aimon/skills/` 与新 `.claude/skills/` 是两套，文档（README + 面板提示文案）必须明确"这里管的是 AI CLI 自身的 skill，不是 VibeSpace task 触发的那种"。否则用户会以为关掉一个就关掉所有。
- **Windows symlink** 默认无权限，必须降级到 copy；UI 默认开关定在"复制"。
- **路径表硬编码**：上游路径表跟 OpenCode / Codex 的实际约定可能小幅漂移，本期照抄上游，未来如有偏差在 `dev/issues.md` 跟踪。
- **DialogHost prompt 支持**：现有可能只支持 confirm/alert，prompt 类型若没有要顺手补一个最小 input 对话框（小子任务）。
- **DB 不动**：本期所有状态都从磁盘扫，不进 SQLite —— 与现有 docs/issues/memory 风格一致，避免新增表 + 迁移。

## 假设

- 大哥要的是"和上游 skill-manager **一样的核心功能**"，不是 1:1 像素级 UI 复刻。优先复用本仓库 sidebar 风格。
- 第一期不需要市场 / 联网。如果想要，明确告知后做第二期。
- OpenCode / Codex 用户可能不多，但路径表照抄成本低，先一并支持。

## 多模型 Plan 会审（待填）

> [Gemini 评审] 待填
> [Codex 评审] 待填
> [Codex 综合主笔] 待填
> [Claude 白话化兜底] 待填
