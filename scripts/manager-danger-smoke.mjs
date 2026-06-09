#!/usr/bin/env node
// manager-danger-smoke: 单元验证「经理 AI 受约束派工」的危险动作硬检测
// (scanDangerousChanges)。不起 server、不 spawn claude——纯 git + worktree。
//
// 断言:
//   1) 删了文件 → deletes 命中
//   2) 改了 .db 文件 → dbTouch 命中
//   3) 改了 db.ts 加 ALTER TABLE → dbTouch 命中(内容 DDL 兜底)
//   4) 只改普通文件 → deletes/dbTouch 都空(干净放行)
//   5) 非 git 路径 → error=true(fail-closed)
//
// 真源是 packages/server/dist(需先 `pnpm -F @aimon/server build`)。

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DIST = resolve(
  REPO_ROOT,
  "packages",
  "server",
  "dist",
  "routes",
  "task-subtasks.js",
);

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (cwd=${cwd}): ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

function assert(cond, label) {
  if (!cond) {
    console.error(`[danger] ✗ ${label}`);
    throw new Error(`assertion failed: ${label}`);
  }
  console.log(`[danger] ✓ ${label}`);
}

let tmp = null;
let exitCode = 0;

try {
  const { scanDangerousChanges } = await import(pathToFileURL(DIST).href);
  assert(typeof scanDangerousChanges === "function", "scanDangerousChanges 已导出");

  tmp = mkdtempSync(join(tmpdir(), "danger-smoke-"));
  const repo = join(tmp, "proj");
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "smoke@vibespace.local"]);
  git(repo, ["config", "user.name", "smoke"]);
  mkdirSync(join(repo, "data"), { recursive: true });
  writeFileSync(join(repo, "keep.ts"), "export const x = 1\n");
  writeFileSync(join(repo, "victim.ts"), "export const doomed = true\n");
  writeFileSync(join(repo, "db.ts"), "// schema\nexport const cols = ['a']\n");
  writeFileSync(join(repo, "data", "app.db"), "binary-ish\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "init"]);

  // 建一个 worktree 分支模拟子任务
  const wt = join(tmp, "wt");
  git(repo, ["worktree", "add", "-b", "agent/test", wt]);

  // ---- Case 1+2+3: 危险改动(删文件 + 改 .db + db.ts 加 DDL) ----
  unlinkSync(join(wt, "victim.ts"));
  writeFileSync(join(wt, "data", "app.db"), "binary-ish\nMORE\n");
  writeFileSync(
    join(wt, "db.ts"),
    "// schema\nexport const cols = ['a','b']\n// ALTER TABLE sessions ADD COLUMN b\n",
  );
  git(wt, ["add", "-A"]);
  git(wt, ["commit", "-m", "dangerous changes"]);

  const scan1 = await scanDangerousChanges(wt, repo);
  assert(scan1.error === false, `危险场景 error=false (got ${scan1.error})`);
  assert(
    scan1.deletes.some((p) => p.includes("victim.ts")),
    `删除被检出 (deletes=${JSON.stringify(scan1.deletes)})`,
  );
  assert(
    scan1.dbTouch.some((p) => p.includes("app.db") || p.includes("db.ts")),
    `DB 改动被检出 (dbTouch=${JSON.stringify(scan1.dbTouch)})`,
  );

  // ---- Case 4: 干净改动(只改普通文件) ----
  const wt2 = join(tmp, "wt2");
  git(repo, ["worktree", "add", "-b", "agent/clean", wt2]);
  writeFileSync(join(wt2, "keep.ts"), "export const x = 2\n");
  git(wt2, ["add", "-A"]);
  git(wt2, ["commit", "-m", "clean change"]);
  const scan2 = await scanDangerousChanges(wt2, repo);
  assert(scan2.error === false, `干净场景 error=false (got ${scan2.error})`);
  assert(scan2.deletes.length === 0, `干净场景无删除 (got ${JSON.stringify(scan2.deletes)})`);
  assert(scan2.dbTouch.length === 0, `干净场景无 DB 改动 (got ${JSON.stringify(scan2.dbTouch)})`);

  // ---- Case 5: fail-closed(非 git 路径) ----
  const notRepo = join(tmp, "not-a-repo");
  mkdirSync(notRepo, { recursive: true });
  const scan3 = await scanDangerousChanges(notRepo, notRepo);
  assert(scan3.error === true, `非 git 路径 fail-closed error=true (got ${scan3.error})`);

  console.log("[danger] all assertions passed");
} catch (err) {
  console.error("[danger] FAIL:", err.message);
  exitCode = 1;
} finally {
  if (tmp) {
    // worktree 要先 prune 再删,否则 .git 残留引用
    try {
      const repo = join(tmp, "proj");
      spawnSync("git", ["worktree", "prune"], { cwd: repo });
    } catch {
      /* best-effort */
    }
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

process.exit(exitCode);
