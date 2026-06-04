# 问题面板 · 上下文

## 关键文件

> 这张清单就是本次改动的边界。执行阶段原则上**只动下列文件**，溢出先回来补。

### 服务端（会改 / 新建）

1. **`packages/server/src/dev-docs-guidelines.ts`**（现 1-113 行）  
   - 在主守则段的"执行时的硬性规则"之后（现第 80 行 `- **熔断：...` 之后、`## 规则与边界` 之前）追加新章节 `## Issues 档案`。  
   - 同时**把该章节单独导出**为 `ISSUES_ARCHIVE_SECTION`（字符串以 `## Issues 档案\n\n` 开头，便于升级逻辑插入）。

2. **`packages/server/src/routes/projects.ts`**  
   - 改 `appendToClaudeMd` / `appendDevDocsGuidelines`（现 19-64 行）：新增"缺章节就补"路径。预计改成两个小函数：  
     - 保留现有 `appendToClaudeMd(projectPath, body, anchor)` 整块追加能力。  
     - 新增 `insertSectionBeforeSeparator(projectPath, section, sectionAnchor, mainAnchor)`：在 CLAUDE.md 里找到 `mainAnchor` 起始、再在这段内搜 `sectionAnchor`，缺则在**主段末尾（下一个顶级 `---` 行之前，或 EOF）** 插入 `section`。  
     - `appendDevDocsGuidelines` 改成：若无主 anchor → 走 `appendToClaudeMd` 整段；否则 → 走 `insertSectionBeforeSeparator` 补 Issues 章节。  
   - `/api/projects/:id/apply-dev-docs` 路由（现 151-168 行）**签名不变**，`wrote:true` 语义扩展为"发生了写入（整段或章节补丁）"；前端文案**不区分**二者，保持简单。

3. **`packages/server/src/issues-service.ts`**（**新建**，参考 `docs-service.ts` 的防 traversal 范式）  
   - 导出：  
     ```ts
     export interface IssueItem { line: number; text: string; done: boolean }
     export interface IssuesPayload { path: string; content: string; items: IssueItem[] }
     export async function readIssues(projectPath: string): Promise<IssuesPayload>
     ```
   - 路径：`<projectPath>/dev/issues.md`（相对 `dev/issues.md` 返回 `path`）。  
   - 行正则：`^\s*[-*+]\s+\[( |x|X)\]\s+(.+)$`；`done = m[1] !== ' '`。  
   - 文件不存在：返回 `{ path: 'dev/issues.md', content: '', items: [] }`（不抛错）。

4. **`packages/server/src/routes/issues.ts`**（**新建**，仿 `routes/docs.ts`）  
   - `GET /api/projects/:id/issues` → `readIssues(proj.path)`，404 / 500 的错误返回与 docs 路由一致。

5. **`packages/server/src/index.ts`**（现 28 / 142 行的 docs 注册前后）  
   - import `registerIssuesRoutes`，在 `registerDocsRoutes(app)` 之后 `await registerIssuesRoutes(app)`。

### 前端（会改 / 新建）

6. **`packages/web/src/types.ts`**（现 315-332 行 Dev Docs 段末尾）  
   - 追加：  
     ```ts
     export interface IssueItem { line: number; text: string; done: boolean }
     export interface IssuesPayload { path: string; content: string; items: IssueItem[] }
     ```

7. **`packages/web/src/api.ts`**（现 295-332 行 Dev Docs 段末尾）  
   - 追加：  
     ```ts
     export function listIssues(projectId: string): Promise<IssuesPayload> {
       return request<IssuesPayload>(`/api/projects/${encodeURIComponent(projectId)}/issues`)
     }
     ```

8. **`packages/web/src/store.ts`**  
   - state 槽新增（贴近现有 `docsTasks / docsLoading / docsError`，现约 85-170 行）：  
     `issuesData: Record<projectId, IssuesPayload | undefined>`、`issuesLoading / issuesError`、`refreshIssues(projectId)`。  
   - 派单用**现成 actions**：`addSession(s)`（现 418-422 行）+ `setActiveSession(projectId, sessionId)`（现 333-341 行）。不新增 session 相关 action。

9. **`packages/web/src/components/sidebar/DocsView.tsx`**（现 1-355 行）  
   - 头部按钮行加一个 2 段 segmented：「任务 / 问题」，本地 `view: 'tasks' | 'issues'` useState。  
   - `view === 'issues'` 分支**就地写**，不拆独立文件（现阶段不够复杂到值得拆）。  
   - 问题条目 UI：左侧状态 pill（复用 `StatusPill` 的样式风格，自己写一个二值 pill 即可）+ 单行文本 truncate + 右侧 hover 按钮「📄 打开 issues.md」「🤖 派 Claude」（done 项不显示"派"）。  
   - 顶部按钮行新增「🤖 派全部」按钮，仅在 `view==='issues'` 且存在 `- [ ]` 条目时出现。  
   - 搜索框只在 `view==='tasks'` 时出现。

### 仓库根（会改）

10. **`f:\KB\AIkanban-main\CLAUDE.md`**  
    - 在现有"执行时的硬性规则"后、"## 规则与边界"前，手动同步 `## Issues 档案` 章节。和 `dev-docs-guidelines.ts` 里的内容逐字一致。

