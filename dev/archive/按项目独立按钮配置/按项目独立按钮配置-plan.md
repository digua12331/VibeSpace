# 按项目独立按钮配置 · plan

## 大哥摘要

现在你看到的输入框上面那一排按钮（清除/历史对话/ok/按你推荐/使用量/继续 等）是**所有项目共用的一套**——不管切到哪个项目都长一样，配置存在浏览器本地（localStorage，浏览器自己的小存储格）。

这次改成 **每个项目各自一套**：项目 A 可以配 6 个按钮，项目 B 可以配 3 个，互不影响。你**现在已经配好的这 6 个按钮**，更新后会自动**复制一份给你的每一个已有项目**做起点，之后你给某个项目单独删/改/加按钮，不会动到别的项目。

**新建项目**自动获得跟现在一样的 2 个默认按钮（清除 + 历史对话）做起步；你随时能在设置抽屉里加更多或删掉。

**验收方式**：打开 VibeSpace → 切到任意项目能看到按钮还在 → 进设置抽屉（右上角齿轮 → "按钮" tab）改一下当前项目的按钮 → 切到另一个项目 → 那个项目的按钮没跟着变 → 切回来，刚才的修改还在 → 刷新页面，所有改动持久化。

> 项目记忆扫描：`auto.md` 扫过无 customButtons 相关条目；`manual.md` 命中两条偏好（小功能直接改 / 用户感知差异才问大方向），本任务按"大方向已确认（每项目独立 + 复制到所有现有项目），只在 plan 后停一次"执行。`ARCHITECTURE.md` 命中 §3.5 状态/样式字典模板（custom buttons 走"模块级 localStorage state + listener"模式，与 prompts.ts 同源）。

## 目标

1. `customButtons.ts` 存储模型从单个全局 key 改成 **per-project key**：`aimon_custom_buttons_v1:<projectId>`，每个项目一份独立的 JSON。
2. 设置抽屉「按钮」tab 编辑的是 **当前选中项目** 的按钮列表，文案从"全局共享"改成"当前项目（XX）的快捷按钮"。
3. 每个 SessionView 按 **session 自己的 projectId** 订阅按钮（多 session 同时开、分属不同项目时，各自显示各自项目的按钮）。
4. **首次启动迁移**：检测旧的全局 key（`aimon_custom_buttons_v1`），把里面的 array 复制到所有现有 projectIds 各自的新 key 下；旧全局 key **保留不删**（可回退）；写防重标记 `aimon_custom_buttons_migrated_v2 = '1'`。
5. 监听器（listeners）保持单个 `Set<Listener>`，通知时带 `projectId`；订阅方按需自行过滤——比 `Map<projectId, Set>` 更简单。

### 验收标准（必须可在浏览器观察 / 命令可跑）

- **浏览器可见**（最关键，大哥就靠这条）：
  - 切项目时，输入框上方那一行按钮**会随项目变化**——在项目 A 删一个按钮，切到项目 B，B 的按钮不跟着变；切回 A，刚才的修改还在。
  - 设置抽屉「按钮」tab 顶部说明文案 = "当前项目"<项目名>"的快捷按钮"，能看到该项目当前的按钮列表，能加/删/改并立刻反映到上方按钮条。
  - 首次启动后（迁移生效），所有现有项目都能看到原先那 6 个按钮，任选一个项目删掉一个按钮、刷新页面不会复活。
  - **新建项目**首次访问时按钮列表 = 默认 2 个种子按钮（清除 + 历史对话），用户删空后刷新不复活（"删空"语义保留）。
  - **跨 tab 并发**：开两个浏览器 tab，A tab 改项目 1 的按钮、B tab 改项目 2 的按钮，互相**不**覆盖（per-project key 天然隔离）。
- **操作日志**（LogsView 可见）：
  - 编辑按钮（add/update/remove）→ 一条 `scope=session action=custom-buttons-saved` 携带 `projectId`、按钮 id 列表（同步操作，不做起止配对——CLAUDE.md 操作日志规则的同步类简化形态）。
  - 首次迁移成功 → 一条 `scope=session action=custom-buttons-migrated` 携带 `projectCount`、`buttonCount`。
  - **保存失败**（localStorage 配额 / private mode）→ 一条 `scope=session action=custom-buttons-save-failed level=error` 携带原因。**不**静默——大哥需要知道刚才那次保存没生效。
- **类型检查 + 构建**：`pnpm --filter @aimon/web build` 通过（项目没有独立 typecheck 脚本，build 含 tsc）。
- **AI 自派 tester**：完成后自派 `vibespace-browser-tester` 跑上述浏览器可见验收清单（含切项目独立性 + 设置抽屉编辑 + 新项目种子 + 刷新持久化），有问题再汇总（manual.md 2026-05-06 偏好）。

## 非目标

