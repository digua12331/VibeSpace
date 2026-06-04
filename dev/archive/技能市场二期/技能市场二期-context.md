# 技能市场二期 · Context

> AI 自用，记录关键文件 / 决策 / 依赖。大哥不审。

## 关键文件（边界）

### 后端（packages/server/src/）

- `skill-market-service.ts` **【新增】** — 搜索 / 下载 / 本地库扫描 / 配置读写。
- `routes/skill-market.ts` **【新增】** — 5 个端点（见 D2）。
- `index.ts` **【改】** — 增 `import { registerSkillMarketRoutes } from "./routes/skill-market.js"` + 注册一行。
- `skill-catalog-service.ts` **【不改】** — `parseSkillManifest` 已经 export；二期 service 直接复用它，自己写 12 行 `scanLibraryDir` 即可。原决策（export scanOneDir 复用）放弃，因为一期 `SkillEntry.source: 'project' | 'global'` 与二期 `'official' | 'custom'` 是不同语义，类型耦合得不偿失。
- `log-bus.ts` — 不改，复用 `serverLog`。

### 前端（packages/web/src/）

- `components/sidebar/SkillsView.tsx` **【改】** — 加 mode 切换、加"本地库"section、加"市场搜索"视图、加"⚙ 库路径"按钮。允许在文件内抽 `MarketResultRow` / `LibrarySection` 两个内联子组件，但**不开新文件**。
- `api.ts` **【改】** — 加 5 个客户端函数。
- `types.ts` **【改】** — 加 `MarketSkill` / `MarketSearchResult` / `SkillSource` / `LocalLibrary` 类型。

### 文档

- `README.md` + `README.zh-CN.md` **【改】** — Highlights 一期那条扩展提一句"+ 市场搜索"；Architecture 路由列表 + Service 列表各加 `skill-market`；`~/.vibespace/skill-market.json` 默认配置位置写明。

### 配置

- `~/.vibespace/skill-market.json` —— `{ localLibraryPath: string }`，默认 `~/SkillManager`。
- 默认本地库 `~/SkillManager/{official, custom}/`，缺失目录由 download 时按需创建。

## 决策记录

### D1：路由不挂在 `/api/projects/:id/...` 下，而是 `/api/skill-market/*`

**理由**：market 是全机器级（搜索 / 库路径 / 库浏览），不属于某个项目。一期 `/api/projects/:id/skill-catalog/:agentType` 是项目级（要装哪儿）；二期市场是 user-level（去哪儿搜、库放哪儿）。混在一起反而别扭。

### D2：路由列表

- `GET /api/skill-market/search?q=&source=github|skills-sh|all&page=1&limit=20`
- `POST /api/skill-market/download` body: `{ repoUrl, skillName }`
- `GET /api/skill-market/library` → `{ path, official: SkillEntry[], custom: SkillEntry[] }`
- `GET /api/skill-market/library/path` → `{ path }`
- `POST /api/skill-market/library/path` body: `{ path: string, migrate?: boolean }`

### D3：装到项目复用一期 endpoint，不新增

**理由**：从本地库装到项目，srcPath 就是 `<lib>/official/<name>` 这种本地绝对路径。一期的 `POST /api/projects/:id/skill-catalog/:agentType/add` 已经接 srcPath，不需要新接口。前端 `LibrarySection` 直接调 `api.addSkillToProject(...)`。

### D4：repoUrl 白名单 regex

```
^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$
```

匹配后 capture group 1 + 2 = owner / repo，**重组**成 `https://github.com/<owner>/<repo>.git` 作为 cloneUrl，绝不直接把用户输入 pass 给 spawn argv。

拒绝示例（写进单测 / 手工验收）：
- `file:///etc/passwd`
- `ssh://git@github.com/foo/bar`
- `http://github.com/foo/bar`（明文 http 不许）
- `../../etc/passwd`
- `https://evil.com/foo/bar`
- `foo bar/baz`（空格）
- 长度 > 200 字符串

### D5：subprocess 使用 async `spawn` + Promise

```ts
function execGit(args: string[], opts: { timeoutMs: number }): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { stdio: ['ignore', 'ignore', 'pipe'], shell: false });
    let stderr = '';
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('git_timeout'));
    }, opts.timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stderr }); });
  });
}
```

`shell: false` + argv array → 不可能命令注入。60s timeout。

### D6：包大小上限 50MB / 5000 文件

clone 完成后递归遍历 tmpDir 累加 `stat.size` + 文件数；超出任一上限 → 抛 `'too_large'` 409，**先**清理 tmpDir 再 throw。

### D7：cpSync 必须 `dereference: true`

防止 clone 下来的恶意仓库里 SKILL.md 子目录有指向库外的 symlink（如 `link -> /etc/passwd`），dereference 让 cp 跟随但拷贝目标内容；**结合 D6 大小上限**确保不会无限递归或拷贝海量文件。

### D8：60s 进程内内存 cache（仅 GitHub 搜索）

```ts
const cache = new Map<string, { ts: number; value: GitHubSearchResult }>();
const TTL_MS = 60_000;
function cacheKey(q: string, page: number, limit: number) { return `${q}|${page}|${limit}`; }
```

只 cache GitHub。skills.sh 不 cache（响应已经偶发不稳定，cache 错误结果反而坏）。**进程重启 cache 清空** —— 不持久化。

### D9：单并发下载锁

模块级 `let _downloading = false`，进入 download handler 检查 → 已在跑 → 返回 429 `'download_in_progress'`。结束（成功 / 失败 / 超时）一律置回 `false`。

