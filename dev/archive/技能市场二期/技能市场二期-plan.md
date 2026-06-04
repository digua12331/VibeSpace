# 技能市场二期 · Plan

## 大哥摘要

这期把"市场"补到 🧩 技能面板里：你可以在面板里搜 GitHub 和 skills.sh 上的 skill（一个文件夹，里面有 SKILL.md，教 AI 怎么干活），点一下"下载"就自动落到本机。
下载后的 skill 会集中放进**本地库**目录（默认 `~/SkillManager`，可在面板里改路径）；之后你仍然用一期那个"装到本项目"按钮把它装进当前项目。
你**怎么验收**：打开 🧩 → 切到"市场搜索"→ 搜个关键词 → 点"下载"→ 切回"本地库"应该看到刚下载的条目。
**只在你点搜索或下载时才联网**，不会主动连外网。安全上只允许下 GitHub 仓库，会拦异常地址、过大仓库（>50MB 或 >5000 文件）、重复下载，失败一定清理临时目录。
**对你已有的东西不动**：项目代码、一期里已装好的 skill（`.claude/skills/` 等）、`.aimon/skills/` 都不碰；本期只往本地库目录里写新文件。

## 目标含验收

1. 浏览器可见的市场入口：技能面板新增“市场搜索”和“本地库”能力，搜索框能查 GitHub / skills.sh / all 三种来源，结果能显示名称、描述、来源、星标数、作者和仓库链接。验收：浏览器里搜索一个关键词，能看到分来源的结果；skills.sh 不可用时 GitHub 结果仍能显示，UI 不崩。
2. 下载能力：点击某条结果的“下载”后，后端只接受 GitHub 仓库地址，把仓库临时下载到本机，找到 `SKILL.md` 后复制到本地库的 `official/<skillName>`。验收：下载成功后浏览器提示下载位置，并且本地库列表能看到该 skill。
3. 安全校验：`repoUrl` 必须用白名单正则校验：`^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$`。匹配后只用 `owner/repo` 重组 `https://github.com/<owner>/<repo>.git` 作为 cloneUrl，不把用户原始输入直接传给 subprocess（子进程，后台执行 git 的小程序）。验收：至少手动测 `file://`、`ssh://`、`http://github.com/...`、`../../etc`、带空格、超长字符串中的 3 个，全部返回 400。
4. 下载过程不阻塞服务：统一用 async `spawn` + Promise 包装 git clone，60 秒硬超时，不使用 `spawnSync`。验收：server typecheck（类型检查，提前发现参数和返回值错误）通过；超时或 git 缺失时返回可读错误。
5. 防止下载内容越界：复制时使用 `cpSync(src, dst, { recursive: true, dereference: true })`，避免下载内容里的 symlink（符号链接，文件夹里的“快捷方式”）指向库外文件。验收：准备带 symlink 的测试仓库或本地假数据时，复制结果不会把库外目标带入。
6. 包大小上限：临时 clone 后递归统计，超过 50MB 或 5000 文件数就拒绝复制并清理。验收：构造或模拟超限目录，接口返回失败，本地库没有残留。
7. 失败清理：下载成功、失败、超时、校验失败后都清理临时目录。验收：失败下载后临时目录已被清理，本地库无残留。
8. 重复下载：目标 skill 已存在时不覆盖，返回 409 `alreadyExists`，前端显示“已经有了”一类提示。验收：同一个 skill 连续下载两次，第二次返回 409，UI 显示已经有了。
9. 本地库路径：配置文件统一为 `~/.vibespace/skill-market.json`，内容只保存本地库路径，默认 `~/SkillManager`。验收：GET/POST 路径接口能读写配置；路径不可写时返回 400 且不改旧配置。
10. 日志：新增用户可感知操作必须记录到 LogsView（浏览器里的操作日志面板）和 `packages/server/data/logs/YYYY-MM-DD.log`。验收：搜索、下载、设置路径都能在 LogsView 看到 `scope=skill-market action=search|download|set-library-path` 的开始/结束配对；失败分支至少人工触发一次 ERROR 条目。
11. 类型和文档：server + web typecheck 通过，README / README.zh-CN 同步补充市场入口、路由和默认路径。验收：项目类型检查命令通过，双语 README 都能看到新增说明。

## 非目标

1. 本期不做收藏、书签、评分、自动更新、版本管理；已存在的 skill 直接 409，不覆盖。
2. 本期不做下载进度条和实时 git 输出；按钮 loading 到接口返回即可。
3. 本期不做 skill 内容全文预览，只在列表里展示标题、描述和来源信息。
4. 本期不支持非 GitHub 下载源，不做代理、镜像、私有仓库认证。
5. migrate（迁移已下载内容到新路径）作为 stretch（可选小尾巴），本期可不交付；路径切换是必须交付。

## 实施步骤

1. 补后端服务 `packages/server/src/skill-market-service.ts`。
   - 实现 GitHub 搜索、skills.sh 搜索、本地库扫描、路径配置、下载主流程。
   - GitHub API 加 60 秒进程内内存 cache（缓存，短时间复用同一搜索结果），key = `q + page + limit`，减少 rate limit（访问频率限制）压力。
   - 下载流程使用 repoUrl 白名单正则、async spawn 60 秒超时、clone 后 50MB / 5000 文件上限、`cpSync(..., { recursive: true, dereference: true })`、finally 清理临时目录。
   - verify: server typecheck 通过；手动或单测覆盖非法 repoUrl、超限包、重复下载、失败清理。

