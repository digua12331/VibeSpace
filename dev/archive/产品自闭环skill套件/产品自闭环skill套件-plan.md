# 产品自闭环 skill 套件 · Plan v2（方案 C — 独立 skill 包）

> v2 取代 v1。v1 是"重量集成进 VibeSpace 后端"，经 Claude + Codex 联合评估判定为过度设计（功能错配 / 重复造轮子），大哥已拍板转向方案 C。v1 全文见 git 历史。

## 大哥摘要

**这次要做什么**：做一个**"产品自闭环" skill 包**（skill = 给 AI 看的操作说明书）——5 个 markdown 文件，教 AI 怎么走完"GitHub 上捞用户反馈 → 切分支改代码 → 录演示视频 → 提 PR + 发 B 站/YouTube → 评论关闭 issue"这条流水线。同时给 VibeSpace 后端加一小段代码，让这套 skill **装一次、所有项目都能用**。

**为什么是这个做法**（你上一轮问对了）：把视频渲染、社交发布做进 VibeSpace 后端是"功能错配"——VibeSpace 是 AI 开发的指挥台，不该变成内容发布平台。所以改成：skill 包**独立**，AI 直接调通用工具（GitHub 的 `gh`、`git`、视频工具、你的发布脚本），VibeSpace 几乎不用改。

**做完后你能看到的东西**：

