# 工作流改独立文件引用 · Context

## 确定的设计（执行照此）

### 文件落点与标记
- 独立文件：`.aimon/workflow/dev-docs.md`，内容 = `DEV_DOCS_GUIDELINES` 常量原文（已含首行后的 `<!-- dev-docs-workflow:vN -->` 戳）。进 git（`.aimon/runtime/` 才 gitignore）。
- CLAUDE.md 引用块（写在工作流原位置）：
  ```
  <!-- dev-docs-workflow:import -->
  @.aimon/workflow/dev-docs.md
  ```
  - 检测靠引用行字符串 `@.aimon/workflow/dev-docs.md`（disk 读，不受注入剥离影响）。

### 三态判定（getDevDocsStatus 新增 `form`）
- `form='file'`：CLAUDE.md 含引用行 `@.aimon/workflow/dev-docs.md`。版本 = 读 `.aimon/workflow/dev-docs.md` 磁盘文件的戳。outdated = 文件戳 < `DEV_DOCS_VERSION`。
- `form='inline-legacy'`：CLAUDE.md 含**行首** `# Dev Docs 工作流`（h1 锚点，用 `/^# Dev Docs 工作流\s*$/m` 行锚匹配，避免被 `## ` 误命中）且非 file 形态。这类需迁移。
- `form='none'`：都没有。
- `enabled = form !== 'none'`；`outdated` 仅 file 形态有意义；inline-legacy 一律视为"待迁移"。

### 函数改造（workflow-service.ts）
- 常量：`DEV_DOCS_FILE_REL=".aimon/workflow/dev-docs.md"`、`DEV_DOCS_IMPORT_LINE="@.aimon/workflow/dev-docs.md"`、`DEV_DOCS_IMPORT_MARKER="<!-- dev-docs-workflow:import -->"`。
- `writeDevDocsFile(projectPath)`：mkdir -p `.aimon/workflow/` + 写 DEV_DOCS_GUIDELINES。
- `ensureImportBlock(projectPath)`：CLAUDE.md 无引用行则在末尾追加引用块（带 `---` 分隔，幂等）。
- `appendDevDocsGuidelines`（改）：= writeDevDocsFile + ensureImportBlock。不再内联整段、不再走 ISSUES retrofit。
- `findInlineBlockRange(content)`：返回老内联块 [start,end)（锚点→下一 `\n\n---\n\n#` 或 EOF，沿用上轮验证过的安全边界）。
- `removeDevDocsGuidelines`（改）：删引用块（若 file 形态）或删内联块（若 legacy）+ 删除独立文件。卸载要兼容两形态。
- `migrateOrUpdateDevDocs(projectPath)`（核心，替代上轮 updateDevDocsGuidelines 块替换）：
  - inline-legacy → 用 findInlineBlockRange 把内联块替换成引用块 + writeDevDocsFile（= 迁移）。
  - file → writeDevDocsFile 覆盖 + ensureImportBlock 自愈（= 更新）。
  - none → no-op。
  - 返回 `{ changed, form, installedVersion, currentVersion, action: 'migrate'|'update'|'noop' }`。
- `updateProjectDevDocs`（改）：调 migrateOrUpdateDevDocs，回填 status。
- `refreshAllOutdatedDevDocs`（改）：每项目按 form 分派——legacy 必迁移、file 仅 outdated 才覆盖、none/已最新跳过；skipped reason 扩 `migrated`/`updated` 计入 updated。
- 删上轮的 `updateDevDocsGuidelines` 内块替换（其能力并入 migrateOrUpdateDevDocs；非导出，安全删）。
- `WorkflowStatus.devDocs` 加 `form: 'none'|'inline-legacy'|'file'`，保留 installedVersion/currentVersion/outdated。

### 类型/路由/前端
- `types.ts`：`WorkflowStatus.devDocs` 镜像加 `form`。
- `routes/projects.ts`：`/api/projects/:id/workflow/update` 复用（内部 migrateOrUpdate），不新增路由——少破坏面。serverLog action 仍叫 `update-workflow`，meta 带 action（migrate/update）。
- `routes/workflow.ts`：refresh-all 不变（内部函数已 form-aware）。
- `api.ts`：`DevDocsUpdateResult` 加 `form`/`action`。
- `PermissionsDrawer.tsx`：按 `status.devDocs.form` 决定徽章/按钮文案——legacy→"待迁移到独立文件"+"迁移到独立文件"按钮；file+outdated→"工作流可更新"+"更新到最新版"；file 已最新→"已是独立文件形态"。"刷新所有项目"卡片文案改"迁移/更新所有项目"。

## 关键文件
- `packages/server/src/dev-docs-guidelines.ts`（只读用，内容不改）
- `packages/server/src/workflow-service.ts`（主战场）
- `packages/server/src/routes/projects.ts`（update 路由内部改）
- `packages/server/src/routes/workflow.ts`（基本不动）
- `packages/web/src/types.ts`（加 form）
- `packages/web/src/api.ts`（加 form/action）
- `packages/web/src/components/PermissionsDrawer.tsx`（三态 UI）

## 决策记录
- **不新增 migrate 路由，复用 update 端点**：前端只需一个"拉到最新文件形态"动作，按 form 显示不同文案即可；后端内部分派迁移/更新。少一个 API、少破坏面。资深视角：不算偷懒——语义就是"对齐到最新形态"，没必要拆两个端点。
- **独立文件内容直接用现有常量写出，不引 loader**：本轮母版仍是 `DEV_DOCS_GUIDELINES` 常量；改 loader 是另一笔账（非目标）。避免一次动太多。
- **HTML 注释剥离不管它**：版本检测全程读磁盘文件，不读 AI 上下文，剥离无影响（官方文档查证）。
- **金丝雀先行**：迁移逻辑做好后先只迁 VibeSpace 自身、真会话验证，避免把没验证的行为推给全部项目。

## 依赖与约束
- `@import` 路径相对 CLAUDE.md 目录（=项目根），`@.aimon/workflow/dev-docs.md` 成立；项目内相对路径不触发授权弹窗（官方文档查证）。
- 老 `ISSUES_ARCHIVE_SECTION`/`insertSectionBeforeSeparator` 若改造后无引用→按 noUnusedLocals 可能报错，执行时确认 build，必要时删 import（属本次改动产生的孤儿，可清）。
- 类型检查：`pnpm -F @aimon/server build`、`pnpm -F @aimon/web build`。
