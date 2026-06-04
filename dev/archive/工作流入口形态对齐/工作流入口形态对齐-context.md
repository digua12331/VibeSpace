# 工作流入口形态对齐 · Context

## 关键文件

### 1. `packages/server/src/harness-template-service.ts` — 改（新增 `uninstallHarnessTemplate` + 追加 `unlink` import）

**现状确认**：

- `getTemplateFiles()` 返回 `HarnessFileSpec[]`，每项 `{ srcAbs, dstRel, kind }`。manifest 范围：`.aimon/skills/*.md`（动态 readdir）+ `.claude/agents/*.md`（动态 readdir）+ `dev/harness-roadmap.md` + `dev/agent-team-blueprint.md` + `.aimon/CUSTOMIZE-harness.md`（后三者静态 + existsSync 守卫）。
- `applyHarnessTemplate()`（L186–L207）**已确认文件级 copyFile**，无整目录拷贝。uninstall 同步文件级 unlink。
- `isHarnessApplied()` 探测点：`existsSync(join(projectPath, ".aimon", "skills"))`（L135）。**uninstall 只删文件不删目录，此探测点卸载后仍返 true**——会导致下次 mount 状态回弹为"已应用"。**见决策 2 / 待主理人拍板**。
- `.gitignore` 追加（L209–L218）：`ensureGitignoreRuntime` 用 appendIfMissing，含 header 注释但**无 marker**——plan 决策"不动 .gitignore"的根因。
- L12 import 现有 `copyFile, mkdir, readdir, readFile, appendFile, writeFile`，**追加 `unlink`**。

**新增（紧接 `applyHarnessTemplate` 之后）**：

```typescript
export interface UninstallResult {
  removedCount: number
  skippedCount: number
  failedFiles: string[]
}

export async function uninstallHarnessTemplate(
  projectPath: string,
): Promise<UninstallResult> {
  const specs = await getTemplateFiles()
  let removedCount = 0, skippedCount = 0
  const failedFiles: string[] = []
  for (const { dstRel } of specs) {
    try {
      await unlink(join(projectPath, dstRel))
      removedCount++
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') skippedCount++
      else failedFiles.push(dstRel)
    }
  }
  return { removedCount, skippedCount, failedFiles }
}
```

### 2. `packages/server/src/routes/projects.ts` — 改（注册 DELETE /harness + 顺手统一 apply-harness scope）

- `apply-harness` 路由（L243–L282）：scope 用 `'installer'`（L249/257/272），与前端 `logAction('project',...)` 不一致 → 顺手 3 处改 `'project'`。
- `harness-applied` 轻量路由（L301–L331）：scope 已 `'project'`，起止配对模板参考。
- `DELETE /dev-docs`（L429–L490）：错误码 `write_failed`/`read_failed`，scope `'project'`。
- 新路由注册位置：L282 与 L284 之间（紧挨 apply-harness）。
- 追加 import：`uninstallHarnessTemplate, UninstallResult`。

**新路由伪代码**：

```typescript
app.delete<{ Params: { id: string } }>(
  "/api/projects/:id/harness",
  async (req, reply) => {
    const proj = getProject(req.params.id)
    if (!proj) return reply.code(404).send({ error: "not_found" })
    const t0 = Date.now()
    serverLog("info", "project", "harness-uninstall 开始", { projectId: proj.id })
    const r = await uninstallHarnessTemplate(proj.path)
    if (r.failedFiles.length > 0) {
      serverLog("error", "project", `harness-uninstall 部分失败 (${Date.now()-t0}ms)`, {
        projectId: proj.id,
        meta: { removedCount: r.removedCount, skippedCount: r.skippedCount, failedCount: r.failedFiles.length },
      })
      return reply.code(207).send({ ok: false, ...r })
    }
    serverLog("info", "project", `harness-uninstall 成功 (${Date.now()-t0}ms)`, {
      projectId: proj.id,
      meta: { removedCount: r.removedCount, skippedCount: r.skippedCount },
    })
    return reply.send({ ok: true, ...r })
  },
)
```

