# 策划方案清单 · Plan

> memory 扫过 `dev/memory/auto.md` / `manual.md`，无相关条目。

## 背景

用户想在左侧 ActivityBar 新增一个入口，用来浏览项目目录下的 `output/` 文件夹。`output/` 下每个子目录代表一个"功能（策划方案）"，目录内有一份 JSON 格式的检查清单（sections → items，含 decision / risk 两种 type），以及其他衍生文件（如 `v0.md`）。用户希望：

1. 在 ActivityBar 点击新图标 → 打开这个侧栏视图；
2. 侧栏列出 `output/` 下各功能文件夹；
3. 点击某个功能 → 展开/进入可查看其中的检查清单（JSON 渲染成表格或列表）；
4. 在页签（编辑区）里能快速编辑清单条目（status / 用户选择 / 自定义答案），保存回 JSON；
5. 功能文件夹下除 JSON 外的其他文件，作为普通文件列出（能点开看）。

## 目标

交付一个新的侧栏视图 **「策划方案」**（activity id 暂定 `output`），以 `<project>/output/` 为数据源，提供：

- ActivityBar 新图标 📐（或 🧩，实现时选一个不和现有 6 个冲突的）；点击切到此视图。
- 侧栏列出 `output/` 下一级子目录（= 功能名），每项可展开显示该目录下所有文件（JSON + md + 其他）。
- 点击 **`.json` 清单文件** → 在编辑区打开一个**专用清单编辑器 Tab**（不是 raw json），按 `sections[].items[]` 渲染：
  - decision 类 item：标题、推荐答案 recommend、备选 alternatives、理由 reason、当前 status 徽章；底部一行内联编辑 — 「确认采纳 recommend」「选备选之一」「自定义答案」三选一，点一次即写回 JSON。
  - risk 类 item：风险描述 + 处理建议 + status 徽章；同样一行内联编辑 status（pending → locked/modified）。
- 点击其它文件（`.md` / `.txt` 等）→ 走现有 `openFile` 在编辑区作普通文件预览。
- `output/` 不存在时：侧栏给出空状态提示，不报错。

### 可验证的验收标准

所有项都要一次过，才算本任务完成：

1. **端到端浏览器观察**：在当前项目下手动建 `output/示例功能/checklist.json`（用户给的 schema 最小样例）+ `output/示例功能/v0.md` → 启动前端 → ActivityBar 出现新图标 → 点击侧栏出现 `示例功能` 节点 → 展开列出两个文件 → 点 `checklist.json` 弹出清单编辑器 Tab → 看到 "A1 设计目的" 一行，带 recommend/alternatives/reason/status → 点"采纳推荐"，Tab 上显示 status 变 `locked` + 磁盘上 JSON 对应 item 的 status 字段已更新为 `locked`（用 `cat` 能看到）。
2. **编辑幂等 & 持久化**：改成 `modified` 并写自定义答案 → 刷新整个前端 → 重新打开该 Tab，看到的是刚才写入的自定义答案，不是 recommend 原值。
3. **空状态**：`output/` 不存在 / 为空时，侧栏显示"暂无策划方案"提示，不是 500 或白屏。
4. **类型检查**：`packages/web` 与 `packages/server` 各自 `tsc --noEmit` 通过（具体命令实现阶段查 `package.json` 对齐，验收时必须执行并贴结果）。

## 非目标（Non-Goals）

不要被相邻的念头带跑：

- **不做**功能文件夹的新建/删除/重命名（本次只读+条目编辑）。用户需要新功能目录，先自己 `mkdir`，UI 不提供。
- **不做** `v0.md` 等衍生文件的生成/锁定联动（JSON schema 里 `guide.afterLock` 说"主策据此产出 v0.md"—— 那是主策的事，不是 UI 的事）。
- **不做**多人协同 / 乐观锁 / 版本号冲突处理。`version: 1` 字段原样读写，UI 不维护它的语义。
- **不做**全局搜索、过滤、排序等二级功能，先把读→编→存主线跑通。

## 实施步骤

粗粒度的打算，verify 写清每步自己能判断通过与否：

1. **后端：新增 output 路由**（`packages/server/src/routes/output.ts`）—
   - `GET /api/projects/:id/output` → 列 `output/` 下一级子目录及每个子目录下的文件清单。
   - `GET /api/projects/:id/output/:feature/checklist` → 读取功能目录下的 `*.json`（见"风险"里文件名约定）并返回解析后的对象 + 原 etag/mtime。
   - `PATCH /api/projects/:id/output/:feature/checklist` → body 里带 item 路径（`sectionId`/`itemId`）+ 新字段（status、自定义字段等），原子重写 JSON。
   - 错误处理复用 `DocsServiceError` 风格。
   - **verify**：用 `curl` 在 `output/示例功能/*.json` 上跑 list / get / patch，`jq` 看 JSON 有无预期字段。

2. **前端 store**：新增 `outputFeatures: Record<projectId, Feature[]>` 及 `outputChecklists: Record<key, ChecklistDoc>` 缓存 + `refreshOutput` / `patchChecklistItem` actions。
   - **verify**：前端热重载后，console 打 `useStore.getState()`，能看到字段。

