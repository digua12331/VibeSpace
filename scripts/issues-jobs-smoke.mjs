#!/usr/bin/env node
// issues-jobs-smoke: end-to-end check for "issues并行派工" feature.
//
// Covers the **contract** layer:
//   1) GET  /api/projects/:id/issues parses [auto] tag + emits hash field
//   2) POST /api/projects/:id/issues/batch-dispatch rejects with correct
//      `reason` for: not-found / already-done / not-auto
//   3) GET  /api/projects/:id/issue-jobs returns [] when nothing dispatched
//
// Does NOT cover real claude PTY spawn / verify pipeline / approve / reject —
// those depend on a working claude CLI on the host and are validated by
// 大哥 manually (start.bat + browser).

import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.AIMON_PORT || "5477";
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_DIR = resolve(__dirname, "..", "packages", "server");
const REPO_ROOT = resolve(SERVER_DIR, "..", "..");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function jsonFetch(method, path, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, init);
  const txt = await res.text();
  let parsed = null;
  if (txt) {
    try {
      parsed = JSON.parse(txt);
    } catch {
      /* leave as text */
    }
  }
  return { status: res.status, body: parsed ?? txt };
}

async function waitHealth(maxMs = 25_000) {
  const start = Date.now();
  for (;;) {
    try {
      const r = await fetch(BASE + "/api/health");
      if (r.ok) return;
    } catch {
      /* retry */
    }
    if (Date.now() - start > maxMs) throw new Error("health timeout");
    await sleep(200);
  }
}

function startServer(label) {
  const proc = spawn("pnpm", ["--filter", "@aimon/server", "dev"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      AIMON_PORT: PORT,
      AIMON_SKIP_HOOK_INSTALL: "1",
      FORCE_COLOR: "0",
    },
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (b) => process.stdout.write(`[${label}] ${b}`));
  proc.stderr.on("data", (b) => process.stderr.write(`[${label}!] ${b}`));
  return proc;
}

async function killGracefully(proc) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    proc.kill("SIGINT");
  }
  await new Promise((res) => {
    let resolved = false;
    proc.once("exit", () => {
      if (!resolved) {
        resolved = true;
        res();
      }
    });
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        res();
      }
    }, 6000);
  });
}

