# 技能市场二期（Claude 草案，未定稿）

> 一期已交付：`.claude|.codex|.opencode/skills/` 文件夹型 skill 的 scan / install / uninstall / 自定义路径添加。
> 本期目标：补 marketplace（联网搜 + 一键下载）+ 本地库浏览，跟一期面板融合在 🧩 同一个入口下。

## 大哥摘要（草案）

- 一期能管已有的 skill，但要装新 skill 还得自己去 GitHub clone、找 SKILL.md、复制——这期把这条路打通：在 🧩 面板里加一栏"市场"，搜 GitHub topic:skill 和 skills.sh（83000 多个开源 skill），挑一个点"下载"就自动落到本地。
- 下载后的 skill 集中放在一个"本地库"目录（默认 `~/SkillManager/`，跟上游兼容；可以在面板里改路径），随后用一期的"装到本项目"按钮把它装进当前项目用就行。
- 面板会从两栏（项目 / 全局）变成三栏：**项目 / 全局 / 本地库**；**市场搜索**单独一行入口（一个搜索框 + 结果列表 + 下载按钮）。
- 联网行为只在你点搜索按钮时才发生，不主动联网；搜索失败/没网会显示"暂时连不上"，不会打断面板其他功能。

## 与上游 skill-manager 的对照

参考 https://github.com/cgx2012/skill-manager/blob/main/skill-manager/src/server/routes/market.ts，关键能力：

- `GET /search?q&page&limit` → GitHub Search API `topic:skill`
- `GET /trending` → GitHub topic:skill + sort=stars
- `GET /search/skills-sh?q&limit` → skills.sh `/api/search`
- `POST /download {repoUrl, skillName}` → `git clone --depth 1` 到临时目录 → 找 SKILL.md → cpSync 到 `<localLibrary>/official/<name>/`
- `GET /local` → 扫 `<localLibrary>/{official, custom}/`
- `POST /config/migrate-local-library {newPath}` → 改路径并迁移已下载内容

本期采纳前 5 个；迁移路径（migrate）作为 stretch（小子项，留到本期末尾如果时间够再做）。

## 目标 + 验收（草案）

**核心 UI 行为（浏览器可观察）**：
1. 🧩 面板顶部新增一个 **🛒 市场** 切换（与现有 agent tab 同行或单独一行）。点开显示搜索栏 + 结果列表。
2. 搜索栏：单输入框 + "搜索"按钮。下方结果按 source（GitHub / skills.sh）分组或带徽章；每条显示 name / description / stars / 作者 / 仓库链接。
3. 每条结果尾部"下载"按钮 → 调后端 `download` → 等待时按钮转 loading → 完成后弹 toast/alert "下载到 `<localLibraryPath>/official/<name>`"。
4. 面板下半部多一栏 **本地库**（与 项目 / 全局 并列），列出 `~/SkillManager/{official, custom}/` 下扫描出的 skill；行尾按钮："装到本项目"（复用一期 addSkill 接口，srcPath = 该 skill 在本地库的路径）。
5. 顶部有"⚙ 库路径"小按钮 → 弹 promptDialog，可改本地库根路径（migrate 是否真挪文件作为 stretch）。
6. 失败分支：网络断开 → 搜索结果空 + 顶部红条提示；下载失败（不是合法 skill 仓库 / 没 git / 已存在） → alertDialog 显示后端返回的 message。

**操作日志**：
- 前端 `logAction('skill-market', 'search'|'download'|'set-library-path', ...)` 起止配对。
- 后端 `serverLog` 同样配对，下载分支必须带 `meta.repoUrl` + `meta.skillName`，失败带 `meta.error`。
- LogsView 看到 `scope=skill-market` 的起止配对；落盘日志 grep 命中。