- 不改按钮 UI 样式 / 颜色 / per-agent 命令覆盖（`resolveCommand`）行为。
- 不引入后端存储——仍走 localStorage（跟设置抽屉里其它项目级偏好一致），不动 SQLite。
- 不改 PermissionsDrawer 抽屉的其它 tab（权限、通知等）。
- 不写"把当前项目按钮复制到另一个项目"的高级 UI——本任务只做"per-project key + 首次启动迁移"。
- 不动当前 git status 里的其它未提交改动（`packages/server/src/index.ts` / `main.tsx` / `store.ts` / `types.ts` / `ProjectsColumn.tsx` 等），它们属于别的进行中任务/草稿。
- 不写前端单测（项目当前无前端单测框架——保留 build + tester 覆盖即可）。
- **不删旧全局 key**——保留作为可回退快照。

## 实施步骤

> **细化拆分在 tasks.md / tasks.json；这里只写粗粒度顺序与各步骤的 verify 抓手。**

1. **改造 `customButtons.ts` 核心存储（per-project key）**
   - 新 key 格式：`aimon_custom_buttons_v1:<projectId>`，每个项目一份独立 JSON。
   - 模块级 cache 改成 `Map<projectId, CustomButton[]>`（**只是读缓存，真源永远是 localStorage 各自的 key**）。
   - API 签名加 projectId：
     - `getCustomButtons(projectId)`：cache 命中返回；未命中 → 读 key → 空/不存在 → 写入并返回 `defaultButtons()`（除非已被标记"用户主动删空"，详见下条）。
     - `setCustomButtons(projectId, list)`：写 key + 更新 cache + 通知所有 listeners（带 projectId）。失败 catch 后**记 LogsView error 日志**（`pushLog`，scope=session），不静默。
     - `onCustomButtonsChange(listener)` 签名保持原样（无 projectId 参数），listener 收 `(projectId, list)`；订阅方按需过滤。
   - **空数组语义**：key 存在但值是 `[]` → 用户主动删空，保持空、不复活种子。key 不存在 → 视为新项目，注入 defaults 并写入。**等价于"key 存在性 ≡ 已初始化"**——不再需要单独 `INIT_KEY`。
   - 新增 `migrateGlobalToPerProject(projectIds: string[]): { projectCount, buttonCount } | null`：
     - 读防重标记 `aimon_custom_buttons_migrated_v2`；已迁移返回 `null`。
     - 读旧全局 `aimon_custom_buttons_v1`；不是合法 array 返回 `null`（不迁移）。
     - **关键**：旧 array 是 `[]` 也要复制 `[]` 给每个 projectId（表示用户原本就主动删空了，迁移后不能莫名复活）。
     - 对去重过滤后的 `projectIds`（剔除空值、null、`'null'`、重复项）逐个写新 key；**全部成功后**才写防重标记（中途失败下次启动可重试）。
     - 不删旧 key（保留作快照，可回退）。
     - 返回统计供上游写迁移日志。
   - `storage` 跨 tab 事件：解析 key 前缀 `aimon_custom_buttons_v1:` → 提取 projectId → 更新 cache → 通知 listeners 带 projectId。旧 key 的 storage 事件忽略（其它 tab 跑旧版的情况）。
   - **verify**：`pnpm --filter @aimon/web build` 通过。
2. **PermissionsDrawer.tsx 接入 `selectedProjectId`**
   - `ButtonsTab` 用 `useStore((s) => s.selectedProjectId)` + `useStore((s) => s.projects)`；`useEffect` 依赖 selectedProjectId 重新订阅、重新读列表。
   - `selectedProjectId === null` 时显示占位提示"请先在左侧选择一个项目再配按钮"，**禁用**新增/删除按钮——硬性防止写入 `'null'` 当 key。
   - 顶部说明文案：`当前项目"<项目名>"的快捷按钮 ...`。
   - 编辑动作（add/update/remove）写一条 `pushLog`（见上 验收-操作日志）。
   - **verify**：build 通过 + 浏览器手测能在不同项目看到不同按钮列表。
3. **SessionView.tsx 按 `session.projectId` 订阅**
   - `useState` 初始化用 `getCustomButtons(session.projectId)`。
   - `useEffect` 订阅 listener：收到 `(projectId, list)` 时只在 `projectId === session.projectId` 才更新 state。依赖数组加 `session.projectId`，防止 session 复用串项目。
   - **关键边界**：`session.projectId` 不在 `projects` 列表（项目被删但 tab 没关）→ 直接返回 `[]`，**不**触发默认写入（避免给已删除项目制造残留配置）。
   - **verify**：build 通过 + 浏览器手测同时开两个不同项目的 session，按钮各自正确。
4. **App 启动期迁移**
   - 在 `App.tsx`（或 store 拉到 projects 完成的明确锚点）首次拿到**非空** `projects` 列表时调一次 `migrateGlobalToPerProject(projects.map(p => p.id))`；幂等（内部读防重标记直接 return）。
   - 迁移返回非 null 时 `pushLog` 一条 `custom-buttons-migrated`。
   - **verify**：清空 localStorage → 手动塞入旧格式 array → 刷新页面 → 所有项目都注入了那 6 个按钮 + LogsView 看到迁移日志；再刷一次不重复迁移（防重标记生效）。
