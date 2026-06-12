# 悬浮输入斜杠动态扩展 · Context

> 给 AI 自己看的执行边界与决策记录。大哥不审。

## 关键文件（边界——本任务原则上只动这里）

### 新增（2 处）

1. **`packages/server/src/dynamic-slash-service.ts`**
   - 纯函数 `scanDynamicSlashCommands({ agent, projectPath }): string[]`
   - 内部维护 agent → { skillDirs, commandDirs, fileExts } 映射
   - 复用 `existsSync` / `readdirSync`，**不复用 skill-catalog-service**——后者的 agent type 是 `claude-code`/`codex`/`opencode`，这边的 agent 是 session.agent (`claude`/`codex`/`gemini`/...)，命名空间不同，强行复用反而绕弯。
2. **`packages/server/src/routes/slash-commands.ts`**
   - 仅一个 GET 端点 + zod 校验 + 错误兜底。

### 会改（3 处）

1. **`packages/server/src/index.ts`**
   - 在 `registerSkillMarketRoutes` 后追加 `await registerSlashCommandRoutes(app)` + import。
2. **`packages/web/src/api.ts`**
   - 末尾追加 `listSlashCommands(projectId, agent): Promise<string[]>`。
3. **`packages/web/src/components/terminal/SessionView.tsx`**
   - 新增 `dynamicSlash` state + `useEffect`（line 27 附近 import；body 部分插入）。
   - `detectTrigger` (line 720) 和 `getMenuItems` (line 747) 里两处 `getSlashCommands(session.agent)` 改用本组件的合并函数。

### 会读但不改

- `packages/server/src/skill-catalog-service.ts` — 对照其 `parseSkillManifest` 与扫描风格，本任务做更轻量的扫描（不解析 frontmatter，只看文件夹/文件名），不复用。
- `packages/web/src/types.ts` — 确认 `Session.projectId: string` 与 `AgentKind = string`。
- `packages/server/src/db.ts` — `getProject(id)` 返回类型。

## 决策记录

### 1. **不复用 skill-catalog-service 的扫描**

- 那边返回完整 `SkillEntry`（含 description / isSymlink），并且只扫 skill 目录、不扫 commands 目录。
- 本任务只要 `string[]` 命令名，且要扫 commands 目录（不同的扩展名规则）。
- 共同抽象 `scanDir(dir, predicate)` 不值得：两边的 predicate 与返回结构都不同，硬抽 helper 比各自写两个 30 行函数更难读。

### 2. **agent 维度直接 switch，不做 manifest 文件**

- 三个 agent + shell 一共 4 个分支，hardcode switch 比加一个 `agent-dirs.json` 更直接。
- 未来加 opencode / qoder 时再加 case 即可——真到那一步成本仍然是 5 行。

### 3. **不上 fs.watch / 主动 invalidation**

- 用户增减 skill 不是常态操作，且大概率发生在 SkillsView 等专门的 UI 里——重开 session 标签足够。
- fs.watch 在跨平台尤其 Windows 上的语义不一致，且本任务**完全不是性能/实时性敏感场景**。
- 资深工程师视角自查："为了用户加了 skill 立刻看到菜单刷新，加 fs.watch 值得吗？"——不值得。

### 4. **GET 不打 serverLog 起止配对**

- CLAUDE.md 操作日志规则：mutation 才需要 logAction / serverLog 起止；GET 只读豁免。
- 失败兜底用 `serverLog('error', 'slash', ...)`，不打 info。对照 skill-catalog GET 的现状（连 error 都没打），本任务也可以更简——但既然失败兜底成本极低，留下错误日志便于排障。

### 5. **前端缓存策略：每次 session 挂载拉一次**

- 不进 `store`，因为：
  - store 已经够臃肿；
  - 这份数据只服务于一个组件（SessionView）；
  - 没有跨组件复用需求。
- session unmount 时自然 GC，不需要清理。
- 失败时 `setDynamicSlash([])`，菜单退化为只显示内置——优雅降级，不打扰用户。

### 6. **built-in 优先于 dynamic**

- 万一用户起了一个叫 `help` 的 skill 文件夹，避免它把 `/help` 顶掉。
- 用 lowercase 比对去重；保留顺序（built-in 在前）。

### 7. **复用 InputMenu 的滚动**

- 用户装的 skill 数量上百也没问题——`InputMenu` 已有 `max-h-[280px] overflow-y-auto` + `maxRows * 4` DOM 上限，本任务不动它。

## 依赖与约束

### TypeScript

- 项目用 TS，必须过 `pnpm --filter @aimon/web exec tsc -b` 与 `pnpm --filter @aimon/server exec tsc -b`。
- `Session.projectId: string`（types.ts line 90）已确认；`AgentKind = string`（types.ts line 6）。
- `request<T>(path, init?)` API（api.ts line 72）签名已知。

### 操作日志

- GET 路由：不上 `logAction`（前端纯 fetch），错误才 `serverLog('error', 'slash', ...)`。
- SessionView 的 effect 失败：silent fallback（菜单退化为内置），不弹 dialog。

### 数据形状

```ts
// 后端返回
interface SlashCommandsResponse {
  commands: string[]   // 已带 / 前缀，已排序，已去重
}

// 前端 state
const [dynamicSlash, setDynamicSlash] = useState<string[]>([])
```

### 名字白名单

- 服务端：`/^[A-Za-z0-9_.\-:]+$/`（与 skill-catalog 的 `SKILL_NAME_RE` 兼容；多加 `:` 是因为 codex 类插件命令可能形如 `codex:rescue`）
- 前端不再额外校验——服务端已过滤。

### 边界返回

- 项目不存在：404 `{ error: "project_not_found" }`。前端 `request` 抛出，effect catch 后 setDynamicSlash([])。
- 参数非法：400 `{ error: "invalid_params" }`。同上。
- 其他错误：500，前端同上。

## 验收方式回顾（来自 plan）

1. ✅ Claude session `/` 菜单出现 `~/.claude/skills/<id>` 的项。
2. ✅ 项目本地新建 `.claude/commands/foo.md` 后重开 session，`/` 出现 `/foo`。
3. ✅ Gemini session `/` 出现 `*.toml` 命令。
4. ✅ 内置项排在前；同名去重；shell 仍然不弹菜单。
5. ✅ 404/400 兜底正确，不 500。
6. ✅ tsc 通过。

## 上下文耗尽时的衔接

- 当前进度看 `tasks.md`。
- 决策已记录。
- 新会话只需说"继续 悬浮输入斜杠动态扩展"。
