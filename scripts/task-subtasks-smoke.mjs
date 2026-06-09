#!/usr/bin/env node
// task-subtasks-smoke: contract check for "大任务自拆并行".
//
// Covers parse / topology / error-paths without spawning real Claude sessions.
// Real worktree + session lifecycle is covered indirectly by the shared
// worktree-session-runner (issues-jobs-smoke already exercises that path).
//
// What this smoke asserts:
//   1) GET subtasks parses valid graph
//   2) write_files overlap auto-adds dep edges
//   3) cycle detection rejects with parseReason='cycle'
//   4) missing-dep rejection
//   5) absence of `## 自拆与依赖` section → parsed=false, reason='no-section'
//   6) POST dispatch on cycle plan → 400
//   7) DELETE non-existent subtask → 404
//   8) POST approve on non-existent subtask → 404
//   9) 404 path on unknown project / task

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

const PORT = process.env.AIMON_PORT || "5476";
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

const TASK_NAME = "smoke-subtask-task";

function planWithGraph(jsonBlock) {
  return [
    "# " + TASK_NAME + " · plan",
    "",
    "## 大哥摘要",
    "smoke test plan",
    "",
    "## 目标",
    "test target",
    "",
    "## 自拆与依赖",
    "",
    "```json",
    jsonBlock,
    "```",
    "",
  ].join("\n");
}

function writeTaskFiles(dir, planContent) {
  const taskDir = join(dir, "dev", "active", TASK_NAME);
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(
    join(taskDir, `${TASK_NAME}-plan.md`),
    planContent,
    "utf8",
  );
  writeFileSync(
    join(taskDir, `${TASK_NAME}-context.md`),
    "# context\nsmoke\n",
    "utf8",
  );
  writeFileSync(
    join(taskDir, `${TASK_NAME}-tasks.md`),
    "# tasks\n\n- [ ] 1 → verify: nope\n",
    "utf8",
  );
}

function assert(cond, label) {
  if (!cond) {
    console.error(`[ts] ✗ ${label}`);
    throw new Error(`assertion failed: ${label}`);
  }
  console.log(`[ts] ✓ ${label}`);
}

let cleanupTmp = null;
let server = null;
let exitCode = 0;