function git(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (cwd=${cwd}): ${r.stderr || r.stdout}`,
    );
  }
  return r.stdout;
}

function initGitRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "smoke@vibespace.local"]);
  git(dir, ["config", "user.name", "smoke"]);
  writeFileSync(join(dir, "README.md"), "smoke\n", "utf8");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-m", "init"]);
}

function writeIssuesFile(dir) {
  mkdirSync(join(dir, "dev"), { recursive: true });
  const content = [
    "# Issues",
    "",
    "- [ ] [auto] auto-eligible issue waiting to be dispatched",
    "- [ ] plain issue that should not be batch-dispatchable",
    "- [x] [auto] already-done auto issue",
    "- [x] another done issue without auto",
    "",
  ].join("\n");
  writeFileSync(join(dir, "dev", "issues.md"), content, "utf8");
  git(dir, ["add", "dev/issues.md"]);
  git(dir, ["commit", "-m", "add issues"]);
}

function assert(cond, label) {
  if (!cond) {
    console.error(`[ij] ✗ ${label}`);
    throw new Error(`assertion failed: ${label}`);
  }
  console.log(`[ij] ✓ ${label}`);
}

let cleanupTmp = null;
let server = null;
let exitCode = 0;

try {
  console.log(`[ij] base=${BASE}`);

  console.log("[ij] starting server");
  server = startServer("srv");
  await waitHealth();
  console.log("[ij] server up");

  const tmp = mkdtempSync(join(tmpdir(), "ij-smoke-"));
  cleanupTmp = tmp;
  console.log(`[ij] tmp=${tmp}`);
  initGitRepo(tmp);
  writeIssuesFile(tmp);

  // Register project.
  const proj = await jsonFetch("POST", "/api/projects", {
    name: "ij-smoke",
    path: tmp,
  });
  assert(proj.status === 200 || proj.status === 201, `project create -> ${proj.status}`);
  const projectId = proj.body.id;
  assert(typeof projectId === "string" && projectId.length > 0, "projectId returned");

  // GET issues — verify auto + hash fields.
  const issuesRes = await jsonFetch("GET", `/api/projects/${projectId}/issues`);
  assert(issuesRes.status === 200, `GET issues -> ${issuesRes.status}`);
  const items = issuesRes.body.items;
  assert(Array.isArray(items) && items.length === 4, `4 issue items (got ${items?.length})`);

  const autoItem = items.find((i) => !i.done && i.auto);
  const plainItem = items.find((i) => !i.done && !i.auto);
  const doneAutoItem = items.find((i) => i.done && i.auto);

  assert(autoItem, "found auto-eligible item");
  assert(plainItem, "found plain (non-auto) item");
  assert(doneAutoItem, "found done auto item");

  assert(autoItem.auto === true, "auto item: auto=true");
  assert(autoItem.text === "auto-eligible issue waiting to be dispatched", "auto item: [auto] prefix stripped from text");
  assert(/^[0-9a-f]{16}$/.test(autoItem.hash), `auto item: hash is 16 hex chars (got ${autoItem.hash})`);

  assert(plainItem.auto === false, "plain item: auto=false");
  assert(/^[0-9a-f]{16}$/.test(plainItem.hash), "plain item: hash is 16 hex chars");

  assert(doneAutoItem.auto === true, "done auto item: auto=true");
  assert(doneAutoItem.done === true, "done auto item: done=true");

  // GET issue-jobs — should be empty initially.
  const jobs0 = await jsonFetch("GET", `/api/projects/${projectId}/issue-jobs`);
  assert(jobs0.status === 200, `GET issue-jobs -> ${jobs0.status}`);
  assert(Array.isArray(jobs0.body.jobs) && jobs0.body.jobs.length === 0, "issue-jobs empty initially");

  // Reject path 1: not-found hash.
  const reject1 = await jsonFetch("POST", `/api/projects/${projectId}/issues/batch-dispatch`, {
    issueHashes: ["deadbeefdeadbeef"],
  });
  assert(reject1.status === 200, `batch-dispatch (not-found) -> ${reject1.status}`);
  assert(reject1.body.results?.[0]?.reason === "not-found", `reason=not-found (got ${reject1.body.results?.[0]?.reason})`);

  // Reject path 2: already-done hash.
  const reject2 = await jsonFetch("POST", `/api/projects/${projectId}/issues/batch-dispatch`, {
    issueHashes: [doneAutoItem.hash],
  });
  assert(reject2.status === 200, `batch-dispatch (already-done) -> ${reject2.status}`);
  assert(reject2.body.results?.[0]?.reason === "already-done", `reason=already-done (got ${reject2.body.results?.[0]?.reason})`);

  // Reject path 3: not-auto hash.
  const reject3 = await jsonFetch("POST", `/api/projects/${projectId}/issues/batch-dispatch`, {
    issueHashes: [plainItem.hash],
  });
  assert(reject3.status === 200, `batch-dispatch (not-auto) -> ${reject3.status}`);
  assert(reject3.body.results?.[0]?.reason === "not-auto", `reason=not-auto (got ${reject3.body.results?.[0]?.reason})`);

  // After 3 rejected dispatches, no job should have been created.
  const jobs1 = await jsonFetch("GET", `/api/projects/${projectId}/issue-jobs`);
  assert(jobs1.body.jobs.length === 0, "no job created after all-reject dispatches");

  // Schema validation: empty array → 400.
  const bad1 = await jsonFetch("POST", `/api/projects/${projectId}/issues/batch-dispatch`, {
    issueHashes: [],
  });
  assert(bad1.status === 400, `empty hashes -> 400 (got ${bad1.status})`);

  // Schema validation: maxConcurrency too high → 400.
  const bad2 = await jsonFetch("POST", `/api/projects/${projectId}/issues/batch-dispatch`, {
    issueHashes: [autoItem.hash],
    maxConcurrency: 999,
  });
  assert(bad2.status === 400, `maxConcurrency=999 -> 400 (got ${bad2.status})`);

  // 404 paths.
  const notProj = await jsonFetch("GET", "/api/projects/does-not-exist/issue-jobs");
  assert(notProj.status === 404, `unknown project -> 404 (got ${notProj.status})`);

  const notJob = await jsonFetch("POST", `/api/projects/${projectId}/issue-jobs/nope/approve`);
  assert(notJob.status === 404, `unknown job approve -> 404 (got ${notJob.status})`);

  console.log("[ij] all assertions passed");
} catch (err) {
  console.error("[ij] FAIL:", err.message);
  exitCode = 1;
} finally {
  if (server) {
    console.log("[ij] killing server");
    await killGracefully(server);
  }
  if (cleanupTmp) {
    try {
      rmSync(cleanupTmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

process.exit(exitCode);
