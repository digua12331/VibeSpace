# 终端快捷键自定义 · Context

## 关键文件（改动边界）

后端：
- `packages/server/src/app-settings.ts` — `AppSettings` 接口、`DEFAULTS`、`readFromDisk`、`AppSettingsPatch`、`setAppSettings`。加 `terminalKeybindings` 字段 + clamp/merge/read 逻辑。
- `packages/server/src/routes/app-settings.ts` — `UpdateBody` zod schema。加 `terminalKeybindings` 校验（拦截非法组合）。

前端：
- `packages/web/src/types.ts` — `AppSettings` 接口（~973）。加 `KeyCombo` / `TerminalKeybindings` 类型并挂到 `AppSettings`。
- `packages/web/src/store.ts` — `State` 接口（~186）、`useStore` 初始值（~392）、setter 区。加 `terminalKeybindings` 状态 + `setTerminalKeybindings`。
- `packages/web/src/App.tsx` — 根组件。加一个 `useEffect` 启动时 `getAppSettings()` 一次，灌进 store。
- `packages/web/src/components/SettingsDialog.tsx` — 加「终端快捷键」section + 录制 UI；`onSave` 的 patch 带上 `terminalKeybindings` 并同步 store。注意它 L79-87 自己监听 window keydown Escape 关窗，录制态要让路。
- `packages/web/src/components/terminal/SessionView.tsx` — `TUI_PASSTHROUGH_KEYMAP`（L86-99）、`attachCustomKeyEventHandler`（L395-459）。加 `matchCombo` + `keybindingsRef`，命中备用键发 `\x03` / `\x1b`。
- `packages/web/src/api.ts` — `getAppSettings` / `updateAppSettings`（1078-1085）。不用改，patch 是 `Partial<AppSettings>` 自动带新字段，确认即可。

## 数据形状

```ts
// types.ts（前端）/ app-settings.ts（后端）保持同形
interface KeyCombo {
  key: string        // KeyboardEvent.key，如 "F8" / "k"
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  meta?: boolean
}
interface TerminalKeybindings {
  abortAltKey: KeyCombo | null      // 备用键，附加发送 \x1b（打断 AI）
  interruptAltKey: KeyCombo | null  // 备用键，附加发送 \x03（强制中断）
}
// AppSettings 增加：terminalKeybindings: TerminalKeybindings
```

后端 DEFAULTS：`terminalKeybindings: { abortAltKey: null, interruptAltKey: null }`。
后端 read：缺字段或类型不对一律回退 null（向后兼容旧 json）。

## 决策记录

- **附加备用键，不替换默认**（已与大哥确认）：默认 Esc→`\x1b`、Ctrl+C→`\x03` 永远有效；备用键只是多一条触发同样字节的路。理由：Esc 的 `\x1b` 同时服务 TUI 菜单取消，纯替换会连带破坏菜单 esc-cancel；附加方案零回归解决"esc 按不出"。
- **落后端，不走 localStorage**：与现有 retention/hibernation 设置一致，避免两套设置来源。VibeSpace 是本机 localhost，工作台级=设备级的差异极小。
- **启动载入放 App 根 useEffect**：不放 main.tsx 顶层、不让 store 自初始化发请求（状态层不带副作用）。SettingsDialog 打开时仍各自 fetch 最新值，保存后同步回 store。
- **长闭包读 ref**：SessionView 的 `attachCustomKeyEventHandler` 是挂载时一次性注册的长生命周期闭包，用 `keybindingsRef.current` 读最新值（一个 useEffect 把 store 值同步进 ref），不重注册 handler（避免漏清理/旧闭包）。和 auto.md「终端方向键直通PTY」那条经验一致——非打印键必须显式映射 ANSI 走 sendInput，且守卫顺序 IME→焦点→空输入。
- **不做新 mutation 路由**：复用现有 PUT /api/app-settings + 现有 `logAction('settings','update-app-settings')`，patch 带 terminalKeybindings 即可。高频按键本身不逐次打日志（和 auto.md「高频键盘事件只幂等标记一次」一致）。
- **录制白名单/拦截**：录制只接受能安全当快捷键的组合。拒绝：纯修饰键、纯单字符（字母/数字/标点）、Escape 自身、Ctrl+C 自身、两备用键互相重复、与 TUI_PASSTHROUGH_KEYMAP 已有键冲突（Enter/Tab/方向键/Backspace/Home/End/PageUp/PageDown）、与粘贴键冲突（Ctrl+V/Cmd+V/Ctrl+Shift+V）。推荐 F1-F12 或 修饰键+非文本键。前后端都校验（前端给即时提示，后端兜底防脏数据）。
- **不过度设计**：只做 abort/interrupt 两个动作；KeyCombo 用扁平 5 字段而非自造编码字符串；校验规则直接写成纯函数，不抽配置框架。

## 依赖与约束

- `AppSettingsPatch.terminalKeybindings?` 为可选；merge 时缺省保留 current。
- 后端 zod 对 KeyCombo：key 非空 string、四个布尔可选；整体非法组合在 route 层用一个校验函数拒绝（返回 400 + ERROR 日志）。
- `matchCombo` 比较 `ev.key`（大小写按 KeyboardEvent.key 原值，F 键大写如 "F8"；字母会受 shift 影响，但已禁单字符故无碍）与四个修饰位。命中即 `preventDefault()`（interrupt 额外 `stopPropagation()`）。
- 校验逻辑要前后端共用同一套常量集合（保留键/粘贴键），避免两边漂移——前端一份、后端一份各自维护但内容对齐（不引跨包共享模块，体量太小）。
