# 技能插件开关面板 · context

## 关键文件

### 新建

- `packages/server/src/claude-settings.ts`（~80 行）
  - 读：`readClaudeSettings()` → `{ settings, exists, parseError? }`，从 `path.join(os.homedir(), '.claude', 'settings.json')` 读，文件不存在返回 `{ settings:{}, exists:false }`，parse 失败返回 `{ settings:{}, exists:true, parseError }`
  - 写：`patchClaudeSettings(patch)`，原子写：先 re-read（防 Claude Code 自身并发写）→ 浅 merge skillOverrides / enabledPlugins → `JSON.stringify(merged, null, 2)` → 写 `settings.json.tmp`（同目录！避免跨卷 rename） → `fs.renameSync` 覆盖
  - skillOverrides 字典里 `value === null` 时 `delete merged.skillOverrides[k]`；`value === 'off'` 时 `merged.skillOverrides[k] = 'off'`
  - 文件不存在时第一次 PUT 自动 `mkdirSync({recursive:true})` + 新建文件
  - 不导出常量路径——保持 helper 一处使用

- `packages/server/src/routes/claude-settings.ts`（~80 行）
  - `GET /api/claude-settings` → 返回 `{ skillOverrides: Record<string,'off'>, enabledPlugins: Record<string,boolean>, path, exists, parseError? }`（不返回整份 settings，避免泄露 OAuth 之外的敏感字段——本字段不存在但有意识地缩范围）
  - `PUT /api/claude-settings` body：`{ skillOverrides?: Record<string,'off'|null>, enabledPlugins?: Record<string,boolean> }`，zod 校验 key 长度 ≤ 200、value 类型；起止 serverLog；catch → 500 + ERROR 日志带 `meta.error`
  - 用 `app-settings.ts` 同款 `app.get` / `app.put<{Body:unknown}>` 模板

### 改

- `packages/server/src/index.ts`：第 46 行附近加 `import { registerClaudeSettingsRoutes } from "./routes/claude-settings.js";`，第 175 行后加 `await registerClaudeSettingsRoutes(app);`
- `packages/web/src/types.ts`：在 line 943 后追加 `ClaudeGlobalSettings` / `ClaudeSettingsPatch` 类型
- `packages/web/src/api.ts`：在 line 987 后追加 `getClaudeSettings()` / `patchClaudeSettings()`
- `packages/web/src/components/sidebar/SkillsView.tsx`：
  - 新增 state：`claudeSettings: ClaudeGlobalSettings | null`、`claudeSettingsState: LoadState`
  - mode='catalog' && agent='claude-code' 时 load 一次（agent 非 claude-code 时不显示 toggle 区——`skillOverrides` 是 Claude Code 私有字段，Codex/OpenCode 自己有别的机制）
  - 顶部 mode tab 下加一行灰字 banner（仅 claude-code agent 显示）
  - "全局技能" `renderAction`：toggle + "装到本项目" 按钮（toggle 在前）
  - "全局技能" `renderBulkAction`：新增"全部启用"/"全部禁用"两个小按钮
  - 在 "全局技能" 区与 "本地库" 区之间插入一个新的 "全局插件" 区（也是 `SkillSection` 复用），数据来自 `claudeSettings.enabledPlugins`，每行 toggle

## 决策记录

### 1. helper 单文件，不抽 service 层
- Codex 评审：service 没必要
- 这是 ~80 行 IO，分两层只会增加跳转。直接 helper 模块够用
- **资深工程师审视**：不会觉得过度设计——一个纯函数 helper + 一个 route 文件，是项目其他 settings 的现状形态

### 2. GET 返回精简字段（只 skillOverrides + enabledPlugins），不回放整份 settings
- settings.json 含 `_aimon_hooks_version` / `hooks` / `permissions` / `autoUpdatesChannel` 等。本任务不需要它们到前端，前端也不应该看到
- PUT 写时仍走完整 read+merge+write，保留所有未知字段
- 这条偏 conservative 一点，符合"对用户主目录文件做最小读取暴露"的原则

