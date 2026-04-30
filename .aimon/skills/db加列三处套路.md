---
triggers: [db, schema, sessions, 加列, migrate, 字段, 列, sqlite]
---

# DB 加列三处套路（针对 packages/server/src/db.ts）

给 sessions / projects / 任意现有表加列时，**必须三处都改**，否则新建库与升级库行为有差异：

## 三处

1. **`CREATE TABLE IF NOT EXISTS …`** 块（migrate 函数顶部那段）—— 让全新建库的 DB 一开始就有这列
2. **legacy CHECK 重建表**（如果该表还有 legacy migration 路径）—— sessions 表有这条；新表没有就跳过
3. **末尾 `addColumnIfMissing(db, table, column, def)` 一行**—— 让升级老库幂等加列

helper 已经在 db.ts 里：

```ts
function addColumnIfMissing(db, table, column, def): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}
```

## 同步要改的地方

加列后还要同步：

- **类型** `Session` / `SessionRow`（camelCase / snake_case 对照）
- **`createSession` INSERT 语句**和返回对象
- **`rowToSession`** 加字段映射，对 NULL 兜底（`r.x ?? defaultValue`）
- **三处 SELECT 列表**：`listSessions` / `listSessionsByProject` / `getSession` 都要把新列加进 SELECT —— **不加会读到 undefined**
- **route 层**的 `WireSession` interface + `serialize` 函数（如果列要进 wire 响应）

## NOT NULL 列的约束

ALTER TABLE 加 NOT NULL 列**必须有 DEFAULT**才能成功。看现有先例：
- `isolation TEXT NOT NULL DEFAULT 'shared'` ✓
- `worktree_path TEXT`（可 NULL）✓
- `task_name TEXT`（可 NULL）✓

## 最近的先例（参考代码风格）

- `harness-worktree隔离`：加 isolation / worktree_path / worktree_branch
- `harness-task绑定与jobs面板`：加 task_name

直接复制粘贴这些先例的 patch 风格，不要发明新写法。

## 不适用

只改 `data/` 下的 JSON 配置 / 加 in-memory 状态 / 改 routes 不动 DB 时，**不需要**走这套——别上来就动 db.ts。
