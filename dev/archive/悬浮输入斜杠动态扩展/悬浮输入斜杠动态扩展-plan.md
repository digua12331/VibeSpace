# 悬浮输入斜杠动态扩展 · Plan

## 大哥摘要

这次要做的是：你在终端输入框里敲 `/` 时，下拉菜单除了原来那批写死的内置命令，**还会自动列出你装在 `~/.claude/skills/`、`~/.claude/commands/` 等目录里的 skill 和自定义命令**——以后你装一个新的 skill / 自定义命令，悬浮输入的 `/` 菜单也跟着多一行，不用我再手动维护命令清单。

它只动 `/` 弹出的那一份候选列表，**不改终端真正发送什么**，所以不会误触 CLI、不影响现有任何会话。覆盖 `claude` / `codex` / `gemini` 三种 agent；shell（cmd / pwsh / shell）保持不动。

## 目标

解决问题：`packages/web/src/components/terminal/slashCommands.ts` 是写死的 `Record<agent, string[]>`，注释里直接写"会随时间漂移，每季度手动 review"——加一个 skill 或 commands 就要改这份文件，没改就菜单里看不到。

可验证的验收标准：

1. 在 `~/.claude/skills/<some-id>/SKILL.md` 真实存在的情况下，浏览器里打开一个 Claude session，悬浮输入栏输入 `/`，下拉菜单中能看到 `/<some-id>`。（你已经装了若干 skill，肉眼能确认）
2. 在 `<project>/.claude/commands/foo.md` 创建一个文件后，刷新（关闭再打开 session 标签）该项目里的 Claude session 终端，输入 `/` 能看到 `/foo`。
3. Gemini session 输入 `/` 同样能看到 `~/.gemini/commands/*.toml` 与 `<project>/.gemini/commands/*.toml` 中的命令名。
4. 内置硬编码命令不受影响——`/help` 等仍排在最前面，动态项追加在后；同名（大小写不敏感）去重，**内置项永远胜出**。
5. shell agent（shell / cmd / pwsh）输入 `/` 不出菜单（行为与现状一致，动态项也不出现）。
6. 后端 `GET /api/projects/:id/slash-commands/:agent` 在项目不存在时返回 404，agent 未知时返回空数组而不是 500。
7. TypeScript 类型检查通过：`pnpm --filter @aimon/web exec tsc -b` 与 `pnpm --filter @aimon/server exec tsc -b` 均退出 0。
8. 这是 GET（只读查询），按 CLAUDE.md 操作日志约定不需要起止配对——参考现有 `skill-catalog` GET 一样不打日志。失败分支允许出 ERROR 日志兜底，但非验收硬指标。

## 非目标

1. 不改 `slashCommands.ts` 内置常量本身（不调内置命令清单的对错）。
2. 不实时监听文件系统（user 加了 skill 之后必须重开 session 标签才看到，不上 fs.watch）。
3. 不改 mention（`@`）菜单的任何行为。
4. 不动 codex / opencode / qoder / kilo 在 `slashCommands.ts` 里的现状（codex 内置 3 条不变；opencode/qoder/kilo 还是空，但若它们的 `~/.codex/skills/*` 等目录存在，会被扫到——这是顺带的好处，不算交付目标）。
5. 不为这件事加新的存储字段或缓存策略——每次 session 挂载时拉一次，不缓存。

## 实施步骤

1. 后端新增 `packages/server/src/dynamic-slash-service.ts`：导出 `scanDynamicSlashCommands({ agent, projectPath }): string[]`。按 agent 列出该 agent 应扫描的 skill 目录（含 SKILL.md 的子文件夹）+ commands 目录（按扩展名过滤的文件），返回 `/<name>` 字符串数组；非法名字（不在 `[A-Za-z0-9_.\-:]` 范围）跳过；目录不存在不报错；按字母排序、去重。
   - 验证：单元逻辑就是几个 `existsSync` + `readdirSync`，类型检查能过即可。
