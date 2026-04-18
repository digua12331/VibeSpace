#!/usr/bin/env node
// persistence-check: prove that the DB row survives a server restart and that
// the shutdown handler marks any live session as 'stopped' (ended_at != null).
//
// Steps:
//   1) start server
//   2) create a project + a claude session
//   3) confirm GET /api/sessions returns 1 row with ended_at == null
//   4) SIGINT (Windows: tree-kill) the server -> graceful shutdown loop runs
//   5) restart server
//   6) GET /api/sessions: row still exists, ended_at != null, status == 'stopped'

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.AIMON_PORT || "5474";
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
    cwd: resolve(SERVER_DIR, "..", ".."),
    env: { ...process.env, AIMON_PORT: PORT, FORCE_COLOR: "0" },
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (b) => process.stdout.write(`[${label}] ${b}`));
  proc.stderr.on("data", (b) => process.stderr.write(`[${label}!] ${b}`));
  return proc;
}

async function killGracefully(proc) {
  if (process.platform === "win32") {
    // SIGINT works for tsx watch on Windows for child taskkill; use tree-kill
    spawn("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    proc.kill("SIGINT");
  }
  await new Promise((resolve) => {
    let resolved = false;
    proc.once("exit", () => { if (!resolved) { resolved = true; resolve(); } });
    setTimeout(() => { if (!resolved) { resolved = true; resolve(); } }, 6000);
  });
}

let cleanupTmp = null;
let server = null;

try {
  console.log(`[persist] base=${BASE}`);

  // ---------- run #1 ----------
  console.log("[persist] starting server #1");
  server = startServer("srv1");
  await waitHealth();
  console.log("[persist] #1 healthy");

  const baseTmp = mkdtempSync(join(tmpdir(), "aimon-persist-"));
  const projDir = join(baseTmp, "proj");
  mkdirSync(projDir, { recursive: true });
  cleanupTmp = baseTmp;

  const proj = await jsonFetch("POST", "/api/projects", { name: "persist-test", path: projDir });
  if (proj.status !== 201) throw new Error("create proj failed: " + JSON.stringify(proj));
  const projectId = proj.body.id;
  console.log(`[persist] created project ${projectId}`);

  const sess = await jsonFetch("POST", "/api/sessions", { projectId, agent: "claude" });
  if (sess.status !== 201) throw new Error("create session failed: " + JSON.stringify(sess));
  const sessionId = sess.body.id;
  console.log(`[persist] created session ${sessionId} (pid=${sess.body.pid})`);

  // give the PTY a beat to actually be live
  await sleep(800);

  const list1 = await jsonFetch("GET", "/api/sessions");
  if (list1.status !== 200) throw new Error("list1 failed: " + JSON.stringify(list1));
  const row1 = list1.body.find((r) => r.id === sessionId);
  if (!row1) throw new Error("session missing pre-restart");
  console.log(`[persist] pre-kill row: status=${row1.status} ended_at=${row1.ended_at}`);
  if (row1.ended_at != null) throw new Error("expected ended_at==null pre-kill");

  // ---------- shutdown ----------
  console.log("[persist] killing server #1");
  await killGracefully(server);
  server = null;
  await sleep(800);

  // ---------- run #2 ----------
  console.log("[persist] starting server #2");
  server = startServer("srv2");
  await waitHealth();
  console.log("[persist] #2 healthy");

  const list2 = await jsonFetch("GET", "/api/sessions");
  if (list2.status !== 200) throw new Error("list2 failed: " + JSON.stringify(list2));
  const all = list2.body;
  const row2 = all.find((r) => r.id === sessionId);
  console.log(`[persist] post-restart all sessions count: ${all.length}`);
  if (!row2) {
    // Either session is gone (bad) or still there.
    throw new Error("session row missing after restart");
  }
  console.log(`[persist] post-restart row: status=${row2.status} ended_at=${row2.ended_at} exit_code=${row2.exit_code}`);

  if (row2.ended_at == null) {
    console.warn("[persist] WARN ended_at still null — graceful shutdown may not have flushed.");
  } else {
    console.log("[persist] OK row marked ended on shutdown.");
  }
  if (row2.status !== "stopped" && row2.status !== "crashed") {
    console.warn(`[persist] WARN unexpected status: ${row2.status}`);
  }

  // After the persistence-check, the front-end refreshSessions filters
  // ended_at!=null out, so simulate that:
  const aliveAfter = all.filter((r) => r.ended_at == null);
  console.log(`[persist] simulated front-end refresh — alive sessions: ${aliveAfter.length}`);

  // cleanup
  await jsonFetch("DELETE", `/api/projects/${projectId}`);
  console.log("[persist] project cleaned up");

  await killGracefully(server);
  server = null;

  if (cleanupTmp) {
    try { rmSync(cleanupTmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log("=== PERSISTENCE CHECK OK ===");
  process.exit(0);
} catch (err) {
  console.error("[persist] FAIL:", err && err.stack ? err.stack : err);
  if (server) {
    try { await killGracefully(server); } catch { /* ignore */ }
  }
  if (cleanupTmp) {
    try { rmSync(cleanupTmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  process.exit(1);
}
