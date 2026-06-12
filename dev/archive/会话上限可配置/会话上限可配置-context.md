# 会话上限可配置 · Context

## 关键文件
- `packages/server/src/app-settings.ts` — 后端设置落盘。`AppSettings`(44)、`DEFAULTS`(55)、`clampIdleMinutes`(78) 范本、`readFromDisk`(167)、`AppSettingsPatch`(197)、`setAppSettings`(203)。加 `maxAiTerminals` + `clampMaxAiTerminals`，照 retentionDays/idleMinutes 的 clamp 范式。
- `packages/web/src/types.ts:1008` — `AppSettings` 前端镜像，加 `maxAiTerminals: number`。
- `packages/web/src/store.ts` — `terminalKeybindings` 字段(202)/默认(409)/setter(607) 是范本，平行加 `maxAiTerminals` + `setMaxAiTerminals`。
- `packages/web/src/App.tsx:15-23` — 启动 getAppSettings().then 里加一行 setMaxAiTerminals。
- `packages/web/src/perf-marks.ts:96-100` — `MAX_OPEN_SESSIONS=12` 保留为兜底默认；`isAtSessionLimit` 加可选 limit 参数。
- `packages/web/src/components/StartSessionMenu.tsx:177-199` — start() 上限拦截处，改读 store.maxAiTerminals。
- `packages/web/src/components/SettingsDialog.tsx` — 终端页签(528-577 冬眠 number 输入是范本)、state(143)、载入(189-194)、onSave(338-368)。加 maxAiTerminals 一整套。

## 决策记录
- **复用 terminalKeybindings 链路而非另起配置**：该字段已打通 后端落盘→types→store→App载入→Settings编辑→回填store 全链，照抄风险最低，不引新机制。资深工程师不会觉得过度设计——就是加一个标量字段。
- **MAX_OPEN_SESSIONS 不删，降级为默认/兜底**：`isAtSessionLimit(count, limit=MAX_OPEN_SESSIONS)`，settings 未载入时仍有合理默认；改动面更小。
- **上限只拦新建、不强关已开**：强关正在跑的 AI 会话会 kill PTY，是破坏性的、用户没要；故只在 StartSessionMenu 拦点击。
- **范围 [1,50]**：原注释说 12 是体感工程值；给到 50 上界够极端多开，下界 1 防误填 0 卡死新建。
- **放「终端」页签**：跟会话冬眠同属终端类设置，归类自然。

## 依赖与约束
- `updateAppSettings` 走 PUT /api/app-settings，patch 是 `Partial<AppSettings>`，后端按字段 merge——加新字段不破坏旧调用。
- 旧 app-settings.json 缺字段时 readFromDisk 回落默认 12，兼容。
- 操作日志：保存复用已有 `logAction('settings','update-app-settings',...)`，meta 带上 maxAiTerminals 即可，无新增 mutation API。
