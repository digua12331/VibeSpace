# 会话上限可配置 · Plan

## 大哥摘要
现在 AI 终端页签最多能开 12 个，这个 12 是写死在代码里的，你改不了。这次把它挪到「设置 → 终端」面板里，做成一个你能自己填的数字框（比如想多开就填 20，机器卡就填 6）。计数规则不变——还是只数 AI 终端，文件预览、HTML 预览那些页签不占名额。改完不动你现有的任何会话和数据，只是多出一个能调的设置项。

## 目标
- 「设置 → 终端」页签新增「AI 终端数量上限」数字输入框（范围 1–50，默认 12）。
- 点「保存」后该值落盘到后端 `app-settings.json`，刷新页面后仍生效。
- 新建 AI 终端时的拦截改读这个设置值，而不是写死的 12：达到上限弹的提示里数字也跟着变。
- 验收（浏览器可观察）：
  1. 打开设置 → 终端，能看到「AI 终端数量上限」输入框，默认显示 12。
  2. 改成一个很小的值（如 2）并保存，再去开 AI 终端，开到第 2 个后点「+」启动，会弹「已达终端数量上限 2 个」的提示，启动被拦下。
  3. 改回较大值（如 12）保存后，又能正常开更多终端。
  4. 改值保存后刷新整页，设置框里仍是刚才填的值（证明落盘成功）。
  5. UI 日志面板能看到 `scope=settings action=update-app-settings` 的起止配对，meta 里带新的 maxAiTerminals。

## 非目标
- 不改「计数只算 AI 终端」的规则（现状已满足，不动）。
- 不对「已经开着的终端数 > 新上限」做强制关闭——上限只拦新建，已开的留着。
- 不给文件/HTML 等非 AI 页签加任何数量限制。

## 实施步骤
1. 后端 `app-settings.ts`：`AppSettings` 加 `maxAiTerminals`，DEFAULTS 设 12，加 `clampMaxAiTerminals`（夹到 [1,50]），readFromDisk / patch / setAppSettings 三处同步。→ 验证：build 过。
2. 前端 `types.ts`：`AppSettings` 接口镜像加 `maxAiTerminals: number`。→ 验证：build 过。
3. 前端 `store.ts`：加 `maxAiTerminals` 字段（默认 12）+ `setMaxAiTerminals` setter。→ 验证：build 过。
4. `App.tsx`：启动载入设置时把 `maxAiTerminals` 写进 store。→ 验证：build 过。
5. `perf-marks.ts`：`isAtSessionLimit(count, limit?)` 加可选上限参数，默认仍是 `MAX_OPEN_SESSIONS`（当作兜底）。→ 验证：build 过。
6. `StartSessionMenu.tsx`：拦截处读 `store.maxAiTerminals` 当上限，提示文案用该值。→ 验证：浏览器验收第 2 条。
7. `SettingsDialog.tsx`：终端页签加数字输入框，载入/保存 maxAiTerminals，保存后回填 store。→ 验证：浏览器验收第 1、3、4、5 条。

## 边界情况
- 用户把上限填得比当前已开终端数还小：只影响后续新建，已开的不动（符合最小惊讶）。
- 输入非法值（空 / 0 / 负数 / 超大）：前端 clamp 到 [1,50]，后端再夹一道兜底。
- 旧的 `app-settings.json` 没有这个字段：readFromDisk 走默认 12。

## 风险与注意
- `MAX_OPEN_SESSIONS` 常量保留作为兜底默认，不删（仍被 isAtSessionLimit 默认参数引用）。
- StartSessionMenu 是唯一做上限拦截的入口；dispatchClaude / runPython / runExecutable 本来就不拦，本次不改其行为。

## 多模型 Plan 会审
> 跳过：小档任务（照 terminalKeybindings 现成链路加一个可配置数字字段，跨文件但机械、可回滚、不动表结构），按工作流小档不调外部模型。