2. 后端新增 `packages/server/src/routes/slash-commands.ts`：`GET /api/projects/:id/slash-commands/:agent`，项目不存在 404，参数非法 400，否则 `{ commands: string[] }`。在 `index.ts` 注册路由。
   - 验证：浏览器直接访问 `http://127.0.0.1:8787/api/projects/<id>/slash-commands/claude` 能看到 JSON 返回。
3. 前端 `packages/web/src/api.ts`：加 `listSlashCommands(projectId, agent): Promise<string[]>`。
   - 验证：tsc 通过；浏览器 DevTools 网络面板能看到对应请求。
4. 前端 `packages/web/src/components/terminal/SessionView.tsx`：
   - 加 `dynamicSlash: string[]` local state + `useEffect` on `[session.projectId, session.agent]` fetch；失败回退空数组（不报错，菜单退化为只剩内置）。
   - 抽 `getEffectiveSlashCommands()`：合并 built-in + dynamic，按 lowercase 去重，built-in 优先。
   - 把 `detectTrigger`（line 720）和 `getMenuItems`（line 747）里两处 `getSlashCommands(session.agent)` 改成 `getEffectiveSlashCommands()`。
   - 验证：浏览器里实测 `/` 菜单出现 skill；类型检查通过。
5. 类型检查 + 浏览器目视验收。
   - 验证：`pnpm --filter @aimon/web exec tsc -b` 和 `pnpm --filter @aimon/server exec tsc -b` 都 0。

## 边界情况

1. 项目目录被删除或路径不存在：`scanDynamicSlashCommands` 内部 existsSync 兜底，返回空数组，不抛错。
2. 用户家目录无 `.claude` 等目录：同上，扫不到就空。
3. SKILL.md 不存在的子目录：跳过（与 skill-catalog-service 一致）。
4. 命令文件名包含中文/空格：`NAME_RE` 不匹配则跳过，不会被加进菜单。
5. session.projectId 为空字符串：`/api/projects//slash-commands/...` → 后端 getProject('') 返回 null → 404 → 前端回退空数组。
6. session.agent 不在已知 switch 分支：返回空数组，菜单只显示内置或为空。
7. 同时存在 `~/.claude/commands/foo.md` 与 `<project>/.claude/commands/foo.md`：去重保留一份（按 lowercase）。
8. 用户在 SkillsView 增删 skill 后没刷新：菜单看不到——v1 不上 invalidation，文档里说一句"重开 session 标签即可刷新"。

## 风险与注意

1. 性能：每次 session 挂载多发一次 GET 网络请求；后端做的就是几次目录扫描，单次量级 < 几十毫秒，无感。
2. 安全：路径全部由后端 `getProject(id).path` + `homedir()` 拼接，不直接用 query string，不存在路径穿越。命令名走 `NAME_RE` 白名单。
3. 兼容：现有 SessionView 行为完全保持——只在原有 `/` 候选列表后追加项。built-in 优先于动态，避免动态 skill 名意外覆盖 `/help` 这类常用项。
4. 假设：Claude Code 的自定义命令路径就是 `~/.claude/commands/*.md` 与 `<project>/.claude/commands/*.md`；Gemini CLI 的自定义命令路径是 `~/.gemini/commands/*.toml` 与 `<project>/.gemini/commands/*.toml`。这两条是社区惯例 + Anthropic/Google 文档说法，与 `skill-catalog-service.ts` 已有约定一致。如果实际 CLI 不识别某个名字，用户输入 `/foo` 然后 Enter，后果是 CLI 自己提示 unknown command——非灾难，菜单的展示与 CLI 的 dispatch 解耦。
5. 用户感知：对方装了一堆 skill 之后菜单会变长——`InputMenu` 已经做了 `max-h-[280px] overflow-y-auto` 滚动 + `maxRows * 4` DOM 上限，不会撑爆。

## 多模型 Plan 会审

> 跳过：用户明确说"1做了"=按你想法做（小档），按 CLAUDE.md 小档不调外部模型，节省外部调用。