**理由**：磁盘 / 网络 / 临时目录都怕并发拖；下载本身就是一次性动作，UI 也是单按钮；上限 1 比限流队列简单 100 倍。

### D10：本地库配置位置 `~/.vibespace/skill-market.json`

**理由**：跟 skill-catalog 的 `homedir()` 系全局风格一致；不进 SQLite（SQLite 是项目级 state，配置是机器级）。文件首次缺失 → 返回默认 `~/SkillManager`，不强制创建。`set` 时不可写 / 不是目录 → 400 + 旧配置不动。

### D11：失败一律清理 + 失败不残留本地库

下载流程 try/finally：
- temp dir 任何分支退出都 `rmSync(..., { recursive: true, force: true })`
- 已经成功 cpSync 但途中又失败的情况不存在（cpSync 是末尾步骤；之前的失败发生在 cpSync 前）。
- 即使 cpSync 失败一半，finally 也尝试清掉部分写入的 `<lib>/official/<skillName>`。

### D12：SkillsView 子组件抽法

文件内（不开新文件）抽：
- `function MarketResultRow(props: { skill: MarketSkill; onDownload: () => void }): JSX`
- `function LibrarySection(props: { lib: LocalLibrary; onInstall: (s: SkillEntry) => void; onChangePath: () => void }): JSX`

主组件保留 mode state + 数据加载 + 编排，行渲染下沉到子组件，避免主函数 300+ 行。

### D13：mode UI 形态

顶部已有的 agent tab（Claude / Codex / OpenCode）保留；**在 agent tab 上方**或**与 agent tab 同一行**加一个 `[目录视图 | 市场搜索]` 切换。

- catalog mode：原一期 UI + "本地库（已下载）" section（第三栏，与 项目 / 全局 并列）
- market mode：搜索栏 + source filter + 结果分组列表 + 下载按钮

⚙ 库路径按钮放在 catalog mode 的"本地库" section 标题右侧（不在 market mode 显示，避免误导）。

## 依赖与约束

- Node ≥ 22（项目要求）；`fs.cpSync`、`Promise.allSettled`、`AbortController` 都内置。
- `git` 命令必须存在。后端 lazy 检查（`spawn('git', ['--version'])` 一次缓存结果），缺失 → download 接口 503。
- Fastify ≥ 4 + zod 已用。
- 前端 React 18 + zustand + DialogHost；`promptDialog` 已可用。
- `serverLog` / `logAction` / `appendJsonl` 已就绪，scope 用 `'skill-market'`。
- 类型检查命令（一期已验证可行）：`cd packages/server && npx tsc --noEmit` / `cd packages/web && npx tsc --noEmit`。

## API 形态详细

### `GET /api/skill-market/search`

Query: `q` (str, optional), `source` ('github' | 'skills-sh' | 'all', default 'all'), `page` (int, default 1), `limit` (int, default 20, max 50)

Response:
```ts
{
  source: 'github' | 'skills-sh' | 'all',
  github: { items: MarketSkill[], total: number, rateLimitRemaining: number | null } | null,
  skillsSh: { items: MarketSkill[], total: number } | null,
  cached: boolean
}
```

`MarketSkill = { id, name, description, source, author, stars, repoUrl, updatedAt? }`

### `POST /api/skill-market/download`

Body: `{ repoUrl: string, skillName: string }` (zod min 1, max 200)

200: `{ success: true, path: string, skillName: string, sizeBytes: number, fileCount: number }`
409: `{ error: 'already_exists', path: string }`
429: `{ error: 'download_in_progress' }`
503: `{ error: 'git_not_installed' }`
400: `{ error: 'invalid_repo_url' | 'too_large' | ... , detail }`

### `GET /api/skill-market/library`

Response: `{ path: string, official: SkillEntry[], custom: SkillEntry[] }`

`SkillEntry` 复用一期类型；`source` 字段对应 `'official' | 'custom'`（小调整：一期是 `'project' | 'global'`，这里独立一组）。

### `GET /api/skill-market/library/path` / `POST /api/skill-market/library/path`

GET: `{ path: string }`
POST body: `{ path: string, migrate?: boolean }` → 200: `{ path, migrated?: { from, to, fileCount } | null }`，400: `{ error: 'path_unwritable' | 'path_not_directory' }`

migrate=true（stretch）：把 `<oldPath>/{official,custom}` 整体 cpSync 到新路径，成功后 rmSync 旧目录。失败不回滚但日志告警。**本期可不实现 migrate=true 分支，仅文件路径写入新值。**

## 验收回放路径（任务完成后跑一遍）

1. `pnpm dev:all` 启动；浏览器开 🧩 面板。
2. catalog mode → 现有 项目 / 全局 两栏不变 + 多了"本地库（已下载）"栏（首次为空）。
3. 切到 market mode → 搜框输入 `test` → 看到 GitHub + skills.sh（如果还活着）的结果合并。
4. 点某个结果的"下载" → loading → 完成 alert "下载到 `~/SkillManager/official/<name>`"。
5. 切回 catalog mode → 本地库栏出现刚下载的 skill → 点"装到本项目" → 项目栏多一条。
6. LogsView 看到 `scope=skill-market action=search` / `download` 起止配对，`scope=skill-catalog action=add` 也有（来自一期）。
7. 主理人手动失败分支：
   - 输入非法 repoUrl（`file://...`）→ 400 ERROR 日志。
   - 同一 skill 二次下载 → 409 + "已经有了"提示。
   - 故意断网搜索 → GitHub 路空 + skills.sh 路空，UI 不崩，红色提示条。
8. `tail -n 100 packages/server/data/logs/<today>.log | findstr skill-market` → 命中。
9. 双语 README 都补了市场段落。
