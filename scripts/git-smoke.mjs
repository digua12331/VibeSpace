#!/usr/bin/env node
// git-smoke: spawn aimon backend, create a throw-away git repo as a project,
// then exercise the 5 git routes and assert the shapes.

import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.AIMON_PORT || "5275";
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
      GIT_AUTHOR_NAME: "git-smoke",
      GIT_AUTHOR_EMAIL: "smoke@aimon.local",
      GIT_COMMITTER_NAME: "git-smoke",
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
  console.log(`[git-smoke] starting backend on ${BASE}`);
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
      console.error(`[git-smoke] server died early code=${code}`);
    }
  });

  await waitHealth();
  console.log("[git-smoke] health ok");

  // ---- build a throw-away git repo ----
  cleanupTmp = mkdtempSync(join(tmpdir(), "aimon-git-smoke-"));
  const repo = join(cleanupTmp, "repo");
  mkdirSync(repo, { recursive: true });
  runGit(repo, ["init", "-b", "main"]);
  writeFileSync(join(repo, "README.md"), "# hello\n\nInitial content.\n");
  runGit(repo, ["add", "README.md"]);
  runGit(repo, ["commit", "-m", "initial"]);
  const firstSha = runGit(repo, ["rev-parse", "HEAD"]);
  writeFileSync(join(repo, "README.md"), "# hello\n\nInitial content.\nAdded line.\n");
  writeFileSync(join(repo, "new.txt"), "brand new\n");
  runGit(repo, ["add", "README.md", "new.txt"]);
  runGit(repo, ["commit", "-m", "second"]);
  const secondSha = runGit(repo, ["rev-parse", "HEAD"]);

  // leave one unstaged edit + one staged edit + one untracked file
  writeFileSync(join(repo, "README.md"), "# hello\n\nInitial content.\nAdded line.\nWorking tree edit.\n");
  writeFileSync(join(repo, "staged.txt"), "staged\n");
  runGit(repo, ["add", "staged.txt"]);
  writeFileSync(join(repo, "untracked.txt"), "nothing to see\n");

  // ---- create project ----
  const proj = await jsonFetch("POST", "/api/projects", { name: "git-smoke", path: repo });
  if (proj.status !== 201) throw new Error("create project: " + JSON.stringify(proj));
  const projectId = proj.body.id;
  console.log(`[git-smoke] project ${projectId} -> ${repo}`);

  // ---- /changes ----
  const changes = await jsonFetch("GET", `/api/projects/${encodeURIComponent(projectId)}/changes`);
  assert(changes.status === 200, "/changes status " + changes.status);
  assert(changes.body.enabled === true, "/changes enabled");
  assert(changes.body.branch === "main", "/changes branch: " + changes.body.branch);
  assert(changes.body.staged.some((e) => e.path === "staged.txt"), "staged.txt in staged");
  assert(changes.body.unstaged.some((e) => e.path === "README.md"), "README.md in unstaged");
  assert(changes.body.untracked.some((e) => e.path === "untracked.txt"), "untracked.txt in untracked");
  console.log("[git-smoke] /changes ok", {
    staged: changes.body.staged.length,
    unstaged: changes.body.unstaged.length,
    untracked: changes.body.untracked.length,
  });

  // ---- /commits ----
  const commits = await jsonFetch("GET", `/api/projects/${encodeURIComponent(projectId)}/commits?limit=5`);
  assert(commits.status === 200 && Array.isArray(commits.body), "/commits shape");
  assert(commits.body.length >= 2, "commits >=2");
  assert(commits.body[0].sha === secondSha, "first commit sha matches HEAD");
  console.log("[git-smoke] /commits ok, first:", commits.body[0].shortSha, commits.body[0].subject);

  // ---- /commits/:sha ----
  const detail = await jsonFetch("GET", `/api/projects/${encodeURIComponent(projectId)}/commits/${secondSha}`);
  assert(detail.status === 200, "/commits/:sha status");
  assert(Array.isArray(detail.body.files) && detail.body.files.length > 0, "commit files");
  assert(detail.body.files.some((f) => f.path === "new.txt" && f.status === "A"), "new.txt added");
  console.log("[git-smoke] /commits/:sha ok, files:", detail.body.files.map((f) => `${f.status}:${f.path}`).join(", "));

  // ---- /file (WORKTREE default) ----
  const fileWT = await jsonFetch(
    "GET",
    `/api/projects/${encodeURIComponent(projectId)}/file?path=README.md`,
  );
  assert(fileWT.status === 200, "/file WORKTREE status");
  assert(fileWT.body.content.includes("Working tree edit"), "WT content has local edit");
  assert(fileWT.body.language === "md", "language=md");

  // ---- /file (HEAD) ----
  const fileHEAD = await jsonFetch(
    "GET",
    `/api/projects/${encodeURIComponent(projectId)}/file?path=README.md&ref=HEAD`,
  );
  assert(fileHEAD.status === 200, "/file HEAD status");
  assert(!fileHEAD.body.content.includes("Working tree edit"), "HEAD content does not have local edit");

  // ---- /file (specific sha) ----
  const fileFirst = await jsonFetch(
    "GET",
    `/api/projects/${encodeURIComponent(projectId)}/file?path=README.md&ref=${firstSha}`,
  );
  assert(fileFirst.status === 200, "/file sha status");
  assert(!fileFirst.body.content.includes("Added line"), "first-commit content");

  console.log("[git-smoke] /file ok (WORKTREE + HEAD + sha)");

  // ---- /diff (HEAD..WORKTREE, default) ----
  const diffWT = await jsonFetch(
    "GET",
    `/api/projects/${encodeURIComponent(projectId)}/diff?path=README.md`,
  );
  assert(diffWT.status === 200, "/diff status");
  assert(diffWT.body.patch.includes("Working tree edit"), "diff patch contains WT text");
  assert(diffWT.body.from === "HEAD" && diffWT.body.to === "WORKTREE", "diff refs default");

  // ---- /diff (first..second) ----
  const diffShas = await jsonFetch(
    "GET",
    `/api/projects/${encodeURIComponent(projectId)}/diff?path=README.md&from=${firstSha}&to=${secondSha}`,
  );
  assert(diffShas.status === 200, "/diff sha status");
  assert(diffShas.body.patch.includes("Added line"), "diff sha patch");
  console.log("[git-smoke] /diff ok");

  // ---- path traversal guard ----
  const bad = await jsonFetch(
    "GET",
    `/api/projects/${encodeURIComponent(projectId)}/file?path=../../etc/passwd`,
  );
  assert(bad.status === 400, "path traversal must 400, got " + bad.status);
  console.log("[git-smoke] path traversal rejected");

  console.log("\n[git-smoke] ALL OK ✅");
  process.exit(0);
} catch (err) {
  console.error("\n[git-smoke] FAIL ❌", err);
  process.exit(1);
}