try {
  console.log(`[ts] base=${BASE}`);
  console.log("[ts] starting server");
  server = startServer("srv");
  await waitHealth();
  console.log("[ts] server up");

  const tmp = mkdtempSync(join(tmpdir(), "ts-smoke-"));
  cleanupTmp = tmp;
  console.log(`[ts] tmp=${tmp}`);
  initGitRepo(tmp);

  // ----- Register project -----
  const proj = await jsonFetch("POST", "/api/projects", {
    name: "ts-smoke",
    path: tmp,
  });
  assert(
    proj.status === 200 || proj.status === 201,
    `project create -> ${proj.status}`,
  );
  const projectId = proj.body.id;
  assert(typeof projectId === "string" && projectId.length > 0, "projectId returned");
  const encTask = encodeURIComponent(TASK_NAME);

  // ----- Case 1: 404 paths -----
  const r404Proj = await jsonFetch(
    "GET",
    `/api/projects/does-not-exist/tasks/${encTask}/subtasks`,
  );
  assert(r404Proj.status === 404, `unknown project -> 404 (got ${r404Proj.status})`);

  const r404PlanMissing = await jsonFetch(
    "GET",
    `/api/projects/${projectId}/tasks/${encTask}/subtasks`,
  );
  // Plan.md doesn't exist yet → endpoint should still return parsed=false.
  assert(
    r404PlanMissing.status === 200 &&
      r404PlanMissing.body.parsed === false &&
      r404PlanMissing.body.parseReason === "no-section",
    `missing plan -> parsed=false reason=no-section (got status=${r404PlanMissing.status} reason=${r404PlanMissing.body?.parseReason})`,
  );

  // ----- Case 2: valid graph -----
  const validPlan = planWithGraph(
    JSON.stringify(
      {
        schema_version: 1,
        subtasks: [
          { id: 1, title: "A", write_files: ["a.ts"], depends_on: [] },
          { id: 2, title: "B", write_files: ["b.ts"], depends_on: [1] },
          { id: 3, title: "C", write_files: ["c.ts"], depends_on: [1] },
        ],
      },
      null,
      2,
    ),
  );
  writeTaskFiles(tmp, validPlan);

  const okGet = await jsonFetch(
    "GET",
    `/api/projects/${projectId}/tasks/${encTask}/subtasks`,
  );
  assert(okGet.status === 200, `GET valid -> ${okGet.status}`);
  assert(okGet.body.parsed === true, "valid plan: parsed=true");
  assert(
    okGet.body.graph?.subtasks?.length === 3,
    `valid plan: 3 subtasks (got ${okGet.body.graph?.subtasks?.length})`,
  );
  assert(
    Array.isArray(okGet.body.graph?.order) && okGet.body.graph.order[0] === 1,
    `topo order starts at 1 (got ${JSON.stringify(okGet.body.graph?.order)})`,
  );
  assert(
    Array.isArray(okGet.body.runs) && okGet.body.runs.length === 0,
    "runs empty before dispatch",
  );

  // ----- Case 2b: 确认凭证闸口(经理 AI 边界 managerConfirmGraph) -----
  // 存原值,强制 confirmGraph=on,测拒绝路径(不 spawn claude),最后还原。
  const settBefore = await jsonFetch("GET", "/api/app-settings");
  const origConfirm = settBefore.body?.manager?.confirmGraph;
  await jsonFetch("PUT", "/api/app-settings", { manager: { confirmGraph: true } });
  try {
    // 裸调 dispatch 不带 token → 409 confirm_required
    const noToken = await jsonFetch(
      "POST",
      `/api/projects/${projectId}/tasks/${encTask}/dispatch-subtasks`,
      {},
    );
    assert(
      noToken.status === 409 && noToken.body?.error === "confirm_required",
      `confirmGraph on + 无 token → 409 confirm_required (got ${noToken.status}/${noToken.body?.error})`,
    );
    // prepare-dispatch 发凭证
    const prep = await jsonFetch(
      "POST",
      `/api/projects/${projectId}/tasks/${encTask}/prepare-dispatch`,
      {},
    );
    assert(
      prep.status === 200 &&
        typeof prep.body?.token === "string" &&
        typeof prep.body?.graphHash === "string",
      `prepare-dispatch 发 token+graphHash (got status=${prep.status})`,
    );
    // 带错 token → 仍 409
    const wrongToken = await jsonFetch(
      "POST",
      `/api/projects/${projectId}/tasks/${encTask}/dispatch-subtasks`,
      { confirmToken: "definitely-wrong" },
    );
    assert(
      wrongToken.status === 409 && wrongToken.body?.error === "confirm_required",
      `错 token → 409 confirm_required (got ${wrongToken.status}/${wrongToken.body?.error})`,
    );
  } finally {
    // 还原大哥原设置(只动 confirmGraph 一项)
    if (typeof origConfirm === "boolean") {
      await jsonFetch("PUT", "/api/app-settings", {
        manager: { confirmGraph: origConfirm },
      });
    }
  }

  // ----- Case 2c: 自动合并闸口(allowAutoMerge 默认关 → 403) -----
  const amBefore = await jsonFetch("GET", "/api/app-settings");
  const origAutoMerge = amBefore.body?.manager?.allowAutoMerge;
  await jsonFetch("PUT", "/api/app-settings", { manager: { allowAutoMerge: false } });
  try {
    const autoOff = await jsonFetch(
      "POST",
      `/api/projects/${projectId}/tasks/${encTask}/auto-approve-all`,
      {},
    );
    assert(
      autoOff.status === 403 && autoOff.body?.error === "auto_merge_disabled",
      `allowAutoMerge 关 → auto-approve-all 403 (got ${autoOff.status}/${autoOff.body?.error})`,
    );
  } finally {
    if (typeof origAutoMerge === "boolean") {
      await jsonFetch("PUT", "/api/app-settings", {
        manager: { allowAutoMerge: origAutoMerge },
      });
    }
  }

  // ----- Case 3: write_files overlap → auto-edge -----
  const overlapPlan = planWithGraph(
    JSON.stringify({
      schema_version: 1,
      subtasks: [
        { id: 1, title: "A", write_files: ["shared.ts"], depends_on: [] },
        { id: 2, title: "B", write_files: ["shared.ts"], depends_on: [] },
      ],
    }),
  );
  writeTaskFiles(tmp, overlapPlan);
  const overlapGet = await jsonFetch(
    "GET",
    `/api/projects/${projectId}/tasks/${encTask}/subtasks`,
  );
  assert(overlapGet.body.parsed === true, "overlap plan: parsed=true");
  assert(
    Array.isArray(overlapGet.body.graph?.auto_edges) &&
      overlapGet.body.graph.auto_edges.length > 0,
    `overlap plan: auto_edges added (got ${overlapGet.body.graph?.auto_edges?.length})`,
  );

  // ----- Case 4: cycle -----
  const cyclePlan = planWithGraph(
    JSON.stringify({
      schema_version: 1,
      subtasks: [
        { id: 1, title: "A", write_files: ["a.ts"], depends_on: [2] },
        { id: 2, title: "B", write_files: ["b.ts"], depends_on: [1] },
      ],
    }),
  );
  writeTaskFiles(tmp, cyclePlan);
  const cycleGet = await jsonFetch(
    "GET",
    `/api/projects/${projectId}/tasks/${encTask}/subtasks`,
  );
  assert(cycleGet.body.parsed === false, "cycle plan: parsed=false");
  assert(
    cycleGet.body.parseReason === "cycle",
    `cycle plan: reason=cycle (got ${cycleGet.body.parseReason})`,
  );

  const cycleDispatch = await jsonFetch(
    "POST",
    `/api/projects/${projectId}/tasks/${encTask}/dispatch-subtasks`,
    {},
  );
  assert(
    cycleDispatch.status === 400,
    `cycle dispatch -> 400 (got ${cycleDispatch.status})`,
  );
  assert(
    cycleDispatch.body?.error === "cycle",
    `cycle dispatch: error=cycle (got ${cycleDispatch.body?.error})`,
  );

  // ----- Case 5: missing dep -----
  const missDepPlan = planWithGraph(
    JSON.stringify({
      schema_version: 1,
      subtasks: [
        { id: 1, title: "A", write_files: ["a.ts"], depends_on: [42] },
      ],
    }),
  );
  writeTaskFiles(tmp, missDepPlan);
  const missGet = await jsonFetch(
    "GET",
    `/api/projects/${projectId}/tasks/${encTask}/subtasks`,
  );
  assert(missGet.body.parsed === false, "missing-dep plan: parsed=false");
  assert(
    missGet.body.parseReason === "missing-dep",
    `missing-dep plan: reason=missing-dep (got ${missGet.body.parseReason})`,
  );

  // ----- Case 6: subtask not-found paths -----
  const approve404 = await jsonFetch(
    "POST",
    `/api/projects/${projectId}/tasks/${encTask}/subtasks/9999/approve`,
  );
  assert(
    approve404.status === 404,
    `approve unknown subtask -> 404 (got ${approve404.status})`,
  );
  const reject404 = await jsonFetch(
    "DELETE",
    `/api/projects/${projectId}/tasks/${encTask}/subtasks/9999`,
  );
  assert(
    reject404.status === 404,
    `reject unknown subtask -> 404 (got ${reject404.status})`,
  );

  // ----- Case 7: invalid subtask id format -----
  const badId = await jsonFetch(
    "POST",
    `/api/projects/${projectId}/tasks/${encTask}/subtasks/nope/approve`,
  );
  assert(
    badId.status === 400,
    `invalid subtask id -> 400 (got ${badId.status})`,
  );

  // ----- Case 8: dispatch invalid body -----
  const dispatchBadBody = await jsonFetch(
    "POST",
    `/api/projects/${projectId}/tasks/${encTask}/dispatch-subtasks`,
    { maxConcurrency: 999 },
  );
  assert(
    dispatchBadBody.status === 400,
    `dispatch maxConcurrency=999 -> 400 (got ${dispatchBadBody.status})`,
  );

  // ----- Case 9: 经理战绩指标端点(新项目应全零) -----
  const metrics = await jsonFetch("GET", `/api/projects/${projectId}/manager-metrics`);
  assert(
    metrics.status === 200 &&
      typeof metrics.body?.dispatched === "number" &&
      typeof metrics.body?.merged === "number" &&
      metrics.body.dispatched === 0 &&
      metrics.body.batches === 0,
    `manager-metrics 新项目全零 (got status=${metrics.status} dispatched=${metrics.body?.dispatched})`,
  );
  const metrics404 = await jsonFetch("GET", `/api/projects/nope/manager-metrics`);
  assert(metrics404.status === 404, `unknown project metrics -> 404 (got ${metrics404.status})`);

  console.log("[ts] all assertions passed");
} catch (err) {
  console.error("[ts] FAIL:", err.message);
  exitCode = 1;
} finally {
  if (server) {
    console.log("[ts] killing server");
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
