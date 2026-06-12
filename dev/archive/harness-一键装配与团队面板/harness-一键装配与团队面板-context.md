# harness-一键装配与团队面板 · context

## 关键文件（改动边界）

执行阶段原则上**只动这里列的文件**。要溢出先回来补这份清单。

### 后端 — 新建 / 改

| 文件 | 行号/符号 | 改什么 |
|---|---|---|
| `packages/server/src/harness-template-service.ts`（**新建**）| 全文件 | 导出 `HarnessFileSpec` 类型 + `getTemplateFiles(): HarnessFileSpec[]`（基于 `import.meta.url` 推算仓库根的 `.aimon/skills/` / `.claude/agents/` / `dev/harness-roadmap.md` / `dev/agent-team-blueprint.md` / `templates/harness/CUSTOMIZE.md`）+ `getHarnessStatus(projectPath): Promise<HarnessStatus>`（探测目标项目里这些文件的 exists / 是否含字面 `vibespace-`）+ `applyHarnessTemplate(projectPath): Promise<{ copied: string[]; skipped: string[] }>`（拷缺失 + .gitignore append `.aimon/runtime/`）。**不引新依赖**，全用 `node:fs/promises` |
| `packages/server/src/routes/projects.ts` | `CreateProjectSchema` L21；createProject 的 POST handler L150；DELETE handler 之后 | schema 加 `applyHarnessGuidelines: z.boolean().optional()`；createProject 成功后若该字段 true → 调 applyHarnessTemplate（best-effort，失败 warn 不阻塞）；新增 `POST /api/projects/:id/apply-harness`；新增 `GET /api/projects/:id/harness-status`；操作日志 `serverLog('info'/'error','installer','apply-harness 开始/成功/失败')` 起止配对 |

### 后端 — 读（不改）

- `packages/server/src/log-bus.ts` — `serverLog`
- `packages/server/src/dev-docs-guidelines.ts` — 现有"装规则"模式参考（appendDevDocsGuidelines / insertSectionBeforeSeparator）
- `packages/server/src/db.ts` — `getProject(id)` 验项目存在
- `templates/harness/install.sh` — 模板源逻辑参考；harness-template-service.ts 实现等价于把它的 cp/sed 步骤翻译成 node:fs

### 前端 — 新建 / 改

| 文件 | 改什么 |
|---|---|
| `packages/web/src/types.ts` | 加 `HarnessFileEntry { kind: 'skill'\|'agent'\|'doc'\|'customize'; relPath: string; exists: boolean; renamed: boolean }` 和 `HarnessStatus { installed: number; total: number; entries: HarnessFileEntry[] }` |
| `packages/web/src/api.ts` | `createProject` 入参加 `applyHarnessGuidelines?: boolean`；新增 `getHarnessStatus(projectId)` / `applyHarness(projectId)` 两个 fetch 函数 |
| `packages/web/src/components/NewProjectDialog.tsx` | 在现有"启用 Dev Docs 三段式工作流"复选框**之后**加第 2 个 "🤝 应用 Harness 团队配置"（默认 false）；submit 时把 `applyHarnessGuidelines` 透到 `api.createProject`；logAction meta 加这字段 |
| `packages/web/src/components/HarnessTeamDrawer.tsx`（**新建**）| 仿 `PermissionsDrawer.tsx` 的居中 modal 形态（`fixed inset-0 z-40 ...` + `relative w-[720px] h-[85vh] ...`）；props `{ project: Project; onClose: () => void }`；useEffect 拉 status；三段渲染：状态总览 / 文件清单表 / 操作区"一键安装缺失"按钮 + 使用提示（CUSTOMIZE-harness.md 路径） |
| `packages/web/src/components/layout/ProjectsColumn.tsx` | 现有右键菜单在「⚙ 权限配置」之后、「删除项目」之前插入「🤝 团队」项；本地 state `harnessTeamProjectId: string \| null` 触发 `<HarnessTeamDrawer />` 渲染 |

### 文档 / issues