3. **ActivityBar 加图标 & PrimarySidebar 路由新 view**：`activity` 类型加 `output`，titles 映射加 "策划方案"，`<OutputView />` 懒生成空 view 先跑通导航。
   - **verify**：点击新图标，侧栏顶部 "策划方案" 标题出现；对现有 6 个视图无副作用。

4. **前端 `OutputView.tsx`**：列功能目录 + 可展开文件列表，仿照 `DocsView` 的视觉规格（fluent-btn、缩进、hover）。
   - 功能目录 click 展开/收起；内部文件点击，若 `.json` 打开清单编辑 Tab（第 5 步），否则走 `openFile`。
   - **verify**：浏览器点一遍，看 `示例功能` 展开、收起、子文件点开的行为。

5. **清单编辑器 Tab**：新增 `EditorTab` 的 `kind: 'checklist'` 分支 —
   - 打开方式：`openFile` 签名里已有 `path` 字段，增加一个 `kind: 'checklist'`（或独立 `openChecklist` action，避免 openFile 单插槽逻辑把清单挤掉）。设计阶段在 context.md 里决定走哪条。
   - 渲染：sections → 每个 item 一张小卡片，decision / risk 两种布局，底部工具条切 status。
   - 写回：点按钮调 `patchChecklistItem`，UI optimistic 更新 + 失败回滚。
   - **verify**：验收标准 1、2 两条手工走通。

6. **空状态 & 错误兜底**：`output/` 不存在时，后端返回 `{ features: [] }` 而不是 404；前端空状态 UI 复用现有 muted/text-sm 风格。
   - **verify**：手动 `rm -rf output` 后重试侧栏，不白屏、不报错。

7. **类型检查 + 冒烟**：`pnpm -C packages/web tsc --noEmit`（或 `build`）+ `pnpm -C packages/server tsc --noEmit`；再按验收标准 1-3 完整走一遍。
   - **verify**：类型检查无 error；三条验收观察项均在浏览器里点出。

## 边界情况

实现/测试时至少覆盖：

- `output/` 不存在 —— 按"空"处理，别 throw。
- 功能目录下有 **0 / 1 / 多个** JSON 文件。多于 1 个时：目前不支持选 —— 取第一个（按字母序），在 context.md 里记作"单清单假设"。
- JSON 缺字段（没 `sections` / 有非法 `type` / `status` 不在 legend 里）—— UI 要能渲染成"格式不支持，请查看原 JSON"的兜底块，**不能整个 Tab 崩**。
- 同一 item 被用户快速连点两次 —— 后端 PATCH 原子写，前端按 mtime/etag 做 If-Match，失败时 toast "已被他处修改，已刷新"。
- 文件名含非 ASCII / 空格 —— 路径拼接必须经过现有 `safeResolve`，不能让路径逃出 `<project>/output/`。
- 功能名含 `/` `\` —— 跟 Dev Docs 同约束，后端校验，前端不做这个活。

## 风险与注意

**假设显式列出**，其中 3 条我需要用户在 plan 阶段就确认，否则 context 没法定案：

- **[待确认] output 文件夹位置**：按字面"目录下的 output 文件夹"，我假设是 `<project.path>/output/`（每个项目自带一份）。如果你是指 VibeSpace 工作区根目录下的全局 `output/`，路由形态会不一样，先确认。
- **[待确认] 清单 JSON 文件名约定**：你给的 schema 里有 `feature` 字段但没说文件叫什么。我准备按约定 `output/<功能名>/<功能名>.json`（与目录同名）或 `output/<功能名>/checklist.json` 二选一。倾向前者，与现有 `dev/active/<任务名>/<任务名>-plan.md` 风格一致；请确认选哪个。
- **[待确认] "点击在页签上可快速编辑对应的清单选项" 的交互粒度**：
  - 解读 A：整份 checklist 作为一个 Tab，所有 item 卡片在一个页面里，任意一条 inline 编辑 → 我倾向这个。
  - 解读 B：每个 item 单独是一个 Tab，点 item 新开 Tab。
  - 这两种 UI 骨架差很多，请选一个。

其他已知风险：

- 现有 `openFile` 是**单 Tab 预览槽**（`openFiles: [tab]` 一次只一个），直接用它打开 checklist 会踢掉用户正在看的普通文件。清单编辑器最好有独立 slot 或走 `activeTabKind` 的第三种值（`'checklist'`）。context 阶段定。
- JSON 写回要原子（tmp + rename），否则中断会坏掉用户的策划数据。已在步骤 1 里列了，实现阶段别偷懒用 `writeFile` 直接覆盖。
- 侧栏图标暂用 emoji（和现有 6 个一致），不走 SVG icon font —— 跟 ActivityBar.tsx 里的注释"16px 每个图标轮廓要一眼可辨"保持一致，但要挑个和现有六个都不像的。候选：📐 / 🧩 / 🗂️ / 📦。实现时选一个，不再回来问。

---

**请确认或修订**以上 3 条 [待确认]，以及对整体目标 / 非目标 / 验收标准是否还有改动。确认后我再进入 Context 阶段。
