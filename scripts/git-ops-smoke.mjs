#!/usr/bin/env node
// git-ops-smoke: spawn aimon backend, build a throw-away git repo with a local
// bare remote (file:// URL — no network), then exercise the new git ops:
// pull / push / fetch / branch create+checkout+delete+merge / stash push+pop /
// reset --soft. Asserts return shapes and post-op state.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.AIMON_PORT || "5276";
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_DIR = resolve(__dirname, "..", "packages", "server");

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
  if (txt) { try { parsed = JSON.parse(txt); } catch {} }
  return { status: res.status, body: parsed ?? txt };
}

async function waitHealth(maxMs = 20_000) {
  const start = Date.now();
  for (;;) {
    try { const r = await fetch(BASE + "/api/health"); if (r.ok) return; } catch {}
    if (Date.now() - start > maxMs) throw new Error("health timeout");
    await sleep(200);
  }
}

function runGit(cwd, args) {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "git-ops-smoke",
      GIT_AUTHOR_EMAIL: "smoke@aimon.local",
      GIT_COMMITTER_NAME: "git-ops-smoke",
      GIT_COMMITTER_EMAIL: "smoke@aimon.local",
    },
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
  return r.stdout.trim();
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function changes(projectId) {
  const r = await jsonFetch("GET", `/api/projects/${encodeURIComponent(projectId)}/changes`);
  assert(r.status === 200, "/changes " + r.status);
  return r.body;
}

let serverProc = null;
let cleanupTmp = null;