### 明确不碰

- `packages/server/src/docs-service.ts`、`pty-manager.ts`、`ws-hub.ts`、`db.ts`、所有其他路由文件
- `packages/web/src/components/dialog/DialogHost.tsx`（**不扩展"带复制按钮的 dialog"**，降级路径用现有 `alertDialog` 把 prompt 文本放在 message 里，用户鼠标选中复制即可）
- `packages/web/src/components/terminal/*`、`editor/*`、`sidebar/` 下其他 view、`ProjectsColumn.tsx` 等
- 既有 `dev/active/*/` 任务文件结构

---

## 决策记录

> 每条都回答过："资深工程师看到这个方案，会不会觉得过度设计？"

1. **issues 放全局 `dev/issues.md`，不按任务分组** — 用户拍板。理由：问题的作用域是"顺手发现的无关项"，本就跨任务；全局更符合语义，实现也更简单。

2. **状态只有 `- [ ] / - [x]`，不引入 `doing`** — 用户拍板。复用既有 checkbox 语法，`doing` 属于任务层面的"部分完成"概念，单条问题不需要。

3. **S1 半自动派单（剪贴板 + 提示 `Ctrl+V Enter`），不做自动 pty 写入** — 用户拍板。避免 Claude CLI 冷启动时序坑、不耦合 CLI 输出格式，成本低且可靠。

4. **"缺章节就补"的 CLAUDE.md 升级策略，不整段覆盖** — 用户同意。以 `## Issues 档案` 为 section anchor 判重。代价：若用户改了章节标题会判"缺"重复追加，作为已知边界。不做模糊匹配——那是"为不可能发生的场景加复杂度"。

5. **不扩展 `DialogHost` 增加"带复制按钮"变体** — 剪贴板失败是低概率降级路径；现有 `alertDialog` 把 prompt 作为 `message` 展示（message 是 `whitespace-pre-wrap break-words` 文本），用户可直接选中复制。新增对话框 variant 属于"只用一次的抽象"。

6. **问题视图不加搜索** — 问题数量通常 < 几十条，UI 空间留给操作按钮。需要搜索时再说。

7. **不加"手动新建问题"入口** — 问题的唯一来源是 AI 执行期追加 + 用户直接编辑 `dev/issues.md`。加 UI 新建属于"用户没要的功能"。

8. **Prompt 模板写死在前端代码里，不做可配置** — 属于"没人要求的灵活性"。

9. **问题条目强制单行** — 守则里显式约束 AI。多行解析要引入"续行缩进"规则，成本不小，收益不明显。长描述用括号或分号压扁即可。

10. **`view: 'tasks' | 'issues'` 用 DocsView 组件局部 state，不进 store** — 切换 tab 是 UI 私事，不跨组件共享；没必要污染全局 store。

11. **不把 issues 视图拆成独立 `IssuesView.tsx`** — 当前预计在 DocsView 里多 ~80 行代码，一个文件内可读。文件真大到影响可读性再拆。

12. **`wrote:true` 在升级场景下复用，不扩展响应字段区分"整段 / 章节补丁"** — 前端 UX 不依赖这个区别，保持 API shape 稳定更省事。

---

## 依赖与约束

### 上游 API

- **`POST /api/projects/:id/apply-dev-docs`** — 签名不变：`{ ok, wrote:boolean, target:string }`。`wrote` 语义扩展为"发生了写入（整段或章节补丁）"。前端现有提示文案（见 `DocsView.onApplyRules`）继续沿用。
- **`POST /api/sessions { projectId, agent:'claude' }`** — 返回 `Session`（snake_case wire shape，见 `routes/sessions.ts:42-63`）。前端 `api.createSession` 已存在。
- **`GET /api/projects/:id/issues`** — 新增。返回 `IssuesPayload`。project 不存在 → 404；读文件失败 → 500。

### 数据结构约定

- **`dev/issues.md` 格式**：每条问题 = 一行 `^\s*[-*+]\s+\[( |x|X)\]\s+(.+)$`。`done = m[1] !== ' '`（`x` / `X` 都算 done）。
- **`IssueItem.line`**：1-based，供未来"点击跳转行"用（本轮不做跳转，打开 md 文件即可）。
- **`items` 顺序** = 文件中出现顺序。
- **文本保真**：text 字段保留行的剩余原始内容（含中文 / 特殊字符 / 括号注释）。

### 兼容性

- 既有项目 CLAUDE.md：升级只做加法，不破坏既有内容；用户手改过的老章节不动。
- 既有 `dev/active/*/*-{plan,context,tasks}.md`：完全不动。
- 既有 DocsView 任务 tab：行为不变，只新增 segmented 按钮。
- TypeScript：`tsc --noEmit` 新增类型需通过；不放宽现有 strict 设置。

### 运行时假设

- Electron/Vite 下 `navigator.clipboard.writeText()` 在 localhost/HTTPS 上下文可用。若抛错 → 走 `alertDialog` 降级，不阻塞主流程。
- Node fs utf8 读写（和既有 docs-service 一致）。
- Windows 路径分隔符：`dev/issues.md` 用 POSIX 正斜杠对外返回，内部 fs 操作用 `node:path/join` 拼。
