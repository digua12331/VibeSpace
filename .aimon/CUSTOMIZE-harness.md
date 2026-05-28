# Harness 配置 · 改造清单（装完后必读）

刚拷过来的 13 个文件 + 2 份 dev/ 文档**约 70% 内容是 VibeSpace 自己的项目栈**——fastify route 模板、SQLite 三处套路、React Tailwind 5 色调色板、`pnpm smoke:worktree` 这些。直接用会让 subagent 派工时给你不存在的命令。

按下面清单逐项改完才算"装好"。

---

## 改造优先级

| 级别 | 含义 |
|---|---|
| 🔴 **必改** | 不改会让 agent 派工产出错误代码 |
| 🟡 **建议改** | 不改不会出错，但 agent 输出不会贴合你项目语境 |
| 🟢 **可保留** | 通用模式，跨项目通用，不改也行 |

---

## `.aimon/skills/` 6 个

### 🔴 `db加列三处套路.md`

VibeSpace 用的是 SQLite + better-sqlite3 + 自写 `addColumnIfMissing` helper。**你项目用别的就要重写整段**：

- 用 **PostgreSQL + Prisma** → skill body 改成"用 `prisma migrate dev` 加 model 字段；不要手写 ALTER"
- 用 **TypeORM** → 改成"用 migration 文件 + `typeorm migration:run`"
- 用 **Drizzle** → 改成"用 `drizzle-kit generate` 出 migration"
- 用 **MongoDB** → 整个 skill 删掉（schemaless，没"加列"概念）

**保留 frontmatter 的 triggers**（`db / schema / 加列 / migrate / 字段`）—— trigger 关键词通用。

### 🔴 `加新api路由.md`

VibeSpace 用 fastify。**你项目换框架就要重写 60%**：

- **Express** → 改"app.get/post/put/delete + middleware + zod 校验仍可用"
- **Next.js App Router** → 改"加 `app/api/<resource>/route.ts` + `Request`/`NextResponse` API"
- **Hono / Elysia** → 各自的 schema 校验方案
- **NestJS** → controller + DTO + 装饰器

**保留**：操作日志规则的精神（mutation 必有起止配对）；scope 命名约定（小写单词）；"DELETE 不要加 body" 这种 HTTP 通用规矩。

### 🔴 `前端加badge.md`

VibeSpace 用 React + Tailwind + 自定义 5 色调色板（cyan/emerald/violet/amber/rose）。**完全项目特定**：

- **Vue** → 改 `<script setup>` + computed badge 模板
- **shadcn/ui** → 改成 `<Badge variant="...">` 用 shadcn 的 variant 系统
- **没用 Tailwind** → 颜色 className 全换
- **不用 React** → 整个 skill 删掉，按你项目 UI 框架重写

**保留**：badge 顺序约定的精神（语义层 > 实现层 > 进程层 > 标识层 > 约束层）—— 任何 UI 框架都受用。

### 🟡 `操作日志埋点.md`

CLAUDE.md 操作日志规则的精神是通用的；具体函数名 `logAction` / `serverLog` / `pushLog` **是 VibeSpace 内部的**：

- 你项目有自己的 logger（pino / winston / bunyan / 自写）→ 把函数名替换成你项目的对应 helper
- 没有结构化 logger → skill 改成"用 console.log 也行，但 msg 里带固定前缀 `[scope] action 开始/成功/失败`"
- 用 OpenTelemetry → skill 改成"包成 span 起止"

**保留**：起止配对、ERROR 路径必须、meta ≤ 2KB。

### 🔴 `smoke脚本.md`

VibeSpace 的 smoke 模板是 `node scripts/*-smoke.mjs` + 起 server + curl。**改造方向多**：

- 你项目用 **vitest / jest** → skill 改成"`describe + it` 块 + supertest 起 server"
- 用 **Playwright** → 改成 e2e test 模板
- 用 **Bun test** → `bun:test` 模板
- **没集成测试** → 这个 skill 改成"加测试：先选框架，再写一个小例子"

**保留**：cleanup 必做、agent 选择不写死外部 CLI、断言用真实状态。

### 🟢 `团队派工.md`

**几乎完全通用**——除了"项目级 vibespace-* agent 优先级高于通用 type"那一节列了具体 7 个 vibespace-* 名字。

- 把 `vibespace-*` 替换成你项目的命名前缀（如 `myproj-*`）
- 8 个通用 type（general-purpose / Explore / Plan / feature-dev:* / codex:* / code-simplifier:*）通用，**保留**

---

## `.claude/agents/` 7 个

### 🔴 `vibespace-explorer.md`

