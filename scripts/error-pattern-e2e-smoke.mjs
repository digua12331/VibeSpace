#!/usr/bin/env node
// End-to-end smoke for the error-loop monitor pipeline.
//
// Spawns a real backend on an isolated port, opens a WS, fires three same-key
// `level:error` log entries via the WS `log-from-client` channel, and asserts:
//   1. exactly ONE `error-pattern-alert` reaches the WS (cooldown holds);
//   2. the alert payload carries the expected key shape;
//   3. firing three more entries during the cooldown produces NO additional
//      alert;
//   4. the JSONL log file on disk contains a follow-up `warn` entry from
//      `serverLog('warn', 'error-monitor', …)` so the alert is replayable.

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Pick a random high port so back-to-back smoke runs (Windows holds the
// listening socket briefly after SIGTERM) don't collide. Override with
// AIMON_PORT for reproducibility when debugging.
const PORT = process.env.AIMON_PORT || String(40000 + Math.floor(Math.random() * 20000));
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
const SERVER_DIR = resolve(__dirname, "..", "packages", "server");
const LOG_DIR = resolve(SERVER_DIR, "data", "logs");

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

function listLogFilesSnapshot() {
  if (!existsSync(LOG_DIR)) return [];
  return readdirSync(LOG_DIR).filter((n) => n.endsWith(".log"));
}

try {
  console.log(`[error-pattern-e2e] starting backend on ${BASE}`);
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
      console.error(`[error-pattern-e2e] server died early code=${code}`);
    }
  });

  await waitHealth();
  console.log("[error-pattern-e2e] health ok");

  cleanupTmp = mkdtempSync(join(tmpdir(), "aimon-epat-e2e-"));
  const projDir = join(cleanupTmp, "proj");
  mkdirSync(projDir, { recursive: true });
  const proj = await jsonFetch("POST", "/api/projects", { name: "epat-e2e", path: projDir });
  if (proj.status !== 201) throw new Error("create project: " + JSON.stringify(proj));
  const projectId = proj.body.id;
  console.log(`[error-pattern-e2e] project ${projectId}`);

  // Open WS and start collecting alerts before sending any error.
  const ws = new WebSocket(WS_URL);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("ws open timeout")), 5000);
    ws.addEventListener("open", () => { clearTimeout(t); res(); });
    ws.addEventListener("error", (e) => { clearTimeout(t); rej(new Error("ws error " + (e.message || ""))); });
  });

  const alerts = [];
  ws.addEventListener("message", (ev) => {
    const data = typeof ev.data === "string" ? ev.data : ev.data.toString("utf8");
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === "error-pattern-alert") {
      alerts.push(msg.alert);
      console.log(`[error-pattern-e2e] WS alert: scope=${msg.alert.key.scope} action=${msg.alert.key.action} count=${msg.alert.count}`);
    }
  });

  await sleep(200);

  // Fire 3 same-key client errors via WS log-from-client. The server
  // persists each one (appendJsonl) and runs the monitor (safeRecord); the
  // 3rd one trips the threshold and the monitor broadcasts alert + logs a
  // warn entry that we'll later assert in the JSONL.
  const SCOPE = "fs";
  const ACTION = "epat-e2e-write";
  const sendError = (msg) =>
    ws.send(JSON.stringify({
      type: "log-from-client",
      level: "error",
      scope: SCOPE,
      msg,
      projectId,
      meta: { action: ACTION },
    }));

  for (let i = 0; i < 3; i += 1) {
    sendError(`failure attempt ${i + 1}`);
    await sleep(50);
  }
  await sleep(600);

  if (alerts.length !== 1) {
    throw new Error(`expected exactly 1 alert after 3 errors, got ${alerts.length}`);
  }
  const alert = alerts[0];
  if (alert.key.scope !== SCOPE) throw new Error(`alert.key.scope = ${alert.key.scope}, want ${SCOPE}`);
  if (alert.key.action !== ACTION) throw new Error(`alert.key.action = ${alert.key.action}, want ${ACTION}`);
  if (alert.key.actionIsFallback !== false) throw new Error("expected actionIsFallback=false");
  if (alert.key.projectId !== projectId) throw new Error(`alert.key.projectId mismatch: ${alert.key.projectId} vs ${projectId}`);
  if (alert.count < 3) throw new Error(`alert.count = ${alert.count}, want >= 3`);
  console.log("[error-pattern-e2e] alert payload OK");

  // Fire 3 MORE errors during cooldown — must NOT produce another alert.
  for (let i = 0; i < 3; i += 1) {
    sendError(`failure cooldown ${i + 1}`);
    await sleep(50);
  }
  await sleep(600);
  if (alerts.length !== 1) {
    throw new Error(`expected 1 alert (cooldown should suppress), got ${alerts.length}`);
  }
  console.log("[error-pattern-e2e] cooldown suppressed repeat alert OK");

  // Assert the JSONL has the warn entry from serverLog('warn','error-monitor',...).
  // The log filename is YYYY-MM-DD.log under packages/server/data/logs.
  const todayFile = `${new Date().toISOString().slice(0, 10)}.log`;
  const todayPath = join(LOG_DIR, todayFile);
  if (!existsSync(todayPath)) {
    throw new Error(`expected JSONL ${todayPath} to exist`);
  }
  const rawJsonl = readFileSync(todayPath, "utf8");
  const lines = rawJsonl.split(/\r?\n/).filter((l) => l.length > 0);
  let foundWarn = false;
  for (const l of lines) {
    let entry; try { entry = JSON.parse(l); } catch { continue; }
    if (
      entry.level === "warn" &&
      entry.scope === "error-monitor" &&
      entry.meta && typeof entry.meta === "object" && entry.meta.alert === true
    ) {
      foundWarn = true;
      break;
    }
  }
  if (!foundWarn) {
    throw new Error(`JSONL missing warn entry from broadcastAlert (file ${todayPath}, ${lines.length} lines)`);
  }
  console.log("[error-pattern-e2e] JSONL has alert warn entry OK");

  ws.close();
  console.log("=== ERROR-PATTERN E2E SMOKE OK ===");
  process.exit(0);
} catch (err) {
  console.error("[error-pattern-e2e] FAIL:", err && err.stack ? err.stack : err);
  cleanup();
  process.exit(1);
}
