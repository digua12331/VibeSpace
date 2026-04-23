import Fastify from "fastify";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getProject } from "../../../../packages/server/src/db.js";
import { registerMemoryRoutes } from "../../../../packages/server/src/routes/memory.js";
import {
  appendLessons,
  readMemory,
} from "../../../../packages/server/src/memory-service.js";

const PROJECT_ID = process.env.SMOKE_PROJECT_ID || "ZJGwyWIP4oqV";

async function main() {
  const proj = getProject(PROJECT_ID);
  if (!proj) throw new Error(`project not found: ${PROJECT_ID}`);
  console.log("[route-smoke] project:", proj.name, "path:", proj.path);

  const autoPath = join(proj.path, "dev/memory/auto.md");
  const backup = await readFile(autoPath, "utf8");

  const app = Fastify({ logger: false });
  await registerMemoryRoutes(app);
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("no address");
  const base = `http://127.0.0.1:${addr.port}`;
  console.log("[route-smoke] listening on", base);

  try {
    const tag = `route-smoke-${Date.now()}`;
    await appendLessons(proj.path, "auto", [
      `- [2026-04-23 / ${tag}] 条目 A（上下文：route 冒烟）`,
      `- [2026-04-23 / ${tag}] 条目 B（上下文：route 冒烟）`,
    ]);

    const getRes = await fetch(`${base}/api/projects/${PROJECT_ID}/memory`);
    if (!getRes.ok) throw new Error(`GET failed: ${getRes.status}`);
    const payload = await getRes.json() as {
      auto: Array<{ kind: string; line: number; text: string }>;
      manual: unknown[];
      rejected: Array<{ kind: string; text: string }>;
    };
    const added = payload.auto.filter((e) => e.kind === "lesson" && e.text.includes(tag));
    console.log("[route-smoke] GET returned added lessons:", added.length);
    if (added.length !== 2) throw new Error(`expected 2 tagged lessons, got ${added.length}`);

    const rollbackRes = await fetch(`${base}/api/projects/${PROJECT_ID}/memory/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ kind: "auto", line: added[0].line }] }),
    });
    if (!rollbackRes.ok) throw new Error(`POST rollback failed: ${rollbackRes.status} ${await rollbackRes.text()}`);
    const after = await rollbackRes.json() as {
      auto: Array<{ kind: string; text: string }>;
      rejected: Array<{ kind: string; text: string }>;
    };
    const afterAdded = after.auto.filter((e) => e.kind === "lesson" && e.text.includes(tag));
    const rejectedAdded = after.rejected.filter((e) => e.kind === "lesson" && e.text.includes(tag));
    const rejectedComments = after.rejected.filter((e) => e.kind === "raw" && e.text.includes("rolled-back from auto.md"));
    console.log("[route-smoke] after rollback — auto tagged:", afterAdded.length, "rejected tagged:", rejectedAdded.length, "rollback comments in rejected:", rejectedComments.length);
    if (afterAdded.length !== 1) throw new Error(`expected 1 remaining, got ${afterAdded.length}`);
    if (rejectedAdded.length !== 1) throw new Error(`expected 1 rolled-back, got ${rejectedAdded.length}`);
    if (rejectedComments.length < 1) throw new Error("expected at least 1 rollback comment in rejected.md");

    console.log("[route-smoke] all assertions passed.");
  } finally {
    await app.close();
    // Restore auto.md and prune the rejected.md entry we just added.
    await writeFile(autoPath, backup, "utf8");
    const rejectedPath = join(proj.path, "dev/memory/rejected.md");
    const rejectedNow = await readFile(rejectedPath, "utf8");
    const cleaned = rejectedNow
      .split(/\r?\n/)
      .filter((ln, i, arr) => {
        if (ln.includes("route-smoke-")) return false;
        if (ln.includes("rolled-back from auto.md") && arr[i + 1]?.includes("route-smoke-")) return false;
        return true;
      })
      .join("\n");
    await writeFile(rejectedPath, cleaned, "utf8");
    // Re-read post-cleanup memory to confirm clean state.
    const finalPayload = await readMemory(proj.path);
    const leftover = [
      ...finalPayload.auto,
      ...finalPayload.rejected,
    ].filter((e) => e.text.includes("route-smoke-"));
    console.log("[route-smoke] leftover after cleanup:", leftover.length);
  }
}

main().catch((err) => {
  console.error("[route-smoke] FAIL:", err);
  process.exit(1);
});
