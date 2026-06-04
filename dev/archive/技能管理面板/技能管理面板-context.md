# 技能管理面板 · Context

> AI 自用，记录关键文件 / 决策 / 依赖。大哥不审。

## 关键文件（边界）

### 后端（packages/server/src/）

- `skill-catalog-service.ts` **【新增】** — 路径表常量、scan/parse/add/remove 五个纯函数。
- `routes/skill-catalog.ts` **【新增】** — 三个端点（见"决策记录"）。zod 校验、`serverLog` 起止配对、ERROR 分支带 `meta.error`。
- `index.ts:23-39` **【改】** — 增 `import { registerSkillCatalogRoutes } from "./routes/skill-catalog.js"` + 在路由注册区调用一次。
- `db.ts` — 不动。本期不进 SQLite。
- `skills-service.ts` — **不动**。这是 `.aimon/skills/` 单文件 + trigger 注入机制，与本期 `.claude|.codex|.opencode/skills/` 文件夹机制并存。

### 前端（packages/web/src/）

- `components/sidebar/SkillsView.tsx` **【新增】** — 仿 `DocsView.tsx` 风格。顶部 agent tab、双栏列表、每行操作按钮、自定义路径输入用 `promptDialog`。
- `components/layout/ActivityBar.tsx:23-44` **【改】** — items 数组加 `{ id: 'skills', icon: '🧩', label: '技能' }`。
- `components/layout/PrimarySidebar.tsx` **【改】** — `TITLES` 加 `skills: '技能'`、`switch` 加 `case 'skills'` → `<SkillsView />`、import 一行。
- `store.ts:43` **【改】** — `Activity` union 加 `'skills'`。
- `api.ts` **【改】** — 新增三个 client 函数：`scanSkillCatalog(projectId, agentType)` / `addSkill(projectId, agentType, body)` / `removeSkill(projectId, agentType, body)`。
- `types.ts` **【改】** — 新增 `SkillAgentType` / `SkillManifest` / `SkillEntry` / `SkillCatalogResult` 类型。
- `logs.ts` — 不动，复用 `logAction`。

### 文档

- `README.md` + `README.zh-CN.md` **【改】** — Highlights 加一句、Architecture 路由列表 + Service 列表各加一行、明确 `.aimon/skills` 与 `.claude|.codex|.opencode/skills` 的区分。
- `dev/active/技能管理面板/` — 三 md + json，本任务自动维护。

## 决策记录（每条都过"资深工程师会不会觉得过度设计"那把刀）

### D1：路由形态走 `/api/projects/:id/skill-catalog/:agentType`，不走 upstream 的 `?projectPath=&agentType=` query

**理由**：本仓库所有项目相关路由（docs / git / cli-configs / perf / hooks）都是 `/api/projects/:id/...` 模式，从 DB 反查 `path`，与 upstream 的"前端传 projectPath 字符串"是不同的安全边界（前端不应该自由传任意 path）。一致性 + 安全性双赢。

### D2：scan 与 global 合并成一个端点 `GET /api/projects/:id/skill-catalog/:agentType` 返回 `{ project, global }`

**理由**：前端永远同时要这两组数据展示在同一面板；分两个端点会触发两次串行请求且无任何收益。Codex 评审采纳。

### D3：DELETE 改 POST `/remove`

**理由**：DELETE 带 body 在不同 fetch / axios / 浏览器 / 反向代理实现里不一致（部分实现剥离 body）。POST + 明确动词路径 是常见的折中。Codex 评审采纳。

### D4：删除单独的 `/manifest` 端点

**理由**：scan 响应每条 skill 已含 `{ name, description, version, path }`，单独 manifest 端点零增量价值。Codex 评审采纳。

### D5：upstream 的 `/add` 和 `/add-from-path` 合并成一个 `POST .../add`，因为 server 视角它们完全相同

**理由**：两者对 server 都是 "拿一个 srcPath，复制或 symlink 到 project skill 目录"。upstream 拆成两个只是因为它的 UI 入口不同。我们的 server 不区分，UI 层照样能做两个入口（点全局 skill 行 vs 点"添加自定义路径"按钮），都调同一个 endpoint。**校验逻辑**（srcPath 存在 + 含 SKILL.md）对两者都强制执行。

### D6：默认 `useSymlink: false`（复制模式）

**理由**：Windows 下创建 symlink 默认要管理员权限或开发者模式，失败概率高；用户不关心底层差别，默认走最稳的。UI 提供 toggle，把"链接到全局"作为可选高级选项。

### D7：`removeSkill` 安全校验

