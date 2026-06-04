# dev-docs-任务右键派发终端 · 任务清单

- [x] 步骤 1：在 `packages/web/src/components/sidebar/DocsView.tsx` 里 import `openContextMenu` 与 `ContextMenuItem`，新增 `buildContinueTaskPrompt(name)`，把任务行 `onContextMenu` 从直接调 `onArchive` 改为弹出菜单（两项：🤖 派 Claude 继续任务 / 📦 归档，中间一个 divider），行尾 📦 按钮与 `dispatching`/`onArchive` 原逻辑不动。 → verify: 文件改动 diff 只覆盖上述四处，无其它区域变动。
- [x] 步骤 2：跑 `pnpm --filter @aimon/web exec tsc -b`。 → verify: 0 error, 0 warning 退出码 0。
- [ ] 步骤 3：浏览器 UI 自测（`pnpm --filter @aimon/web dev`，在 Dev Docs → 任务 tab）。 → verify: (a) 右键任一任务弹出菜单（不再立刻走归档弹窗）；(b) 点「🤖 派 Claude 继续任务」→ 右侧新增 Claude session 并聚焦，剪贴板内容为 `继续 <任务名>`，出现"已派 Claude 继续任务"提示弹窗；(c) 点「📦 归档」→ 弹出归档确认，与原行为一致；(d) 菜单外点击 / ESC 关闭菜单。 → blocked: 无浏览器交互能力，需用户手动验证。
