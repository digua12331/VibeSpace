# 按项目独立按钮配置 · context

> 给 AI 自己看的执行边界与决策依据。大哥不审。

## 关键文件（本次改动边界）

| 文件 | 角色 | 改动方式 |
|---|---|---|
| `packages/web/src/customButtons.ts` | 存储/读写实现本体 | **大改**：per-project key + cache map + listeners 协议变更 + 迁移函数 |
| `packages/web/src/components/PermissionsDrawer.tsx`（行 11-17, 789-854） | 设置抽屉「按钮」tab | **中改**：注入 `selectedProjectId`、`projects`；占位提示；调用方传 projectId |
| `packages/web/src/components/terminal/SessionView.tsx`（行 24-28, 295-297, 1273-1276） | 渲染按钮条 | **小改**：useState 初始化 + 订阅传 `session.projectId`，依赖数组更新 |
| `packages/web/src/App.tsx` | 启动期挂载点 | **新增**：useEffect 监听 store.projects → 首次非空时调 `migrateGlobalToPerProject` |

**只读参考**：
- `packages/web/src/store.ts:175,178,367,556,610,652-655`（`selectedProjectId / projects` 字段定义、读取、变更点）
- `packages/web/src/logs.ts`（`pushLog` 签名）
- `packages/web/src/prompts.ts`（同源 localStorage 模式参考——不改）
- `dev/ARCHITECTURE.md` §3.5（badge/chip 字典模式说明，确认本任务**不**走"抽通用组件"路线，只动 customButtons 本身）

**白名单**（write_files）严格只这 4 个：
```
packages/web/src/customButtons.ts
packages/web/src/components/PermissionsDrawer.tsx
packages/web/src/components/terminal/SessionView.tsx
packages/web/src/App.tsx
```

执行阶段每步 verify 后跑 `git diff --name-only HEAD` 比对，越界（含当前已有 5 个未提交的别任务文件）立即回滚。

## 决策记录

### D1：per-project key vs 单 key 大 map（采纳 per-project）

**选 per-project key `aimon_custom_buttons_v1:<projectId>`**：
- **跨 tab 并发更稳**：单 key 大 map 是"读整包→改一格→写整包"，两 tab 改不同项目时后写覆盖先写；per-project key 天然隔离。
- **JSON 损坏影响范围小**：一个项目 key 坏只影响该项目。
- **storage 事件解析更简**：从 key 前缀直接提 projectId，不用 diff map。
- **代价**：项目删除后可能残留旧 key（localStorage 小数据可接受，不主动清理）。

**资深工程师视角自检**："会不会过度设计？" → 不会。每项目独立 key 是 localStorage 业界默认模式（参考 `prompts.ts` 也用同样 `aimon_<feature>_v1` 单 key 模式，那里没有按项目分桶需求；本任务有，所以拓展前缀加 projectId 是最少改动的扩展）。

### D2：监听器单 Set vs `Map<projectId, Set>`（采纳单 Set）

**选单 `Set<Listener>` + 通知带 `(projectId, list)`**：
- 订阅方（SessionView / PermissionsDrawer）本来就知道自己关心哪个 projectId，自己过滤一行 if 比维护 Map 简单。
- Map<projectId, Set> 需要 ref-count 处理"最后一个订阅者撤销"、跨 projectId 切换重新订阅等，开销不抵收益。
- 不通知所有 listeners 的"性能节省"在按钮列表这种<100 entry 的场景里完全无意义。

### D3：取消 `INIT_KEY`，用"key 存在性"代替（采纳）

**简化为**：key 不存在 → 注入 defaults 并写入；key 存在（即使 `[]`） → 保持值不变。
- 等价于原 INIT_KEY 的"区分从未初始化 vs 用户删空"语义。
- 少一个 key，少一处错位的可能。
- 迁移时旧全局 `[]` → 复制 `[]` 给每个项目（**关键**：保持"用户主动删空"语义不丢）。

### D4：`onCustomButtonsChange` 签名（callback 协议变更，函数签名不变）

**保留函数签名 `onCustomButtonsChange(listener)` 不加 projectId 参数**；listener 回调多带 `(projectId, list)`。
- 比"加 projectId 参数 + 分桶 Map"更简（见 D2）。
- callback 协议变更会被 TS 编译捕获，三处调用方（仅 SessionView / PermissionsDrawer）都会得到 type error，强制修正。
- 比"加 projectId 参数"语义更对：订阅方关心的是"任何项目的按钮变化都通知我"还是"只关心特定项目"，由 listener 内部 if 决定，灵活性更高。

### D5：迁移时机放 App.tsx，不放 customButtons.ts 懒迁移（采纳）

**理由**：
- 懒迁移（首次 `getCustomButtons(X)` 时迁全部）需要知道"所有现有项目 id"，但 customButtons.ts 本身不持有 projects 列表，会变成模块间反向依赖。
- App.tsx 拉到 projects 后 useEffect 调一次，是项目级初始化的天然位置。
- 幂等通过防重标记 `aimon_custom_buttons_migrated_v2` 保证；首次 projects 为空时自动跳过，等下次有项目再迁。

### D6：操作日志最小集（不滥用 logAction）

- 编辑（add/update/remove）→ 一条 `pushLog` 同步日志（无起止配对——CLAUDE.md "同步操作可简化"）。
- 迁移成功 → 一条 `pushLog`。
- 保存失败 → 一条 `pushLog level=error`（**核心修正**：原实现是 catch 静默，用户配额满了不知道）。
- **不**给"切换 selectedProjectId 触发 setList"加日志（高频 UI 状态变化，按 CLAUDE.md 操作日志规则属于豁免类）。

## 依赖与约束

- **localStorage 协议**：`aimon_<feature>_v<n>:<scope?>` 是项目既有命名约定（`prompts.ts` 同源），本任务遵循。
- **store 字段**：`selectedProjectId: string | null` / `projects: Project[]` 已存在，无需新增。
- **session 对象**：`session.projectId` 已在 SessionView 多处使用（行 149/155/253/305/310/320/432/653/798/973），可以直接读。
- **构建约束**：项目无独立 `typecheck` 脚本，verify 走 `pnpm --filter @aimon/web build`（含 tsc）。
- **当前 git 未提交改动**（5 个文件，属其它任务/草稿，本任务**不动**）：
  - `packages/server/src/index.ts`
  - `packages/web/src/components/layout/ProjectsColumn.tsx`
  - `packages/web/src/main.tsx`
  - `packages/web/src/store.ts`
  - `packages/web/src/types.ts`
  - `packages/server/src/process-mem-service.ts`（未跟踪）
- **没有前端单测框架**：本任务靠 build + vibespace-browser-tester 覆盖，不引新测试依赖。

## "过度设计自检"清单

- [x] 不做用户没要的功能：没有"按钮分组/排序拖拽/导入导出 JSON"等花活。
- [x] 不做只用一次的抽象：没有抽通用 `usePerProjectStorage` hook（只 1 处用得到）。
- [x] 不做没要求的灵活性：监听器没做优先级/异步队列。
- [x] 不写不可能场景的错误处理：projectId 校验只防 `null/empty/'null'`，不防"projectId 是 emoji"等无意义情况。
- [x] 行数估算：customButtons.ts 从 195 行 → 预计 ~260 行（+35%，含迁移函数）；其它两文件各 +10 行；App.tsx +15 行。整体增量 < 100 行，**外科式改动**。
