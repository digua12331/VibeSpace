#!/usr/bin/env node
// codex-smoke: spawn aimon backend, start a real Codex session, and assert the
// heuristic CodexStatusDetector produces working → ... → idle (and stopped on
// kill). Runs on its own port to avoid clashing with a dev backend.

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.AIMON_PORT || "5374";
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
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

function dumpStatuses(frames, label = "") {
  console.log(`[codex-smoke] all status frames${label ? " " + label : ""}:`);
  for (const f of frames) {
    const t = new Date(f.ts).toISOString().slice(11, 23);
    console.log(`  ${t} ${f.status}${f.detail ? " (" + f.detail + ")" : ""}`);
  }
}

try {
  console.log(`[codex-smoke] starting backend on ${BASE}`);
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
      console.error(`[codex-smoke] server died early code=${code}`);
    }
  });

  await waitHealth();
  console.log("[codex-smoke] health ok");

  cleanupTmp = mkdtempSync(join(tmpdir(), "aimon-codex-smoke-"));
  const projDir = join(cleanupTmp, "proj");
  mkdirSync(projDir, { recursive: true });

  const proj = await jsonFetch("POST", "/api/projects", { name: "codex-smoke", path: projDir });
  if (proj.status !== 201) throw new Error("create project: " + JSON.stringify(proj));
  const projectId = proj.body.id;
  console.log(`[codex-smoke] project ${projectId}`);

  const sess = await jsonFetch("POST", "/api/sessions", { projectId, agent: "codex" });
  if (sess.status !== 201) throw new Error("create codex session: " + JSON.stringify(sess));
  const sessionId = sess.body.id;
  console.log(`[codex-smoke] codex session ${sessionId} pid=${sess.body.pid}`);

  // WS subscribe
  const ws = new WebSocket(WS_URL);
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("ws open timeout")), 5000);
    ws.addEventListener("open", () => { clearTimeout(t); res(); });
    ws.addEventListener("error", (e) => { clearTimeout(t); rej(new Error("ws error " + (e.message || ""))); });
  });

  const statuses = [];
  let outputBytes = 0;
  let exitSeen = null;
  ws.addEventListener("message", (ev) => {
    const data = typeof ev.data === "string" ? ev.data : ev.data.toString("utf8");
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === "status" && msg.sessionId === sessionId) {
      statuses.push({ ts: Date.now(), status: msg.status, detail: msg.detail });
      console.log(`[codex-smoke] status: ${msg.status}${msg.detail ? " (" + msg.detail + ")" : ""}`);
    } else if (msg.type === "output" && msg.sessionId === sessionId) {
      outputBytes += (msg.data || "").length;
    } else if (msg.type === "exit" && msg.sessionId === sessionId) {
      exitSeen = { code: msg.code, signal: msg.signal };
      console.log(`[codex-smoke] exit code=${msg.code} signal=${msg.signal}`);
    }
  });
  ws.send(JSON.stringify({ type: "subscribe", sessionIds: [sessionId] }));
  await sleep(200);

  // Phase A: wait ~7s for codex to start, render, idle.
  console.log("[codex-smoke] phase A: waiting 7s for startup → working → idle");
  await sleep(7000);
  console.log(`[codex-smoke] outputBytes after 7s: ${outputBytes}`);

  // If codex is blocked on the upgrade-prompt dialog, the tail will contain
  // "Press enter to continue" and we'll already have flipped to idle (the
  // STRIPPED_PROMPT_RE matches it). Surface that for the operator either way.
  const haveWorking = statuses.some((s) => s.status === "working");
  const haveIdle = statuses.some((s) => s.status === "idle");
  if (!haveWorking || !haveIdle) {
    dumpStatuses(statuses, "(phase A failure)");
    throw new Error(
      `phase A: expected to see 'working' AND 'idle' frames. ` +
      `working=${haveWorking} idle=${haveIdle}. ` +
      `(If outputBytes is small, codex may be waiting on auth/login or upgrade dialog.)`,
    );
  }

  // Order check: at least one 'working' must precede the first 'idle'.
  const firstIdleIdx = statuses.findIndex((s) => s.status === "idle");
  const firstWorkingIdx = statuses.findIndex((s) => s.status === "working");
  if (firstWorkingIdx === -1 || firstIdleIdx === -1 || firstWorkingIdx > firstIdleIdx) {
    dumpStatuses(statuses, "(phase A order failure)");
    throw new Error(`phase A order: working should precede idle (firstWorking=${firstWorkingIdx}, firstIdle=${firstIdleIdx})`);
  }
  console.log("[codex-smoke] phase A OK (working then idle observed)");

  // Phase B: send an input keystroke (just 'x') to trigger a re-render. We do
  // NOT submit a prompt — that would burn LLM tokens / hang the test.
  const beforeB = statuses.length;
  console.log("[codex-smoke] phase B: sending 'x' keystroke and watching for working→idle");
  ws.send(JSON.stringify({ type: "input", sessionId, data: "x" }));
  await sleep(4500);

  const phaseBFrames = statuses.slice(beforeB);
  const bWorking = phaseBFrames.some((s) => s.status === "working");
  const bIdle = phaseBFrames.some((s) => s.status === "idle");
  if (!bWorking || !bIdle) {
    dumpStatuses(statuses, "(phase B failure)");
    console.warn(`[codex-smoke] WARN: phase B did not re-cycle working→idle (working=${bWorking} idle=${bIdle}). ` +
      `This is non-fatal — keystroke may have been dedup'd if the prior 'idle' was very recent.`);
  } else {
    console.log("[codex-smoke] phase B OK (working then idle re-observed)");
  }

  // Erase the keystroke before kill (cosmetic).
  ws.send(JSON.stringify({ type: "input", sessionId, data: "\u0008" }));
  await sleep(300);

  // Phase C: DELETE → expect stopped frame.
  const beforeC = statuses.length;
  console.log("[codex-smoke] phase C: DELETE session, expect 'stopped'");
  const del = await jsonFetch("DELETE", `/api/sessions/${sessionId}`);
  if (del.status !== 204) throw new Error("delete: " + JSON.stringify(del));

  // Wait up to 8s for either 'stopped' frame or exit message.
  const cDeadline = Date.now() + 8000;
  while (Date.now() < cDeadline) {
    const cFrames = statuses.slice(beforeC);
    if (cFrames.some((s) => s.status === "stopped" || s.status === "crashed") || exitSeen) break;
    await sleep(150);
  }
  const stoppedSeen = statuses.slice(beforeC).some((s) => s.status === "stopped");
  if (!stoppedSeen && !exitSeen) {
    dumpStatuses(statuses, "(phase C failure)");
    throw new Error("phase C: no 'stopped' status nor exit frame within 8s");
  }
  console.log(`[codex-smoke] phase C OK (stoppedFrame=${stoppedSeen} exit=${!!exitSeen})`);

  ws.close();
  dumpStatuses(statuses, "(final)");

  console.log("=== CODEX SMOKE OK ===");
  process.exit(0);
} catch (err) {
  console.error("[codex-smoke] FAIL:", err && err.stack ? err.stack : err);
  cleanup();
  process.exit(1);
}
