#!/usr/bin/env node
// worktree-smoke: end-to-end test of T2-A "harness-worktree隔离".
//
// Steps:
//   1) start server (in a child)
//   2) mkdtemp + git init + initial commit
//   3) POST /api/projects { path: tmp }
//   4) POST /api/sessions { isolation: 'worktree' } x2 (agent='shell')
//   5) confirm both responses include worktreeBranch + worktreePath
//   6) write conflicting "test.txt" content into each worktree (different bytes)
//   7) assert: each worktree has its own copy; main repo `git status` stays clean
//   8) DELETE session1 ?gc=true   → worktree dir removed
//      DELETE session2  (no gc)   → worktree dir kept
//   9) POST /api/sessions to a NON-git project → expect 400 not_a_git_repo
//  10) DELETE project → residual worktree dir cleaned (project-delete GC path)
//  11) cleanup tmp + kill server

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.AIMON_PORT || "5476";
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_DIR = resolve(__dirname, "..", "packages", "server");
const REPO_ROOT = resolve(SERVER_DIR, "..", "..");

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function jsonFetch(method, path, body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, init);
  const txt = await res.text();
  let parsed = null;
  if (txt) { try { parsed = JSON.parse(txt); } catch { /* leave as text */ } }
  return { status: res.status, body: parsed ?? txt };
}

