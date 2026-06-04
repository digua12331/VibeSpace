# 技能插件开关面板 · plan

## 大哥摘要

现在你的 `~/.claude/settings.json`（Claude Code 的全局配置文件）里已经有 84 条 `skillOverrides: "off"`（关掉某 skill 的软开关）和 10 条 `enabledPlugins`（插件总开关）。要再关 / 开一个，得手动改 JSON 文件——又麻烦又容易写错。

这次给你 AIkanban 左侧的「技能」面板加一行行**开关**（toggle）：

- **每个 skill 行**：原来的"装到本项目"按钮**旁边**多一个开关。点 → 关 / 开，状态写进 `~/.claude/settings.json` 的 `skillOverrides`（关 = 写 `"off"`，开 = 删掉那条 key）。
- **同组批量**：一个 skill 系列（如 `lark-*` 24 个、`ljg-*` 20 个）能一键"全部关 / 全部开"。
- **新增"插件"区**：列出当前 10 个 plugin（如 `frontend-design@claude-plugins-official`），每行一个开关，状态写进 `enabledPlugins` 字段。
- **顶部一句灰字提示**："这是 Claude Code 的全局设置，影响所有项目。改完后**下次新开** Claude Code 会话才生效。"

完成验收：你打开「技能」面板，能看到 toggle，点几下后去 `~/.claude/settings.json` 看文件被改了，重启一个 Claude 会话能感受到 skill 描述少了（系统提示更短、内存降下来）。

**这次不动 MCP server**（下次再做，那层禁用语义不一样，做起来要再单写一份）。

## 目标 + 验收标准

1. 「技能」面板的"全局技能"区每行（skill）加一个 toggle，点击触发改写 `~/.claude/settings.json` 的 `skillOverrides`。
   - 验收：浏览器里能看到 toggle；点击后用文件管理器看 `~/.claude/settings.json` 内容变了；LogsView 出现 `scope=claude-settings action=patch` 的起止配对（开始 / 成功 (Nms)）。
2. 「技能」面板新增"插件"区，列 `enabledPlugins` 字段所有 entry，每行一个 toggle。
   - 验收：浏览器里能看到 10 个 plugin 行；点击 toggle 后 `enabledPlugins[<key>]` 在 true ↔ false 之间切换；同样有起止日志。
3. 同前缀分组（如 `lark-*`）在折叠组级有"全部启用 / 全部禁用"按钮。
   - 验收：点"全部禁用"，该组所有 skill 一次写入 `"off"`；只产生**一次** PUT 请求（不是 N 个）。
4. 面板顶部明示这是系统级配置：写明"改动写入 `~/.claude/settings.json`，影响所有项目，下次新开会话生效"。
   - 验收：浏览器里能看到这句提示（小灰字，permanent 不滚动消失）。
5. 失败分支：手动给 `~/.claude/settings.json` 加 chmod 444 或 Windows 只读属性，点 toggle → 后端 `serverLog ERROR` + 前端弹 `alertDialog`。
   - 验收：手动制造一次失败，LogsView 看到 ERROR 条目带 `meta.error`，浏览器弹错误对话框。

## 非目标

- 不动 MCP server 启停（独立任务，下次做）
- 不动 `~/.claude.json`（这是另一个文件，存的是 OAuth token、numStartups 等运行时状态）
- 不动项目级 `<repo>/.claude/settings.json`（`PermissionsDrawer` 已经管它了，本任务不重复）
- 不实现 `skillOverrides` 的 `"name-only"` 三态（极少用，UI 三态复杂，未来需要再加）
- 不实现 plugin 的"安装/卸载"功能（plugin 安装走 `/plugin install`，不在本任务范围）
- 不重写 `SkillsView` 整体结构，外科式新增

## 实施步骤

### 1. 后端：一个新 service + 一个新路由

参照 codex 评审建议简化结构——**不抽 service 层**，直接把读写函数放在路由文件里（或一个最小 helper 模块）。`packages/server/src/app-settings.ts` 管的是项目数据目录的设置，不要让它跨界管用户主目录的文件。

新建 `packages/server/src/claude-settings.ts`（仅 ~50 行的 helper）：
- 路径：`path.join(os.homedir(), '.claude', 'settings.json')`
- `readClaudeSettings(): { settings: object, exists: boolean, parseError?: string }`
- `writeClaudeSettingsPatch(patch: { skillOverrides?: Record<string, 'off'|null>, enabledPlugins?: Record<string, boolean> }): object`
  - 读 → 浅 merge（保留所有未知字段）→ 原子写 (`tmp` 文件**与目标同目录**，避免跨卷 rename 失败) → 返回新内容的相关字段
  - `skillOverrides[name] = null` 视为"删 key"；`= 'off'` 写入
  - 写之前**重新读盘**一次，防 Claude Code 自身并发写覆盖
  - JSON parse 失败 → throw（路由层 catch → 500），**不静默吞错**

