# fix-persistence-cascade · 待启动任务（线索）

> 本文件是线索登记，**不是正式的 Dev Docs 三段式**。等用户准备动手时，说 "启动 fix-persistence-cascade"，再按流程生成 plan.md / context.md / tasks.md。

## 症状

`pnpm smoke:persistence` 失败：

```
[persist] post-restart all sessions count: 0
[persist] FAIL: Error: session row missing after restart
```

server #1 创建 session → 写入 DB → kill server #1 → 启 server #2 → `GET /api/sessions` 返回空。按 smoke 的预期，session row 应在（`ended_at` 会被 reap 置为 now，但 row 不该消失）。

## 根因假设

- [packages/server/src/db.ts:79-88](../../../packages/server/src/db.ts#L79-L88) `syncProjectsTable` 在启动时对 `projects` 表做 `DELETE FROM projects` → 再 `INSERT`
- [packages/server/src/db.ts:107](../../../packages/server/src/db.ts#L107) `sessions.project_id` 带 `REFERENCES projects(id) ON DELETE CASCADE`
- 即使同一个 project id 被 INSERT 回来，DELETE 瞬间的 CASCADE 已把 sessions 全部删光

## 可能的修复方向（仅供参考，不算 plan）

- 把 `syncProjectsTable` 改成"upsert"语义：`INSERT OR REPLACE`，或做 diff 后逐条 UPDATE / INSERT / DELETE，只删真的不再存在的 project，保持引用它的 session 不被牵连
- 或者把 sessions → projects 的外键约束放宽（`ON DELETE SET NULL` / 去掉 CASCADE），让 session 记录即使对应 project 被删也不消失

两种都要配合一次 DB 迁移；第一种更贴近"projects.json 是唯一真相"的现状。

## 触发 / 放大条件

在处理 dual-instance-iteration 任务过程中发现。当时工作区里还有**本任务之外**的未提交改动（`packages/server/src/routes/fs-ops.ts` +78 行、`packages/web/src/api.ts` +17 行、`packages/web/src/components/fileContextMenu.ts` +19 行、`packages/web/src/components/layout/ProjectsColumn.tsx` +18 行），不确定是否参与放大。启动正式任务前建议先 `git status` 把工作区弄干净，只带这个修复上车。

## 对其他任务的影响

`dual-instance-iteration` 本任务**不修复**这个问题（外科式改动原则）。其它 3 个 smoke（`smoke:hooks` / `smoke:server` / `smoke:refresh`）全部通过，本任务的改动不触碰 db.ts / sessions / projects 任何业务逻辑，因此确认无新回归引入。