| 文件 | 改什么 |
|---|---|
| `dev/issues.md` | append 一行：README "Karpathy 守则" 描述过时（grep 全 packages 0 命中），单独 issue |
| `README.md` | 末尾"Reusing the harness config..."段加一句"也可以在 VibeSpace UI 新建项目时勾选 / 既有项目右键打开团队面板一键装" |
| `dev/learnings.md` | 视情况追加（harness 模板 server-side 探测 / "drawer 命名"实际是 modal 的发现） |

---

## 决策记录

每条都过了"资深工程师会不会觉得过度设计"。

### D1 · 模板源走 import.meta.url 推算仓库根，不读 env / 配置
**选**：`SCRIPT_FILE = fileURLToPath(import.meta.url)` → 上溯到仓库根（packages/server/src/ → 仓库根）
**不选**：env `AIMON_REPO_ROOT` 配置 / 模板内容内嵌进 .ts 字符串
**理由**：本仓库的 server 必跟仓库源码同步部署（dev/stable 都是仓库内的子包），路径推算稳定；env 配置是给"独立部署"准备的过度设计；模板内嵌字符串会让 install 时模板跟仓库源失去联系——失去"VibeSpace 自己的真实 skill / agent 是参考样板"的价值。资深视角：合理。

### D2 · `HarnessTeamDrawer` 沿用 `PermissionsDrawer` 的居中 modal，不做"侧边滑出 drawer"
**选**：`fixed inset-0 z-40 flex items-center justify-center` + `relative w-[720px] h-[85vh]`
**不选**：右侧抽屉 (transform translate-x-0 / -full) 形态
**理由**：项目里"Drawer"现有 1 个实例（PermissionsDrawer）实际就是居中 modal——命名跟实现不一致是项目历史，但 v1 不要为新组件引入第二种布局形态。资深视角：保持一致。**plan AS3 描述有误**（写成"右侧滑出"），context 里更正。

### D3 · 改造度探测只看字面 `vibespace-` 字符串存在性
**选**：每个文件 grep 一次 `vibespace-`，存在 = 未改造，不存在 = 已改造
**不选**：AST 分析 / fuzzy 比对模板源
**理由**：v1 朴素够用；用户改名 vibespace-* → myproj-* 时 grep 命中变 0，正确反映"改造完成"；唯一误报是"用户保留 vibespace-* 名只重写 body"——这种边缘场景小，可接受。**已写进 plan 风险与注意 #3**。资深视角：合理。

### D4 · 一键安装**只补缺失不覆盖**
**选**：existsSync 检查每个目标路径，已存在则跳过，未存在则 cp
**不选**：覆盖模式 / "强制重装"按钮
**理由**：跟 install.sh 行为一致；UI 加"覆盖"按钮风险大（误删用户改造内容），v1 不做。资深视角：保守正确。

### D5 · createProject 路径里 applyHarness 失败**不阻塞项目创建**
**选**：try/catch 包 applyHarnessTemplate；失败 serverLog warn；项目仍创建
**不选**：失败回滚整个项目创建
**理由**：跟现有 appendDevDocsGuidelines 的处理一致（`try { ... } catch (err) { app.log.warn(...) }`）；项目创建是核心动作，模板拷贝是衍生动作——不该让衍生失败拖死核心。资深视角：标准 best-effort 模式。

### D6 · 右键菜单新加「团队」直接放在「权限」之后，不做二级菜单合并
**选**：第 6 项（codeChanges / files / vscode / perms / **team** / delete）
**不选**：合并 perms+team 为「⚙ 项目配置 ▸」二级菜单
**理由**：6 项菜单可控；二级菜单要扩 ProjectsColumn 的 setMenu state（现在 menu 是单层），引入复杂度。如果未来菜单膨胀到 8+ 再考虑。**plan 末尾的开放问题里 user 选了 (A)**——本决策直接落地。资深视角：合理增量。

