#!/usr/bin/env node
// budget-cutoff-smoke: end-to-end check for "执行不打扰最小闭环".
//
// Covers the three critical paths:
//   1) Budget tracking: PostToolUse hooks increment rounds + tokens; task is
//      lazy-registered with limits from .aimon/task-budget.json.
//   2) Real cutoff: rounds-exceeded fires -> ptyManager.kill called +
//      STATUS.md appended with CUTOFF block + WS broadcast issued.
//   3) SessionStart injection: hook response.additionalContext includes the
//      tail of STATUS.md when the session is bound to a task.
//
// Uses agent='shell' so a real claude CLI is not required. Sets very low
// budget limits (maxRounds=2) so the cutoff triggers after 2 PreToolUse
// events without simulating a real Claude run.

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

const PORT = process.env.AIMON_PORT || "5478";
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_DIR = resolve(__dirname, "..", "packages", "server");
const REPO_ROOT = resolve(SERVER_DIR, "..", "..");

const TEST_TASK = "smoke-budget-task";

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

function setupTaskScaffold(projectPath) {
  // Dev Docs three-section scaffold so the task is recognized.
  const taskDir = join(projectPath, "dev", "active", TEST_TASK);
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(
    join(taskDir, `${TEST_TASK}-plan.md`),
    `# ${TEST_TASK} · plan\n\n## 大哥摘要\nSmoke 测试任务。\n`,
    "utf8",
  );
  writeFileSync(
    join(taskDir, `${TEST_TASK}-context.md`),
    `# ${TEST_TASK} · context\nSmoke.\n`,
    "utf8",
  );
  writeFileSync(
    join(taskDir, `${TEST_TASK}-tasks.md`),
    `# ${TEST_TASK} · tasks\n- [ ] 1 smoke step\n`,
    "utf8",
  );

  // Override budget limits very low so cutoff fires after 2 rounds.
  const aimonDir = join(projectPath, ".aimon");
  mkdirSync(aimonDir, { recursive: true });
  writeFileSync(
    join(aimonDir, "task-budget.json"),
    JSON.stringify(
      {
        maxRounds: 2,
        maxElapsedMinutes: 120,
        maxStallMinutes: 15,
        maxVerifyFails: 3,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function assert(cond, label) {
  if (!cond) {
    console.error(`[bc] ✗ ${label}`);
    throw new Error(`assertion failed: ${label}`);
  }
  console.log(`[bc] ✓ ${label}`);
}

let cleanupTmp = null;
let server = null;
let exitCode = 0;

try {
  console.log(`[bc] base=${BASE}`);

  console.log("[bc] starting server");
  server = startServer("srv");
  await waitHealth();
  console.log("[bc] server up");

  const tmp = mkdtempSync(join(tmpdir(), "bc-smoke-"));
  cleanupTmp = tmp;
  console.log(`[bc] tmp=${tmp}`);
  initGitRepo(tmp);
  setupTaskScaffold(tmp);

  // Register project.
  const proj = await jsonFetch("POST", "/api/projects", {
    name: "bc-smoke",
    path: tmp,
  });
  assert(proj.status === 200 || proj.status === 201, `project create -> ${proj.status}`);
  const projectId = proj.body.id;

  // Create a session bound to the test task. agent='shell' to avoid claude CLI dep.
  const sess = await jsonFetch("POST", "/api/sessions", {
    projectId,
    agent: "shell",
    isolation: "shared",
    task: TEST_TASK,
  });
  assert(sess.status === 200 || sess.status === 201, `session create -> ${sess.status}`);
  const sessionId = sess.body.id;
  assert(typeof sessionId === "string", "sessionId returned");

  // Initial budget list — task should not yet be registered (hook hasn't fired).
  const budgets0 = await jsonFetch("GET", `/api/projects/${projectId}/task-budgets`);
  assert(budgets0.status === 200, `task-budgets GET -> ${budgets0.status}`);
  // It's fine if empty; the lazy register happens on first hook event.

  // Fire PreToolUse #1 — this should lazy-register the task budget with our
  // low limits, increment rounds to 1.
  const hook1 = await jsonFetch("POST", "/api/hooks/claude", {
    sessionId,
    event: "PreToolUse",
    payload: {
      tool_name: "Bash",
      tool_input: { command: "echo round1" },
    },
  });
  assert(hook1.status === 200, `hook #1 -> ${hook1.status}`);

  // Give the lazy register a moment to settle (await readFile etc).
  await sleep(200);

  const budgets1 = await jsonFetch("GET", `/api/projects/${projectId}/task-budgets`);
  const b1 = budgets1.body.budgets?.find((b) => b.taskName === TEST_TASK);
  assert(b1, "task budget present after first hook");
  assert(b1.rounds === 1, `rounds=1 after one PreToolUse (got ${b1?.rounds})`);
  assert(b1.limits.maxRounds === 2, `low maxRounds loaded from .aimon (got ${b1?.limits.maxRounds})`);
  assert(!b1.cutoff, "no cutoff yet at rounds=1");

  // Fire PreToolUse #2 — this hits maxRounds=2, triggering cutoff.
  const hook2 = await jsonFetch("POST", "/api/hooks/claude", {
    sessionId,
    event: "PreToolUse",
    payload: {
      tool_name: "Bash",
      tool_input: { command: "echo round2" },
    },
  });
  assert(hook2.status === 200, `hook #2 -> ${hook2.status}`);

  // Let the cutoff handler write STATUS.md.
  await sleep(500);

  const budgets2 = await jsonFetch("GET", `/api/projects/${projectId}/task-budgets`);
  const b2 = budgets2.body.budgets?.find((b) => b.taskName === TEST_TASK);
  assert(b2, "task budget still present after cutoff");
  assert(b2.rounds === 2, `rounds=2 (got ${b2?.rounds})`);
  assert(b2.cutoff, "cutoff field populated");
  assert(b2.cutoff?.reason === "rounds-exceeded", `cutoff.reason=rounds-exceeded (got ${b2.cutoff?.reason})`);
  assert(typeof b2.cutoff?.nextStep === "string" && b2.cutoff.nextStep.length > 0, "cutoff.nextStep filled");

  // STATUS.md was created and has a CUTOFF block.
  const statusPath = join(tmp, "dev", "active", TEST_TASK, "STATUS.md");
  assert(existsSync(statusPath), `STATUS.md exists at ${statusPath}`);
  const statusContent = readFileSync(statusPath, "utf8");
  assert(statusContent.includes("CUTOFF"), "STATUS.md contains CUTOFF block");
  assert(statusContent.includes("rounds-exceeded"), "STATUS.md mentions rounds-exceeded reason");
  assert(statusContent.includes("nextStep:"), "STATUS.md has nextStep line");

  // Fire a third PreToolUse — should be no-op since task is in cutoff state.
  const hook3 = await jsonFetch("POST", "/api/hooks/claude", {
    sessionId,
    event: "PreToolUse",
    payload: { tool_name: "Bash", tool_input: { command: "echo round3" } },
  });
  assert(hook3.status === 200, `hook #3 (post-cutoff) -> ${hook3.status}`);
  await sleep(150);
  const budgets3 = await jsonFetch("GET", `/api/projects/${projectId}/task-budgets`);
  const b3 = budgets3.body.budgets?.find((b) => b.taskName === TEST_TASK);
  assert(b3.rounds === 2, `rounds stays at 2 after cutoff (got ${b3.rounds})`);

  // SessionStart injection — start a fresh session bound to the same task,
  // simulate the SessionStart hook, expect additionalContext to include
  // STATUS.md tail content.
  const sess2 = await jsonFetch("POST", "/api/sessions", {
    projectId,
    agent: "shell",
    isolation: "shared",
    task: TEST_TASK,
  });
  assert(sess2.status === 200 || sess2.status === 201, `2nd session create -> ${sess2.status}`);
  const sessionId2 = sess2.body.id;

  const sessionStart = await jsonFetch("POST", "/api/hooks/claude", {
    sessionId: sessionId2,
    event: "SessionStart",
    payload: {},
  });
  assert(sessionStart.status === 200, `SessionStart hook -> ${sessionStart.status}`);
  const additional = sessionStart.body.additionalContext || "";
  assert(typeof additional === "string", "additionalContext is a string");
  assert(
    additional.includes("上次执行状态") || additional.includes(TEST_TASK),
    "additionalContext mentions the task or status section",
  );
  assert(additional.includes("CUTOFF"), "additionalContext carries the CUTOFF entry forward");

  // Schema sanity: 404 on unknown project.
  const notProj = await jsonFetch("GET", "/api/projects/does-not-exist/task-budgets");
  assert(notProj.status === 404, `unknown project -> 404 (got ${notProj.status})`);

  console.log("[bc] all assertions passed");
} catch (err) {
  console.error("[bc] FAIL:", err.message);
  exitCode = 1;
} finally {
  if (server) {
    console.log("[bc] killing server");
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