2. 补后端路由 `packages/server/src/routes/skill-market.ts` 并在入口注册。
   - 最终路由列表：
     - `GET /api/skill-market/search?q&source=github|skills-sh|all`
     - `POST /api/skill-market/download {repoUrl, skillName}`
     - `GET /api/skill-market/library`
     - `GET /api/skill-market/library/path`
     - `POST /api/skill-market/library/path {path, migrate?:boolean}`
   - mutation（会改本机文件或配置的接口）必须用 `serverLog` 记录开始、成功、失败；失败带 `meta.error`。
   - verify: curl 或浏览器请求各端点能拿到 JSON；下载和设置路径在 LogsView 与落盘日志里都有起止配对。

3. 补前端 API 和类型。
   - 新增 `MarketSkill`、`MarketSearchResult`、`LocalLibrary`、`SkillSource` 等类型，以及搜索、下载、读取库、设置路径函数。
   - verify: web typecheck 通过；接口错误能显示后端 message，不吞掉。

4. 改 `SkillsView.tsx` 的 UI。
   - 增加“市场搜索”视图：搜索框、来源选择、结果列表、下载按钮、错误提示。
   - 增加“本地库”区域：展示 `~/SkillManager/{official, custom}` 扫描出的 skill，并复用一期“装到本项目”入口。
   - 本期允许在同目录下抽 1-2 个 sub-component（子组件，拆小但不新开文件夹），例如 `MarketResultRow`、`LibrarySection`，保持文件结构克制。
   - 前端 mutation 用 `logAction('skill-market', 'search'|'download'|'set-library-path', ...)` 包装。
   - verify: 浏览器里能搜索、下载、切回本地库看到条目；LogsView 看到起止配对；重复下载 UI 显示“已经有了”。

5. 补配置和文档。
   - 配置统一读写 `~/.vibespace/skill-market.json`，默认本地库为 `~/SkillManager`。
   - README 和 README.zh-CN 同步补市场功能、API 路由、本地库路径和失败提示。
   - verify: 删除配置文件后能走默认路径；改路径后重启仍生效；双语 README 都有对应段落。

6. 做人工失败分支验收。
   - 至少测 3 个非法 repoUrl 返回 400。
   - 测失败下载后临时目录清理、本地库无残留。
   - 测重复下载返回 409 alreadyExists，前端提示已经有了。
   - 测 skills.sh 故意请求不存在关键词或断网时，GitHub 一路有结果则 UI 不崩。
   - verify: 把人工验收结果记录到 tasks；未人工触发的失败分支标“待主人手动验收”，不冒充已完成。

## 边界情况

1. 搜索关键词为空：可以走 GitHub `topic:skill` 的默认热门结果，skills.sh 返回空也不算失败。
2. skills.sh 挂了、断网、字段变了：只让 skills.sh 这一路为空或显示提示，不影响 GitHub 结果。
3. GitHub rate limit：优先用 60 秒 cache 降低压力；如果仍被限制，前端展示可读提示。
4. 下载仓库根目录就是一个 skill，或子目录里有多个 `SKILL.md`：先按 `skillName` 精确匹配子目录，找不到再扫描第一份 `SKILL.md`。
5. `repoUrl` 非 GitHub、带空格、路径穿越、协议不对、超长：返回 400，不启动 git。
6. 本机没有 git：下载接口返回 503，并提示先安装 git。
7. 临时目录写入失败、磁盘满、权限不足：返回失败并尽力清理临时目录。
8. 本地库路径不存在：允许创建；路径不可写或不是目录时返回 400，不改配置。
9. `migrate=true`：stretch，不作为本期必须交付；若实现，迁移失败要明确提示部分成功/失败，不静默吞掉。
10. 中文路径、带空格路径：使用 path API 拼接，不用字符串手搓，不走 shell。

## 风险与注意

1. 最大风险是下载地址被当成命令参数滥用：必须先用白名单 regex 提取 owner/repo，再重组 cloneUrl，不直接 pass 用户原始输入给 spawn。
2. 第二风险是 symlink 越狱：复制必须 `dereference: true`，并且只复制找到的 skill 目录，不复制整个仓库到未知位置。
3. 第三风险是大仓库拖垮磁盘或服务：clone 后先统计大小和文件数，超过 50MB 或 5000 文件立即拒绝并清理。
4. 后端下载会改本机文件，属于用户可感知 mutation，必须同时覆盖前端 `logAction` 和后端 `serverLog`；验收时要区分外层用户操作日志和内层服务日志，不把两套配对误判为重复。
5. memory 扫过，相关长期偏好是：面向大哥的说明优先写“在哪里点、看到什么、会不会动现有数据”；新增可见功能要同步 README / README.zh-CN；涉及人工浏览器和失败分支验收时要明确标注，不把人工项冒充自动完成。
6. 不要顺手重构一期已有技能安装逻辑；本期只在需要时复用现有接口。

## 多模型 Plan 会审

> [Gemini 评审] 跳过：gemini CLI 未安装（spawn ENOENT）
> [Codex 评审] repoUrl 必须用白名单 regex 校验并重组 cloneUrl，不直接 pass 给 spawn；cpSync 必须加 dereference:true 防 symlink 越狱；GitHub 搜索结果加 60s 内存 cache 防 rate limit
> [Codex 综合主笔] 采纳了安全校验三件套（regex 白名单、cpSync dereference、大小上限）和 cache；放弃了 migrate 本期交付（标为 stretch）；因为安全风险优先级高于功能完整性
> [Claude 白话化兜底] 重写大哥摘要为 5 行白话版，明确入口（🧩 → 市场搜索）+ 验收路径 + 只有点击才联网 + "对一期成果和现有项目都不动"边界；其余实施细节、安全校验、决策记录保留 Codex 原稿不动