**安全 / 健壮性验收**：
- repoUrl 校验：只接受 `https://github.com/<owner>/<repo>(.git)?` 或 GitHub `owner/repo` 短格式，**不接受任意 URL**（拒绝 `file://` / `ssh://` / 任意 host）。
- git clone 用 `spawnSync` 不走 shell，参数走 argv 数组，避免命令注入。
- 临时目录用 `os.tmpdir()` + 时间戳，结束（成功或失败）必清理。
- 网络请求带 timeout（≤ 10s），AbortController；不阻塞事件循环。
- skills.sh 字段缺失时容错，不抛。
- 已存在的 skill 不覆盖，返回 409 + `alreadyExists: true`，前端提示"已经有了"。
- `git` 命令不存在时，`download` 立即返回 503 + 人话错误"请先装 git"。

**类型检查**：server + web typecheck 通过。

## 非目标（这期不做）

1. 不做"我的收藏"/"书签"（upstream 的 saved-collections）。
2. 不做下载进度条 / 流式输出，下载就是同步等返回。
3. 不做 skill 内容预览（点进去看 SKILL.md 全文），列表里只展示标题和描述。
4. 不做下载后的自动版本管理 / 升级，已存在就 409。
5. 不做对 git clone 的代理 / 镜像支持。
6. 不动一期已有代码（新增即可）。

## 实施步骤（粗粒度）

1. **后端 service** — `packages/server/src/skill-market-service.ts`
   - `searchGitHub(q, page?, limit?)`: 用 `fetch` 调 `https://api.github.com/search/repositories?q=${q}+topic:skill&sort=stars&order=desc`，10s timeout。User-Agent 带 `VibeSpace`。
   - `searchSkillsSh(q, limit?)`: 调 `https://skills.sh/api/search?q=&limit=`。失败返回空数组不抛。
   - `searchAll(q)`: 并发跑两路，结果合并 + 标 source 字段。
   - `getLocalLibraryPath()` / `setLocalLibraryPath(p)` / `migrateLocalLibrary(newPath)`: 配置存在 `<repo-data>/skill-market.json` 或 `~/.vibespace/skill-market.json`（决策记录里定）。
   - `scanLocalLibrary()`: 复用一期 `scanOneDir`（导出它），扫 `<lib>/official` + `<lib>/custom`。
   - `downloadSkill({ repoUrl, skillName })`:
     - 校验 repoUrl 合法（regex）。
     - 临时目录 `os.tmpdir()/vibespace-skill-<ts>`。
     - `spawnSync('git', ['clone', '--depth', '1', cloneUrl, tmpDir], { stdio: 'pipe', shell: false })`，超时 30s。
     - 在 tmpDir 中递归找 `SKILL.md`（先精确匹配 name 子目录，再 fallback 全树搜）。
     - cpSync 到 `<lib>/official/<skillName>`（已存在 → 抛 SkillMarketError 'already_exists' 409）。
     - 清理 tmpDir（成功失败都要）。
   verify: 单测 mock 一个本地 git server，或起码静态检查通过；server typecheck 通过。

2. **后端路由** — `packages/server/src/routes/skill-market.ts`
   - `GET /api/skill-market/search?q=&source=github|skills.sh|all` → 列表。
   - `POST /api/skill-market/download` body: `{ repoUrl, skillName }` → 落盘结果。
   - `GET /api/skill-market/library` → `{ path, official: SkillEntry[], custom: SkillEntry[] }`。
   - `GET /api/skill-market/library/path` → `{ path }`。
   - `POST /api/skill-market/library/path` body: `{ path: string, migrate?: boolean }` → 改路径。
   - 全部走 zod；mutation 用 `serverLog` 起止配对。
   verify: server typecheck 通过；curl 各端点拿到 JSON。

3. **注册路由** — `packages/server/src/index.ts`：一行 import + 一行 `await register...`。

4. **前端 API + 类型** — `api.ts` + `types.ts`
   - 新增 `MarketSkill` / `MarketSearchResult` / `LocalLibrary` / `SkillSource` 类型。
   - 客户端函数：`searchSkillMarket(q, source?)` / `downloadSkill({ repoUrl, skillName })` / `getSkillLibrary()` / `setSkillLibraryPath(p, migrate?)`.