通用结构（"返回 ≤30 行清单"）保留；**monorepo 结构图**那段写满了 VibeSpace 的 packages/server / packages/web / scripts 路径——必须改成你项目的实际路径。

**改名**：把所有 `vibespace-explorer` 字面字符串改成 `<你项目代号>-explorer`（frontmatter `name` 字段也改）。否则 Task 工具会跟"vibespace-explorer 这个 name 跟项目无关"语义冲突。

### 🔴 `vibespace-route-author.md`

参考"`.aimon/skills/加新api路由.md`"那条改造方向。**改名同上**。

### 🔴 `vibespace-db-scribe.md`

参考"`.aimon/skills/db加列三处套路.md`"那条。如果你项目没 DB / 用 NoSQL → **整个删掉**这个 agent。

### 🔴 `vibespace-ui-decorator.md`

参考"`.aimon/skills/前端加badge.md`"那条。如果你项目没前端 → **整个删掉**。

### 🟡 `vibespace-smoke-author.md`

参考 smoke skill 那条。**改名同上**。

### 🟡 `vibespace-browser-tester.md`

只有当你项目集成了 browser-use MCP 才有意义。

- 没集成 → 删掉这个 agent；或改成 Playwright / Puppeteer 直跑（但那就要给它 Bash + Node 工具权限了）
- 集成了 → frontmatter `tools: ..., mcp__browser-use__*` 通配符**实测一次**：派出去跑 `mcp tools/list`，如果工具不可用就改成 explicit 列工具名

### 🟢 `vibespace-rules-auditor.md`

通用结构。**改：**

1. 改名（frontmatter `name`）
2. "第一步 Read" 段：把 5 个文件路径换成你项目的对应规则文件（你的 CLAUDE.md / 你的 learnings.md / 你的 .aimon/skills 哪几个）
3. "查的红线"那个清单按你项目实际规则改：
   - 如果没"操作日志规则" → 删第 1 条
   - 如果没 "Dev Docs 三段式" → 删 plan 相关检查项
   - 加你项目自己的红线（比如"必须用 i18n 不能写死字符串"）

---

## `dev/` 两份文档

### 🟢 `harness-roadmap.md`

12 层 × VibeSpace 落点对照表。**整个表格按你项目重写一遍**——12 层概念通用（来自 shareAI-lab/learn-claude-code），但每层"VibeSpace 处置 / 状态 / 对应任务"完全是 VibeSpace 自己的进度。

**保留**：12 层标题（s01–s12）+ "劝退档 / 未来评估档" 的格式约定。

### 🟢 `agent-team-blueprint.md`

总图 / 工作流阶段 × 角色 / skill 触发表 / 7 层对应。第二节"项目级团队成员"清单是 7 个 vibespace-* —— 按你改名后的 agent 重写。

**保留**：subagent 不走三段式那段（这是元规则，跨项目通用）。

---

## 改造完成自查清单

逐项打勾才算装好：

```
[ ] 所有 vibespace-* 改名成 <你项目代号>-*（agents 文件名 + frontmatter name + 互相引用）
[ ] db / route / ui / smoke 4 个 skill 按你项目栈重写
[ ] db-scribe / route-author / ui-decorator 3 个 agent 按你项目栈重写
[ ] browser-tester：要么实测 mcp 通配符，要么删掉
[ ] rules-auditor 的 Read 清单换成你项目规则
[ ] dev/harness-roadmap.md 整个重写（12 层 × 你项目落点）
[ ] dev/agent-team-blueprint.md 第二节 agent 清单按改名后重写
[ ] CLAUDE.md 加一行"如果 env AIMON_SESSION_PROMPT_PATH 存在就读它"（可选，让 skill 真生效）
[ ] .gitignore 加 .aimon/runtime/（脚本应该已经做了，确认下）
[ ] 启动一次 claude session，Task 工具菜单看到 7 个 <你项目代号>-* 出现
```

---

## 一个保守的起步建议

**别一次性把 7 个 agent + 6 个 skill 全装**——选 3 个最适合你项目的先用：

- 任何项目：`*-explorer` + `*-rules-auditor` 这两个 read-only 的成本最低、价值最高
- 有 API 后端：加 `*-route-author`
- 有数据库：加 `*-db-scribe`
- 有前端：加 `*-ui-decorator`
- 有 e2e 测试：加 `*-smoke-author` 或 `*-browser-tester`（二选一，不要都装）

用 1-2 个月再决定要不要扩。**agent 太多 = 大哥在 Task 工具菜单里选困难症**，反而拖累 vibe coding 节奏。