### 3. PUT 合并两类 patch 到一个接口
- Codex 评审：两个 PUT 合一
- 实际批量场景（一次禁用 lark-* 24 个）需要单次写盘——拆两个接口反而要客户端串两次请求
- 单接口 body 用 optional 字段，patch 不传就 noop

### 4. 仅 claude-code agent tab 下显示 toggle
- skillOverrides 是 Claude Code 私有协议字段——Codex/OpenCode 自己有别的开关机制（且本任务不在范围内）
- agent='codex' / 'opencode' 时面板照旧（不显示 toggle 按钮，不显示插件区，不显示顶部 banner）
- 避免误导用户以为 toggle 对 Codex skill 生效

### 5. UI 不做"立即生效"幻觉，灰字明示重启生效
- Codex 评审：UI 不做热更新，直接灰字提示
- Claude Code 启动时一次性读 settings.json，运行中改文件**不会**反映到当前进程。如果 UI 假装"已生效"，用户会困惑

### 6. enabledPlugins toggle 不展示连带影响
- Plugin 关掉会带走它的 skill/agent/MCP。在 UI 上展示连带需要扫 plugin manifest，工作量大
- toggle 旁加 `?` icon hover 提示"关闭此插件会同时禁用它提供的 skill 和 agent"，把责任交给用户
- 用户是自己装的 plugin，应该知道里面有啥

### 7. 孤儿 skillOverrides 条目不主动清理
- skillOverrides 里有 entry 但 `~/.claude/skills/` 下找不到该 skill（用户卸了 skill 但没改 settings）→ UI 不显示该条
- 不主动 delete 孤儿 key，避免误删用户手动配置
- 数据源是 `data.global` 列表，自然过滤掉孤儿

### 8. 不引入"name-only" 三态
- 当前 Claude Code 支持 `skillOverrides[name] = 'off' | 'name-only' | <full>`，'name-only' 是把 skill 描述精简到只剩名字（节省 token）
- 三态 UI 复杂，先做 on/off 双态。未来真有人要再加
- non-goals 已写明

## 依赖与约束

- 上游协议：`~/.claude/settings.json` 是 Claude Code 自身定义的格式。我们只动 `skillOverrides`（删 key/写 'off'）和 `enabledPlugins`（true/false），不动其他字段。所有未知字段在 read+merge+write 过程中**必须**保留
- 并发：Claude Code 自身可能并发写（如插件安装时写 enabledPlugins）。本任务的写法是 read→merge→write，最差情况是"用户快速点 toggle"时丢失中间态。前端用 disabled 短暂遮蔽避免点穿，但不强一致——非关键路径，可接受
- Windows 文件锁：tmp 文件**必须**与目标 `settings.json` 同目录（`path.join(claudeDir, 'settings.json.tmp')`），跨目录 rename 在 NTFS 跨卷时会 EXDEV 失败
- LogsView 约束：scope='claude-settings'，action='patch'/'toggle-skill'/'toggle-plugin'/'bulk-skills'，meta 不塞完整字典只塞 key 数组和操作数量（≤2KB）
- 项目记忆引用：
  - `dev/memory/auto.md` 第 38 条：会改文件的后端操作要 serverLog 起止
  - `dev/memory/auto.md` 第 40 条（2026-05-02 / 技能管理面板）：README 和界面文案必须区分 VibeSpace 内部 `.aimon/skills` 与 AI CLI 自己的 `.claude/.codex/.opencode/skills`——本任务的 banner 文案就是为了履行这一条
  - `dev/memory/manual.md` 2026-05-06：交付前 AI 自己派 vibespace-browser-tester 跑验收
  - 系统级 SessionStart hook 注入的 auto.md 经验：`logAction(scope, action, fn, ctx)` 包 mutation；起止配对必备；UI 改动需要浏览器可观察验收

## tasks.md 与 tasks.json 同步

- md 是真源，json 是派生物
- 每步 verify 通过后立即把 md 的 `- [ ]` 改 `- [x]`，同时把 json 对应 step 的 status 改 done
