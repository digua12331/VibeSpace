/**
 * Smoke for selectAutoLessons (SessionStart 记忆按相关性召回).
 * Run: npx tsx scripts/memory-relevance-test.ts  (cwd = packages/server)
 * Exits non-zero on first failed assertion.
 */
import { selectAutoLessons } from "../src/routes/hooks.ts";
import type { MemoryEntry } from "../src/memory-service.ts";

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL- ${label}`);
  }
}

function lesson(
  idx: number,
  task: string,
  body: string,
  files?: string[],
): MemoryEntry {
  return {
    kind: "lesson",
    line: idx + 1,
    text: `- [2026-06-0${(idx % 9) + 1} / ${task}] ${body}`,
    date: "2026-06-01",
    task,
    body,
    files,
  };
}

// Chronological order = array order. Newest is last.
const lessons: MemoryEntry[] = [
  lesson(0, "旧任务A", "和路由无关的前端经验", ["packages/web/src/store.ts"]),
  lesson(1, "归档评审与记忆", "SessionStart 注入相关", ["packages/server/src/routes/hooks.ts"]),
  lesson(2, "无关任务B", "纯样式调整", ["packages/web/src/App.tsx"]),
  lesson(3, "最近任务C", "最新但不相关", ["packages/web/src/foo.tsx"]),
  lesson(4, "最近任务D", "最新但不相关2", ["packages/web/src/bar.tsx"]),
];

// 1) File overlap wins: hint targets hooks.ts → lesson idx 1 must be selected even though it's not newest.
{
  const { selected, mode } = selectAutoLessons(lessons, 2, {
    taskName: "记忆按相关性召回",
    fileHints: ["packages/server/src/routes/hooks.ts"],
  });
  assert(mode === "relevance", "有文件信号 → mode=relevance");
  assert(selected.some((e) => e.files?.includes("packages/server/src/routes/hooks.ts")), "文件重叠条目被选中（排在前）");
}

// 2) No signal at all → recency fallback, last N in chronological order.
{
  const { selected, mode } = selectAutoLessons(lessons, 2, { taskName: "", fileHints: [] });
  assert(mode === "recency", "无任务名+无文件 → mode=recency");
  assert(selected.length === 2 && selected[0].task === "最近任务C" && selected[1].task === "最近任务D", "recency 取最近 2 条且保持时间序");
}

// 3) Hints that match nothing + name with no overlap → all-zero → recency fallback.
{
  const { selected, mode } = selectAutoLessons(lessons, 3, {
    taskName: "zzzz9999",
    fileHints: ["packages/server/src/never-exists.ts"],
  });
  assert(mode === "recency", "全 0 分 → 退回 recency");
  assert(selected.length === 3 && selected[2].task === "最近任务D", "recency 末尾仍是最新条目");
}

// 4) Selected output preserves chronological (idx) order even when picked by score.
{
  const many: MemoryEntry[] = [
    lesson(0, "归档评审与记忆", "早期相关", ["packages/server/src/routes/hooks.ts"]),
    lesson(1, "无关", "中间不相关", ["packages/web/src/x.ts"]),
    lesson(2, "记忆服务", "晚期相关", ["packages/server/src/memory-service.ts"]),
  ];
  const { selected } = selectAutoLessons(many, 2, {
    taskName: "记忆相关",
    fileHints: ["packages/server/src/routes/hooks.ts", "packages/server/src/memory-service.ts"],
  });
  assert(selected.length === 2 && selected[0].line < selected[1].line, "选中条目按原始行序（时间序）输出");
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nall passed");