### 3. `packages/web/src/components/PermissionsDrawer.tsx` — 改（WorkflowTab 改造）

**`WorkflowTab` 函数体区间 L1023–L1205**：
- state 声明（L1024–L1030）：在 `harnessLoadError` 之后新增 `harnessRemoving`。
- useEffect（L1032–L1062）：不动。
- `applyHarnessClick()`（L1064–L1083）：保留不动，scope 已是 `'project'`。
- `toggle()`（L1085–L1123）：**完全不动**（confirmDialog + logAction 全保留）。
- JSX return（L1125–L1204）：改 Dev Docs 区块（L1133–L1160）和 Harness 区块（L1162–L1202）。

**改造细节**：
- Dev Docs：移除 checkbox，改"状态行 + 按钮"布局；保留 `claudeMdExists` 灰色子提示。
- Harness：移除"已应用，撤销请联系开发"（L1187–L1189）；按钮根据 enabled 切换"应用"(accent)/"卸载"(rose)。
- disabled 态：`disabled:opacity-50 disabled:cursor-not-allowed`。
- "应用"按钮 class（沿用现状）：`bg-accent text-[#003250] font-medium hover:bg-accent-2 border border-accent/60`。
- "卸载"按钮 class（**待拍板**）：见决策 1。

**新增 `removeHarnessClick()` 函数（紧接 `applyHarnessClick` 之后）**：

```typescript
async function removeHarnessClick() {
  if (harnessRemoving || harnessEnabled !== true) return
  const ok = await confirmDialog(
    '会删除 Harness apply 时拷贝的全部文件（包括你可能修改过的）；用户自行新增的文件不动；.gitignore 不会被修改。',
    { title: 'Harness 卸载确认', confirmLabel: '确认卸载', variant: 'danger' }
  )
  if (!ok) return
  setHarnessRemoving(true)
  try {
    const result = await logAction(
      'project',
      'remove-harness',
      () => api.removeHarness(project.id),
      { projectId: project.id },
    )
    setHarnessEnabled(false)
    if (result.failedFiles.length > 0) {
      await alertDialog(
        `以下文件未删成功（其余已删）：\n${result.failedFiles.join('\n')}`,
        { title: '卸载部分失败', variant: 'danger' }
      )
    }
  } catch (e: unknown) {
    await alertDialog(
      `卸载失败: ${e instanceof Error ? e.message : String(e)}`,
      { title: '卸载 Harness 失败', variant: 'danger' }
    )
  } finally {
    setHarnessRemoving(false)
  }
}
```

注：`logAction` 返回 `fn()` 的值（`HarnessUninstallResult`），207 不抛（`request()` 对 2xx 不 throw），直接判 `failedFiles.length > 0`。`logAction` 失败已自动写 ERROR 日志，catch 里只补 alertDialog。

### 4. `packages/web/src/api.ts` — 改（新增 `removeHarness` + 内联 `HarnessUninstallResult`）

- `removeDevDocs`（L137–L144）：模板可复用。
- `applyHarness`（L115–L119）：前端 scope 已 `'project'`，不动。
- `request()`（L56–L82）：对 2xx（含 207）不 throw，正常返回 JSON。

**新增（紧接 `removeDevDocs` 之后）**：

```typescript
export interface HarnessUninstallResult {
  ok: boolean
  removedCount: number
  skippedCount: number
  failedFiles: string[]
}

export function removeHarness(projectId: string): Promise<HarnessUninstallResult> {
  return request<HarnessUninstallResult>(
    `/api/projects/${encodeURIComponent(projectId)}/harness`,
    { method: 'DELETE' },
  )
}
```

### 5. `packages/web/src/components/dialog/DialogHost.tsx` — 只读

- `confirmDialog(message, opts?: { title?, confirmLabel?, cancelLabel?, variant?: 'info'|'danger' }): Promise<boolean>`（L57–L79）
- `alertDialog(message, opts?: { title?, confirmLabel?, variant?: 'info'|'danger' }): Promise<void>`（L81–L97，无 cancelLabel）