### D7 · drawer 不做"卸载已装"按钮
**选**：drawer 仅展示 + 一键安装；卸载靠用户自己删文件
**不选**：UI 给"卸载"或"清空"
**理由**：误删风险大；卸载是一次性操作，加 UI 入口收益低；用户真要卸载 13 个文件可以 `rm -r .aimon/skills .claude/agents` 自己跑。资深视角：减少表面积合理。

### D8 · drawer 不做实时 fs-watch，按需刷新
**选**：drawer mount 时 fetch 一次；加 ⟳ 刷新按钮
**不选**：fs.watch / WS 推送
**理由**：用户改 .aimon/skills 文件不频繁，watch 是 over-engineering；MemoryView 现成模式（3s 轮询）也不必要——开 drawer 不是常驻视图。资深视角：合理。

---

## 依赖与约束

### 上游 / 兼容性

- **`templates/harness/install.sh` 的存在与 server 端逻辑无关**：脚本路径仍保留作为"命令行入口"；server 端的 applyHarnessTemplate 是独立实现的等价物。两条路径**逻辑必须一致**（同样的 13+1 文件清单、同样的"已存在则跳过"、同样的 .gitignore 处理）—— 实施时把文件清单提取成 `HarnessFileSpec[]` 常量，install.sh 里也改成读这个常量？**否**——保持两份独立实现，常量不强行同步（脚本是 bash，server 是 TS，跨语言维护成本高）。**风险**：未来加新模板文件时要记得两边都改——加一行 ESLint comment / 文件顶部注释提醒
- **dev/ 目录在 VibeSpace 自身 .gitignore 整个被忽略**——但目标项目可能不忽略；server 端按目标项目当前 .gitignore 行为来，不强制改"目标项目要忽略 dev/"
- **现有 `appendDevDocsGuidelines` 路径不动**：勾"Dev Docs"+ "Harness" 两个复选框 → 先 appendDevDocsGuidelines（写 CLAUDE.md）再 applyHarnessTemplate（拷文件）；两者不冲突
- **API 兼容**：CreateProjectSchema 加可选字段是向后兼容的；旧客户端不传 applyHarnessGuidelines 则视作 false

### 数据结构

- `HarnessFileSpec`：`{ srcAbs: string; dstRel: string; kind: 'skill'|'agent'|'doc'|'customize' }`
- `HarnessStatus`：`{ installed: number; total: number; entries: HarnessFileEntry[]; gitignoreHasRuntime: boolean }`
- `HarnessFileEntry`：`{ kind; relPath; exists: boolean; renamed: boolean }` —— `renamed` 仅对 kind='agent' 有意义（skill 文件名通用，没"vibespace-"前缀）；其它 kind 此字段恒为 false

### 操作日志（按 CLAUDE.md 规则）

- `POST /api/projects` 创建路径如果勾了 applyHarness：`serverLog('info','installer','apply-harness 开始/成功 (Nms)/失败: …', { projectId, meta: { copied, skipped, source: 'newProjectDialog' } })`
- `POST /api/projects/:id/apply-harness`：同模式，meta.source='drawer'
- `GET /api/projects/:id/harness-status`：**不**记日志（高频读不该污染 LogsView）
- 至少一条 ERROR 在验收时手动触发（让目标目录变只读再装一次 → ERROR 入账）

### 性能

- harness-status 探测：13 个文件 existsSync + readFile（仅 agents 6 个要 grep `vibespace-`）→ 每次 < 50ms，可接受
- apply 操作：13 文件 copyFile + 1 次 appendFile —— 串行 < 100ms

### 熔断点（按 CLAUDE.md）

- 实施 A-1 时如果 `import.meta.url` 推算仓库根逻辑不稳（dev / stable 双实例 / 打包后路径变形），**停手**——把实际推出来的路径打日志给大哥看，再决定是改路径策略还是加 env 兜底
- 实施 B-3 drawer 渲染如果布局跟 PermissionsDrawer 起冲突（z-index / overlay 互相挡），**停手**——保留 PermissionsDrawer 不动，HarnessTeamDrawer 临时改成更简陋的 fixed 居中也行