5. **前端 UI** — 改 `SkillsView.tsx`（不开新文件，与一期同入口）
   - 顶部除 agent tab 外，加一个 mode 切换：**目录视图 / 市场搜索**。
   - 目录视图：保留一期 项目 / 全局 两栏，新增第三栏 **本地库（已下载）**，行尾按钮"装到本项目"。
   - 市场视图：搜索框 + 结果分组（GitHub / skills.sh）+ 每条"下载"按钮。
   - 顶部"⚙ 库路径"按钮 → promptDialog 改路径。
   - 全部 mutation 用 `logAction('skill-market', ...)` 包装。
   verify: web typecheck 通过；浏览器点搜索能拿到结果，点下载能落盘，再切回目录视图能在本地库栏看到。

6. **配置文件** — `~/.vibespace/skill-market.json`
   - 仅一个字段 `{ localLibraryPath: string }`，缺省值 `~/SkillManager`（与 upstream 兼容）。
   - 读取/写入封在 service 内，前端不直接接触。

7. **README 双语** — Highlights 段补一行"市场"；Architecture 路由列表 + Service 列表各加一行；说明本地库默认路径和怎么改。

8. **手工浏览器实操验收**（标 "待主理人手动验收"）—— 搜 / 下 / 装 / 改库路径 / 故意断网触发 ERROR 日志 / 失败分支至少触发一次。

## 边界情况

- 搜索 q 为空：转为 trending（GitHub topic:skill 按 stars 排序前 20）。
- skills.sh API 形态变了 / 字段缺失 → 容错降级，不阻塞 GitHub 那一路。
- GitHub API rate limit（未鉴权 60req/h）→ 后端把 `X-RateLimit-Remaining` 透出来，前端在 ≤5 时给警告。
- 下载的仓库本身就是一个 skill（根目录有 SKILL.md）vs 包含多个 skill 子目录（每个子目录有 SKILL.md）：先精确按 name 匹配子目录，找不到再扫全树第一个 SKILL.md。
- repoUrl 不是 GitHub → 400 `'invalid_repo_url'`。
- git 命令缺失 → 503 `'git_not_installed'`。
- 临时目录写盘失败（磁盘满 / 权限）→ 500 + 清理。
- 库路径改到一个不存在或不可写的目录 → 400 + 不改配置。
- migrate=true 时迁移失败（部分文件已挪）→ partial 状态，不回滚但日志提示用户。
- 中文 / 空格 路径 → 走 path.join，不拼字符串、不 shell。

## 风险与注意

- **最大风险：git clone 注入**。spawn 必须 shell:false + argv 数组；repoUrl 通过 regex 白名单后只用 owner/repo 重组 cloneUrl，不直接把用户输入 pass 给 spawn。
- **第二风险：DoS / 失控临时目录**。下载并发上限（同一时刻最多 1 个，第 2 个直接 429）；下载 timeout 60s 硬切；finally 清理。
- **GitHub API 没有鉴权**：60req/h 限制大哥个人用够，不需要 token，但代码里留 `process.env.VIBESPACE_GITHUB_TOKEN` 钩子，未来可加。
- **skills.sh 是第三方接口**，可能挂 / 改 schema：本期容错兜底，issues 里记一条"长期监控"。
- **本地库默认路径 `~/SkillManager`**：跟 upstream skill-manager 兼容，避免大哥已经在用 upstream 时再分一个。`~/.vibespace/skill-market.json` 配置可改。
- **下载是阻塞 IO**：用 `spawnSync` 在 fastify handler 里跑会卡 event loop。改用 `spawn` + Promise，60s 内完成。

## 假设

- 大哥要的是"上游 skill-manager 的市场功能"，不是更高级的版本管理 / 自动更新。
- 默认路径 `~/SkillManager` 兼容 upstream 是合理选择，配置可改。
- 不要求做下载进度条；下载平均 5–15s，转个 loading 即可。

## 多模型 Plan 会审（待填）

> [Gemini 评审] 待填（gemini CLI 缺失，应跳过）
> [Codex 评审] 待填
> [Codex 综合主笔] 待填
> [Claude 白话化兜底] 待填