### 6. `packages/server/src/log-bus.ts` — 只读

- `serverLog(level, scope, msg, extra?: { projectId?, sessionId?, meta?: unknown })`（L54–L86）
- meta JSON-serializable ≤2KB；失败时只放 `failedCount`（数字），不放 `failedFiles` 数组。

---

## 决策记录

### 决策 1：卸载按钮配色（**待主理人拍板**）

两个推荐方案均有项目内先例：
- **A · outline rose**：`border border-rose-700/60 text-rose-300 hover:bg-rose-900/30`，与 ButtonRow 删除按钮（L921）对齐，视觉较轻。
- **B · solid bg-rose**：`bg-rose-500 text-white hover:bg-rose-600`，与 confirmDialog 的 danger 按钮对齐，视觉更强。

context 倾向 **A · outline**：卸载是常规操作（已有 confirmDialog 二次确认兜底），solid 红会过度吸引注意。

### 决策 2：`isHarnessApplied` 探测点回弹问题（**待主理人拍板**）

**问题**：探测点是 `existsSync(.aimon/skills/)`，uninstall 只删文件不删目录 → 卸载后下次 mount 抽屉，状态回弹"已应用"。

两个解法：
- **本次修**：uninstall 末尾追加 `rmdir(.aimon/skills/)` + `rmdir(.claude/agents/)` + `rmdir(.aimon/)` 兜底（rmdir 仅在目录空时成功，非空 ENOTEMPTY 跳过——天然保护用户后加的文件）。改动 ≤10 行。
- **下次修**：往 `dev/issues.md` 追加一条"探测点改为检测代表性文件而非目录"，本次不动。

context 倾向 **本次修**（rmdir 自带空目录保护，复杂度低，避免主理人卸载后困惑）。

### 决策 3：uninstall 文件级 unlink 不做 rmSync（已锁定）

apply 已确认文件级 copyFile，对称设计，避免误删用户在同目录新建的文件。

### 决策 4：manifest 动态 + 用户改过的文件无脑删（已锁定）

`getTemplateFiles()` 实时扫；不检测 mtime/hash/dirty；二次确认承担告知责任。

### 决策 5：207 + failedFiles，不回滚（已锁定）

207 Multi-Status 语义正确；failedFiles 在 alertDialog 全显，meta 只放 `failedCount` 控大小。

### 决策 6：不动 .gitignore（已锁定）

apply 追加无 marker，无法精确移除；残留 `.aimon/runtime/` 条目无副作用。

### 决策 7：scope 顺手统一为 `'project'`

后端 apply-harness 3 处 `'installer'`（L249/257/272）改 `'project'`。新增 uninstall 路由直接用 `'project'`。前端已是 `'project'`，不改。

### 决策 8：WorkflowTab 不抽子组件

两块差异（claudeMdExists vs 描述段落），重复 < 30 行；抽子组件需 props 设计 + 耦合差异，反而增维护负担。

### 决策 9：`HarnessUninstallResult` 内联在 api.ts

仅 `removeHarness` + `WorkflowTab` 消费；参照 `PastedImageResult`（L622）先例。

---

## 依赖与约束

- **后端 import**：`harness-template-service.ts` L12 追加 `unlink`；`routes/projects.ts` 顶部 harness import 追加 `uninstallHarnessTemplate, UninstallResult`。
- **框架**：Fastify + `node:fs/promises`，无新依赖。
- **前端**：复用 `logAction` + `confirmDialog` + `alertDialog`，无新依赖。207 通过返回值判，非 catch 路径。
- **TypeScript**：`pnpm -F server tsc --noEmit` + `pnpm -F web tsc --noEmit` 0 错误。
- **日志落盘**：`packages/server/data/logs/YYYY-MM-DD.log` JSONL，`log-bus.ts::appendJsonl` 统一写。