5. **自派 tester + 收尾**
   - dev server 已起或自起（README 启动方式），派 `vibespace-browser-tester` 跑验收清单。
   - 跑 `git diff --name-only HEAD` 比对 write_files 白名单（见 tasks.json），越界停下来。
   - 全 grep `getCustomButtons|setCustomButtons|onCustomButtonsChange` 确认无残留旧签名调用（破坏性变更协议）。

## 边界情况

- **`selectedProjectId === null`**：设置抽屉 ButtonsTab 显示占位 + 禁用编辑按钮，硬性防止 `'null'` 当 key。
- **`session.projectId` 在 projects 被删了**（session tab 还没关）：`getCustomButtons` 返回 `[]` 且**不**写入（避免给已删除项目落残留）；按钮条隐藏。
- **首次启动且尚无任何项目**：跳过迁移（projectIds 为空）；旧全局 key 留在原处，等下次有项目时再迁。
- **多 tab 同步**：per-project key 天然隔离——A tab 改项目 1、B tab 改项目 2 互不覆盖；`storage` 事件解析 key 前缀 → 派发到 listeners 带 projectId。
- **localStorage quota / private mode**：catch 后**必写 error 日志**到 LogsView（`scope=session action=custom-buttons-save-failed`），不静默。
- **某项目 key JSON 损坏**：catch 后仅该项目返回 `defaultButtons()` 并尝试覆盖写入（写也失败就走"save-failed"日志路径）；其它项目不受影响（per-project key 的优势）。
- **新建项目**：`getCustomButtons(projectId)` 首次调用 → key 不存在 → 注入 defaults 并写入；该项目此后跟其它项目一样独立维护。

## 风险与注意

- **迁移时机依赖项目列表**：必须等 store 拉到 projects 后再调，提前调会跳过迁移（projectIds 为空）。要在 App 里找一个明确的"projects 已就绪"锚点（如 store 的 `projects` 字段从 `[]` 变非空时的 useEffect）。
- **"用户主动删空"语义简化但不能丢**：原 `INIT_KEY` 删除后，依赖"key 存在性"判断初始化。迁移时旧全局是 `[]` 也要复制 `[]` 给每个项目，否则用户原本删空的状态会被默认值复活。
- **未提交改动叠加**：当前 git status 有 5 个未提交文件属于其它任务/草稿，本任务白名单**不包含**这些文件；执行阶段如果发现本任务无意改动，立刻回滚。
- **破坏性变更协议**：本任务**会修改导出符号** `getCustomButtons / setCustomButtons` 的签名（加 projectId 参数）→ 触发 CLAUDE.md "破坏性变更协议"。已通过 grep 列出全部调用点（仅 3 处：PermissionsDrawer / SessionView / customButtons 自身），将在 tasks.md 对应步骤的 verify 里加"修改后 grep 确认无残留旧签名调用"。`onCustomButtonsChange` 签名保留（参数不变，listener 回调多个参数算 callback 协议变更，但 TS 编译会捕获不兼容）。
- **熔断**：同一步骤 verify 失败 2 次仍不过就停，把错误日志、试过的方案、当前疑惑打印给大哥，等介入。

## 多模型 Plan 会审

> [Gemini 评审] 跳过：本任务结构聚焦（单核心文件 + 2 个调用方 + 迁移函数），无长上下文/跨多模块依赖追踪需求，Gemini 边际收益低。
> [Codex 评审] 关键采纳：(1) 改 per-project key（`aimon_custom_buttons_v1:<projectId>`）替代单 key 大 map——并发更稳、JSON 损坏影响范围小、监听器结构更简；(2) 监听器保持单 `Set`，通知带 projectId 让订阅方自行过滤，不做 `Map<projectId, Set>`；(3) 迁移幂等标记必须**全部成功后**才写，否则中途失败会被永久跳过；(4) 旧全局 `[]` 要复制 `[]` 到每个项目，否则用户原本删空的状态会复活；(5) 保存失败必须记 LogsView 日志，不静默；(6) 新建项目"key 不存在 → 注入 defaults 并写入"行为要在 plan 显式写出；(7) `selectedProjectId === null` 时硬性防止写入 `'null'` 当 key；(8) `session.projectId` 在 projects 被删时返回 `[]` 但**不**写入（防残留）。
> [Codex 综合主笔] 跳过：plan 已由 Claude 草拟完整六段，Codex 仅做评审清单不重新主笔——本任务量级 + 大哥已通过"继续"接受推荐方向的信号下，再走综合主笔属于过度流程（参见 manual.md 2026-04-24 "小功能直接改"偏好的扩展精神）。Claude 在草稿上吸收 Codex 全部 8 条采纳点。
> [Claude 白话化兜底] 检查项：(1) 大哥摘要保留 3-5 行白话、术语括号翻译（localStorage / 桶 → 改成"小存储格"/"一份独立 JSON"）；(2) 全文术语括号翻译保留（JSON / cache / listener / key 等首次出现处或有上下文）；(3) manual.md 偏好对齐：UI 改动有浏览器可观察验收、自派 tester、只在 plan 停一次（已落）；(4) 新增"新建项目自动获得 2 个默认按钮"说明到大哥摘要（Codex 提醒漏的边界）；(5) 风险段补"保留'删空'语义不丢"原因。