新建 `packages/server/src/routes/claude-settings.ts`：
- `GET /api/claude-settings` → `{ skillOverrides, enabledPlugins, path, exists, parseError? }`
- `PUT /api/claude-settings` body：
  ```ts
  {
    skillOverrides?: Record<string, 'off' | null>,  // null = 删 key
    enabledPlugins?: Record<string, boolean>
  }
  ```
  - 一个路由接受所有 patch（合并 codex 评审建议的"两个 PUT 合一"）
  - zod 校验：value 仅允许 `'off' | null` 或 `boolean`；key 长度 ≤ 200 防恶意输入
  - `serverLog('info', 'claude-settings', 'patch 开始', { meta: { keys, counts } })` 起止
  - 不在 meta 里塞完整字典，只塞 key 数组和操作数量（manual.md/auto.md 的 2KB meta 约束）

在 `packages/server/src/index.ts` 路由注册段加一行 `await registerClaudeSettingsRoutes(app)`。

### 2. 前端 client + 类型

`packages/web/src/api.ts` 新增：
- `getClaudeSettings(): Promise<ClaudeGlobalSettings>`
- `patchClaudeSettings(patch: ClaudeSettingsPatch): Promise<ClaudeGlobalSettings>`

`packages/web/src/types.ts` 镜像 `ClaudeGlobalSettings` / `ClaudeSettingsPatch`。

### 3. 前端 UI：改 SkillsView

参照 codex 评审建议**复用 `SkillSection`**，不新建组件：

- 拉 `getClaudeSettings()` 到组件 state，`mode === 'catalog'` 时拉一次
- 在"全局技能"区的 `renderAction`：原"装到本项目"按钮**之前**加 toggle，宽度紧凑（不挤垮按钮）
  - toggle 状态 = `skillOverrides[s.name] !== 'off'`（默认 true）
  - 点击 → `logAction('claude-settings', 'toggle-skill', () => patchClaudeSettings({ skillOverrides: { [s.name]: nowOn ? 'off' : null } }))`
- 在 `renderBulkAction`：原"全部装"按钮之前加"全部启用 / 全部禁用"两个按钮
  - 点击 → 一次 `patchClaudeSettings({ skillOverrides: { name1: 'off', name2: 'off', ... } })`
- 新增"插件"区（在"全局技能"区之后、"本地库"之前）：
  - 用 `<SkillSection>` 包，标题"全局插件"，hint = "位于 ~/.claude/settings.json 的 enabledPlugins"
  - 把 `enabledPlugins` 字典 map 成 `SkillEntry`-like 数据：`{ id: key, name: key.split('@')[0], description: '@' + key.split('@')[1], path: '<settings.json>' }`
  - `renderAction` = toggle，状态 = `enabledPlugins[key] === true`
  - 顺便 hover tooltip 显示完整 key
- 顶部加一行灰字 banner（在 mode tab 下面）："改动写入 ~/.claude/settings.json（系统级，影响所有项目），下次新开 Claude Code 会话生效"

### 4. 浏览器验收

派 `vibespace-browser-tester` 跑：
- 开"技能"面板能看到 toggle + 顶部提示 + 插件区
- 点一个 skill toggle → 用 `Read` 工具看 settings.json 已变
- 点"全部禁用"批量 → 一次 PUT，settings.json 一次写入
- 故意把 settings.json 设为只读，点 toggle → 看 LogsView 的 ERROR + 浏览器弹错

## 边界情况

- `~/.claude/settings.json` 不存在：GET 返回 `{ exists: false, skillOverrides: {}, enabledPlugins: {} }`，UI 显示"未初始化"，第一次 PUT 自动创建文件 + 目录
- JSON parse 失败：GET 返回 `parseError` 字段，UI 显示"配置文件损坏，请手动修复"，禁用所有 toggle 防误覆盖
- 并发写（用户快点）：前端 toggle 切到 disabled 直到响应回来；后端写前 re-read
- Claude Code 自身并发写：后端写前 re-read + 浅 merge，最多丢一两条快速点击的中间态（用户体验可接受）
- skill 在 `~/.claude/skills/` 下不存在但 `skillOverrides` 有条目（孤儿）：UI 在"全局技能"列表外不显示（因为列表数据源是 skill-catalog 扫盘结果）。孤儿 key **本任务不主动清理**（避免误删，留给未来）
- skill 存在但 `skillOverrides` 没条目 → 默认 toggle 显示"已启用"
- `enabledPlugins` 字段不存在 → 显示空列表 + 提示"未安装插件"
- Windows 文件锁 / 权限拒绝：后端 catch → serverLog ERROR + 路由 500 + 前端 alertDialog