async function waitHealth(maxMs = 25_000) {
  const start = Date.now();
  for (;;) {
    try { const r = await fetch(BASE + "/api/health"); if (r.ok) return; } catch { /* retry */ }
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
    spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    proc.kill("SIGINT");
  }
  await new Promise((res) => {
    let resolved = false;
    proc.once("exit", () => { if (!resolved) { resolved = true; res(); } });
    setTimeout(() => { if (!resolved) { resolved = true; res(); } }, 6000);
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
  // First commit so HEAD exists; worktree add HEAD needs a real ref.
  writeFileSync(join(dir, "README.md"), "smoke\n", "utf8");
  git(dir, ["add", "README.md"]);
  git(dir, ["commit", "-m", "init"]);
}

let cleanupTmp = null;
let server = null;

try {
  console.log(`[wt] base=${BASE}`);

  console.log("[wt] starting server");
  server = startServer("srv");
  await waitHealth();
  console.log("[wt] server healthy");

  const baseTmp = mkdtempSync(join(tmpdir(), "aimon-wt-"));
  cleanupTmp = baseTmp;
  const gitProj = join(baseTmp, "git-proj");
  const plainProj = join(baseTmp, "plain-proj");
  initGitRepo(gitProj);
  mkdirSync(plainProj, { recursive: true }); // not a git repo

  // ---------- 3) create git project ----------
  const proj = await jsonFetch("POST", "/api/projects", {
    name: "wt-smoke",
    path: gitProj,
  });
  if (proj.status !== 201) throw new Error("create proj failed: " + JSON.stringify(proj));
  const projectId = proj.body.id;
  console.log(`[wt] project ${projectId} -> ${gitProj}`);

  // ---------- 4) two isolated sessions ----------
  const s1 = await jsonFetch("POST", "/api/sessions", {
    projectId, agent: "shell", isolation: "worktree",
  });
  if (s1.status !== 201) throw new Error("create s1 failed: " + JSON.stringify(s1));
  if (s1.body.isolation !== "worktree") throw new Error("s1 isolation mismatch");
  if (!s1.body.worktreeBranch || !s1.body.worktreePath) throw new Error("s1 missing worktree fields");
  console.log(`[wt] s1 ${s1.body.id} branch=${s1.body.worktreeBranch} path=${s1.body.worktreePath}`);

  const s2 = await jsonFetch("POST", "/api/sessions", {
    projectId, agent: "shell", isolation: "worktree",
  });
  if (s2.status !== 201) throw new Error("create s2 failed: " + JSON.stringify(s2));
  console.log(`[wt] s2 ${s2.body.id} branch=${s2.body.worktreeBranch} path=${s2.body.worktreePath}`);

  // Sanity: paths differ.
  if (s1.body.worktreePath === s2.body.worktreePath) {
    throw new Error("two isolated sessions share the same worktree path");
  }

  // ---------- 6) write conflicting test.txt into each worktree ----------
  await sleep(300); // let PTYs settle (we don't actually use them — direct fs)
  writeFileSync(join(s1.body.worktreePath, "test.txt"), "hello-from-s1\n", "utf8");
  writeFileSync(join(s2.body.worktreePath, "test.txt"), "hello-from-s2\n", "utf8");

  // ---------- 7) verify isolation ----------
  const fileA = readFileSync(join(s1.body.worktreePath, "test.txt"), "utf8");
  const fileB = readFileSync(join(s2.body.worktreePath, "test.txt"), "utf8");
  if (fileA === fileB) throw new Error("two worktrees see the same file content (isolation broken)");
  if (existsSync(join(gitProj, "test.txt"))) {
    throw new Error("main repo has test.txt — isolation leaked into project root");
  }
  const mainStatus = git(gitProj, ["status", "--porcelain"]).trim();
  if (mainStatus !== "") {
    throw new Error("main repo status is dirty after worktree writes: " + mainStatus);
  }
  console.log("[wt] OK isolation: each worktree has own test.txt; main repo clean");

  // ---------- 8) DELETE session 1 with gc=true, session 2 without ----------
  const del1 = await fetch(`${BASE}/api/sessions/${encodeURIComponent(s1.body.id)}?gc=true`, { method: "DELETE" });
  if (del1.status !== 204) throw new Error("delete s1 failed: " + del1.status);
  await sleep(400); // worktree-remove is async path
  if (existsSync(s1.body.worktreePath)) {
    throw new Error("s1 worktree still exists after gc=true delete: " + s1.body.worktreePath);
  }
  console.log("[wt] OK s1 worktree removed (gc=true)");

  const del2 = await fetch(`${BASE}/api/sessions/${encodeURIComponent(s2.body.id)}`, { method: "DELETE" });
  if (del2.status !== 204) throw new Error("delete s2 failed: " + del2.status);
  if (!existsSync(s2.body.worktreePath)) {
    throw new Error("s2 worktree removed despite no gc flag: " + s2.body.worktreePath);
  }
  console.log("[wt] OK s2 worktree retained (no gc)");

  // ---------- 9) non-git project rejects worktree isolation ----------
  const proj2 = await jsonFetch("POST", "/api/projects", {
    name: "wt-smoke-plain",
    path: plainProj,
  });
  if (proj2.status !== 201) throw new Error("create proj2 failed: " + JSON.stringify(proj2));

  const sx = await jsonFetch("POST", "/api/sessions", {
    projectId: proj2.body.id, agent: "shell", isolation: "worktree",
  });
  if (sx.status !== 400) {
    throw new Error("expected 400 for non-git isolated, got " + sx.status + " " + JSON.stringify(sx.body));
  }
  if (sx.body?.error !== "not_a_git_repo") {
    throw new Error("expected error=not_a_git_repo, got " + JSON.stringify(sx.body));
  }
  console.log("[wt] OK non-git project → 400 not_a_git_repo");
  await jsonFetch("DELETE", `/api/projects/${proj2.body.id}`);

  // ---------- 10) deleting the git project should clean residual worktree ----------
  const projDel = await jsonFetch("DELETE", `/api/projects/${projectId}`);
  if (projDel.status !== 200) throw new Error("delete project failed: " + JSON.stringify(projDel));
  await sleep(400);
  if (existsSync(s2.body.worktreePath)) {
    throw new Error("residual worktree not GCed on project delete: " + s2.body.worktreePath);
  }
  console.log("[wt] OK project delete GCs residual worktrees");

  await killGracefully(server);
  server = null;

  if (cleanupTmp) {
    try { rmSync(cleanupTmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log("=== WORKTREE SMOKE OK ===");
  process.exit(0);
} catch (err) {
  console.error("[wt] FAIL:", err && err.stack ? err.stack : err);
  if (server) {
    try { await killGracefully(server); } catch { /* ignore */ }
  }
  if (cleanupTmp) {
    try { rmSync(cleanupTmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  process.exit(1);
}