- `skillName` 必须 match `^[A-Za-z0-9_\-\.]+$`（不含路径分隔符 / `..`）
- 解析后的最终 path 必须 `path.resolve()` 后 `.startsWith()` 目标 skill 目录的 `path.resolve()`
- lstatSync 区分 symlink（unlinkSync）vs 目录（rmSync recursive）

**理由**：误删风险是本期最大风险（CLAUDE.md 风险段已列），双重校验是最低成本兜底。

### D8：`addSkill` 安全校验

- `srcPath` 必须存在（`existsSync`）
- `srcPath` 必须是目录
- `srcPath` 含 `SKILL.md`（不要求 frontmatter，但要求文件存在）
- 目标已存在 → 409 + `{ error: 'already_exists' }`，**不覆盖**

**理由**：自定义路径输入是攻击面，server 必须 enforce 而非信任前端。

### D9：复制实现走 `fs.cpSync(src, dst, { recursive: true })`

**理由**：Node 16.7+ 内置，VibeSpace 要求 Node ≥22，安全。upstream 自己写递归 copyDir 是为兼容老 Node，本仓库不需要。

### D10：日志 scope 用 `'skill-catalog'`

**理由**：避免与现有 `'skills'`（如果未来 `.aimon/skills/` 系统加日志）混淆。LogsView 一眼能筛。

### D11：本期不抽 helper、不为未来 marketplace 留 type seam

**理由**：CLAUDE.md 外科式约束 + Codex 评审"不留 marketplace stub"。第二期再说。`AGENT_SKILL_DIRS` 常量本身就是天然 seam。

## 依赖与约束

- Node ≥ 22（已是项目要求），`fs.cpSync` 可用。
- Fastify ≥ 4，zod 已在用，无新增依赖。
- 前端 React 18 + zustand，`promptDialog` 已存在（DialogHost.tsx:99）。
- `logAction` / `pushLog`（packages/web/src/logs.ts）+ `serverLog`（packages/server/src/log-bus.ts）按 CLAUDE.md 操作日志规则使用。
- `getProject(id)` 来自 db.ts，路由用它从 id 反查 path。
- 类型检查命令：`pnpm -C packages/server typecheck` + `pnpm -C packages/web typecheck`。

## OpenCode 双路径处理

upstream 的 OpenCode 项目级有 `.opencode/skill` 和 `.opencode/skills` 两个候选。本仓库照搬：

- scan：两个目录都扫，结果合并去重（同名以先扫到的为准）。
- add：写第一个候选 `.opencode/skill`（与 upstream 默认一致）。
- 全局同样多候选，scan 全扫，add 写第一个。

## 路径表（与 upstream 对齐）

```ts
const AGENT_SKILL_DIRS = {
  'claude-code': {
    project: ['.claude/skills'],
    global: [path.join(os.homedir(), '.claude', 'skills')],
  },
  'codex': {
    project: ['.codex/skills'],
    global: [path.join(os.homedir(), '.codex', 'skills')],
  },
  'opencode': {
    project: ['.opencode/skill', '.opencode/skills'],
    global: [
      path.join(os.homedir(), '.config', 'opencode', 'skill'),
      path.join(os.homedir(), '.config', 'opencode', 'skills'),
      path.join(os.homedir(), '.agents', 'skill'),
      path.join(os.homedir(), '.agents', 'skills'),
    ],
  },
} as const;
```

## SKILL.md 解析

- 有 YAML frontmatter（`---` 包夹）→ 取 `name` + `description`（最多 200 字符截断）。
- 无 frontmatter → 首行去 `#` 当 name；后续合并截 200 当 description。
- 解析失败 → 文件夹名兜底 name、空 description。
- 仿 upstream 简化解析，**不引入 `gray-matter`**（与现有 `skills-service.ts` 风格一致）。

## 验收回放路径（任务完成后跑一遍）

1. `pnpm dev`（或 start.bat）启动，浏览器打开。
2. 点左侧 🧩 → 看到面板。
3. 切到 Claude tab → 看到项目里的 skill（若有） + `~/.claude/skills/` 下的全局 skill。
4. 点全局 skill 行的"装到本项目" → 列表刷新、项目栏多一条。
5. LogsView 看到 `scope=skill-catalog` 的起止配对。
6. 点项目 skill 行的"卸载" → 弹 confirmDialog → 确认 → 列表刷新。
7. 点"添加自定义路径" → 输入一个不存在的路径 → server 返回 400 → ERROR 日志在 LogsView 出现。
8. `tail -n 50 packages/server/data/logs/$(date +%Y-%m-%d).log | grep skill-catalog` → 能看到落盘的日志。
9. 切 Codex / OpenCode tab，未装则空态显示"暂无"，不报错。