function cleanup() {
  if (serverProc && !serverProc.killed) {
    try { serverProc.kill("SIGTERM"); } catch {}
  }
  if (cleanupTmp) {
    try { rmSync(cleanupTmp, { recursive: true, force: true }); } catch {}
  }
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

try {
  console.log(`[git-ops-smoke] starting backend on ${BASE}`);
  serverProc = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["tsx", "src/index.ts"],
    {
      cwd: SERVER_DIR,
      env: { ...process.env, AIMON_PORT: PORT },
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    },
  );
  serverProc.stdout.on("data", (b) => process.stdout.write(`[srv] ${b}`));
  serverProc.stderr.on("data", (b) => process.stderr.write(`[srv!] ${b}`));
  serverProc.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[git-ops-smoke] server died early code=${code}`);
    }
  });

  await waitHealth();
  console.log("[git-ops-smoke] health ok");

  // ---- build a bare remote + work repo cloned from it ----
  cleanupTmp = mkdtempSync(join(tmpdir(), "aimon-git-ops-smoke-"));
  const bare = join(cleanupTmp, "remote.git");
  const work = join(cleanupTmp, "work");
  mkdirSync(bare, { recursive: true });
  runGit(bare, ["init", "--bare", "-b", "main"]);
  // file:// URL works on Windows + POSIX
  const remoteUrl = pathToFileURL(bare).href;

  mkdirSync(work, { recursive: true });
  runGit(work, ["init", "-b", "main"]);
  runGit(work, ["remote", "add", "origin", remoteUrl]);
  writeFileSync(join(work, "README.md"), "# initial\n");
  runGit(work, ["add", "README.md"]);
  runGit(work, ["commit", "-m", "initial"]);
  runGit(work, ["push", "-u", "origin", "main"]);

  // ---- create project ----
  const proj = await jsonFetch("POST", "/api/projects", { name: "git-ops-smoke", path: work });
  if (proj.status !== 201) throw new Error("create project: " + JSON.stringify(proj));
  const projectId = proj.body.id;
  const px = encodeURIComponent(projectId);
  console.log(`[git-ops-smoke] project ${projectId} -> ${work}`);

  // ---------- /fetch ----------
  // Make a sister clone, push a new commit, then fetch from work and assert behind>0.
  const sister = join(cleanupTmp, "sister");
  runGit(cleanupTmp, ["clone", remoteUrl, "sister"]);
  writeFileSync(join(sister, "README.md"), "# initial\nfrom sister\n");
  runGit(sister, ["add", "README.md"]);
  runGit(sister, ["commit", "-m", "sister edit"]);
  runGit(sister, ["push"]);

  const fetchRes = await jsonFetch("POST", `/api/projects/${px}/fetch`);
  assert(fetchRes.status === 200, "/fetch status " + fetchRes.status + " body=" + JSON.stringify(fetchRes.body));
  assert(fetchRes.body.ok === true, "/fetch ok flag");
  const afterFetch = await changes(projectId);
  assert(afterFetch.behind >= 1, "behind after fetch should be >=1, got " + afterFetch.behind);
  console.log("[git-ops-smoke] /fetch ok (behind=" + afterFetch.behind + ")");

  // ---------- /pull (--ff-only) ----------
  const pullRes = await jsonFetch("POST", `/api/projects/${px}/pull`);
  assert(pullRes.status === 200, "/pull status " + pullRes.status + " body=" + JSON.stringify(pullRes.body));
  const afterPull = await changes(projectId);
  assert(afterPull.behind === 0, "behind after pull should be 0, got " + afterPull.behind);
  console.log("[git-ops-smoke] /pull ok");

  // ---------- /push ----------
  writeFileSync(join(work, "from-work.txt"), "work\n");
  runGit(work, ["add", "from-work.txt"]);
  runGit(work, ["commit", "-m", "work edit"]);
  const pushRes = await jsonFetch("POST", `/api/projects/${px}/push`);
  assert(pushRes.status === 200, "/push status " + pushRes.status + " body=" + JSON.stringify(pushRes.body));
  const afterPush = await changes(projectId);
  assert(afterPush.ahead === 0, "ahead after push should be 0, got " + afterPush.ahead);
  console.log("[git-ops-smoke] /push ok");

  // ---------- /branches/create (with checkout) ----------
  const cBr = await jsonFetch("POST", `/api/projects/${px}/branches/create`, {
    branch: "feature/x",
    checkout: true,
  });
  assert(cBr.status === 200, "/branches/create " + cBr.status + " body=" + JSON.stringify(cBr.body));
  assert(cBr.body.action === "checked-out" && cBr.body.branch === "feature/x", "branch result shape");
  const afterCBr = await changes(projectId);
  assert(afterCBr.branch === "feature/x", "switched to feature/x, got " + afterCBr.branch);
  console.log("[git-ops-smoke] /branches/create ok");

  // ---------- /branches/checkout (back to main) ----------
  const coMain = await jsonFetch("POST", `/api/projects/${px}/branches/checkout`, { branch: "main" });
  assert(coMain.status === 200, "/branches/checkout main " + coMain.status);
  const afterCoMain = await changes(projectId);
  assert(afterCoMain.branch === "main", "back on main");
  console.log("[git-ops-smoke] /branches/checkout ok");

  // ---------- /merge (no-ff) ----------
  // Add a commit on feature/x then merge into main.
  await jsonFetch("POST", `/api/projects/${px}/branches/checkout`, { branch: "feature/x" });
  writeFileSync(join(work, "feat.txt"), "feature\n");
  runGit(work, ["add", "feat.txt"]);
  runGit(work, ["commit", "-m", "feature commit"]);
  await jsonFetch("POST", `/api/projects/${px}/branches/checkout`, { branch: "main" });
  const mergeRes = await jsonFetch("POST", `/api/projects/${px}/merge`, { branch: "feature/x" });
  assert(mergeRes.status === 200, "/merge " + mergeRes.status + " body=" + JSON.stringify(mergeRes.body));
  // Assert HEAD has 2 parents (no-ff merge commit) — read via git log.
  const headParents = runGit(work, ["log", "-1", "--format=%P"]).split(/\s+/).filter(Boolean);
  assert(headParents.length === 2, "merge commit should have 2 parents, got " + headParents.length);
  console.log("[git-ops-smoke] /merge ok (no-ff confirmed)");

  // ---------- /branches/delete (safe) ----------
  // feature/x is now merged; safe delete should succeed.
  const dBr = await jsonFetch("POST", `/api/projects/${px}/branches/delete`, { branch: "feature/x" });
  assert(dBr.status === 200, "/branches/delete safe " + dBr.status + " body=" + JSON.stringify(dBr.body));
  console.log("[git-ops-smoke] /branches/delete (safe) ok");

  // ---------- /branches/delete (force) on unmerged branch ----------
  await jsonFetch("POST", `/api/projects/${px}/branches/create`, { branch: "throwaway" });
  await jsonFetch("POST", `/api/projects/${px}/branches/checkout`, { branch: "throwaway" });
  writeFileSync(join(work, "throw.txt"), "throw\n");
  runGit(work, ["add", "throw.txt"]);
  runGit(work, ["commit", "-m", "throw commit"]);
  await jsonFetch("POST", `/api/projects/${px}/branches/checkout`, { branch: "main" });
  const safeDel = await jsonFetch("POST", `/api/projects/${px}/branches/delete`, { branch: "throwaway" });
  assert(safeDel.status >= 400, "safe delete of unmerged branch must fail, got " + safeDel.status);
  const forceDel = await jsonFetch("POST", `/api/projects/${px}/branches/delete`, { branch: "throwaway", force: true });
  assert(forceDel.status === 200, "/branches/delete force " + forceDel.status + " body=" + JSON.stringify(forceDel.body));
  console.log("[git-ops-smoke] /branches/delete (safe-fail + force) ok");

  // ---------- /stash push + /stashes + /stash/pop ----------
  writeFileSync(join(work, "scratch.txt"), "wip\n");
  // need to track the file too — stash with --include-untracked covers it.
  const beforeStash = await changes(projectId);
  assert(
    beforeStash.untracked.some((e) => e.path === "scratch.txt"),
    "scratch.txt should be untracked before stash",
  );
  const sPush = await jsonFetch("POST", `/api/projects/${px}/stash`, { message: "wip-test" });
  assert(sPush.status === 200, "/stash push " + sPush.status + " body=" + JSON.stringify(sPush.body));
  const afterStashPush = await changes(projectId);
  assert(
    !afterStashPush.untracked.some((e) => e.path === "scratch.txt"),
    "scratch.txt cleared after stash push",
  );
  const sList = await jsonFetch("GET", `/api/projects/${px}/stashes`);
  assert(sList.status === 200 && Array.isArray(sList.body) && sList.body.length === 1, "stash list count");
  const sPop = await jsonFetch("POST", `/api/projects/${px}/stash/pop`);
  assert(sPop.status === 200, "/stash pop " + sPop.status + " body=" + JSON.stringify(sPop.body));
  const afterStashPop = await changes(projectId);
  assert(
    afterStashPop.untracked.some((e) => e.path === "scratch.txt"),
    "scratch.txt restored after stash pop",
  );
  console.log("[git-ops-smoke] /stash push+list+pop ok");

  // Clean scratch + commit something so reset-soft has a real target.
  rmSync(join(work, "scratch.txt"), { force: true });
  writeFileSync(join(work, "for-reset.txt"), "to-undo\n");
  runGit(work, ["add", "for-reset.txt"]);
  runGit(work, ["commit", "-m", "to-undo"]);
  const headBefore = runGit(work, ["rev-parse", "HEAD"]);

  // ---------- /reset-soft ----------
  const rs = await jsonFetch("POST", `/api/projects/${px}/reset-soft`);
  assert(rs.status === 200, "/reset-soft " + rs.status + " body=" + JSON.stringify(rs.body));
  assert(rs.body.previousHead === headBefore, "previousHead matches");
  const afterReset = await changes(projectId);
  assert(
    afterReset.staged.some((e) => e.path === "for-reset.txt"),
    "for-reset.txt back in staged after reset --soft",
  );
  console.log("[git-ops-smoke] /reset-soft ok");

  // ---------- error path: pull on detached HEAD ----------
  const sha = runGit(work, ["rev-parse", "HEAD"]);
  runGit(work, ["checkout", sha]);
  const detachedPull = await jsonFetch("POST", `/api/projects/${px}/pull`);
  assert(detachedPull.status >= 400, "pull on detached must fail, got " + detachedPull.status);
  console.log("[git-ops-smoke] error path: pull on detached HEAD rejected ok");
  // Restore to main so cleanup doesn't get confused.
  runGit(work, ["checkout", "main"]);

  // ---------- error path: invalid branch name ----------
  const badBr = await jsonFetch("POST", `/api/projects/${px}/branches/create`, { branch: "../etc/passwd" });
  assert(badBr.status === 400, "invalid branch must 400, got " + badBr.status);
  console.log("[git-ops-smoke] error path: invalid branch rejected ok");

  console.log("\n[git-ops-smoke] ALL OK ✅");
  process.exit(0);
} catch (err) {
  console.error("\n[git-ops-smoke] FAIL ❌", err);
  process.exit(1);
}
