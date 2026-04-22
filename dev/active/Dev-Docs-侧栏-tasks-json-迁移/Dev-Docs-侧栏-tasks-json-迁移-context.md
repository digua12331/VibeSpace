# Dev-Docs-侧栏-tasks-json-迁移 · 上下文

## 关键文件

### 服务端（核心改动点）

- **[packages/server/src/docs-service.ts](../../../packages/server/src/docs-service.ts)**
  - `DocTaskSummary.status` 联合类型（[L9](../../../packages/server/src/docs-service.ts#L9)）——加 `"blocked"`。
  - `countCheckboxes` + `deriveStatus`（[L122-L139](../../../packages/server/src/docs-service.ts#L122-L139)）——**不动**，作回退路径保留。
  - `summarizeTask`（[L141-L174](../../../packages/server/src/docs-service.ts#L141-L174)）——改：先尝试 json，拿到合法 json 就用 json 的 step 聚合；否则走原 md 路径。
  - 新增模块私有函数 `readTasksJson(projectPath, name)` 和私有类型 `TasksJson` / `TaskStep`（见"依赖与约束"的 schema）。

### Web 类型（跨进程同步）

- **[packages/web/src/types.ts](../../../packages/web/src/types.ts)**
  - `DocTaskStatus`（[L318](../../../packages/web/src/types.ts#L318)）——加 `'blocked'`。
  - `DocTaskSummary`（[L320-L326](../../../packages/web/src/types.ts#L320-L326)）——保持形状不变，`status` 类型变化即可。

### UI（新增 blocked 胶囊）

- **[packages/web/src/components/sidebar/DocsView.tsx](../../../packages/web/src/components/sidebar/DocsView.tsx)**
  - `StatusPill`（[L32-L52](../../../packages/web/src/components/sidebar/DocsView.tsx#L32-L52)）——新加 `task.status === 'blocked'` 分支。

### 只读参考（不改）

- [packages/web/src/store.ts](../../../packages/web/src/store.ts) — `docsTasks` / `refreshDocs` 已透传 `DocTaskSummary`，不需要改。
- [packages/web/src/api.ts](../../../packages/web/src/api.ts) — HTTP 层也只是透传。
- [packages/server/src/index.ts](../../../packages/server/src/index.ts) — `/api/docs/*` 路由直接调 `docs-service.ts` 的导出，无中间逻辑。

## 决策记录

1. **读端策略：json 优先 + 静默回退 md**
   - 合法 json 存在 → 用 json 的 `steps[].status` 聚合。
   - json 缺失 / JSON 解析失败 / schema 不合法 / `steps` 空数组 → 回退 `countCheckboxes(md)`。
   - **不自动从 md 生成 json**（AI 侧的事，不在服务端代办）。
   - 过度设计反问：*"要不要做一个『json 落后于 md 时惰性写回』的同步机制？"* → 不。服务端维护写端就破坏了 CLAUDE.md 里"md 为真源、AI 负责双写"的契约。

2. **schema 校验：手写最小 validator，不引 zod**
   - 虽然服务端已经依赖 zod（[package.json:23](../../../packages/server/package.json#L23)），但本次 reader 只 3-4 个字段，用 10 行 `typeof` / `Array.isArray` 判断就够。
   - 过度设计反问：*"用 zod 不是更一致吗？"* → 引入一个 zod schema 还要关心错误聚合路径，反而变成噪声；这里只需要"解析失败就当没有"的宽松策略。

3. **不加单测**
   - 项目无测试基础设施（没有 vitest/jest，没有任何 `*.test.ts` / `*.spec.ts`）。
   - 加测试等于顺带搭框架——典型"200 行问题写 500 行"。
   - 替代验证：类型检查 + 4 个浏览器场景手动点过（见 tasks 阶段的 verify）。
   - 过度设计反问：*"没测试怎么防回归？"* → reader 是纯函数，修改 `summarizeTask` 时在浏览器里对 4 种输入各看一眼就能判死活；真要加，等以后某次改动先把 vitest 搭起来。

4. **blocked 的任务级聚合规则**（md→json 取代品，json 模式下生效）
   - 任意一个 step 是 `blocked` → 任务级 `blocked`；
   - 否则全部 `done` → `done`；
   - 否则存在任意 `doing` 或 (`done` > 0 && 有 `todo`) → `doing`；
   - 否则 → `todo`。
   - UI 胶囊文案：`"阻塞 X/Y"`，其中 X = blocked 步骤数、Y = 总步骤数（让用户一眼看到阻塞量级）。

5. **`checked` / `total` 在 json 模式下的语义**
   - `total` = `steps.length`。
   - `checked` = `status === 'done'` 的 step 数量。
   - 保持跟 md 模式对齐，UI 显示 `X/Y` 不需要额外分支。

6. **`updatedAt` 取 max(md.mtime, json.mtime)**
   - AI 可能先改 md 后改 json（或反过来），取较大值可让任务在侧栏"最近更新"排序里正确上浮。
   - 只有 md 没 json → md.mtime；只有 json 没 md（罕见）→ json.mtime。

7. **跨包类型同步：手工双写，不做单一真源**
   - [types.ts:320](../../../packages/web/src/types.ts#L320) 和 [docs-service.ts:7](../../../packages/server/src/docs-service.ts#L7) 的 `DocTaskSummary` 本来就是手写副本（web 不 import server）。
   - 过度设计反问：*"要不要抽共享包 / codegen？"* → 4 个字段，一个任务改 2 处，不值得。维持现状。

## 依赖与约束

### 类型检查命令（项目没有 `typecheck` script，build 命令兼做类型检查）

```bash
# 服务端 typecheck
pnpm --filter @aimon/server exec tsc --noEmit -p tsconfig.json

# Web 端 typecheck
pnpm --filter @aimon/web exec tsc -b --noEmit
```

如果 `tsc --noEmit` 有环境问题，回退用全量 build：

```bash
pnpm --filter @aimon/server build
pnpm --filter @aimon/web build
```

### 浏览器验收入口

- 起 dev：`pnpm dev:all`（server + web 并行）。
- 侧栏位置：左侧导航点进"Dev Docs"侧栏，选中任意现有项目（git status 显示当前 cwd 就是一个 git repo，可以拿自身作为测试项目）。
- 刷新按钮：侧栏右上角 `⟳` 触发 `refreshDocs`，每次改文件后手点即可。

### tasks.json schema（服务端 reader 认可的最小集）

```ts
interface TasksJson {
  task: string       // 必须存在，内容不校验
  steps: TaskStep[]  // 必须是数组；为空数组则视为无效，回退 md
}
interface TaskStep {
  id?: number        // 本次不用，不校验
  title?: string     // 本次不显示
  verify?: string    // 本次不显示
  status: 'todo' | 'doing' | 'done' | 'blocked'
                     // 未知值按 'todo' 处理（不抛错）
}
```

- 文件编码：utf-8（跟 md 一致，`readFile(..., 'utf8')`）。
- 文件路径：`<projectPath>/dev/active/<任务名>/<任务名>-tasks.json`。

### 已对齐的决策（来自上轮对话）

- 归档目录名选 A：[CLAUDE.md:12](../../../CLAUDE.md#L12) 已改回 `dev/archive/`（已落盘，与 [docs-service.ts:51](../../../packages/server/src/docs-service.ts#L51) 一致）。
- 冲突判优选 α：UI 在 md/json 不一致时以 **json 为准**。

### 现有 active 任务（回归基线）

8 个任务目录，全部**没有** tasks.json，必须在改动后 checked/total/status 保持不变：

- `dual-instance-iteration`
- `fix-persistence-cascade`
- `右键扩展-VSCode与Bat执行`
- `图片粘贴`
- `性能面板`
- `提示词库`
- `文件右键菜单`
- `问题面板`

（本任务自己 `Dev-Docs-侧栏-tasks-json-迁移/` 属于在途任务，不作回归基线。）

---

**等你确认：**

- 决策 4（blocked 胶囊文案用 "阻塞 X/Y" 显示**阻塞步骤数**）OK 吗？还是你更想看到 "阻塞 · 进行中 X/Y" 这种组合？
- 决策 6（`updatedAt` 取 max）OK 吗？还是简单点只用 md.mtime？
- 其他有想补的吗？

确认后进入 Tasks 阶段。