1. **家目录多一个文件夹** `C:\Users\zh_zhang\.aimon\skills\`，里面 5 个 `.md`：1 个总纲 + 4 个分步（捞需求 / 改代码 / 录视频 / 发布）。
2. **以后在任何 VibeSpace 项目起会话**，只要任务名含"产品闭环""捞 issue""录视频"等关键词，VibeSpace 会自动把对应 skill 塞给 AI——它就知道该用哪条命令、按什么顺序走。
3. **VibeSpace 后端改约 150 行**：以前它只扫**当前项目**的 skill 文件夹，改完后**同时**扫家目录的全局池（global pool）。这是实现你要的"装一次到处能用"。
4. **每跑一次闭环 = VibeSpace 里的一个任务**——进度记在 `tasks.md`（VibeSpace 既有的任务清单），每步操作进 LogsView（操作日志面板）。**不新建数据库表**，复用 VibeSpace 已经有的东西。

**关于敏感信息（你之前担心 AI 看到 token）**：不用担心，也不用 VibeSpace 自造加密存储。GitHub 的 `gh` 工具你 `gh auth login` 登录一次，口令（token）就存进**你电脑系统自带的凭证保险箱**，AI 调 `gh issue list` 时根本接触不到它。git 推代码同理。社交平台发布的账号信息，由你自备的发布脚本自己从环境变量读——VibeSpace 全程不碰。

**会不会动到你已有的东西**：不会。
- 现有 VibeSpace 项目、会话、Dev Docs、那 6 个 `.aimon/skills` 示例——一个字不动。
- 不新建数据库表、不动现有任何 UI 按钮。
- 唯一的后端改动是"skill 扫描多看一个文件夹"，对现有行为零影响（现有项目级 skill 照常工作）。

**关于发布前的人工确认**：skill 里**硬性写死**——AI 在提 PR、发视频之前，**必须**把将要执行的完整命令打印在终端、然后停下来，明确请你回复确认；**不准 AI 自己跑发布命令**。这比之前设想的"终端里按 y/n"可靠（Windows 终端里 `read -p` 不稳），因为这是写进 skill 的行为约束，AI 不会绕过。

**外部依赖（你得自己装）**：`gh`（GitHub CLI）、`git`、Node + npx + FFmpeg（录视频用）、Python 3（发布脚本用）。skill 文件里会写清楚每个怎么装、首次跑视频工具会下载几百 MB 看似卡住是正常的。**发布脚本 `publish_social.py` 由你自备**——skill 只规定"假定有这个脚本，参数是 `<视频路径> <文案>`"，VibeSpace/skill 不替你写 B 站/YouTube 上传代码（涉及账号风险）。

**工程量**：约 150 行代码 + 5 个 md + 测试，**1-2 天**。

**你这次拍板的就一件事**：上面这个方向和验收方式，对吗？

---

## 目标 & 验收标准

**核心目标**：让 AI 在任何 VibeSpace 项目里，靠任务名命中 → 自动获得"产品自闭环" skill 包的指导，按 5 个 md 描述的流程和数据约定走完闭环；VibeSpace 后端只做"全局 skill 池扫描"这一项小改动，不承载任何业务逻辑。

**可验证的验收标准**（每条都能在浏览器/磁盘/终端直接看到）：

### 验收组 1 — VibeSpace 后端：全局 skill 池

1. **全局池被扫描并注入**：
   - 把 5 个 skill 文件放到 `~/.aimon/skills/`
   - 在 VibeSpace 起一个会话（项目随便选一个，**不是** VibeSpace 仓库自己），任务名设为 `产品闭环测试`
   - 验证：会话启动后 `AIMON_SESSION_PROMPT_PATH` 指向的 runtime prompt 文件里，包含总纲 skill 的 body
   - LogsView 里能看到 `scope=skills`、`meta.skills` 含全局 skill 名的注入日志

2. **项目级同名覆盖全局**：
   - 把同名 skill 复制进某项目自己的 `.aimon/skills/`，里面改一句话标记
   - 同样任务名启动会话
   - 验证：runtime prompt 里是**项目级版本**（带标记），不是全局版本

3. **全局目录不存在 → 优雅降级**：
   - 删掉 `~/.aimon/skills/` 整个目录
   - 起会话不报错；项目级 skill 仍正常命中

4. **坏 frontmatter 单文件隔离**：
   - 全局池塞一个 frontmatter 写一半的 `坏文件.md`，其余 4 个完好
   - 起会话：4 个完好的正常 trigger；坏文件被跳过，`serverLog('warn','skills',...)` 有记录哪个文件坏了

5. **前端"项目 skill 列表"语义不变**：
   - `routes/projects.ts:414` 走的 `listSkills(projectPath)` 仍只返回项目级 skill（全局池不混进前端那个列表）

### 验收组 2 — skill 包内容质量

6. **5 个 skill 文件齐全且格式正确**：
   - 1 个总纲（`产品自闭环-总纲.md`）+ 4 个分步，都有合法 frontmatter（`triggers` 数组）
   - 总纲里明确写出**数据契约**：分支命名 `feat-ai-issue-<号>`、视频产物路径 `.aimon/artifacts/issue-<号>/demo.mp4`、一次闭环 = 一个 VibeSpace task（任务名含 issue 号）、issue 号/分支名/视频路径/PR 链接如何在 4 步之间传递
   - 4 个分步 skill 各自的 `triggers` 不过宽（**禁用**单独的"改代码"这类会命中所有任务的词）

7. **发布卡点写进 skill**：
   - `发布-pr与社交平台.md` 明确规定 AI 在 `gh pr create`、发视频前必须打印完整命令 + 停下等大哥确认；明确写"AI 不准自己执行发布命令"

8. **外部依赖与失败处理写清楚**：
   - 每个分步 skill 头部列前置依赖（`gh` 已登录 / `git` / FFmpeg / Python）
   - 录视频 skill 明写"首次运行会下载大依赖、看似卡住是正常的，不要误判超时去 kill 进程"
   - `gh` 未登录 / 命令失败时，skill 指导 AI 把 stderr 抛给大哥，**不**自动 retry

### 验收组 3 — 端到端

9. **smoke 脚本通过**：
   - `scripts/global-skills-smoke.mjs`（仿现有 `worktree-smoke.mjs`）跑临时目录覆盖验收组 1 的 5 个场景，断言 runtime prompt 内容；不污染真实 `~/.aimon/skills`
   - `package.json` 加 `smoke:global-skills` 入口；脚本 exit 0

10. **类型检查通过**：`pnpm --filter @aimon/server build` 零报错

11. **后端单测通过**：`skills-service.spec.ts`（新建或 append）覆盖"只全局/只项目/合并冲突/都不存在/坏文件"5 场景；`pnpm --filter @aimon/server test` 通过

12. **README 增补**：`README.md` + `README.zh-CN.md` 加"产品自闭环 skill 包安装"一节（PowerShell `Copy-Item` 命令 + 前置依赖清单 + 首跑警告）

---

## 非目标（明确不做）

- **不**改 VibeSpace 后端做任何业务逻辑（无 issue 缓存、无 automation 状态表、无 integrations 加密存储）—— v1 的重量集成全部砍掉
- **不**集成 B 站 / YouTube SDK —— 发布走大哥自备的 `publish_social.py`
- **不**自造凭证存储 —— 复用 `gh auth` / `git` 系统凭证 / 环境变量
- **不**新建 SQLite 表 —— 状态跟踪复用 Dev Docs（`tasks.md`）+ 操作日志
- **不**加 UI（无设置页、无按钮、无"待审队列"组件）
- **不**改 `routes/projects.ts:414` 的语义（前端项目 skill 列表保持只显示项目级）
- **不**把 5 个 skill 串成"一键全自动跑完"——每步靠任务名 trigger 注入说明，AI 在大哥监督下分步推进；尤其发布步骤必须人工确认

---

## 实施步骤

### A. VibeSpace 后端：skill 扫描支持"项目级 + 家目录全局"两层

- A1. 重构 `packages/server/src/skills-service.ts`（采纳 Codex 评审建议：抽公共扫描函数，不写两套）：
  - 把现有 `listSkills` 内部的"signature + readFile + parse + cache"逻辑抽成 `scanSkillsDir(dir: string): Promise<SkillEntry[]>`，缓存 Map 的 key 从 `projectPath` 改成扫描目录的绝对路径
  - `listSkills(projectPath)` = `scanSkillsDir(<projectPath>/.aimon/skills)`（**对外行为完全不变**）
  - 新增常量 `GLOBAL_SKILLS_DIR = join(homedir(), ".aimon", "skills")` 和 `listGlobalSkills()` = `scanSkillsDir(GLOBAL_SKILLS_DIR)`
  - 改 `pickSkillsForTask(projectPath, taskName)`：取项目级 + 全局级，**合并去重**——按 skill `name`（文件名去 `.md`）去重，**项目级覆盖全局级**；trigger 匹配逻辑不变（substring）
  - 失败/不存在：全局目录不存在 → `scanSkillsDir` 返 `[]`（`existsSync` 已有保护）；单坏文件 → 既有 `try/catch continue` 已覆盖
  - 注入日志：在 `routes/sessions.ts:461` 既有 `serverLog('info','skills','injected',...)` 的 `meta` 里补一个字段，标注每个 skill 来源 `global` / `project`（便于排障，不新增日志条目）
  - **验证**：`scanSkillsDir` 的缓存 key 改造后,确认 `routes/projects.ts:414` 调 `listSkills` 仍只返回项目级
- A2. `routes/sessions.ts` / `routes/projects.ts` 调用方**零改动**（`pickSkillsForTask` / `listSkills` 签名不变）
- A3. 单测 `packages/server/src/skills-service.spec.ts`：用 `tmpdir` 造项目级 + 全局级两套目录，覆盖 5 场景
- A4. **类型检查 + 单测必须过**（`pnpm --filter @aimon/server build` + `test`）

### B. 写 5 个 skill 文件

源文件放仓库内 `.aimon/global-skills/`（**新目录**——明确是"分发源"，不参与 VibeSpace 运行时扫描；运行时扫的是 `~/.aimon/skills/`。命名上与既有 `.aimon/skills/` 区分清楚，README 里也写明）。每个文件用既有 skill 的 frontmatter（`triggers`）+ body 格式：

- B1. **`产品自闭环-总纲.md`**（串联 + 数据契约）
  - triggers: `[产品闭环, 产品自闭环, issue 闭环, 自动产品流, 闭环修 issue]`
  - body：4 步总览 + **数据契约**（分支名 `feat-ai-issue-<号>`、视频路径 `.aimon/artifacts/issue-<号>/demo.mp4`、一次闭环=一个 task、4 步之间靠 task 的 tasks.md 传递状态）+ "每步都要让大哥能在对话/LogsView 看到操作"

- B2. **`捞需求-github-issues.md`**（Issue Scout）
  - triggers: `[捞需求, github issue, gh issue, 用户反馈, enhancement issue]`
  - body：`gh issue list --state open --label "enhancement" --json number,title,body` / `gh issue view <号> --comments`；前置依赖 `gh auth login`（说明 token 存系统凭证、AI 不接触）；输出是 JSON，AI 自己过滤吐槽留高优；PowerShell + Bash 两套示例（默认 PowerShell，因本机是 Windows）

- B3. **`本地实现-切分支改代码.md`**（Local Coder）
  - triggers: `[ai 闭环编码, feat-ai-issue, 自动实现 issue, 切分支改代码]`（**避免**单独"改代码"）
  - body：`git checkout -b feat-ai-issue-<号>` / 改代码后跑项目自有测试命令 / 提交但**先不 push**（push + PR 留给发布步骤，确保人工确认在 push 之前）

- B4. **`录演示视频-hyperframes.md`**（Video Director）
  - triggers: `[录演示视频, 演示视频, hyperframes, 录视频 mp4]`
  - body：前置依赖 Node + npx + FFmpeg；用 HyperFrames 写 HTML/CSS/GSAP 动画 → `npx hyperframes render` → 产物落 `.aimon/artifacts/issue-<号>/demo.mp4`；**明写**首跑下载大依赖、看似卡住正常、不要 kill 进程；失败回退（FFmpeg 没装/超时）该怎么报告，不要卡死

- B5. **`发布-pr与社交平台.md`**（Publisher，含强制卡点）
  - triggers: `[发布更新, 提 pr, 发布视频, 社交平台发布]`
  - body：`git push` + `gh pr create --title ... --body ...`（PR body 里贴 issue 号 + 视频路径）；**强制卡点**——发 PR、发视频前必须打印完整命令 + 停下等大哥回复确认，明确"AI 不准自己执行发布命令"；视频发布调 `python publish_social.py <视频路径> <文案>`（脚本由大哥自备，不存在时报告并跳过）；发完 `gh issue comment <号>` + `gh issue close <号>`

### C. 端到端 smoke 脚本

- C1. `scripts/global-skills-smoke.mjs`（仿 `scripts/worktree-smoke.mjs`，参考 `vibespace-smoke-author` 子代理约定）：
  - 通过环境变量 `AIMON_GLOBAL_SKILLS_DIR` override 全局目录指向临时目录（A1 里 `GLOBAL_SKILLS_DIR` 支持此 env override，**纯测试用**，生产默认 `~/.aimon/skills`）
  - 造临时项目目录 + 临时全局目录，跑 5 场景，断言 `pickSkillsForTask` 结果
  - cleanup 临时目录，不污染真实 `~/.aimon/skills`
- C2. `package.json` 加 `"smoke:global-skills": "node scripts/global-skills-smoke.mjs"`

### D. README 增补

- D1. `README.md` + `README.zh-CN.md` 加"产品自闭环 skill 包"一节：
  - 安装命令（PowerShell）：`Copy-Item .aimon\global-skills\*.md $HOME\.aimon\skills\ -Force`
  - 前置依赖清单：`gh`（已登录）/ `git` / Node + npx + FFmpeg / Python 3 + 自备 `publish_social.py`
  - 首跑警告：HyperFrames 首次下载大依赖、耗时 5-15 分钟

---

## 边界情况

- **全局与项目同名冲突**：按文件名 stem 去重，项目级覆盖全局级；**不**做 body 合并
- **全局目录是符号链接 / 循环链接**：依赖 `node:fs` API 自身错误处理 + `scanSkillsDir` 的 `try/catch` 兜底
- **Windows 路径**：`homedir()` 在 Windows = `C:\Users\zh_zhang`，全程用 `path.join`
- **缓存 key 改造风险**：缓存 Map 从 `projectPath` key 改成 `dir` key 后，要确保 `routes/projects.ts:414` 仍只拿项目级——单测专门断言这条
- **mtime 秒级精度**：1 秒内连改两次同 skill 文件可能读旧缓存（既有缺陷，`skills-service.ts:107` 注释写明），全局池沿用现状不解决
- **trigger 关键词过宽**：4 个分步 skill 的 trigger 经人工检查不与日常开发任务名（"修 bug""加路由""改样式"）冲突；总纲用"产品闭环"等组合词
- **HyperFrames 首跑卡 5-15 分钟**：skill body 明写,避免 AI 误判超时（auto.md [2026-05-02/接入-browser-use] 经验：外部工具链首跑隐式下载大依赖）
- **`gh` 未登录 / `publish_social.py` 不存在**：skill 指导 AI 报告给大哥、不自动 retry、不伪造成功
- **发布卡点被 AI 绕过**：靠 skill 文本约束（"必须停下等确认"）；这是文本级约束不是代码级强制——验收时人工确认 skill 措辞足够强硬

---

## 风险与注意

1. **风险：发布卡点是"文本约束"不是"代码强制"**
   - 现象：理论上 AI 可能不遵守 skill 里"停下等确认"的规定，直接跑发布命令
   - 缓解：a) skill 措辞用最强硬的祈使句 + 多次重复；b) skill 里要求 AI 把发布命令先写进 `tasks.md` 待办、由大哥勾选触发；c) 实操中大哥本来就在监督每个会话——这是可接受的残余风险。**plan 不假装这是 100% 防住的**
   - 备注：若日后发现 AI 真的绕过，再考虑做代码级强制（那时才值得动 VibeSpace），现在不过度设计

2. **风险：全局 skill 池污染所有项目**
   - 现象：全局池里某个 skill 写歪了，所有项目会话都受影响
   - 缓解：a) README 明写"全局池高谨慎，只放跨项目通用 skill"；b) 注入日志标 `source=global/project` 可排障；c) 项目级永远能覆盖全局级

3. **风险：`scanSkillsDir` 重构碰了核心路径**
   - 现象：`listSkills` / `pickSkillsForTask` 是会话启动链路，重构出 bug 会让所有 skill 注入失效
   - 缓解：重构保持 `listSkills` / `pickSkillsForTask` 对外签名与行为完全不变；单测覆盖"只项目"场景确保回归；改动外科式，只抽函数不改逻辑

4. **假设：VibeSpace 会话启动确实读 `AIMON_SESSION_PROMPT_PATH`**
   - 已确认：`routes/sessions.ts:451-460` 写 runtime prompt + 设 env；`dev-docs-guidelines.ts:30` 指导 AI 读它。假设成立

5. **关键文件清单（边界）**：
   - **改**：`packages/server/src/skills-service.ts`、`packages/server/src/routes/sessions.ts`（仅 `meta` 补 source 字段一行）、`package.json`、`README.md`、`README.zh-CN.md`
   - **新建**：`.aimon/global-skills/{产品自闭环-总纲,捞需求-github-issues,本地实现-切分支改代码,录演示视频-hyperframes,发布-pr与社交平台}.md`（5 个）、`packages/server/src/skills-service.spec.ts`、`scripts/global-skills-smoke.mjs`
   - **不动**：`routes/projects.ts`、所有其他 routes、所有 web 端代码、SQLite、UI

6. **memory 扫过的相关条目**（已读、本 plan 已遵循）：
   - [2026-05-02 / 接入-browser-use] 外部工具链首跑隐式下载大依赖 → 录视频 skill body 明写
   - [2026-05-02 / 接入-browser-use] 可选增强能力注入失败不阻塞主 session → 全局目录不存在静默降级
   - [2026-05-02 / 会话启动模板-yaml化] 项目级可选配置目录"目录不存在=功能隐藏、坏文件跳过+记日志、接口仍成功" → 全局池同此处理
   - [2026-05-02 / 会话启动模板-yaml化] 新增可配置能力要附 schema/示例/坏输入用例 → README + 5 个 skill 即示例，单测覆盖坏文件
   - manual.md [2026-04-30] 大哥偏好"plan 后停一次" → 本 v2 plan 等大哥确认，后续 context/tasks/执行不停

---

## 多模型 Plan 会审

> [Codex 评审 · 第 1 轮 / plan 草案] 30 条关键洞察，已纳入：4 个 skill 之间需明确数据契约（issue#→branch→video→PR）→ v2 用总纲 skill 写死分支命名/artifact 路径约定；trigger substring 匹配过宽 → 4 分步 skill 禁用宽词；Windows `read -p [y/n]` 不可靠 → 改"打印命令+停下等确认"写进 skill；"放当前项目 .aimon/skills/ 是更简零代码路径" → v2 全局池仍需 ~150 行，但已是抽函数复用的最小切口。

> [Codex 评审 · 第 2 轮 / 方向评估] 大哥提出元问题"该不该做进 VibeSpace"，Codex 独立评估明确推荐**方案 C**：(1) 视频渲染 + 社交发布不属 AI 开发工作台核心职责，做进后端是定位漂移；(2) `integrations` 加密存 token 重复造轮子——`gh auth login` 默认把 token 存进系统 credential store（来源：GitHub CLI 官方文档 `gh auth login` / `gh auth setup-git`）；(3) `automation_runs` 状态表重复 Dev Docs；(4) 先按 C 跑通闭环、真实跑 5-10 次再判断哪些值得产品化。本 v2 plan 即按方案 C 重写。

> [Gemini 评审] **未执行**：本机 `gemini` CLI 未安装（spawn ENOENT）。按 CLAUDE.md 规定外部工具失败不重试、回退 Claude 单写，此处如实记录。

> [Codex 综合主笔] 本 v2 未单独走"Codex 综合主笔"步骤——方案 C 本就是 Codex 第 2 轮评估推荐的方向，plan 由 Claude 主笔、Codex 两轮评审已充分融入，无需再派一轮综合。

> [Claude 白话化兜底] 全文用大白话，专业术语首次出现均括号翻译（skill / global pool / token / frontmatter / stem / runtime prompt / credential store / subprocess 等）。大哥摘要严格分段、每段简短。已对照 manual.md：偏好"plan 后停一次"已照做；偏好"小功能直接做"不完全适用（本任务跨多文件 + 改后端核心路径，按默认档走，但只在本 plan 后停一次）。