## 风险与注意

- **改的是系统级配置**：UI 必须明示影响所有项目，否则用户以为只关 AIkanban（auto.md `[2026-05-02 / 技能管理面板]` 第 40 条 "README 和界面文案里要明确区分 VibeSpace 内部 `.aimon/skills` 与各 AI CLI 自己读取的 `.claude/.codex/.opencode/skills`"）
- **当前会话不生效**：Claude Code 启动时读 settings.json，改完只影响**下次新开会话**。UI 灰字提示要写明，否则用户点完没感觉以为坏了
- **保留 settings.json 未知字段**：当前文件含 `_doc` / `_aimon_hooks_version` / `permissions` / `hooks` / `extraKnownMarketplaces` / `skipDangerousModePermissionPrompt` / `autoUpdatesChannel` 等。写入必须**读 + spread + 写**，不能用结构化重写覆盖
- **enabledPlugins 关掉的连带效应**：plugin 关掉后会摘掉它提供的所有 skill / agent / MCP。UI 上 plugin 行下面**不**主动列连带影响（实现复杂、且 plugin 是用户自己装的、应该知道自己装了啥），只在 toggle 旁加个 `?` icon hover 提示"关闭此插件会同时禁用它提供的所有 skill 和 agent"
- **Windows 原子写**：`tmp` 文件**必须**与 `~/.claude/settings.json` **同目录**（`path.join(dir, 'settings.json.tmp')`）。跨目录 rename 在 Windows 上会失败
- **JSON 字段顺序**：`JSON.parse` + `JSON.stringify` 会按对象 key 插入顺序输出。我们的写法是 `{ ...current, ...patch }`，新 key 会被加到末尾。这对人类阅读 settings.json 影响很小，**不为字段顺序做额外工作**
- **enabledPlugins key 形如 `name@market`**：路由 zod 不强制 `@` 分隔（防止以后格式变化），但前端展示时按 `key.split('@')[0]` 切出短名，hover 显示完整 key
- **logAction scope 命名**：用 `claude-settings`，跟现有 `skill-catalog` / `skill-market` 区分（auto.md 第 38 条"会改文件的后端操作要用 serverLog 记录开始、成功、失败"）
- **测试派 tester**：本任务有可观察 UI，按 manual.md 2026-05-06 偏好，交付前自己派 `vibespace-browser-tester` 跑验收，有问题再汇报

## 关键文件

- 新建：
  - `packages/server/src/claude-settings.ts`（读写 helper，~50 行）
  - `packages/server/src/routes/claude-settings.ts`（GET / PUT，~80 行）
- 改：
  - `packages/server/src/index.ts`（注册路由一行）
  - `packages/web/src/api.ts`（两个客户端函数）
  - `packages/web/src/types.ts`（两个类型）
  - `packages/web/src/components/sidebar/SkillsView.tsx`（state + toggle 渲染 + 插件区 + 顶部提示）

## 多模型 Plan 会审

> [Gemini 评审] 跳过：MCP `mcp__gemini-cli__ask-gemini` spawn ENOENT；直接 CLI 缺 `GEMINI_API_KEY` 环境变量。两次失败后回退（CLAUDE.md "重试一次仍失败则回退 Claude 单独写"）。
> [Codex 评审] OpenAI API 401 未授权，`codex:codex-rescue` subagent 兜底给清单：**1)** service 层不必要，直接 inline 进 route 文件；**2)** 两个 PUT 合并成一个 partial patch PUT；**3)** plugin 区复用现有 `SkillSection`，不新建组件；**4)** Windows 原子写 tmp 文件须与目标同目录，否则跨卷 rename 失败；**5)** 写前 re-read 防 Claude Code 自身并发写覆盖；**6)** UI 不做热更新，直接灰字提示"重启 Claude Code 后生效"；**7)** JSON parse 失败 try/catch 后返回 500，不静默吞错。
> [Codex 综合主笔] 跳过：API 401 + subagent 兜底已给清单。Claude 综合 subagent 清单 + 项目记忆（auto.md 第 38/40/49 条 + manual.md 2026-05-06）+ 用户偏好直接定稿，并把 5 步实施和边界处理按"少抽象、复用现有组件"重写。
> [Claude 白话化兜底] 大哥摘要全段由 Claude 写白话；全文 settings.json / skillOverrides / enabledPlugins / zod / patch / tmp / rename / parse / merge 等术语第一次出现都附白话翻译或上下文说明；对照 manual.md 2026-04-30（只在大方向 / 用户感知差异分叉处停）和 2026-05-06（交付前 AI 自己派 tester）已嵌进实施步骤和验收。
