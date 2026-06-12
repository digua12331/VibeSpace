# 终端自动停止与卡顿修复 · context

## 关键文件

### 步骤 1 — 终端不再自动停
- `packages/server/src/app-settings.ts:31-38` — `DEFAULTS.hibernation`，把 `enabled` 由 `true` 改 `false`。
- `packages/server/src/hibernate-sweeper.ts:46-47` — sweeper 在 `!settings.hibernation.enabled` 处提前 return，无需改。
- `packages/server/data/app-settings.json` — 现有内容 `{"pasteImageRetentionDays":1}`，**无 `hibernation` 段** → `readHibernation(undefined)` 回落 DEFAULTS，故改默认即生效，磁盘文件不动。
- `packages/web/src/components/SettingsDialog.tsx` — 仅核对：休眠开关读 `/api/app-settings` 同一份数据，关态展示正常、用户手动开仍可用。预期无需改。

### 步骤 2 — 前端只保活在用的终端
- `packages/web/src/components/terminal/TerminalHost.tsx:35-47` — `liveProjectFilter` 当前只在 `keepAliveDegraded`（堆 >2GB）时生效；改成**始终生效**：保活集合 = 当前项目 + `recentProjectOrder` 前 `KEEPALIVE_LRU_LIMIT` 个项目。`renderable` 据此过滤。
- `packages/web/src/perf-marks.ts:87-88` — `KEEPALIVE_MEM_THRESHOLD` / `KEEPALIVE_LRU_LIMIT=3`，常量复用，不改。
- 不动 `SessionView`：其 unmount 自带 `xterm.dispose()` + WS 退订，被预算剔除的会话走原 dispose 路径即可（参见 auto.md：xterm/IME/TUI 优先靠稳定挂载层保活、不改组件内部生命周期）。

### 步骤 3 — 插件瘦身
- `C:\Users\zh_zhang\.claude\settings.json` 的 `enabledPlugins`（**仓库外的机器级配置**）：
  `frontend-design` / `context7` / `code-review` / `code-simplifier` / `skill-creator` → `false`；
  `codex` / `github` / `superpowers` 保持 `true`。

## 决策记录

- **休眠：只改默认值，不迁移磁盘文件**。现有 `app-settings.json` 没写 `hibernation`，改 `DEFAULTS` 即生效；不去给磁盘文件补写 `hibernation:{enabled:false}`——那样会把"默认"固化成"用户显式选择"，反而剥夺用户后续在设置里改的语义。资深工程师视角：改一个默认常量足矣，不做多余迁移。
- **步骤 2 只动 TerminalHost，不做订阅引用计数**。Codex 建议的"订阅 ref-count / 前后台分层"是更大重构。xterm 实例（DOM + WebGL + scrollback）才是内存大头，WS 订阅相对轻。始终生效的项目过滤即可堵住"跨项目无限累积 xterm"这个真漏点；SessionView unmount 自带退订。`refreshSessions` 仍 subscribe 全部 alive 会话这点收益小、改动大，记进 `dev/issues.md` 不在本轮。不为"可能"的场景过度设计。
- **不碰 WebSocket backpressure**。Codex 提的输出洪峰限流是"疯狂刷屏才卡"，与本次"稳态卡顿 + 终端停止"是两类问题，单列 issues。

## 依赖与约束

- 步骤 1/2 改完需重启 VibeSpace 服务 + 刷新前端才能验收（sweeper 在进程启动时 `setInterval`；前端是打包产物）。
- 步骤 3 改的是 Claude Code 全局配置，对**新开的** Claude 会话生效，已在跑的会话不受影响。
- `keepAliveDegraded`（2GB 兜底）保留：步骤 2 后它作为二道防线——降级时保活集合可进一步收窄到仅当前项目。
- 类型检查：web 与 server 均 TypeScript，改完各跑一次项目级 `tsc`（见 `package.json` scripts）。
