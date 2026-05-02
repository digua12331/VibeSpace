// Unit-style smoke for memory-service parsing & formatting.
// Runs under tsx so it can import the .ts sources directly.
// Invoked by scripts/memory-parse-smoke.mjs at repo root.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatLessonLine, readMemory, type MemoryEntry } from "../src/memory-service.ts";
import { extractLessons, normalizeLesson } from "../src/review-runner.ts";

let failures = 0;
let total = 0;

function check(name: string, cond: boolean, detail?: unknown) {
  total += 1;
  if (cond) {
    process.stdout.write(`  PASS  ${name}\n`);
  } else {
    failures += 1;
    process.stdout.write(`  FAIL  ${name}\n`);
    if (detail !== undefined) {
      process.stdout.write(`        ${JSON.stringify(detail)}\n`);
    }
  }
}

function findLesson(entries: MemoryEntry[], task: string): MemoryEntry | undefined {
  return entries.find((e) => e.kind === "lesson" && e.task === task);
}

async function run() {
  const root = mkdtempSync(join(tmpdir(), "vibespace-memory-parse-"));
  mkdirSync(join(root, "dev", "memory"), { recursive: true });
  const autoPath = join(root, "dev", "memory", "auto.md");

  const lines: string[] = [
    "# header (raw line, kept as kind=raw)",
    "",
    // 1. legacy format — no tag segment
    "- [2026-05-01 / 任务A] 这是老条目，没有任何结构标签",
    // 2. new format with all three keys
    "- [2026-05-02 / 任务B] 结构化经验全字段 [category=约定; severity=warn; files=src/foo.ts,src/bar.ts]",
    // 3. body contains brackets but no real trailing tag
    "- [2026-05-02 / 任务C] 看到 [error] 时…(结论)",
    // 4. body contains brackets AND has a real trailing tag (only the LAST one is consumed)
    "- [2026-05-02 / 任务D] 看到 [error] 时…(结论) [category=踩坑]",
    // 5. invalid trailing segment (no `=` inside) — must be left intact
    "- [2026-05-02 / 任务E] 这条结尾的方括号不是标签 [random text without equals]",
    // 6. unknown keys only — must be left intact (recognised=false → null)
    "- [2026-05-02 / 任务F] 全不识别的 key [foo=bar; baz=qux]",
    // 7. severity invalid value — other valid keys still apply
    "- [2026-05-02 / 任务G] severity 非法但 category 有效 [category=操作流程; severity=critical]",
    // 8. partial mix: only severity
    "- [2026-05-02 / 任务H] 只标了严重度 [severity=error]",
    // 9. files with whitespace and trailing comma
    "- [2026-05-02 / 任务I] files 含空白与空段 [files= a.ts , , b.ts ]",
    // 10. round-trip via formatLessonLine
    formatLessonLine("2026-05-02", "任务J", "round-trip 渲染", {
      category: "约定",
      severity: "info",
      files: ["x.ts", "y.ts"],
    }),
  ];
  writeFileSync(autoPath, lines.join("\n") + "\n", "utf8");
  // manual / rejected files are auto-created by readMemory if missing

  const payload = await readMemory(root);

  // raw header preserved
  const header = payload.auto.find((e) => e.line === 1);
  check("raw header preserved as kind=raw", header?.kind === "raw" && header.text.startsWith("# header"));

  // 1. legacy
  const a = findLesson(payload.auto, "任务A");
  check(
    "legacy line: parsed as lesson, no structured tag",
    !!a && a.body === "这是老条目，没有任何结构标签" && a.category === undefined && a.severity === undefined && a.files === undefined,
    a,
  );

  // 2. all three keys
  const b = findLesson(payload.auto, "任务B");
  check(
    "full structured tag: category/severity/files all parsed",
    !!b && b.body === "结构化经验全字段" && b.category === "约定" && b.severity === "warn" &&
      Array.isArray(b.files) && b.files.length === 2 && b.files[0] === "src/foo.ts" && b.files[1] === "src/bar.ts",
    b,
  );

  // 3. body contains brackets, no real tail tag
  const c = findLesson(payload.auto, "任务C");
  check(
    "body brackets without trailing tag: kept verbatim",
    !!c && c.body === "看到 [error] 时…(结论)" && c.category === undefined && c.severity === undefined && c.files === undefined,
    c,
  );

  // 4. body contains brackets AND a real trailing tag
  const d = findLesson(payload.auto, "任务D");
  check(
    "body brackets + trailing tag: only last bracket is the tag",
    !!d && d.body === "看到 [error] 时…(结论)" && d.category === "踩坑",
    d,
  );

  // 5. invalid trailing segment
  const e = findLesson(payload.auto, "任务E");
  check(
    "trailing bracket without `=` is not a tag",
    !!e && e.body === "这条结尾的方括号不是标签 [random text without equals]" && e.category === undefined,
    e,
  );

  // 6. unknown keys only
  const f = findLesson(payload.auto, "任务F");
  check(
    "unknown keys only → tag rejected, body verbatim",
    !!f && f.body === "全不识别的 key [foo=bar; baz=qux]" && f.category === undefined,
    f,
  );

  // 7. severity invalid value but category valid
  const g = findLesson(payload.auto, "任务G");
  check(
    "invalid severity dropped, valid category kept",
    !!g && g.body === "severity 非法但 category 有效" && g.category === "操作流程" && g.severity === undefined,
    g,
  );

  // 8. severity-only
  const h = findLesson(payload.auto, "任务H");
  check(
    "severity-only tag",
    !!h && h.body === "只标了严重度" && h.severity === "error" && h.category === undefined && h.files === undefined,
    h,
  );

  // 9. files with whitespace and empty segments
  const i = findLesson(payload.auto, "任务I");
  check(
    "files: whitespace/empty segments dropped, others trimmed",
    !!i && Array.isArray(i.files) && i.files.length === 2 && i.files[0] === "a.ts" && i.files[1] === "b.ts",
    i,
  );

  // 10. round-trip
  const j = findLesson(payload.auto, "任务J");
  check(
    "formatLessonLine round-trip preserves all three fields",
    !!j && j.body === "round-trip 渲染" && j.category === "约定" && j.severity === "info" &&
      Array.isArray(j.files) && j.files.length === 2 && j.files[0] === "x.ts" && j.files[1] === "y.ts",
    j,
  );

  // formatLessonLine: comma-containing path is filtered out
  const lineWithCommaPath = formatLessonLine("2026-05-02", "任务K", "comma 路径过滤", {
    files: ["valid.ts", "no,comma.ts", "also-valid.ts"],
  });
  check(
    "formatLessonLine drops paths containing comma",
    lineWithCommaPath.endsWith("[files=valid.ts,also-valid.ts]"),
    lineWithCommaPath,
  );

  // formatLessonLine with no opts → no trailing tag
  const plain = formatLessonLine("2026-05-02", "任务L", "纯结论");
  check(
    "formatLessonLine without opts → no trailing tag",
    plain === "- [2026-05-02 / 任务L] 纯结论",
    plain,
  );

  rmSync(root, { recursive: true, force: true });

  // ---------- review-runner.extractLessons (A2 prompt + parse robustness) ----------

  const today = "2026-05-02";
  const taskName = "测试任务";

  // Mixed LLM output: prose intro, valid lessons (some tagged, some not), an
  // invalid multi-line entry, a markdown table, a bare bullet without bracket.
  const mixed = [
    "Sure, here are the lessons I extracted:",
    "",
    "- [2026-05-02 / 测试任务] 普通经验，没有标签",
    "- [2026-05-02 / 测试任务] 带完整标签的经验 [category=约定; severity=warn; files=src/foo.ts]",
    "- [2026-05-02 / 测试任务] 只标了类别 [category=踩坑]",
    "* not a dash bullet — should not match",
    "- bullet without bracket prefix should not match",
    "| col1 | col2 |",
    "| --- | --- |",
    "| a | b |",
    "- [2026-05-02 / 测试任务] 多行经验第一行",
    "  续行内容 — extractLessons should drop the continuation, keep the first line",
    "(no lessons)",
  ].join("\n");

  const extracted = extractLessons(mixed, taskName, today);
  check(
    "extractLessons accepts valid lines (with and without tag)",
    extracted.length === 4,
    extracted,
  );
  check(
    "extractLessons preserves trailing tag in body",
    extracted[1].endsWith("[category=约定; severity=warn; files=src/foo.ts]"),
    extracted[1],
  );
  check(
    "extractLessons keeps tag-less lines",
    extracted[0].endsWith("普通经验，没有标签"),
    extracted[0],
  );
  check(
    "extractLessons rewrites date and task to runner-known values",
    extracted.every((l) => l.startsWith(`- [${today} / ${taskName}] `)),
    extracted,
  );

  // Wide-in: invalid tag segment must not block the lesson — it just falls
  // through extractLessons (which ignores tags entirely) and the body keeps
  // the bracket text. memory-service then sees no recognised tag and leaves
  // the body verbatim. We assert the line still survives extraction.
  const malformed = "- [2026-05-02 / 测试任务] 标签解析会失败 [random text without equals]";
  const malformedOut = extractLessons(malformed, taskName, today);
  check(
    "extractLessons accepts lines whose tag segment is malformed (parse falls back gracefully)",
    malformedOut.length === 1 && malformedOut[0].endsWith("[random text without equals]"),
    malformedOut,
  );

  // Date and task hallucination protection
  const hallucinated = "- [1999-01-01 / 错误任务名] 模型瞎填了日期和任务名 [category=测试]";
  const fixed = normalizeLesson(hallucinated, taskName, today);
  check(
    "normalizeLesson overrides hallucinated date and task",
    fixed === `- [${today} / ${taskName}] 模型瞎填了日期和任务名 [category=测试]`,
    fixed,
  );

  // MAX_LESSONS cap (5)
  const tenLessons = Array.from({ length: 10 }, (_, i) =>
    `- [2026-05-02 / 测试任务] 经验第 ${i + 1} 条`).join("\n");
  const capped = extractLessons(tenLessons, taskName, today);
  check(
    "extractLessons caps at MAX_LESSONS=5",
    capped.length === 5,
    capped.length,
  );

  process.stdout.write(`\n[memory-parse] ${total - failures}/${total} passed\n`);
  if (failures > 0) process.exit(1);
}

run().catch((err) => {
  process.stderr.write(`[memory-parse] CRASH: ${err && err.stack ? err.stack : String(err)}\n`);
  process.exit(1);
});
