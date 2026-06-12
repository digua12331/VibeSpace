import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendLessons,
  readMemory,
  rollbackLessons,
} from "../../../../packages/server/src/memory-service.js";

async function main() {
  const root = join(tmpdir(), `aimon-memory-smoke-${Date.now()}`);
  if (existsSync(root)) await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  console.log("[smoke] root:", root);

  // 1. First read initialises all three files.
  let payload = await readMemory(root);
  console.log("[smoke] after init — auto lesson count:", payload.auto.filter((e) => e.kind === "lesson").length);
  if (payload.auto.filter((e) => e.kind === "lesson").length !== 0) throw new Error("expected 0 auto lessons after init");

  // 2. Append two entries to auto.
  await appendLessons(root, "auto", [
    "- [2026-04-23 / 测试任务] 条目一（上下文：冒烟测试）",
    "- [2026-04-23 / 测试任务] 条目二（上下文：冒烟测试）",
  ]);
  payload = await readMemory(root);
  const autoLessons = payload.auto.filter((e) => e.kind === "lesson");
  console.log("[smoke] after append — auto lesson count:", autoLessons.length);
  if (autoLessons.length !== 2) throw new Error(`expected 2 auto lessons, got ${autoLessons.length}`);

  // 3. Rollback the first lesson.
  const firstLine = autoLessons[0].line;
  await rollbackLessons(root, [{ kind: "auto", line: firstLine }]);
  payload = await readMemory(root);
  const remaining = payload.auto.filter((e) => e.kind === "lesson");
  const rejected = payload.rejected.filter((e) => e.kind === "lesson");
  const rejectedRawComments = payload.rejected.filter((e) => e.kind === "raw" && e.text.startsWith("<!-- rolled-back"));
  console.log("[smoke] after rollback — auto lessons:", remaining.length, "rejected lessons:", rejected.length, "rejected comments:", rejectedRawComments.length);
  if (remaining.length !== 1) throw new Error(`expected 1 auto lesson after rollback, got ${remaining.length}`);
  if (rejected.length !== 1) throw new Error(`expected 1 rejected lesson, got ${rejected.length}`);
  if (rejectedRawComments.length !== 1) throw new Error(`expected 1 rolled-back comment line, got ${rejectedRawComments.length}`);

  // 4. Dump file contents for visual inspection.
  for (const name of ["auto.md", "manual.md", "rejected.md"]) {
    const body = await readFile(join(root, "dev/memory", name), "utf8");
    console.log(`\n===== ${name} =====\n${body}`);
  }

  console.log("\n[smoke] all assertions passed.");
}

main().catch((err) => {
  console.error("[smoke] FAIL:", err);
  process.exit(1);
});
